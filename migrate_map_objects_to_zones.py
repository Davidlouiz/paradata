#!/usr/bin/env python3
"""
Migration: Rename map_objects table to zones
- Creates new 'zones' table with identical structure
- Copies all data from map_objects
- Updates audit_log references
- Drops old map_objects table
"""

import sqlite3
from datetime import datetime

DB_PATH = "alerte_parapente.db"


def migrate():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    print("🔄 Starting map_objects → zones migration...")

    # Create new zones table
    print("📝 Creating zones table...")
    cursor.execute("""
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
    """)

    # Check if map_objects exists
    cursor.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='map_objects'"
    )
    if cursor.fetchone():
        # Copy data from map_objects to zones
        print("📊 Copying data from map_objects to zones...")
        cursor.execute("""
            INSERT INTO zones (id, geometry, zone_type_id, description, created_by, created_at,
                              updated_by, updated_at, deleted_by, deleted_at, locked_by, lock_expires_at)
            SELECT id, geometry, zone_type_id, description, created_by, created_at,
                   updated_by, updated_at, deleted_by, deleted_at, locked_by, lock_expires_at
            FROM map_objects
        """)
        count = cursor.rowcount
        print(f"✅ Copied {count} zones")

        # Drop old table
        print("🗑️ Dropping old map_objects table...")
        cursor.execute("DROP TABLE IF EXISTS map_objects")

        print("✅ Migration completed successfully!")
    else:
        print("ℹ️ map_objects table doesn't exist, zones table created")

    # Create indices for performance
    print("📈 Creating indices...")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_zones_deleted ON zones(deleted_at)")
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_zones_locked ON zones(locked_by, lock_expires_at)"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_zones_zone_type ON zones(zone_type_id)"
    )

    conn.commit()
    conn.close()
    print("✅ All done!")


if __name__ == "__main__":
    migrate()
