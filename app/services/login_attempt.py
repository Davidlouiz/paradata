"""Service for managing login attempts and account lockout."""

from datetime import datetime, timedelta
from app.database import get_db

MAX_LOGIN_ATTEMPTS = 5
LOCKOUT_DURATION_MINUTES = 15


def record_login_attempt(username: str, success: bool, ip_address: str = None):
    """Record a login attempt in the database."""
    conn = None
    try:
        conn = get_db()
        c = conn.cursor()
        c.execute(
            """
            INSERT INTO login_attempts (username, success, ip_address)
            VALUES (?, ?, ?)
        """,
            (username, success, ip_address),
        )
        conn.commit()
    finally:
        if conn:
            conn.close()


def get_failed_attempts_count(username: str) -> int:
    """Get the number of failed login attempts in the last LOCKOUT_DURATION_MINUTES."""
    conn = None
    try:
        conn = get_db()
        c = conn.cursor()
        cutoff_time = datetime.utcnow() - timedelta(minutes=LOCKOUT_DURATION_MINUTES)
        c.execute(
            """
            SELECT COUNT(*) FROM login_attempts
            WHERE username = ? AND success = 0 AND attempted_at > ?
        """,
            (username, cutoff_time),
        )
        count = c.fetchone()[0]
        return count
    finally:
        if conn:
            conn.close()


def is_user_locked_out(username: str) -> bool:
    """Check if user is currently locked out."""
    conn = None
    try:
        conn = get_db()
        c = conn.cursor()
        c.execute(
            """
            SELECT locked_until FROM login_lockout WHERE username = ?
        """,
            (username,),
        )
        result = c.fetchone()

        if not result:
            return False

        locked_until = datetime.fromisoformat(result[0])
        if datetime.utcnow() > locked_until:
            # Lockout expired, remove the record
            c.execute("DELETE FROM login_lockout WHERE username = ?", (username,))
            conn.commit()
            return False

        return True
    finally:
        if conn:
            conn.close()


def get_lockout_remaining_time(username: str) -> int:
    """Get remaining lockout time in seconds. Returns 0 if not locked out."""
    conn = None
    try:
        conn = get_db()
        c = conn.cursor()
        c.execute(
            """
            SELECT locked_until FROM login_lockout WHERE username = ?
        """,
            (username,),
        )
        result = c.fetchone()

        if not result:
            return 0

        locked_until = datetime.fromisoformat(result[0])
        remaining = (locked_until - datetime.utcnow()).total_seconds()
        return max(0, int(remaining))
    finally:
        if conn:
            conn.close()


def lock_user_account(username: str):
    """Lock a user account for LOCKOUT_DURATION_MINUTES."""
    conn = None
    try:
        conn = get_db()
        c = conn.cursor()
        locked_until = datetime.utcnow() + timedelta(minutes=LOCKOUT_DURATION_MINUTES)
        c.execute(
            """
            INSERT OR REPLACE INTO login_lockout (username, locked_until)
            VALUES (?, ?)
        """,
            (username, locked_until.isoformat()),
        )
        conn.commit()
    finally:
        if conn:
            conn.close()


def reset_failed_attempts(username: str):
    """Reset failed login attempts after successful login."""
    conn = None
    try:
        conn = get_db()
        c = conn.cursor()
        c.execute("DELETE FROM login_lockout WHERE username = ?", (username,))
        conn.commit()
    finally:
        if conn:
            conn.close()
