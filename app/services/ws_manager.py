"""
WebSocket Connection Manager – Track connected clients and broadcast events
"""

from typing import Dict, Set
from datetime import datetime


class ConnectionManager:
    """Manage WebSocket connections and broadcast events."""

    def __init__(self):
        self.active_connections: Dict[str, Set] = {}  # user_id -> set of sids
        self.sids_to_users: Dict[str, str] = {}  # sid -> user_id

    def connect(self, sid: str, user_id: str = None):
        """Register a new connection."""
        if user_id:
            if user_id not in self.active_connections:
                self.active_connections[user_id] = set()
            self.active_connections[user_id].add(sid)
        self.sids_to_users[sid] = user_id

    def disconnect(self, sid: str):
        """Unregister a connection."""
        user_id = self.sids_to_users.pop(sid, None)
        if user_id and user_id in self.active_connections:
            self.active_connections[user_id].discard(sid)
            if not self.active_connections[user_id]:
                del self.active_connections[user_id]

    def get_user_connections(self, user_id: str) -> Set:
        """Get all SIDs for a user."""
        return self.active_connections.get(user_id, set())

    def get_all_connections(self) -> list:
        """Get all connected SIDs."""
        return list(self.sids_to_users.keys())


# Global connection manager instance
manager = ConnectionManager()
