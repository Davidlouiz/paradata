from fastapi import APIRouter, HTTPException, status, Query, Depends
from datetime import datetime, timedelta, timezone
from typing import Optional, List
import json
from shapely.geometry import shape

from app.database import get_db, dict_from_row
from app.models import (
    MapObjectCreate,
    MapObjectUpdate,
    MapObjectResponse,
    MapObjectsListResponse,
    SingleMapObjectResponse,
    CheckoutResponse,
    BoundingBox,
)
from app.services.quota import (
    check_daily_quota,
    get_daily_usage_breakdown,
    get_remaining_quota,
    DAILY_CREATE_LIMIT,
    DAILY_UPDATE_LIMIT,
    DAILY_DELETE_LIMIT,
)
from app.api.auth import get_current_user, require_login
from app.services.ws_manager import manager

# Import sio from main (will be injected)
sio = None


def set_sio(socket_server):
    """Inject Socket.IO instance."""
    global sio
    sio = socket_server


router = APIRouter()


def _geometry_intersects_existing(
    conn, new_geom_json: dict, exclude_id: int | None = None
) -> bool:
    """Return True if new geometry intersects any existing non-deleted geometry.

    Erodes both geometries by ~10cm (0.00001°) to tolerate boundary contacts.
    """
    AREA_EPSILON = 1e-10  # tolerate tiny numeric overlaps
    BUFFER_DISTANCE = 0.00001  # ~10cm buffer for boundary tolerance

    try:
        new_geom = shape(new_geom_json)
        # Erode the new geometry slightly to avoid boundary conflicts
        new_geom = new_geom.buffer(-BUFFER_DISTANCE)
        if new_geom.is_empty:
            return False
    except Exception:
        return False

    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT id, geometry
        FROM map_objects
        WHERE deleted_at IS NULL
        """
    )
    rows = cursor.fetchall()
    for row in rows:
        row_id = row[0]
        if exclude_id and row_id == exclude_id:
            continue
        try:
            existing = shape(json.loads(row[1]))
            # Erode the existing geometry slightly to avoid boundary conflicts
            existing = existing.buffer(-BUFFER_DISTANCE)
            if existing.is_empty:
                continue
        except Exception:
            continue
        if not new_geom.intersects(existing):
            continue
        intersection = new_geom.intersection(existing)
        if intersection.is_empty:
            continue
        # Allow boundary contacts and negligible overlaps; block only if area is meaningful
        if intersection.area <= AREA_EPSILON:
            continue
        return True
    return False


LOCK_DURATION_MINUTES = 15

# Grace windows after creation (free actions by creator)
GRACE_UPDATE_MINUTES = 30  # free updates within 30 minutes after creation
GRACE_DELETE_MINUTES = 15  # free delete within 15 minutes after creation


def parse_utc(dt_str: str) -> datetime:
    """Parse ISO string and return timezone-aware UTC datetime."""
    if not dt_str:
        return None
    dt = datetime.fromisoformat(dt_str)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return dt


def serialize_map_object(row: dict, conn=None) -> MapObjectResponse:
    """Convert database row to MapObjectResponse."""
    if not row:
        return None

    # Get creator username
    if conn is None:
        conn = get_db()
    cursor = conn.cursor()

    cursor.execute("SELECT username FROM users WHERE id = ?", (row["created_by"],))
    creator = cursor.fetchone()
    created_by_username = creator[0] if creator else "Unknown"

    updated_by_username = None
    if row["updated_by"]:
        cursor.execute("SELECT username FROM users WHERE id = ?", (row["updated_by"],))
        updater = cursor.fetchone()
        updated_by_username = updater[0] if updater else None

    locked_by_username = None
    lock_expires_at = None
    if row["locked_by"]:
        cursor.execute("SELECT username FROM users WHERE id = ?", (row["locked_by"],))
        locker = cursor.fetchone()
        locked_by_username = locker[0] if locker else None
        lock_expires_at = row["lock_expires_at"]

    return MapObjectResponse(
        id=row["id"],
        geometry=json.loads(row["geometry"]),
        severity=row["severity"],
        description=row["description"],
        created_by=row["created_by"],
        created_by_username=created_by_username,
        created_at=row["created_at"],
        updated_by=row["updated_by"],
        updated_by_username=updated_by_username,
        updated_at=row["updated_at"],
        lock={
            "locked_by": row["locked_by"],
            "locked_by_username": locked_by_username,
            "lock_expires_at": lock_expires_at,
        }
        if row["locked_by"]
        else None,
    )


def _audit_snapshot(geometry_json: str, severity: str, description: str | None) -> str:
    """Build a JSON snapshot for audit comparisons."""
    try:
        geometry = json.loads(geometry_json)
    except Exception:
        geometry = geometry_json
    return json.dumps(
        {
            "geometry": geometry,
            "severity": severity,
            "description": description,
        }
    )


def _quota_message(user_id: int) -> str:
    breakdown = get_daily_usage_breakdown(user_id)
    return (
        "Quota journalier atteint ("
        f"créations: {breakdown['CREATE']}/{DAILY_CREATE_LIMIT}, "
        f"modifications: {breakdown['UPDATE']}/{DAILY_UPDATE_LIMIT}, "
        f"suppressions: {breakdown['DELETE']}/{DAILY_DELETE_LIMIT})"
    )


def _is_within_creation_grace(obj: dict, user_id: int, minutes: int) -> bool:
    """Return True if creator acts within grace window after creation."""
    if obj.get("created_by") != user_id:
        return False
    created_at = parse_utc(obj.get("created_at"))
    if not created_at:
        return False
    return datetime.now(timezone.utc) - created_at <= timedelta(minutes=minutes)


def _is_delete_undo_create(obj: dict, user: dict) -> bool:
    """Return True if delete qualifies as an undo of a recent self-created object."""
    # Deprecated stricter rule; kept for reference. Use grace helper instead.
    return _is_within_creation_grace(obj, user["id"], GRACE_DELETE_MINUTES)


def _is_update_rollback(
    conn, object_id: int, user_id: int, target_snapshot: str
) -> bool:
    """Return True if the update reverts the user's last change within 30 minutes."""
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT action, user_id, before_data, after_data, timestamp
        FROM audit_log
        WHERE object_id = ? AND action = 'UPDATE'
        ORDER BY timestamp DESC
        LIMIT 1
    """,
        (object_id,),
    )
    row = cursor.fetchone()
    if not row:
        return False
    if row[1] != user_id:
        return False

    ts = parse_utc(row[4])
    if not ts or datetime.now(timezone.utc) - ts > timedelta(minutes=30):
        return False

    before_data = row[2]
    if not before_data:
        return False

    try:
        before_obj = json.loads(before_data)
        target_obj = json.loads(target_snapshot)
    except Exception:
        return False

    return before_obj == target_obj


def _is_update_chain_by_sequence(conn, object_id: int, user_id: int) -> bool:
    """
    Retouche successive de la même zone par le même utilisateur:
    Si la dernière action dans l'audit est une modification par ce même utilisateur,
    alors la nouvelle modification est considérée comme une retouche et ne consomme pas de quota.
    Pas de notion de temps ou de verrou.
    """
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT user_id, action
        FROM audit_log
        WHERE object_id = ?
        ORDER BY timestamp DESC
        LIMIT 1
        """,
        (object_id,),
    )
    row = cursor.fetchone()
    if not row:
        return False
    # sqlite returns tuples here
    uid = row[0]
    action = row[1]
    return uid == user_id and action in (
        "UPDATE",
        "GRACE_UPDATE",
        "UNDO_UPDATE",
        "GRACE_UPDATE_CHAIN",
    )


