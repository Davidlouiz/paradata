"""Endpoints de l’API des types de zones."""

from fastapi import APIRouter, Depends, HTTPException, status
from app.database import get_db
from app.api.auth import require_login
from typing import Optional
import re

router = APIRouter(prefix="/zone-types", tags=["zone-types"])


@router.get("")
def get_zone_types(db=Depends(get_db)):
    """Lister les types de zones disponibles (code/nom/couleur/description/created_at)."""
    cursor = db.execute(
        "SELECT code, name, description, color_hex, created_at FROM zone_types WHERE deleted_at IS NULL ORDER BY name"
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
                "created_at": row["created_at"],
            }
        )

    return {"success": True, "data": result}


def _validate_zone_type_inputs(
    code: str, name: str, color_hex: str, description: Optional[str] = None
):
    if not code or not isinstance(code, str):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Le code est requis",
        )
    if not name or not isinstance(name, str):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Le nom est requis"
        )
    # Normalize code: uppercase and underscore
    norm_code = code.strip().upper()
    # Only allow A-Z, 0-9 and underscores
    if not re.fullmatch(r"[A-Z0-9_]+", norm_code):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Le code doit contenir uniquement des lettres, chiffres ou underscores (A-Z, 0-9, _)",
        )
    # Color validation: #RRGGBB
    if not isinstance(color_hex, str) or not re.fullmatch(
        r"#[0-9A-Fa-f]{6}", color_hex.strip()
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="La couleur doit être au format hexadécimal #RRGGBB",
        )
    desc = (description or "").strip()
    if not desc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="La description est requise",
        )
    return norm_code, name.strip(), color_hex.strip(), desc


@router.post("")
def create_zone_type(
    payload: dict, user: dict = Depends(require_login), db=Depends(get_db)
):
    """Créer un type de zone. Restaure s'il existe en supprimé, sinon insère, sinon 409 si déjà actif."""
    code = payload.get("code")
    name = payload.get("name")
    color = payload.get("color") or payload.get("color_hex")
    description = payload.get("description")

    code, name, color, description = _validate_zone_type_inputs(
        code, name, color, description
    )

    # Existe en actif ?
    row = db.execute(
        "SELECT id FROM zone_types WHERE code = ? AND deleted_at IS NULL", (code,)
    ).fetchone()
    if row:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Un type actif existe déjà avec ce code: {code}",
        )

    # Existe mais supprimé ? -> restaurer
    row_del = db.execute(
        "SELECT id FROM zone_types WHERE code = ? AND deleted_at IS NOT NULL", (code,)
    ).fetchone()
    try:
        if row_del:
            db.execute(
                "UPDATE zone_types SET name = ?, description = ?, color_hex = ?, deleted_at = NULL, deleted_by = NULL WHERE id = ?",
                (name, description, color, row_del[0]),
            )
        else:
            db.execute(
                "INSERT INTO zone_types (code, name, description, color_hex) VALUES (?, ?, ?, ?)",
                (code, name, description, color),
            )
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    return {
        "success": True,
        "data": {
            "code": code,
            "name": name,
            "description": description,
            "color": color,
        },
    }


@router.put("/{zone_type_code}")
def update_zone_type(
    zone_type_code: str,
    payload: dict,
    user: dict = Depends(require_login),
    db=Depends(get_db),
):
    """Mettre à jour un type de zone actif (nom, description, couleur, et éventuellement code si < 3 mois)."""
    # Doit exister et ne pas être supprimé
    row = db.execute(
        "SELECT id, code, created_at FROM zone_types WHERE code = ? AND deleted_at IS NULL",
        (zone_type_code,),
    ).fetchone()
    if not row:
        raise HTTPException(
            status_code=404, detail=f"Type de zone '{zone_type_code}' introuvable"
        )

    zt_id = row["id"]
    current_code = row["code"]
    created_at = row["created_at"]

    name = payload.get("name")
    color = payload.get("color") or payload.get("color_hex")
    description = payload.get("description")
    # Validate name/color/description using validator (code normalization not used here)
    _, name, color, description = _validate_zone_type_inputs(
        zone_type_code, name, color, description
    )

    # Optional code change
    new_code = payload.get("code")
    norm_new_code = None
    if new_code is not None and new_code.strip().upper() != current_code:
        candidate = new_code.strip().upper()
        if not re.fullmatch(r"[A-Z0-9_]+", candidate):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Le code doit contenir uniquement des lettres, chiffres ou underscores (A-Z, 0-9, _)",
            )
        # Autoriser seulement si créé il y a moins de 7 jours
        from datetime import datetime, timedelta

        try:
            # created_at from SQLite is in UTC naive 'YYYY-MM-DD HH:MM:SS'
            created_dt = datetime.fromisoformat(str(created_at))
        except Exception:
            created_dt = None
        now = datetime.now()
        if not created_dt or (now - created_dt) > timedelta(days=7):
            raise HTTPException(
                status_code=400,
                detail="La modification du code n'est autorisée que pendant les 7 premiers jours suivant la création",
            )
        # Unicité du code (quel que soit l'état supprimé ou non)
        other = db.execute(
            "SELECT id FROM zone_types WHERE code = ? AND id <> ?", (candidate, zt_id)
        ).fetchone()
        if other:
            raise HTTPException(
                status_code=409, detail=f"Un type existe déjà avec ce code: {candidate}"
            )
        norm_new_code = candidate

    try:
        if norm_new_code:
            db.execute(
                "UPDATE zone_types SET code = ?, name = ?, description = ?, color_hex = ? WHERE id = ?",
                (norm_new_code, name, description, color, zt_id),
            )
            ret_code = norm_new_code
        else:
            db.execute(
                "UPDATE zone_types SET name = ?, description = ?, color_hex = ? WHERE id = ?",
                (name, description, color, zt_id),
            )
            ret_code = current_code
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    return {
        "success": True,
        "data": {
            "code": ret_code,
            "name": name,
            "description": description,
            "color": color,
        },
    }


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
            detail_msg = "Impossible de supprimer ce type de zone : 1 zone l'utilise actuellement."
        else:
            detail_msg = f"Impossible de supprimer ce type de zone : {zone_count} zones l'utilisent actuellement."
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
