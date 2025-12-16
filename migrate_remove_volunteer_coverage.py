#!/usr/bin/env python3
"""
Migration script to remove volunteer_coverage table and related data.
Run once after updating the codebase to drop obsolete coverage features.
"""

import sqlite3

DB_PATH = "alerte_parapente.db"


def main():
    conn = sqlite3.connect(DB_PATH)
    try:
        cur = conn.cursor()
        # Drop indexes first if they exist
        try:
            cur.execute("DROP INDEX IF EXISTS idx_volunteer_coverage_user")
        except Exception:
            pass
        # Drop table
        cur.execute("DROP TABLE IF EXISTS volunteer_coverage")
        conn.commit()
        print("Dropped volunteer_coverage (and related index) if existed.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