@router.get("", response_model=MapObjectsListResponse)
async def list_map_objects(
    minLat: float = Query(...),
    minLng: float = Query(...),
    maxLat: float = Query(...),
    maxLng: float = Query(...),
):
    """Get visible map objects in bbox (public endpoint)."""
    conn = get_db()
    cursor = conn.cursor()

    # Get all non-deleted objects (simplified: ignore bbox for now)
    cursor.execute("""
        SELECT * FROM map_objects
        WHERE deleted_at IS NULL
        ORDER BY created_at DESC
    """)

    rows = cursor.fetchall()
    conn.close()

    objects = [serialize_map_object(dict_from_row(row)) for row in rows]

    return MapObjectsListResponse(success=True, data=objects)


@router.get("/{object_id}", response_model=SingleMapObjectResponse)
async def get_map_object(object_id: int):
    """Get single map object by ID (public endpoint)."""
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute(
        """
        SELECT * FROM map_objects
        WHERE id = ? AND deleted_at IS NULL
    """,
        (object_id,),
    )

    row = dict_from_row(cursor.fetchone())
    conn.close()

    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Object not found"
        )

    return SingleMapObjectResponse(success=True, data=serialize_map_object(row))


@router.post("", response_model=SingleMapObjectResponse)
async def create_map_object(req: MapObjectCreate, user: dict = Depends(require_login)):
    """Create a new map object."""
    # Check quota
    if not check_daily_quota(user["id"], "CREATE"):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=_quota_message(user["id"]),
        )

    # Validate geometry
    if not req.geometry or req.geometry.get("type") not in ["Polygon", "MultiPolygon"]:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid geometry: must be Polygon or MultiPolygon",
        )

    conn = get_db()
    # Prevent overlapping zones
    if _geometry_intersects_existing(conn, req.geometry):
        conn.close()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="La zone chevauche une zone existante",
        )
    cursor = conn.cursor()

    # Insert object
    geometry_json = json.dumps(req.geometry)
    cursor.execute(
        """
        INSERT INTO map_objects (geometry, severity, description, created_by)
        VALUES (?, ?, ?, ?)
    """,
        (geometry_json, req.severity, req.description, user["id"]),
    )

    object_id = cursor.lastrowid

    # Log audit
    cursor.execute(
        """
        INSERT INTO audit_log (object_id, action, user_id, after_data)
        VALUES (?, ?, ?, ?)
    """,
        (object_id, "CREATE", user["id"], geometry_json),
    )

    conn.commit()

    # Get created object
    cursor.execute("SELECT * FROM map_objects WHERE id = ?", (object_id,))
    obj = dict_from_row(cursor.fetchone())
    conn.close()

    # Broadcast to all clients
    if sio:
        await sio.emit(
            "map_object_created",
            {
                "object": serialize_map_object(obj).__dict__,
            },
            skip_sid=None,
        )

    return SingleMapObjectResponse(
        success=True,
        data=serialize_map_object(obj),
        remaining_quota=get_remaining_quota(user["id"], "CREATE"),
    )


