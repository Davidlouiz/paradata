#!/usr/bin/env python3
"""Migrate database to support dynamic zone types.

- Creates `zone_types` table (code/name/color_hex) if missing and seeds defaults.
- Rebuilds `map_objects` to reference `zone_types(code)` instead of a fixed CHECK.
"""

import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "alerte_parapente.db"

DEFAULT_ZONE_TYPES = [
    ("NO_ALERT", "Aucune alerte", "#7cb342"),
    ("ALERT_STANDARD", "Alerte standard", "#d32f2f"),
]


def ensure_zone_types(conn: sqlite3.Connection) -> None:
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS zone_types (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            color_hex TEXT NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    cur.executemany(
        "INSERT OR IGNORE INTO zone_types (code, name, color_hex) VALUES (?, ?, ?)",
        DEFAULT_ZONE_TYPES,
    )
    conn.commit()


def map_objects_has_new_schema(conn: sqlite3.Connection) -> bool:
    """Check if map_objects already has zone_type_id column (new schema)."""
    cur = conn.cursor()
    try:
        cur.execute("PRAGMA table_info(map_objects)")
    except sqlite3.Error:
        return False
    rows = cur.fetchall() or []
    for row in rows:
        # row format: (cid, name, type, notnull, dflt_value, pk)
        if len(row) >= 2 and row[1] == "zone_type_id":
            return True
    return False


def rebuild_map_objects(conn: sqlite3.Connection) -> None:
    cur = conn.cursor()
    cur.execute("ALTER TABLE map_objects RENAME TO map_objects_old")

    # Recreate map_objects with FK to zone_types(id)
    cur.execute(
        """
        CREATE TABLE map_objects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            geometry TEXT NOT NULL,
            zone_type_id INTEGER NOT NULL,
            description TEXT,
            created_by INTEGER NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_by INTEGER,
            updated_at TIMESTAMP,
            deleted_at TIMESTAMP,
            locked_by INTEGER,
            lock_expires_at TIMESTAMP,
            FOREIGN KEY (zone_type_id) REFERENCES zone_types(id),
            FOREIGN KEY (created_by) REFERENCES users(id),
            FOREIGN KEY (updated_by) REFERENCES users(id),
            FOREIGN KEY (locked_by) REFERENCES users(id)
        )
        """
    )

    # Copy existing data, resolving severity code to zone_type_id
    cur.execute(
        """
        INSERT INTO map_objects (
            id, geometry, zone_type_id, description, created_by, created_at,
            updated_by, updated_at, deleted_at, locked_by, lock_expires_at
        )
        SELECT
            o.id, o.geometry, zt.id, o.description, o.created_by, o.created_at,
            o.updated_by, o.updated_at, o.deleted_at, o.locked_by, o.lock_expires_at
        FROM map_objects_old o
        LEFT JOIN zone_types zt ON zt.code = o.severity
        """
    )

    # Drop old table
    cur.execute("DROP TABLE map_objects_old")

    # Recreate indexes
    cur.execute(
        "CREATE INDEX IF NOT EXISTS idx_map_objects_deleted ON map_objects(deleted_at)"
    )
    cur.execute(
        "CREATE INDEX IF NOT EXISTS idx_map_objects_locked ON map_objects(locked_by, lock_expires_at)"
    )

    conn.commit()


def main():
    if not DB_PATH.exists():
        print(f"Database not found at {DB_PATH}, nothing to migrate.")
        return

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")

    ensure_zone_types(conn)

    if map_objects_has_new_schema(conn):
        print("map_objects already has zone_type_id column; no rebuild needed.")
        conn.close()
        return

    print("Rebuilding map_objects to use zone_type_id instead of severity...")
    rebuild_map_objects(conn)
    conn.close()
    print("Migration complete.")


if __name__ == "__main__":
    main()
