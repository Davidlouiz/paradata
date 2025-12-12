from datetime import date
from app.database import get_db, dict_from_row

DAILY_QUOTA_LIMIT = 20  # Max objects per user per day


def get_daily_usage(user_id: int) -> int:
    """Get number of creations/modifications by user today."""
    conn = get_db()
    cursor = conn.cursor()
    
    today = str(date.today())
    cursor.execute("""
        SELECT count FROM daily_quota 
        WHERE user_id = ? AND date = ?
    """, (user_id, today))
    
    row = cursor.fetchone()
    conn.close()
    
    return row[0] if row else 0


def check_daily_quota(user_id: int) -> bool:
    """Return True if user has quota remaining, False if exceeded."""
    usage = get_daily_usage(user_id)
    return usage < DAILY_QUOTA_LIMIT


def increment_daily_quota(user_id: int):
    """Increment user's daily usage."""
    conn = get_db()
    cursor = conn.cursor()
    
    today = str(date.today())
    
    # Try to increment existing record
    cursor.execute("""
        UPDATE daily_quota 
        SET count = count + 1
        WHERE user_id = ? AND date = ?
    """, (user_id, today))
    
    if cursor.rowcount == 0:
        # Insert new record
        cursor.execute("""
            INSERT INTO daily_quota (user_id, date, count)
            VALUES (?, ?, 1)
        """, (user_id, today))
    
    conn.commit()
    conn.close()


def get_remaining_quota(user_id: int) -> int:
    """Get remaining quota for user today."""
    usage = get_daily_usage(user_id)
    return max(0, DAILY_QUOTA_LIMIT - usage)
