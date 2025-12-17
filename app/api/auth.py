from fastapi import APIRouter, HTTPException, status, Depends, Header
from datetime import datetime, timedelta
from typing import Optional
import jwt
import bcrypt

from app.database import get_db, dict_from_row
import asyncio
from app.models import LoginRequest, LoginResponse, AuthMeResponse, UserResponse
from app.services.quota import (
    get_daily_usage_breakdown,
    DAILY_CREATE_LIMIT,
    DAILY_UPDATE_LIMIT,
    DAILY_DELETE_LIMIT,
)

router = APIRouter()

# JWT settings
SECRET_KEY = "your-secret-key-change-in-production"  # TODO: Move to env
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30 * 24  # 30 days


def get_password_hash(password: str) -> str:
    """Hacher un mot de passe."""
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode(), salt).decode()


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Vérifier un mot de passe par rapport à son hash."""
    return bcrypt.checkpw(plain_password.encode(), hashed_password.encode())


def create_access_token(user_id: int, expires_delta: Optional[timedelta] = None) -> str:
    """Créer un jeton d’accès JWT."""
    if expires_delta is None:
        expires_delta = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)

    expire = datetime.utcnow() + expires_delta
    to_encode = {"sub": str(user_id), "exp": expire}

    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def get_current_user(authorization: Optional[str] = Header(None)):
    """Obtenir l’utilisateur courant à partir du jeton JWT dans l’en-tête Authorization."""
    if not authorization:
        return None

    if not authorization.startswith("Bearer "):
        return None

    token = authorization[7:]  # Remove "Bearer " prefix

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            return None
    except jwt.InvalidTokenError:
        return None

    def _query():
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM users WHERE id = ?", (int(user_id),))
        row = cursor.fetchone()
        conn.close()
        return dict_from_row(row)

    # run blocking DB call in thread - this function is already called in a thread
    # by FastAPI's dependency resolution, so just call it directly
    return _query()


def require_login(user: Optional[dict] = Depends(get_current_user)):
    """Dépendance pour exiger l’authentification."""
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )
    return user


@router.post("/login", response_model=LoginResponse)
async def login(req: LoginRequest):
    """Authentifier l’utilisateur et retourner un jeton JWT."""
    print(f"[auth.login] attempt for username={req.username}")

    def _find_user():
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM users WHERE username = ?", (req.username,))
        row = cursor.fetchone()
        conn.close()
        return dict_from_row(row)

    user = await asyncio.to_thread(_find_user)

    if not user:
        print(f"[auth.login] user not found: {req.username}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )

    try:
        print(f"[auth.login] verifying password for user id={user.get('id')}")
        valid = verify_password(req.password, user.get("password_hash") or "")
    except Exception as exc:
        print(f"[auth.login] password verification error: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal error during authentication",
        )

    if not valid:
        print(f"[auth.login] invalid password for user id={user.get('id')}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )

    # Create token
    token = create_access_token(user["id"])

    return LoginResponse(
        success=True,
        data={
            "id": user["id"],
            "username": user["username"],
            "token": token,
            "created_at": user["created_at"],
        },
    )


@router.post("/logout")
async def logout():
    """Déconnexion de l’utilisateur (côté client : jeter le jeton)."""
    return {"success": True, "message": "Logged out"}


@router.get("/me", response_model=AuthMeResponse)
async def me(user: Optional[dict] = Depends(get_current_user)):
    """Obtenir les informations de l’utilisateur authentifié."""
    if user is None:
        return AuthMeResponse(success=True, data=None)

    return AuthMeResponse(
        success=True,
        data=UserResponse(
            id=user["id"], username=user["username"], created_at=user["created_at"]
        ),
    )


@router.get("/quota")
async def quota(user: dict = Depends(require_login)):
    """Retourner le détail des quotas par action et les limites pour l’utilisateur courant."""
    breakdown = get_daily_usage_breakdown(user["id"])
    return {
        "success": True,
        "data": {
            "create": {"used": breakdown["CREATE"], "limit": DAILY_CREATE_LIMIT},
            "update": {"used": breakdown["UPDATE"], "limit": DAILY_UPDATE_LIMIT},
            "delete": {"used": breakdown["DELETE"], "limit": DAILY_DELETE_LIMIT},
        },
    }


@router.post("/register")
async def register(req: LoginRequest):
    """Enregistrer un nouvel utilisateur."""

    def _create_user():
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM users WHERE username = ?", (req.username,))
        if cursor.fetchone():
            conn.close()
            return None

        hashed_password = get_password_hash(req.password)
        cursor.execute(
            "INSERT INTO users (username, password_hash) VALUES (?, ?)",
            (req.username, hashed_password),
        )
        conn.commit()
        user_id = cursor.lastrowid
        conn.close()
        return user_id

    user_id = await asyncio.to_thread(_create_user)
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Username already taken"
        )

    # Return token
    token = create_access_token(user_id)

    return LoginResponse(
        success=True,
        data={
            "id": user_id,
            "username": req.username,
            "token": token,
            "created_at": datetime.utcnow().isoformat(),
        },
    )
