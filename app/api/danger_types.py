"""Endpoints de l’API des types de zones."""

from fastapi import APIRouter, Depends, HTTPException
from app.database import get_db
from app.api.auth import require_login

router = APIRouter(prefix="/zone-types", tags=["zone-types"])


@router.get("")
def get_zone_types(db=Depends(get_db)):
    """Lister les types de zones disponibles (code/nom/couleur/description)."""
    cursor = db.execute(
        "SELECT code, name, description, color_hex FROM zone_types WHERE deleted_at IS NULL ORDER BY name"
    )
    types = cursor.fetchall()

    result = []
    for row in types:
        result.append(
            {
                "code": row["code"],
                "name": row["name"],
                "description": row["description"],
                "color": row["color_hex"],
            }
        )

    return {"success": True, "data": result}


@router.delete("/{zone_type_code}")
def delete_zone_type(
    zone_type_code: str, user: dict = Depends(require_login), db=Depends(get_db)
):
    """Supprimer un type de zone (protégé si des zones l'utilisent). Authentification requise."""
    # D'abord, récupérer l'ID du type de zone (uniquement les non supprimés)
    cursor = db.execute(
        "SELECT id FROM zone_types WHERE code = ? AND deleted_at IS NULL",
        (zone_type_code,),
    )
    type_row = cursor.fetchone()
    if not type_row:
        raise HTTPException(
            status_code=404,
            detail=f"Type de zone '{zone_type_code}' introuvable ou déjà supprimé.",
        )
    zone_type_id = type_row[0]

    # Vérifier si des zones utilisent ce type (uniquement les zones non supprimées)
    cursor = db.execute(
        "SELECT COUNT(*) FROM zones WHERE zone_type_id = ? AND deleted_at IS NULL",
        (zone_type_id,),
    )
    row = cursor.fetchone()
    zone_count = row[0] if row else 0

    if zone_count > 0:
        # Message avec pluriel correct
        if zone_count == 1:
            detail_msg = (
                "Impossible de supprimer ce type : 1 zone l'utilise actuellement."
            )
        else:
            detail_msg = f"Impossible de supprimer ce type : {zone_count} zones l'utilisent actuellement."
        raise HTTPException(
            status_code=400,
            detail=detail_msg,
        )

    # Soft delete du type de zone
    try:
        from datetime import datetime, timezone

        now = datetime.now(timezone.utc)
        user_id = user["id"]
        db.execute(
            "UPDATE zone_types SET deleted_at = ?, deleted_by = ? WHERE code = ?",
            (now, user_id, zone_type_code),
        )
        db.commit()
        return {"success": True, "message": "Type de zone supprimé avec succès"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
