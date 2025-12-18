from fastapi import APIRouter, HTTPException, status, Query, Depends
from datetime import datetime, timedelta, timezone
from typing import Optional, List
import json
from shapely.geometry import shape, Point

from app.database import get_db, dict_from_row
from app.models import (
    ZoneCreate,
    ZoneUpdate,
    ZoneResponse,
    ZonesListResponse,
    SingleZoneResponse,
    CheckoutResponse,
    BoundingBox,
    ZonesByCoordinateResponse,
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
    """Injecter l’instance Socket.IO."""
    global sio
    sio = socket_server


router = APIRouter(prefix="/zones", tags=["zones"])


def _geometry_intersects_existing(
    conn, new_geom_json: dict, new_zone_type_id: int, exclude_id: int | None = None
) -> bool:
    """Retourne True si la nouvelle géométrie intersecte une géométrie existante du même type non supprimée.

    Érode les deux géométries d'environ ~10 cm (0,00001°) pour tolérer les contacts de limite.
    Les zones de types différents peuvent se chevaucher ; seules les zones du même type ne peuvent pas.
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
        SELECT id, geometry, zone_type_id
        FROM zones
        WHERE deleted_at IS NULL
        """
    )
    rows = cursor.fetchall()
    for row in rows:
        row_id = row[0]
        if exclude_id and row_id == exclude_id:
            continue
        existing_zone_type_id = row[2]
        # Only check overlap for zones of the same type
        if existing_zone_type_id != new_zone_type_id:
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


def _validate_geometry_structure(geom_json: dict) -> tuple[bool, str | None]:
    """Valider la structure de la géométrie (pas de sommets dupliqués, géométrie valide).

    Returns:
        (is_valid, error_message) - error_message is None if valid
    """
    try:
        geom = shape(geom_json)

        # Check if geometry is valid according to Shapely
        if not geom.is_valid:
            return (
                False,
                "Géométrie invalide : auto-intersections ou structure incorrecte détectée",
            )

        # For Polygon, check for duplicate vertices (except closing vertex)
        if geom_json.get("type") == "Polygon":
            coords = geom_json.get("coordinates", [[]])[0]
            if len(coords) < 4:
                return False, "Polygone invalide : au moins 3 sommets distincts requis"

            # Check for duplicate vertices (excluding the last closing vertex)
            unique_coords = set()
            for i in range(len(coords) - 1):  # Exclude last coordinate (closing)
                coord_tuple = tuple(coords[i])
                if coord_tuple in unique_coords:
                    return (
                        False,
                        "Géométrie invalide : sommets dupliqués détectés (polygone avec auto-contact)",
                    )
                unique_coords.add(coord_tuple)

            # Verify that last coordinate closes the polygon
            if coords[0] != coords[-1]:
                return (
                    False,
                    "Polygone invalide : le dernier point doit être égal au premier",
                )

        # For MultiPolygon, validate each polygon
        elif geom_json.get("type") == "MultiPolygon":
            for poly_coords in geom_json.get("coordinates", []):
                ring = poly_coords[0]
                if len(ring) < 4:
                    return (
                        False,
                        "MultiPolygon invalide : chaque polygone doit avoir au moins 3 sommets distincts",
                    )

                unique_coords = set()
                for i in range(len(ring) - 1):
                    coord_tuple = tuple(ring[i])
                    if coord_tuple in unique_coords:
                        return (
                            False,
                            "Géométrie invalide : sommets dupliqués détectés dans un des polygones",
                        )
                    unique_coords.add(coord_tuple)

        return True, None

    except Exception as e:
        return False, f"Erreur de validation de géométrie : {str(e)}"


LOCK_DURATION_MINUTES = 15

# Grace windows after creation (free actions by creator)
GRACE_UPDATE_MINUTES = 120  # free updates within 120 minutes after creation
GRACE_DELETE_MINUTES = 120  # free delete within 120 minutes after creation


def parse_utc(dt_str: str) -> datetime:
    """Analyser une chaîne ISO et retourner un datetime UTC avec fuseau horaire."""
    if not dt_str:
        return None
    dt = datetime.fromisoformat(dt_str)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return dt


