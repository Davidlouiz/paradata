#!/usr/bin/env python3
"""
Migration script: Simplify to 2 alert levels only
- NO_ALERT (keep as is)
- ALERT_MANAGERS + ALERT_COMMUNITY → ALERT_STANDARD
"""

import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "alerte_parapente.db"


def migrate():
    print("🔄 Starting migration to 2 alert levels...")

    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    # Check current distribution
    print("\n📊 Current distribution in map_objects:")
    cursor.execute(
        "SELECT severity, COUNT(*) as count FROM map_objects WHERE deleted_at IS NULL GROUP BY severity"
    )
    for row in cursor.fetchall():
        print(f"   • {row['severity']}: {row['count']} zones")

    # Recreate table with new CHECK constraint (2 levels only)
    print("\n📦 Recreating map_objects with 2-level CHECK constraint...")
    cursor.execute("PRAGMA foreign_keys = OFF;")
    cursor.execute("BEGIN;")

    cursor.execute(
        """
        CREATE TABLE map_objects_new (
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
        """
    )

    cursor.execute(
        """
        INSERT INTO map_objects_new (
            id, geometry, severity, description, created_by, created_at,
            updated_by, updated_at, deleted_at, locked_by, lock_expires_at
        )
        SELECT
            id,
            geometry,
            CASE severity
                WHEN 'NO_ALERT' THEN 'NO_ALERT'
                WHEN 'ALERT_MANAGERS' THEN 'ALERT_STANDARD'
                WHEN 'ALERT_COMMUNITY' THEN 'ALERT_STANDARD'
                ELSE 'ALERT_STANDARD'
            END AS severity,
            description,
            created_by,
            created_at,
            updated_by,
            updated_at,
            deleted_at,
            locked_by,
            lock_expires_at
        FROM map_objects;
        """
    )

    managers_count = cursor.execute(
        "SELECT COUNT(*) FROM map_objects WHERE severity = 'ALERT_MANAGERS'"
    ).fetchone()[0]
    community_count = cursor.execute(
        "SELECT COUNT(*) FROM map_objects WHERE severity = 'ALERT_COMMUNITY'"
    ).fetchone()[0]

    cursor.execute("DROP TABLE map_objects;")
    cursor.execute("ALTER TABLE map_objects_new RENAME TO map_objects;")

    # Recreate indexes
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_map_objects_deleted ON map_objects(deleted_at);"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_map_objects_locked ON map_objects(locked_by, lock_expires_at);"
    )

    cursor.execute("COMMIT;")
    cursor.execute("PRAGMA foreign_keys = ON;")

    print(
        f"   • ALERT_MANAGERS ({managers_count}) + ALERT_COMMUNITY ({community_count}) → ALERT_STANDARD"
    )
    print("   • Table recreated and data migrated")

    # Update audit_log JSON blobs
    print("\n📝 Updating audit_log snapshots (before_data/after_data)...")

    audit_updated = 0
    cursor.execute(
        "SELECT id, before_data, after_data FROM audit_log WHERE "
        "(before_data LIKE '%ALERT_MANAGERS%' OR before_data LIKE '%ALERT_COMMUNITY%') "
        "OR (after_data LIKE '%ALERT_MANAGERS%' OR after_data LIKE '%ALERT_COMMUNITY%')"
    )
    audit_entries = cursor.fetchall()

    for entry in audit_entries:
        before = entry["before_data"]
        after = entry["after_data"]

        if before:
            new_before = before.replace('"ALERT_MANAGERS"', '"ALERT_STANDARD"')
            new_before = new_before.replace('"ALERT_COMMUNITY"', '"ALERT_STANDARD"')
        else:
            new_before = before

        if after:
            new_after = after.replace('"ALERT_MANAGERS"', '"ALERT_STANDARD"')
            new_after = new_after.replace('"ALERT_COMMUNITY"', '"ALERT_STANDARD"')
        else:
            new_after = after

        if new_before != before or new_after != after:
            cursor.execute(
                "UPDATE audit_log SET before_data = ?, after_data = ? WHERE id = ?",
                (new_before, new_after, entry["id"]),
            )
            audit_updated += 1

    print(f"   • {audit_updated} audit entries updated")

    # Verify migration
    print("\n✅ Verification - New distribution in map_objects:")
    cursor.execute(
        "SELECT severity, COUNT(*) as count FROM map_objects WHERE deleted_at IS NULL GROUP BY severity"
    )
    for row in cursor.fetchall():
        print(f"   • {row['severity']}: {row['count']} zones")

    conn.commit()
    conn.close()

    print("\n✅ Migration complete!")
    print(f"   Total audit entries updated: {audit_updated}")


if __name__ == "__main__":
    migrate()
