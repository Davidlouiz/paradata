"""
API CAPTCHA pour protéger l'inscription contre les bots.
Génère des challenges mathématiques simples avec rate limiting par IP.
"""

import secrets
import time
import random
from typing import Dict
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter(prefix="/captcha", tags=["captcha"])

# Cache en mémoire des challenges CAPTCHA (token -> {question, answer, expires, ip})
_captcha_store: Dict[str, dict] = {}

# Suivi des tentatives par IP (ip -> {attempts, reset_time})
_attempt_tracker: Dict[str, dict] = {}

MAX_ATTEMPTS_PER_IP = 5  # Max 5 tentatives par 15 minutes
ATTEMPT_WINDOW = 900  # 15 minutes en secondes


class CaptchaChallenge(BaseModel):
    token: str
    question: str


class CaptchaVerification(BaseModel):
    token: str
    answer: int


def _cleanup_expired():
    """Nettoie les challenges et compteurs expirés."""
    now = time.time()
    # Nettoie les challenges
    expired = [tok for tok, data in _captcha_store.items() if data["expires"] < now]
    for tok in expired:
        del _captcha_store[tok]
    # Nettoie les compteurs d'IP
    expired_ips = [
        ip for ip, data in _attempt_tracker.items() if data["reset_time"] < now
    ]
    for ip in expired_ips:
        del _attempt_tracker[ip]


def _check_ip_attempts(ip: str) -> bool:
    """Vérifie si l'IP a dépassé la limite de tentatives."""
    _cleanup_expired()
    now = time.time()

    if ip not in _attempt_tracker:
        return True

    data = _attempt_tracker[ip]
    if data["reset_time"] < now:
        # Fenêtre expirée, réinitialise
        del _attempt_tracker[ip]
        return True

    return data["attempts"] < MAX_ATTEMPTS_PER_IP


def _record_attempt(ip: str, success: bool):
    """Enregistre une tentative de CAPTCHA."""
    now = time.time()

    if ip not in _attempt_tracker:
        _attempt_tracker[ip] = {"attempts": 1, "reset_time": now + ATTEMPT_WINDOW}
    else:
        _attempt_tracker[ip]["attempts"] += 1
        # Si succès, on peut réduire légèrement le compteur
        if success and _attempt_tracker[ip]["attempts"] > 1:
            _attempt_tracker[ip]["attempts"] -= 1


@router.get("/challenge", response_model=CaptchaChallenge)
async def get_challenge(request: Request):
    """Génère un challenge CAPTCHA mathématique avec difficulté variable."""
    _cleanup_expired()

    client_ip = request.client.host

    if not _check_ip_attempts(client_ip):
        raise HTTPException(
            status_code=429, detail="Trop de tentatives. Réessayez dans 15 minutes."
        )

    # Génère une opération avec difficulté variable
    difficulty = random.choice(["easy", "medium", "hard"])

    if difficulty == "easy":
        a, b = random.randint(1, 10), random.randint(1, 10)
        operations = [
            (f"{a} + {b}", a + b),
            (f"{a} - {b}" if a >= b else f"{b} - {a}", abs(a - b)),
        ]
    elif difficulty == "medium":
        a, b = random.randint(5, 20), random.randint(2, 10)
        operations = [
            (f"{a} + {b}", a + b),
            (f"{a} - {b}" if a >= b else f"{b} - {a}", abs(a - b)),
            (f"{a} × {b}", a * b),
        ]
    else:  # hard
        a, b = random.randint(2, 12), random.randint(2, 12)
        c = random.randint(1, 5)
        operations = [
            (f"{a} × {b}", a * b),
            (f"({a} + {b}) × {c}", (a + b) * c),
            (f"{a * b} ÷ {a}", b),
        ]

    question, answer = random.choice(operations)

    # Génère un token unique
    token = secrets.token_urlsafe(32)

    # Stocke le challenge (expire après 5 minutes)
    _captcha_store[token] = {
        "answer": answer,
        "expires": time.time() + 300,
        "ip": client_ip,
    }

    return CaptchaChallenge(token=token, question=question)


def verify_captcha(token: str, answer: int, ip: str) -> bool:
    """
    Vérifie la réponse au CAPTCHA et enregistre la tentative.
    Retourne True si la réponse est correcte, False sinon.
    """
    _cleanup_expired()

    if not _check_ip_attempts(ip):
        return False

    if token not in _captcha_store:
        _record_attempt(ip, False)
        return False

    data = _captcha_store[token]

    # Vérifie que le token correspond à la même IP
    if data.get("ip") != ip:
        _record_attempt(ip, False)
        del _captcha_store[token]
        return False

    # Vérifie l'expiration
    if data["expires"] < time.time():
        _record_attempt(ip, False)
        del _captcha_store[token]
        return False

    # Vérifie la réponse
    is_valid = data["answer"] == answer

    # Enregistre la tentative
    _record_attempt(ip, is_valid)

    # Invalide le token (usage unique)
    del _captcha_store[token]

    return is_valid
