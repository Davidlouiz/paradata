from fastapi import APIRouter, HTTPException, status, Depends, Header
from datetime import datetime, timedelta
from typing import Optional
import jwt
import bcrypt

from app.database import get_db, dict_from_row
import asyncio
from app.models import LoginRequest, LoginResponse, AuthMeResponse, UserResponse

router = APIRouter()

# JWT settings
SECRET_KEY = "your-secret-key-change-in-production"  # TODO: Move to env
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30 * 24  # 30 days


def get_password_hash(password: str) -> str:
    """Hash a password."""
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode(), salt).decode()


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against its hash."""
    return bcrypt.checkpw(plain_password.encode(), hashed_password.encode())


def create_access_token(user_id: int, expires_delta: Optional[timedelta] = None) -> str:
    """Create JWT access token."""
    if expires_delta is None:
        expires_delta = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)

    expire = datetime.utcnow() + expires_delta
    to_encode = {"sub": str(user_id), "exp": expire}

    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def get_current_user(authorization: Optional[str] = Header(None)):
    """Get current user from JWT token in Authorization header."""
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
    """Dependency to require authentication."""
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )
    return user


@router.post("/login", response_model=LoginResponse)
async def login(req: LoginRequest):
    """Authenticate user and return JWT token."""
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
    """Logout user (client-side: discard token)."""
    return {"success": True, "message": "Logged out"}


@router.get("/me", response_model=AuthMeResponse)
async def me(user: Optional[dict] = Depends(get_current_user)):
    """Get current authenticated user info."""
    if user is None:
        return AuthMeResponse(success=True, data=None)

    return AuthMeResponse(
        success=True,
        data=UserResponse(
            id=user["id"], username=user["username"], created_at=user["created_at"]
        ),
    )


@router.post("/register")
async def register(req: LoginRequest):
    """Register a new user."""

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


