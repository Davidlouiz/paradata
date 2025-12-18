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
    RegisterInitRequest,
    RegisterInitResponse,
    RegisterVerifyKeyRequest,
    RegisterVerifyKeyResponse,
    RegisterCompleteRequest,
    RecoverPasswordRequest,
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
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Non authentifié"
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
            detail="Nom d'utilisateur ou mot de passe invalide",
        )

    try:
        print(f"[auth.login] verifying password for user id={user.get('id')}")
        valid = verify_password(req.password, user.get("password_hash") or "")
    except Exception as exc:
        print(f"[auth.login] password verification error: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Erreur interne lors de l'authentification",
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
            detail=f"Nom d'utilisateur ou mot de passe invalide. {remaining_attempts} tentative(s) restante(s).",
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


# ============ RECOVERY KEY MANAGEMENT ============
# In-memory session storage for recovery keys during account creation
# Key: session_id, Value: { "key_raw": "...", "key_hash": "...", "expires_at": timestamp }
_recovery_key_sessions = {}


def _generate_recovery_key() -> str:
    """Générer une clé de récupération 128 bits, retournée comme 32 caractères hex, formatée comme XXXX-XXXX-..."""
    random_bytes = secrets.token_bytes(16)  # 128 bits
    hex_key = random_bytes.hex().upper()  # 32 hex chars
    # Format as XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX (8 groups of 4)
    formatted = "-".join([hex_key[i : i + 4] for i in range(0, 32, 4)])
    return formatted


def _normalize_recovery_key(key: str) -> str:
    """Supprimer les tirets et espaces, convertir en majuscules."""
    return key.replace("-", "").replace(" ", "").upper()


def _hash_recovery_key(key: str) -> str:
    """Hacher la clé de récupération en utilisant bcrypt (comme le mot de passe)."""
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(key.encode(), salt).decode()


def _cleanup_expired_sessions():
    """Supprimer les sessions de clé de récupération expirées."""
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
    Étape 1 : Générer une clé de récupération pour la création de compte.
    Retourne un ID de session unique et la clé de récupération à afficher.
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
    Étape 2 : Vérifier que l'utilisateur a correctement saisi la clé de récupération.
    Cela garantit qu'il l'a sauvegardée avant de continuer.
    """
    _cleanup_expired_sessions()

    session_id = req.session_id

    if session_id not in _recovery_key_sessions:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Session de clé de récupération expirée ou invalide",
        )

    session_data = _recovery_key_sessions[session_id]
    user_key = _normalize_recovery_key(req.recovery_key)

    if user_key != session_data["key_raw"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La clé de récupération ne correspond pas. Veuillez réessayer.",
        )

    # Key verified! Session is now ready for final registration
    return RegisterVerifyKeyResponse(
        success=True,
        data={},
    )


@router.post("/register/complete", response_model=LoginResponse)
async def register_complete(req: RegisterCompleteRequest, request: Request):
    """
    Étape 3 : Terminer la création de compte avec nom d'utilisateur, mot de passe et clé de récupération vérifiée.
    La clé de récupération doit avoir été vérifiée à l'étape 2.
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
            detail="Aucune session de clé de récupération valide. Veuillez recommencer.",
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
            return {"error": "Ce nom d'utilisateur est déjà utilisé"}

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


@router.post("/recover-password", response_model=LoginResponse)
async def recover_password(req: RecoverPasswordRequest):
    """
    Réinitialiser le compte (nom d'utilisateur + mot de passe) en utilisant la clé de récupération.
    La clé de récupération est l'identifiant unique - preuve de propriété du compte.
    Permet de changer à la fois le nom d'utilisateur et le mot de passe.
    """

    def _reset_account():
        conn = get_db()
        cursor = conn.cursor()

        # Normalize and verify the recovery key by scanning all users
        normalized_key = _normalize_recovery_key(req.recovery_key)

        # Find user by recovery key hash
        cursor.execute("SELECT * FROM users WHERE recovery_key_hash IS NOT NULL")
        rows = cursor.fetchall()

        user = None
        for row in rows:
            user_data = dict_from_row(row)
            try:
                if bcrypt.checkpw(
                    normalized_key.encode(), user_data["recovery_key_hash"].encode()
                ):
                    user = user_data
                    break
            except Exception:
                continue

        if not user:
            conn.close()
            return {"error": "Clé de récupération invalide"}

        # Check if new username is already taken (by another user)
        cursor.execute(
            "SELECT id FROM users WHERE username = ? AND id != ?",
            (req.new_username, user["id"]),
        )
        if cursor.fetchone():
            conn.close()
            return {"error": "Ce nom d'utilisateur est déjà utilisé"}

        # Update both username and password
        new_password_hash = get_password_hash(req.new_password)
        cursor.execute(
            "UPDATE users SET username = ?, password_hash = ? WHERE id = ?",
            (req.new_username, new_password_hash, user["id"]),
        )
        conn.commit()
        conn.close()

        return {"user_id": user["id"], "username": req.new_username}

    result = await asyncio.to_thread(_reset_account)

    if "error" in result:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=result["error"],
        )

    # Create token for automatic login
    token = create_access_token(result["user_id"])

    return LoginResponse(
        success=True,
        data={
            "id": result["user_id"],
            "username": result["username"],
            "token": token,
            "created_at": datetime.utcnow().isoformat(),
        },
    )
