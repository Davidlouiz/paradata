from fastapi import APIRouter, HTTPException, status, Depends, Header, Request
from datetime import datetime, timedelta
from typing import Optional
import jwt
import bcrypt
import secrets

from app.database import get_db, dict_from_row
import asyncio
from app.models import (
    LoginRequest,
    LoginResponse,
    AuthMeResponse,
    UserResponse,
    RegisterRequest,
    RegisterInitRequest,
    RegisterInitResponse,
    RegisterVerifyKeyRequest,
    RegisterVerifyKeyResponse,
    RegisterCompleteRequest,
)
from app.services.quota import (
    get_daily_usage_breakdown,
    DAILY_CREATE_LIMIT,
    DAILY_UPDATE_LIMIT,
    DAILY_DELETE_LIMIT,
)
from app.services.login_attempt import (
    record_login_attempt,
    is_user_locked_out,
    get_lockout_remaining_time,
    get_failed_attempts_count,
    lock_user_account,
    reset_failed_attempts,
    MAX_LOGIN_ATTEMPTS,
)
from app.api.captcha import verify_captcha

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
    # Check if user is locked out
    if is_user_locked_out(req.username):
        remaining = get_lockout_remaining_time(req.username)
        minutes = remaining // 60
        seconds = remaining % 60
        print(f"[auth.login] user {req.username} is locked out for {remaining}s")
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Compte temporairement verrouillé. Réessayez dans {minutes}m{seconds}s.",
        )

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
        record_login_attempt(req.username, False)
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
        # Record failed attempt
        record_login_attempt(req.username, False)
        failed_count = get_failed_attempts_count(req.username)

        if failed_count >= MAX_LOGIN_ATTEMPTS:
            lock_user_account(req.username)
            print(
                f"[auth.login] user {req.username} locked out after {MAX_LOGIN_ATTEMPTS} attempts"
            )
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Trop de tentatives échouées. Compte verrouillé pour 15 minutes.",
            )

        remaining_attempts = MAX_LOGIN_ATTEMPTS - failed_count
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid username or password. {remaining_attempts} attempt(s) remaining.",
        )

    # Successful login
    record_login_attempt(req.username, True)
    reset_failed_attempts(req.username)
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
async def register(req: RegisterRequest, request: Request):
    """Enregistrer un nouvel utilisateur avec validation CAPTCHA."""

    # Vérifie le CAPTCHA
    client_ip = request.client.host
    if not verify_captcha(req.captcha_token, req.captcha_answer, client_ip):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="CAPTCHA invalide ou expiré"
        )

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


# ============ RECOVERY KEY MANAGEMENT ============
# In-memory session storage for recovery keys during account creation
# Key: session_id, Value: { "key_raw": "...", "key_hash": "...", "expires_at": timestamp }
_recovery_key_sessions = {}


def _generate_recovery_key() -> str:
    """Generate a 128-bit recovery key, returned as 32 hex chars, formatted as XXXX-XXXX-..."""
    random_bytes = secrets.token_bytes(16)  # 128 bits
    hex_key = random_bytes.hex().upper()  # 32 hex chars
    # Format as XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX (8 groups of 4)
    formatted = "-".join([hex_key[i : i + 4] for i in range(0, 32, 4)])
    return formatted


def _normalize_recovery_key(key: str) -> str:
    """Remove dashes and spaces, convert to uppercase."""
    return key.replace("-", "").replace(" ", "").upper()


def _hash_recovery_key(key: str) -> str:
    """Hash recovery key using bcrypt (same as password)."""
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(key.encode(), salt).decode()


def _cleanup_expired_sessions():
    """Remove expired recovery key sessions."""
    now = datetime.utcnow()
    expired_keys = [
        sid
        for sid, data in _recovery_key_sessions.items()
        if datetime.fromisoformat(data["expires_at"]) < now
    ]
    for sid in expired_keys:
        del _recovery_key_sessions[sid]


@router.post("/register/init", response_model=RegisterInitResponse)
async def register_init(req: RegisterInitRequest):
    """
    Step 1: Generate a recovery key for account creation.
    Returns a unique session ID and the recovery key to display.
    """
    _cleanup_expired_sessions()

    # Generate recovery key
    recovery_key = _generate_recovery_key()
    recovery_key_normalized = _normalize_recovery_key(recovery_key)
    recovery_key_hash = _hash_recovery_key(recovery_key_normalized)

    # Create session
    session_id = secrets.token_urlsafe(32)
    _recovery_key_sessions[session_id] = {
        "key_raw": recovery_key_normalized,  # Store normalized form
        "key_hash": recovery_key_hash,
        "expires_at": (datetime.utcnow() + timedelta(minutes=10)).isoformat(),
    }

    return RegisterInitResponse(
        success=True,
        data={
            "session_id": session_id,
            "recovery_key": recovery_key,  # Display formatted version
        },
    )


@router.post("/register/verify-key", response_model=RegisterVerifyKeyResponse)
async def register_verify_key(req: RegisterVerifyKeyRequest):
    """
    Step 2: Verify that the user correctly entered the recovery key.
    This ensures they saved it before proceeding.
    """
    _cleanup_expired_sessions()

    session_id = req.session_id

    if session_id not in _recovery_key_sessions:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Recovery key session expired or invalid",
        )

    session_data = _recovery_key_sessions[session_id]
    user_key = _normalize_recovery_key(req.recovery_key)

    if user_key != session_data["key_raw"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Recovery key does not match. Please try again.",
        )

    # Key verified! Session is now ready for final registration
    return RegisterVerifyKeyResponse(
        success=True,
        data={},
    )


@router.post("/register/complete", response_model=LoginResponse)
async def register_complete(req: RegisterCompleteRequest, request: Request):
    """
    Step 3: Complete account creation with username, password, and verified recovery key.
    The recovery key must have been verified in step 2.
    """
    _cleanup_expired_sessions()

    # Verify CAPTCHA
    client_ip = request.client.host
    if not verify_captcha(req.captcha_token, req.captcha_answer, client_ip):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="CAPTCHA invalide ou expiré"
        )

    session_id = req.session_id

    if session_id not in _recovery_key_sessions:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No valid recovery key session. Please start over.",
        )

    session_data = _recovery_key_sessions[session_id]
    recovery_key_hash = session_data["key_hash"]

    def _create_user_with_recovery():
        conn = get_db()
        cursor = conn.cursor()

        # Check username availability
        cursor.execute("SELECT id FROM users WHERE username = ?", (req.username,))
        if cursor.fetchone():
            conn.close()
            return {"error": "Username already taken"}

        # Hash password
        hashed_password = get_password_hash(req.password)

        # Create user with recovery key hash
        cursor.execute(
            "INSERT INTO users (username, password_hash, recovery_key_hash) VALUES (?, ?, ?)",
            (req.username, hashed_password, recovery_key_hash),
        )
        conn.commit()
        user_id = cursor.lastrowid
        conn.close()

        return {"user_id": user_id}

    result = await asyncio.to_thread(_create_user_with_recovery)
    if "error" in result:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=result["error"],
        )

    user_id = result["user_id"]

    # Clean up session
    del _recovery_key_sessions[session_id]

    # Create token
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
