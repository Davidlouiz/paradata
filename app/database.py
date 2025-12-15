import sqlite3
import os
from datetime import datetime
from typing import Optional

DB_PATH = "alerte_parapente.db"


def get_db():
    """Get database connection."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    # Enable foreign keys
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    """Initialize database schema."""
    conn = get_db()
    cursor = conn.cursor()

    # Users table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Map objects table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS map_objects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            geometry TEXT NOT NULL,
            severity TEXT NOT NULL CHECK(severity IN ('NO_ALERT', 'ALERT_STANDARD')),
            description TEXT,
            created_by INTEGER NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_by INTEGER,
            updated_at TIMESTAMP,
            deleted_at TIMESTAMP,
            locked_by INTEGER,
            lock_expires_at TIMESTAMP,
            FOREIGN KEY (created_by) REFERENCES users(id),
            FOREIGN KEY (updated_by) REFERENCES users(id),
            FOREIGN KEY (locked_by) REFERENCES users(id)
        )
    """)

    # Audit log table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            object_id INTEGER NOT NULL,
            action TEXT NOT NULL,
            user_id INTEGER NOT NULL,
            timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            before_data TEXT,
            after_data TEXT,
            FOREIGN KEY (object_id) REFERENCES map_objects(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)

    # Create indices for performance
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_map_objects_deleted ON map_objects(deleted_at)"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_map_objects_locked ON map_objects(locked_by, lock_expires_at)"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_audit_log_object ON audit_log(object_id)"
    )

    # Volunteer coverage table: polygons defined by users for monitoring
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS volunteer_coverage (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            geometry TEXT NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        )
        """
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_volunteer_coverage_user ON volunteer_coverage(user_id)"
    )

    # Clean up legacy daily_quota table (unused since quotas derive from audit_log)
    cursor.execute("DROP TABLE IF EXISTS daily_quota")

    conn.commit()
    conn.close()


def dict_from_row(row: sqlite3.Row) -> dict:
    """Convert sqlite3.Row to dict."""
    return dict(row) if row else None
