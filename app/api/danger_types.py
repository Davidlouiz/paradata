"""
Danger Types API endpoints
"""

from fastapi import APIRouter, Depends
from app.database import get_db

router = APIRouter(prefix="/danger-types", tags=["danger-types"])


@router.get("")
def get_danger_types(db=Depends(get_db)):
    """
    Récupérer tous les types de danger disponibles
    """
    cursor = db.execute("SELECT id, name, description FROM danger_types ORDER BY name")
    types = cursor.fetchall()

    result = []
    for row in types:
        result.append(
            {
                "id": row["id"],
                "name": row["name"],
                "description": row["description"],
            }
        )

    return {"success": True, "data": result}
