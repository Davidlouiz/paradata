"""Endpoints de l’API des types de zones."""

from fastapi import APIRouter, Depends
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
