from fastapi import APIRouter, Depends, HTTPException, status
import json
from shapely.geometry import shape

from app.database import get_db, dict_from_row
from app.api.auth import require_login

router = APIRouter(prefix="/volunteers", tags=["volunteers"])


@router.get("/coverage/me")
async def list_my_coverage(user: dict = Depends(require_login)):
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        "SELECT id, user_id, geometry, created_at, updated_at FROM volunteer_coverage WHERE user_id = ?",
        (user["id"],),
    )
    rows = [dict_from_row(r) for r in cur.fetchall()]
    conn.close()
    for r in rows:
        try:
            r["geometry"] = json.loads(r["geometry"]) if r.get("geometry") else None
        except Exception:
            r["geometry"] = None
    return {"success": True, "data": rows}


@router.post("/coverage")
async def add_coverage(geometry: dict, user: dict = Depends(require_login)):
    if not geometry or geometry.get("type") not in ("Polygon", "MultiPolygon"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Geometry must be Polygon or MultiPolygon",
        )
    try:
        new_shape = shape(geometry)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid geometry"
        )

    # Prevent overlapping coverage perimeters for the same user
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT id, geometry FROM volunteer_coverage WHERE user_id = ?",
            (user["id"],),
        )
        existing = cur.fetchall()
        # Use a small epsilon to allow mere boundary contacts without blocking
        EPSILON = 1e-9
        # Normalize new geometry to handle minor self-intersections
        try:
            normalized_new = new_shape.buffer(0)
        except Exception:
            normalized_new = new_shape
        for cov_id, geom_json in existing:
            try:
                existing_geom = json.loads(geom_json)
                existing_shape = shape(existing_geom)
                try:
                    normalized_existing = existing_shape.buffer(0)
                except Exception:
                    normalized_existing = existing_shape
                if normalized_new.intersects(normalized_existing):
                    inter = normalized_new.intersection(normalized_existing)
                    # Block only meaningful overlaps (area greater than epsilon)
                    if not inter.is_empty and getattr(inter, "area", 0.0) > EPSILON:
                        raise HTTPException(
                            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail="Le nouveau périmètre chevauche un périmètre existant.",
                        )
            except HTTPException as e:
                # Re-raise validation errors with explicit detail
                raise HTTPException(status_code=e.status_code, detail=e.detail)
            except Exception:
                # Skip invalid existing geometries rather than blocking
                continue
        cur.execute(
            "INSERT INTO volunteer_coverage (user_id, geometry) VALUES (?, ?)",
            (user["id"], json.dumps(geometry)),
        )
        conn.commit()
        new_id = cur.lastrowid
        return {"success": True, "data": {"id": new_id}}
    finally:
        try:
            conn.close()
        except Exception:
            pass


@router.delete("/coverage/{coverage_id}")
async def delete_coverage(coverage_id: int, user: dict = Depends(require_login)):
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        "DELETE FROM volunteer_coverage WHERE id = ? AND user_id = ?",
        (coverage_id, user["id"]),
    )
    if cur.rowcount == 0:
        conn.close()
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Coverage not found"
        )
    conn.commit()
    conn.close()
    return {"success": True}


@router.get("/covering/{object_id}")
async def volunteers_covering_object(object_id: int):
    """Return users whose coverage intersects the given map object."""
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        "SELECT geometry FROM map_objects WHERE id = ? AND deleted_at IS NULL",
        (object_id,),
    )
    row = cur.fetchone()
    if not row:
        conn.close()
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Object not found"
        )
    try:
        obj_geom = shape(json.loads(row[0]))
    except Exception:
        conn.close()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid object geometry",
        )

    cur.execute(
        """
        SELECT vc.id, vc.user_id, vc.geometry, u.username
        FROM volunteer_coverage vc
        JOIN users u ON u.id = vc.user_id
        """
    )
    results = []
    for vc_id, user_id, geom_json, username in cur.fetchall():
        try:
            g = shape(json.loads(geom_json))
            if obj_geom.intersects(g):
                inter = obj_geom.intersection(g)
                if not inter.is_empty:
                    results.append(
                        {"coverage_id": vc_id, "user_id": user_id, "username": username}
                    )
        except Exception:
            continue
    conn.close()
    return {"success": True, "data": results}