@router.post("/{object_id}/checkout", response_model=CheckoutResponse)
async def checkout_object(object_id: int, user: dict = Depends(require_login)):
    """Acquire lock on object for editing."""
    conn = get_db()
    cursor = conn.cursor()

    # Get object
    cursor.execute("SELECT * FROM map_objects WHERE id = ?", (object_id,))
    obj = dict_from_row(cursor.fetchone())

    if not obj:
        conn.close()
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Object not found"
        )

    # Check if already locked by someone else
    if obj["locked_by"] and obj["locked_by"] != user["id"]:
        if obj["lock_expires_at"]:
            lock_time = parse_utc(obj["lock_expires_at"])
            if lock_time and lock_time > datetime.now(timezone.utc):
                # Still locked
                cursor.execute(
                    "SELECT username FROM users WHERE id = ?", (obj["locked_by"],)
                )
                locker = cursor.fetchone()
                locker_username = locker[0] if locker else "un autre utilisateur"
                conn.close()
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Zone déjà en cours d'édition par {locker_username}",
                )

    # Acquire lock
    lock_expires = (
        datetime.now(timezone.utc) + timedelta(minutes=LOCK_DURATION_MINUTES)
    ).isoformat()
    cursor.execute(
        """
        UPDATE map_objects
        SET locked_by = ?, lock_expires_at = ?
        WHERE id = ?
    """,
        (user["id"], lock_expires, object_id),
    )

    conn.commit()
    conn.close()

    # Broadcast lock event
    if sio:
        await sio.emit(
            "map_object_locked",
            {
                "object_id": object_id,
                "locked_by": user["id"],
                "locked_by_username": user["username"],
                "lock_expires_at": lock_expires,
            },
            skip_sid=None,
        )

    return CheckoutResponse(success=True, data={"lock_expires_at": lock_expires})


