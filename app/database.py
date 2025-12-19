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

    # Users table (created first, no dependencies)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            recovery_key_hash TEXT,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Backfill recovery_key_hash column for existing databases
    cursor.execute("PRAGMA table_info(users)")
    user_columns = [row[1] for row in cursor.fetchall()]
    if "recovery_key_hash" not in user_columns:
        cursor.execute("ALTER TABLE users ADD COLUMN recovery_key_hash TEXT")

    # Zone types table (dynamic list of severities)
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS zone_types (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            color_hex TEXT NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            deleted_by INTEGER,
            deleted_at TIMESTAMP,
            FOREIGN KEY (deleted_by) REFERENCES users(id)
        )
        """
    )

    # Backfill columns for existing databases
    cursor.execute("PRAGMA table_info(zone_types)")
    zone_type_columns = [row[1] for row in cursor.fetchall()]
    if "description" not in zone_type_columns:
        cursor.execute("ALTER TABLE zone_types ADD COLUMN description TEXT")
    if "deleted_by" not in zone_type_columns:
        cursor.execute(
            "ALTER TABLE zone_types ADD COLUMN deleted_by INTEGER REFERENCES users(id)"
        )
    if "deleted_at" not in zone_type_columns:
        cursor.execute("ALTER TABLE zone_types ADD COLUMN deleted_at TIMESTAMP")

    # Backfill descriptions for existing rows (overwrite to ensure wording is current)
    cursor.execute(
        """
        UPDATE zone_types
        SET code = 'DIFFICULT_ACCESS',
            name = 'Zones difficiles d''accès',
            description = 'Zone dont il est difficile de ressortir à pied, sans assistance.',
            color_hex = '#5c6bc0'
        WHERE code IN ('DENSE_VEGETATION', 'DIFFICULT_ACCESS')
        """
    )
    cursor.execute(
        """
        UPDATE zone_types
        SET description = 'Zone où une disparition peut passer inaperçue et retarder l''arrivée des secours.'
        WHERE code = 'REMOTE_AREA'
        """
    )
    cursor.execute(
        """
        UPDATE zone_types
        SET name = 'Décollage',
            description = 'Zone utilisée pour le décollage des parapentes.',
            color_hex = '#00c853'
        WHERE code = 'TAKEOFF'
        """
    )
    cursor.execute(
        """
        UPDATE zone_types
        SET name = 'Atterrissage',
            description = 'Zone destinée à l''atterrissage des parapentes.',
            color_hex = '#d500f9'
        WHERE code = 'LANDING'
        """
    )
    cursor.execute(
        """
        UPDATE zone_types
        SET name = 'Zone de préparation',
            description = 'Zone pour se préparer, s''équiper ou plier.',
            color_hex = '#ffd600'
        WHERE code = 'PREPARATION_ZONE'
        """
    )

    # Seed default zone types if missing
    cursor.execute(
        """
        INSERT OR IGNORE INTO zone_types (code, name, description, color_hex) VALUES
        (
            'DIFFICULT_ACCESS',
            'Zones difficiles d''accès',
            'Zone où il est compliqué ou impossible d''aller facilement, pour les personnes comme pour les secours.',
            '#5c6bc0'
        ),
        (
            'REMOTE_AREA',
            'Zone reculée',
            'Zone où une disparition peut passer inaperçue et retarder l''arrivée des secours.',
            '#d32f2f'
        ),
        (
            'TAKEOFF',
            'Décollage',
            'Zone utilisée pour le décollage des parapentes.',
            '#00c853'
        ),
        (
            'LANDING',
            'Atterrissage',
            'Zone destinée à l''atterrissage des parapentes.',
            '#d500f9'
        ),
        (
            'PREPARATION_ZONE',
            'Zone de préparation',
            'Zone pour se préparer, s''équiper ou plier.',
            '#ffd600'
        )
        """
    )

    # Map zones table
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS zones (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            geometry TEXT NOT NULL,
            zone_type_id INTEGER NOT NULL,
            description TEXT,
            created_by INTEGER NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_by INTEGER,
            updated_at TIMESTAMP,
            deleted_by INTEGER,
            deleted_at TIMESTAMP,
            locked_by INTEGER,
            lock_expires_at TIMESTAMP,
            FOREIGN KEY (zone_type_id) REFERENCES zone_types(id),
            FOREIGN KEY (created_by) REFERENCES users(id),
            FOREIGN KEY (updated_by) REFERENCES users(id),
            FOREIGN KEY (deleted_by) REFERENCES users(id),
            FOREIGN KEY (locked_by) REFERENCES users(id)
        )
    """
    )

    # Login attempts table (for lockout mechanism)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS login_attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            attempted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            ip_address TEXT,
            success BOOLEAN DEFAULT 0
        )
    """)

    # Login lockout table (tracks locked accounts)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS login_lockout (
            username TEXT PRIMARY KEY,
            locked_until DATETIME NOT NULL
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
            FOREIGN KEY (object_id) REFERENCES zones(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)

    # Create indices for performance
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_zones_deleted ON zones(deleted_at)")
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_zones_locked ON zones(locked_by, lock_expires_at)"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_audit_log_object ON audit_log(object_id)"
    )

    # Table volunteer_coverage supprimée

    # Clean up legacy daily_quota table (unused since quotas derive from audit_log)
    cursor.execute("DROP TABLE IF EXISTS daily_quota")

    conn.commit()
    conn.close()


def dict_from_row(row: sqlite3.Row) -> dict:
    """Convert sqlite3.Row to dict."""
    return dict(row) if row else None
