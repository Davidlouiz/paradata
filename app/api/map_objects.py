from fastapi import APIRouter, HTTPException, status, Query, Depends
from datetime import datetime, timedelta
from typing import Optional, List
import json

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
    increment_daily_quota,
    get_remaining_quota,
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

LOCK_DURATION_MINUTES = 15


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
        danger_type_id=row["danger_type_id"],
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
    if not check_daily_quota(user["id"]):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Daily quota exceeded. Remaining: {get_remaining_quota(user['id'])}",
        )

    # Validate geometry
    if not req.geometry or req.geometry.get("type") not in ["Polygon", "MultiPolygon"]:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid geometry: must be Polygon or MultiPolygon",
        )

    conn = get_db()
    cursor = conn.cursor()

    # Insert object
    geometry_json = json.dumps(req.geometry)
    cursor.execute(
        """
        INSERT INTO map_objects (geometry, danger_type_id, severity, description, created_by)
        VALUES (?, ?, ?, ?, ?)
    """,
        (geometry_json, req.danger_type_id, req.severity, req.description, user["id"]),
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

    # Increment quota
    increment_daily_quota(user["id"])

    # Broadcast to all clients
    if sio:
        await sio.emit(
            "map_object_created",
            {
                "object": serialize_map_object(obj).__dict__,
            },
            skip_sid=None,
        )

    return SingleMapObjectResponse(success=True, data=serialize_map_object(obj))


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
            lock_time = datetime.fromisoformat(obj["lock_expires_at"])
            if lock_time > datetime.utcnow():
                # Still locked
                conn.close()
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Object locked by another user",
                )

    # Acquire lock
    lock_expires = (
        datetime.utcnow() + timedelta(minutes=LOCK_DURATION_MINUTES)
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
        lock_time = datetime.fromisoformat(obj["lock_expires_at"])
        if lock_time < datetime.utcnow():
            conn.close()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Lock expired"
            )

    # Update object
    new_geometry = req.geometry if req.geometry else obj["geometry"]
    new_danger_type = (
        req.danger_type_id if req.danger_type_id else obj["danger_type_id"]
    )
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

    geometry_json = json.dumps(new_geometry) if req.geometry else obj["geometry"]

    cursor.execute(
        """
        UPDATE map_objects
        SET geometry = ?, danger_type_id = ?, severity = ?, description = ?,
            updated_by = ?, updated_at = ?, locked_by = NULL, lock_expires_at = NULL
        WHERE id = ?
    """,
        (
            geometry_json,
            new_danger_type,
            new_severity,
            new_description,
            user["id"],
            datetime.utcnow().isoformat(),
            object_id,
        ),
    )

    # Log audit
    cursor.execute(
        """
        INSERT INTO audit_log (object_id, action, user_id, before_data, after_data)
        VALUES (?, ?, ?, ?, ?)
    """,
        (object_id, "UPDATE", user["id"], obj["geometry"], geometry_json),
    )

    conn.commit()

    # Get updated object
    cursor.execute("SELECT * FROM map_objects WHERE id = ?", (object_id,))
    updated_obj = dict_from_row(cursor.fetchone())
    conn.close()

    # Increment quota
    increment_daily_quota(user["id"])

    # Broadcast update event
    if sio:
        await sio.emit(
            "map_object_updated",
            {
                "object": serialize_map_object(updated_obj).__dict__,
            },
            skip_sid=None,
        )

    return SingleMapObjectResponse(success=True, data=serialize_map_object(updated_obj))


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

    # Soft delete
    cursor.execute(
        """
        UPDATE map_objects
        SET deleted_at = ?, locked_by = NULL, lock_expires_at = NULL
        WHERE id = ?
    """,
        (datetime.utcnow().isoformat(), object_id),
    )

    # Log audit
    cursor.execute(
        """
        INSERT INTO audit_log (object_id, action, user_id)
        VALUES (?, ?, ?)
    """,
        (object_id, "DELETE", user["id"]),
    )

    conn.commit()
    conn.close()

    # Increment quota
    increment_daily_quota(user["id"])

    # Broadcast delete event
    if sio:
        await sio.emit(
            "map_object_deleted",
            {
                "object_id": object_id,
            },
            skip_sid=None,
        )

    return CheckoutResponse(success=True)


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
        lock_time = datetime.fromisoformat(lock_expires_at)
        if lock_time < datetime.utcnow():
            # Lock expired
            return {"locked": False}

    return {
        "locked": bool(locked_by),
        "locked_by": locked_by,
        "lock_expires_at": lock_expires_at,
    }
