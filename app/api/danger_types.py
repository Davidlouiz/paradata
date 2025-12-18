"""Endpoints de l’API des types de zones."""

from fastapi import APIRouter, Depends, HTTPException
from app.database import get_db

router = APIRouter(prefix="/zone-types", tags=["zone-types"])


@router.get("")
def get_zone_types(db=Depends(get_db)):
    """Lister les types de zones disponibles (code/nom/couleur/description)."""
    cursor = db.execute(
        "SELECT code, name, description, color_hex FROM zone_types ORDER BY name"
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
def delete_zone_type(zone_type_code: str, db=Depends(get_db)):
    """Supprimer un type de zone (protégé si des zones l'utilisent)."""
    # D'abord, récupérer l'ID du type de zone
    cursor = db.execute(
        "SELECT id FROM zone_types WHERE code = ?",
        (zone_type_code,),
    )
    type_row = cursor.fetchone()
    if not type_row:
        raise HTTPException(
            status_code=404,
            detail=f"Type de zone '{zone_type_code}' introuvable.",
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

    # Supprimer le type de zone
    try:
        db.execute("DELETE FROM zone_types WHERE code = ?", (zone_type_code,))
        db.commit()
        return {"success": True, "message": "Type de zone supprimé avec succès"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
