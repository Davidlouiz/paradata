from datetime import date
from app.database import get_db

# Per-action daily limits
DAILY_CREATE_LIMIT = 20
DAILY_UPDATE_LIMIT = 5
DAILY_DELETE_LIMIT = 5


def get_daily_usage_breakdown(user_id: int) -> dict:
    """Get breakdown of today's actions by type (CREATE, UPDATE, DELETE).

    Special handling:
    - GRACE_DELETE does not count toward DELETE.
    - Each GRACE_DELETE "restores" one CREATE (subtracts from today's CREATE, not below 0).
    """
    conn = get_db()
    cursor = conn.cursor()

    today = str(date.today())

    cursor.execute(
        """
        SELECT action, COUNT(*) as count FROM audit_log 
        WHERE user_id = ? 
        AND DATE(timestamp) = ?
        AND action IN ('CREATE', 'UPDATE', 'DELETE')
        GROUP BY action
    """,
        (user_id, today),
    )

    breakdown = {"CREATE": 0, "UPDATE": 0, "DELETE": 0}
    for row in cursor.fetchall():
        action, count = row[0], row[1]
        breakdown[action] = count

    # Count GRACE_DELETE entries for today (do not count as DELETE; restore CREATE)
    cursor.execute(
        """
        SELECT COUNT(*) FROM audit_log
        WHERE user_id = ? AND DATE(timestamp) = ? AND action = 'GRACE_DELETE'
        """,
        (user_id, today),
    )
    grace_delete_count = cursor.fetchone()[0] or 0

    if grace_delete_count:
        # Restore CREATE by subtracting GRACE_DELETE count, not below zero
        breakdown["CREATE"] = max(0, breakdown["CREATE"] - grace_delete_count)
        # DELETE is already unaffected since GRACE_DELETE isn't included above

    conn.close()
    return breakdown


def _get_action_limit(action: str) -> int:
    action = action.upper()
    if action == "CREATE":
        return DAILY_CREATE_LIMIT
    if action == "UPDATE":
        return DAILY_UPDATE_LIMIT
    if action == "DELETE":
        return DAILY_DELETE_LIMIT
    # Unknown actions are not limited
    return 0


def check_daily_quota(user_id: int, action: str) -> bool:
    """Return True if user has quota remaining for the given action."""
    action = action.upper()
    limit = _get_action_limit(action)
    if limit == 0:
        return True

    breakdown = get_daily_usage_breakdown(user_id)
    return breakdown.get(action, 0) < limit


def get_remaining_quota(user_id: int, action: str) -> int:
    """Get remaining quota for user today for the given action."""
    action = action.upper()
    limit = _get_action_limit(action)
    if limit == 0:
        return 0

    breakdown = get_daily_usage_breakdown(user_id)
    return max(0, limit - breakdown.get(action, 0))
