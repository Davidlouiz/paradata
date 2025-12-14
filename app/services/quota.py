from datetime import date
from app.database import get_db, dict_from_row

DAILY_QUOTA_LIMIT = 5  # Max objects per user per day


def get_daily_usage(user_id: int) -> int:
    """Get number of creations/modifications by user today."""
    conn = get_db()
    cursor = conn.cursor()

    today = str(date.today())

    # Compter toutes les actions (CREATE, UPDATE, DELETE) dans audit_log pour aujourd'hui
    cursor.execute(
        """
        SELECT COUNT(*) FROM audit_log 
        WHERE user_id = ? 
        AND DATE(timestamp) = ?
        AND action IN ('CREATE', 'UPDATE', 'DELETE')
    """,
        (user_id, today),
    )

    row = cursor.fetchone()
    conn.close()

    return row[0] if row else 0


def check_daily_quota(user_id: int) -> bool:
    """Return True if user has quota remaining, False if exceeded."""
    usage = get_daily_usage(user_id)
    return usage < DAILY_QUOTA_LIMIT


def increment_daily_quota(user_id: int):
    """Increment user's daily usage - no longer needed, calculated from audit_log."""
    # Cette fonction ne fait plus rien, le quota est calculé automatiquement
    # depuis audit_log par get_daily_usage()
    pass


def get_remaining_quota(user_id: int) -> int:
    """Get remaining quota for user today."""
    usage = get_daily_usage(user_id)
    return max(0, DAILY_QUOTA_LIMIT - usage)