@router.post("/{object_id}/release", response_model=CheckoutResponse)
async def release_object(object_id: int, user: dict = Depends(require_login)):
    """Release lock on object without modifying it."""
    conn = get_db()
    cursor = conn.cursor()

    # Get object
    cursor.execute("SELECT * FROM map_objects WHERE id = ?", (object_id,))
    obj = dict_from_row(cursor.fetchone())

    if not obj:
        conn.close()
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Object not found"
        )

    # Check if locked by this user
    if obj["locked_by"] != user["id"]:
        conn.close()
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Not locked by you"
        )

    # Release lock
    cursor.execute(
        """
        UPDATE map_objects
        SET locked_by = NULL, lock_expires_at = NULL
        WHERE id = ?
    """,
        (object_id,),
    )

    conn.commit()
    conn.close()

    # Broadcast release event
    if sio:
        await sio.emit(
            "map_object_released",
            {
                "object_id": object_id,
            },
            skip_sid=None,
        )

    return CheckoutResponse(success=True)


@router.put("/{object_id}", response_model=SingleMapObjectResponse)
async def update_map_object(
    object_id: int, req: MapObjectUpdate, user: dict = Depends(require_login)
):
    """Update map object (requires lock)."""
    conn = get_db()
    cursor = conn.cursor()

    # Get object
    cursor.execute("SELECT * FROM map_objects WHERE id = ?", (object_id,))
    obj = dict_from_row(cursor.fetchone())

    if not obj:
        conn.close()
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Object not found"
        )

    # Check lock
    if obj["locked_by"] != user["id"]:
        conn.close()
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Object not locked by you"
        )

    # Check lock expiry
    if obj["lock_expires_at"]:
        lock_time = parse_utc(obj["lock_expires_at"])
        if lock_time and lock_time < datetime.now(timezone.utc):
            conn.close()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Lock expired"
            )

    # Update object
    new_geometry = req.geometry if req.geometry else obj["geometry"]
    new_severity = req.severity if req.severity else obj["severity"]
    new_description = (
        req.description if req.description is not None else obj["description"]
    )

    if req.geometry:
        if not req.geometry or req.geometry.get("type") not in [
            "Polygon",
            "MultiPolygon",
        ]:
            conn.close()
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Invalid geometry",
            )
        # Prevent overlapping zones excluding self
        if _geometry_intersects_existing(conn, req.geometry, exclude_id=object_id):
            conn.close()
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="La zone chevauche une zone existante",
            )

    geometry_json = json.dumps(new_geometry) if req.geometry else obj["geometry"]

    before_snapshot = _audit_snapshot(
        obj["geometry"], obj["severity"], obj.get("description")
    )
    after_snapshot = _audit_snapshot(geometry_json, new_severity, new_description)

    is_rollback = _is_update_rollback(conn, object_id, user["id"], after_snapshot)
    is_update_grace = _is_within_creation_grace(obj, user["id"], GRACE_UPDATE_MINUTES)
    is_chain_grace = _is_update_chain_by_sequence(
        conn, object_id, user["id"]
    )  # retouche successive

    # Check daily quota unless this is a rollback or grace update
    if not (is_rollback or is_update_grace or is_chain_grace) and not check_daily_quota(
        user["id"], "UPDATE"
    ):
        conn.close()
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=_quota_message(user["id"]),
        )

    cursor.execute(
        """
        UPDATE map_objects
        SET geometry = ?, severity = ?, description = ?,
            updated_by = ?, updated_at = ?, locked_by = NULL, lock_expires_at = NULL
        WHERE id = ?
    """,
        (
            geometry_json,
            new_severity,
            new_description,
            user["id"],
            datetime.now(timezone.utc).isoformat(),
            object_id,
        ),
    )

    action_label = (
        "UNDO_UPDATE"
        if is_rollback
        else (
            "GRACE_UPDATE"
            if is_update_grace
            else ("GRACE_UPDATE_CHAIN" if is_chain_grace else "UPDATE")
        )
    )
    cursor.execute(
        """
        INSERT INTO audit_log (object_id, action, user_id, before_data, after_data)
        VALUES (?, ?, ?, ?, ?)
    """,
        (object_id, action_label, user["id"], before_snapshot, after_snapshot),
    )

    conn.commit()

    # Get updated object
    cursor.execute("SELECT * FROM map_objects WHERE id = ?", (object_id,))
    updated_obj = dict_from_row(cursor.fetchone())
    conn.close()

    # Broadcast update event
    if sio:
        await sio.emit(
            "map_object_updated",
            {
                "object": serialize_map_object(updated_obj).__dict__,
            },
            skip_sid=None,
        )

    return SingleMapObjectResponse(
        success=True,
        data=serialize_map_object(updated_obj),
        remaining_quota=get_remaining_quota(user["id"], "UPDATE"),
    )