def _get_zone_type_id(conn, code: str) -> int:
    """Résoudre le code de type de zone en ID, lever 422 si introuvable."""
    if not code:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Le type de zone est requis",
        )
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM zone_types WHERE code = ?", (code,))
    row = cursor.fetchone()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Type de zone inconnu: {code}",
        )
    return row[0]


def serialize_zone(row: dict, conn=None) -> ZoneResponse:
    """Convertir une ligne de base de données en `ZoneResponse`."""
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

    # Resolve zone_type_id to code for API compatibility
    zone_type_code = None
    if row.get("zone_type_id"):
        cursor.execute(
            "SELECT code FROM zone_types WHERE id = ?", (row["zone_type_id"],)
        )
        zt = cursor.fetchone()
        zone_type_code = zt[0] if zt else None

    return ZoneResponse(
        id=row["id"],
        geometry=json.loads(row["geometry"]),
        zone_type=zone_type_code,
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


def _audit_snapshot(geometry_json: str, zone_type: str, description: str | None) -> str:
    """Construire un instantané JSON pour les comparaisons d’audit."""
    try:
        geometry = json.loads(geometry_json)
    except Exception:
        geometry = geometry_json
    return json.dumps(
        {
            "geometry": geometry,
            "zone_type": zone_type,
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
    """Retourne True si le créateur agit dans la fenêtre de grâce après la création."""
    if obj.get("created_by") != user_id:
        return False
    created_at = parse_utc(obj.get("created_at"))
    if not created_at:
        return False
    return datetime.now(timezone.utc) - created_at <= timedelta(minutes=minutes)


def _is_delete_undo_create(obj: dict, user: dict) -> bool:
    """Retourne True si la suppression équivaut à annuler un objet récemment créé par l’utilisateur."""
    # Deprecated stricter rule; kept for reference. Use grace helper instead.
    return _is_within_creation_grace(obj, user["id"], GRACE_DELETE_MINUTES)


def _is_update_rollback(
    conn, object_id: int, user_id: int, target_snapshot: str
) -> bool:
    """Retourne True si la mise à jour annule le dernier changement de l’utilisateur dans les 30 minutes."""
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


@router.get("", response_model=ZonesListResponse)
async def list_zones(
    minLat: float = Query(...),
    minLng: float = Query(...),
    maxLat: float = Query(...),
    maxLng: float = Query(...),
):
    """Obtenir les zones visibles dans le rectangle englobant (endpoint public)."""
    conn = get_db()
    cursor = conn.cursor()

    # Get all non-deleted objects (simplified: ignore bbox for now)
    cursor.execute("""
        SELECT * FROM zones
        WHERE deleted_at IS NULL
        ORDER BY created_at DESC
    """)

    rows = cursor.fetchall()

    zones = [serialize_zone(dict_from_row(row), conn) for row in rows]

    conn.close()

    return ZonesListResponse(success=True, data=zones)


@router.get("/by-coordinate", response_model=ZonesByCoordinateResponse)
async def get_zones_by_coordinate(
    lat: float = Query(..., description="Latitude"),
    lng: float = Query(..., description="Longitude"),
):
    """Obtenir les zones qui couvrent une coordonnée GPS donnée (endpoint public)."""
    conn = get_db()
    cursor = conn.cursor()

    # Créer le point de coordonnée
    try:
        point = Point(lng, lat)  # Shapely utilise (lng, lat) = (x, y)
    except Exception as e:
        conn.close()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Coordonnées invalides: {str(e)}",
        )

    # Récupérer toutes les zones non supprimées
    cursor.execute("""
        SELECT * FROM zones
        WHERE deleted_at IS NULL
        ORDER BY created_at DESC
    """)

    rows = cursor.fetchall()
    zones = []

    # Filtrer les zones qui contiennent le point
    for row in rows:
        row_dict = dict_from_row(row)
        try:
            geometry_json = json.loads(row_dict["geometry"])
            geometry = shape(geometry_json)

            # Vérifier si le point est dans la géométrie
            if geometry.contains(point):
                zones.append(serialize_zone(row_dict, conn))
        except Exception:
            # Ignorer les géométries invalides
            continue

    conn.close()

    return ZonesByCoordinateResponse(success=True, data=zones)


@router.get("/{object_id}", response_model=SingleZoneResponse)
async def get_zone(object_id: int):
    """Obtenir une zone unique par ID (endpoint public)."""
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute(
        """
        SELECT * FROM zones
        WHERE id = ? AND deleted_at IS NULL
    """,
        (object_id,),
    )

    row = dict_from_row(cursor.fetchone())
    conn.close()

    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Zone non trouvée."
        )

    return SingleZoneResponse(success=True, data=serialize_zone(row))


@router.post("", response_model=SingleZoneResponse)
async def create_zone(req: ZoneCreate, user: dict = Depends(require_login)):
    """Créer une nouvelle zone."""
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
            detail="Géométrie invalide : doit être un Polygon ou MultiPolygon",
        )

    # Validate geometry structure (no duplicate vertices, valid shape)
    is_valid, error_msg = _validate_geometry_structure(req.geometry)
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=error_msg,
        )

    conn = get_db()
    zone_type_id = _get_zone_type_id(conn, req.zone_type)

    # Prevent overlapping zones of the same type
    if _geometry_intersects_existing(conn, req.geometry, zone_type_id):
        conn.close()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="La zone chevauche une zone existante du même type",
        )
    cursor = conn.cursor()

    # Insert object
    geometry_json = json.dumps(req.geometry)
    cursor.execute(
        """
        INSERT INTO zones (geometry, zone_type_id, description, created_by)
        VALUES (?, ?, ?, ?)
    """,
        (geometry_json, zone_type_id, req.description, user["id"]),
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
    cursor.execute("SELECT * FROM zones WHERE id = ?", (object_id,))
    obj = dict_from_row(cursor.fetchone())
    conn.close()

    # Broadcast to all clients
    if sio:
        await sio.emit(
            "zone_created",
            {
                "object": serialize_zone(obj).__dict__,
            },
            skip_sid=None,
        )

    return SingleZoneResponse(
        success=True,
        data=serialize_zone(obj),
        remaining_quota=get_remaining_quota(user["id"], "CREATE"),
    )


@router.post("/{object_id}/checkout", response_model=CheckoutResponse)
async def checkout_object(object_id: int, user: dict = Depends(require_login)):
    """Acquérir le verrou sur la zone pour édition."""
    conn = get_db()
    cursor = conn.cursor()

    # Get object
    cursor.execute("SELECT * FROM zones WHERE id = ?", (object_id,))
    obj = dict_from_row(cursor.fetchone())

    if not obj:
        conn.close()
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Zone non trouvée."
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
        UPDATE zones
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
            "zone_locked",
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
    """Libérer le verrou sur la zone sans la modifier."""
    conn = get_db()
    cursor = conn.cursor()

    # Get object
    cursor.execute("SELECT * FROM zones WHERE id = ?", (object_id,))
    obj = dict_from_row(cursor.fetchone())

    if not obj:
        conn.close()
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Zone non trouvée."
        )

    # Check if locked by this user
    if obj["locked_by"] != user["id"]:
        conn.close()
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Non verrouillée par vous"
        )

    # Release lock
    cursor.execute(
        """
        UPDATE zones
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
            "zone_released",
            {
                "object_id": object_id,
            },
            skip_sid=None,
        )

    return CheckoutResponse(success=True)


@router.put("/{object_id}", response_model=SingleZoneResponse)
async def update_zone(
    object_id: int, req: ZoneUpdate, user: dict = Depends(require_login)
):
    """Mettre à jour la zone (nécessite un verrou)."""
    conn = get_db()
    cursor = conn.cursor()

    # Get object
    cursor.execute("SELECT * FROM zones WHERE id = ?", (object_id,))
    obj = dict_from_row(cursor.fetchone())

    if not obj:
        conn.close()
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Zone non trouvée."
        )

    # Check lock
    if obj["locked_by"] != user["id"]:
        conn.close()
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Zone non verrouillée par vous",
        )

    # Check lock expiry
    if obj["lock_expires_at"]:
        lock_time = parse_utc(obj["lock_expires_at"])
        if lock_time and lock_time < datetime.now(timezone.utc):
            conn.close()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Verrou expiré"
            )

    # Update object
    new_geometry = req.geometry if req.geometry else obj["geometry"]

    # Resolve zone_type code to zone_type_id
    if req.zone_type:
        new_zone_type_id = _get_zone_type_id(conn, req.zone_type)
    else:
        new_zone_type_id = obj["zone_type_id"]

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
                detail="Géométrie invalide",
            )

        # Validate geometry structure (no duplicate vertices, valid shape)
        is_valid, error_msg = _validate_geometry_structure(req.geometry)
        if not is_valid:
            conn.close()
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=error_msg,
            )
        # Prevent overlapping zones of the same type, excluding self
        if _geometry_intersects_existing(
            conn, req.geometry, new_zone_type_id, exclude_id=object_id
        ):
            conn.close()
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="La zone chevauche une zone existante du même type",
            )

    geometry_json = json.dumps(new_geometry) if req.geometry else obj["geometry"]

    # Get zone_type codes for audit (resolve IDs back to codes)
    cursor.execute("SELECT code FROM zone_types WHERE id = ?", (obj["zone_type_id"],))
    old_row = cursor.fetchone()
    old_zone_type_code = old_row[0] if old_row else None
    cursor.execute("SELECT code FROM zone_types WHERE id = ?", (new_zone_type_id,))
    new_row = cursor.fetchone()
    new_zone_type_code = new_row[0] if new_row else None

    before_snapshot = _audit_snapshot(
        obj["geometry"], old_zone_type_code, obj.get("description")
    )
    after_snapshot = _audit_snapshot(geometry_json, new_zone_type_code, new_description)

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
        UPDATE zones
        SET geometry = ?, zone_type_id = ?, description = ?,
            updated_by = ?, updated_at = ?, locked_by = NULL, lock_expires_at = NULL
        WHERE id = ?
    """,
        (
            geometry_json,
            new_zone_type_id,
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
    cursor.execute("SELECT * FROM zones WHERE id = ?", (object_id,))
    updated_obj = dict_from_row(cursor.fetchone())
    conn.close()

    # Broadcast update event
    if sio:
        await sio.emit(
            "zone_updated",
            {
                "object": serialize_zone(updated_obj).__dict__,
            },
            skip_sid=None,
        )

    return SingleZoneResponse(
        success=True,
        data=serialize_zone(updated_obj),
        remaining_quota=get_remaining_quota(user["id"], "UPDATE"),
    )


@router.delete("/{object_id}", response_model=CheckoutResponse)
async def delete_zone(object_id: int, user: dict = Depends(require_login)):
    """Suppression logique de la zone."""
    conn = get_db()
    cursor = conn.cursor()

    # Get object
    cursor.execute("SELECT * FROM zones WHERE id = ?", (object_id,))
    obj = dict_from_row(cursor.fetchone())

    if not obj:
        conn.close()
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Zone non trouvée."
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
        UPDATE zones
        SET deleted_at = ?, deleted_by = ?, locked_by = NULL, lock_expires_at = NULL
        WHERE id = ?
    """,
        (datetime.now(timezone.utc).isoformat(), user["id"], object_id),
    )

    # Resolve zone_type code for audit snapshot (obj has zone_type_id)
    cursor.execute("SELECT code FROM zone_types WHERE id = ?", (obj["zone_type_id"],))
    zt_row = cursor.fetchone()
    obj_zone_type_code = zt_row[0] if zt_row else None
    before_snapshot = _audit_snapshot(
        obj["geometry"], obj_zone_type_code, obj.get("description")
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
            "zone_deleted",
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
    """Obtenir le statut du verrou de la zone (public)."""
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute(
        """
        SELECT locked_by, lock_expires_at FROM zones WHERE id = ?
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
