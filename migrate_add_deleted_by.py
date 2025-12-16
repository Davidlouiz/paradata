import sqlite3

DB_PATH = "alerte_parapente.db"


def migrate():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Add deleted_by column if it does not exist
    cursor.execute("PRAGMA table_info(map_objects)")
    cols = [row[1] for row in cursor.fetchall()]
    if "deleted_by" not in cols:
        cursor.execute("ALTER TABLE map_objects ADD COLUMN deleted_by INTEGER")
        # Optional: no backfill, remains NULL for historical deletions
        # Enforce FK behavior via pragma already enabled at runtime
        print("Added column deleted_by to map_objects")
    else:
        print("Column deleted_by already exists")

    conn.commit()
    conn.close()


if __name__ == "__main__":
    migrate()