@router.delete("/{object_id}", response_model=CheckoutResponse)
async def delete_map_object(object_id: int, user: dict = Depends(require_login)):
    """Soft-delete map object."""
    conn = get_db()
    cursor = conn.cursor()

    # Get object
    cursor.execute("SELECT * FROM map_objects WHERE id = ?", (object_id,))
    obj = dict_from_row(cursor.fetchone())

    if not obj:
        conn.close()
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Object not found"
        )

    grace_delete = _is_within_creation_grace(obj, user["id"], GRACE_DELETE_MINUTES)

    # Check daily quota unless this delete is within grace window
    if not grace_delete and not check_daily_quota(user["id"], "DELETE"):
        conn.close()
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=_quota_message(user["id"]),
        )

    # Soft delete
    cursor.execute(
        """
        UPDATE map_objects
        SET deleted_at = ?, locked_by = NULL, lock_expires_at = NULL
        WHERE id = ?
    """,
        (datetime.now(timezone.utc).isoformat(), object_id),
    )

    before_snapshot = _audit_snapshot(
        obj["geometry"], obj["severity"], obj.get("description")
    )

    # Log audit
    action_label = "GRACE_DELETE" if grace_delete else "DELETE"
    cursor.execute(
        """
        INSERT INTO audit_log (object_id, action, user_id, before_data)
        VALUES (?, ?, ?, ?)
    """,
        (object_id, action_label, user["id"], before_snapshot),
    )

    conn.commit()
    conn.close()

    # Broadcast delete event
    if sio:
        await sio.emit(
            "map_object_deleted",
            {
                "object_id": object_id,
                "deleted_by": user["id"],
                "deleted_by_username": user.get("username", "Unknown"),
            },
            skip_sid=None,
        )

    return CheckoutResponse(
        success=True, remaining_quota=get_remaining_quota(user["id"], "DELETE")
    )


@router.get("/{object_id}/lock")
async def get_lock_status(object_id: int):
    """Get lock status of object (public)."""
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute(
        """
        SELECT locked_by, lock_expires_at FROM map_objects WHERE id = ?
    """,
        (object_id,),
    )

    row = cursor.fetchone()
    conn.close()

    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Object not found"
        )

    locked_by, lock_expires_at = row

    if locked_by and lock_expires_at:
        lock_time = parse_utc(lock_expires_at)
        if lock_time and lock_time < datetime.now(timezone.utc):
            # Lock expired
            return {"locked": False}

    return {
        "locked": bool(locked_by),
        "locked_by": locked_by,
        "lock_expires_at": lock_expires_at,
    }
