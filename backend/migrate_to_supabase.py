"""
Render → Supabase PostgreSQL Migration Script
==============================================
1. Connects to the Render Postgres database and dumps all table data.
2. Creates the schema on Supabase Postgres.
3. Imports all data into Supabase.

Usage:
    python migrate_to_supabase.py --render-url "postgresql://..." --supabase-url "postgresql://..."

If --render-url is not provided, it dumps from the local SQLite database instead.
"""

import argparse
import json
import sys
from datetime import datetime

import psycopg2
import psycopg2.extras


# ── Table definitions in dependency order ────────────────────────────────────
# Mirrors core/models.py exactly.
CREATE_TABLES_SQL = """
-- Users
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    hashed_password VARCHAR(255) NOT NULL,
    weight_kg FLOAT,
    height_cm FLOAT,
    age INTEGER,
    gender VARCHAR(20) DEFAULT NULL,
    activity_level VARCHAR(50) DEFAULT 'moderate',
    goal VARCHAR(50) DEFAULT 'maintain',
    dietary_mode VARCHAR(50) DEFAULT 'standard',
    allergens JSON DEFAULT '[]',
    is_admin BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_users_id ON users (id);
CREATE INDEX IF NOT EXISTS ix_users_email ON users (email);

-- Food items
CREATE TABLE IF NOT EXISTS food_items (
    id SERIAL PRIMARY KEY,
    yolo_class_id INTEGER UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    nutrition_json JSON NOT NULL,
    health_score INTEGER DEFAULT 50,
    tags JSON DEFAULT '[]',
    allergens JSON DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS ix_food_items_id ON food_items (id);
CREATE INDEX IF NOT EXISTS ix_food_items_yolo_class_id ON food_items (yolo_class_id);

-- Meal logs
CREATE TABLE IF NOT EXISTS meal_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    scan_id VARCHAR(36),
    meal_type VARCHAR(30) DEFAULT 'snack',
    foods_json JSONB NOT NULL,
    totals_json JSONB
);

CREATE INDEX IF NOT EXISTS ix_meal_logs_id ON meal_logs (id);
CREATE INDEX IF NOT EXISTS ix_meal_logs_user_id ON meal_logs (user_id);
CREATE INDEX IF NOT EXISTS ix_meal_logs_scan_id ON meal_logs (scan_id);
CREATE INDEX IF NOT EXISTS ix_meal_logs_user_timestamp ON meal_logs (user_id, timestamp DESC);

-- Model versions
CREATE TABLE IF NOT EXISTS model_versions (
    id SERIAL PRIMARY KEY,
    version_tag VARCHAR(50) NOT NULL,
    pt_path VARCHAR(500) NOT NULL,
    class_count INTEGER NOT NULL,
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_active BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS ix_model_versions_id ON model_versions (id);

-- Nutrition reviews
CREATE TABLE IF NOT EXISTS nutrition_reviews (
    id SERIAL PRIMARY KEY,
    dish_name VARCHAR(255) UNIQUE NOT NULL,
    per_100g JSONB NOT NULL,
    allergens JSONB DEFAULT '[]',
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    promoted_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS ix_nutrition_reviews_id ON nutrition_reviews (id);
CREATE INDEX IF NOT EXISTS ix_nutrition_reviews_dish_name ON nutrition_reviews (dish_name);

-- Revoked tokens
CREATE TABLE IF NOT EXISTS revoked_tokens (
    id SERIAL PRIMARY KEY,
    jti VARCHAR(36) UNIQUE NOT NULL,
    revoked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS ix_revoked_tokens_id ON revoked_tokens (id);
CREATE INDEX IF NOT EXISTS ix_revoked_tokens_jti ON revoked_tokens (jti);
"""

# Ordered list of tables to migrate (respects dependencies)
TABLES = ["users", "food_items", "meal_logs", "model_versions", "nutrition_reviews", "revoked_tokens"]


def connect(url: str):
    """Open a psycopg2 connection from a PostgreSQL URL."""
    print(f"  Connecting to ...{url[-40:]}...")
    conn = psycopg2.connect(url)
    conn.autocommit = False
    return conn


def dump_render(render_url: str) -> dict:
    """Dump all rows from all tables in the Render database."""
    conn = connect(render_url)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    data = {}
    for table in TABLES:
        try:
            cur.execute(f'SELECT * FROM "{table}" ORDER BY id')
            rows = cur.fetchall()
            # Convert datetime objects and other non-JSON-serializable types
            clean_rows = []
            for row in rows:
                clean = {}
                for k, v in row.items():
                    if isinstance(v, datetime):
                        clean[k] = v.isoformat()
                    else:
                        clean[k] = v
                clean_rows.append(clean)
            data[table] = clean_rows
            print(f"  [OK] {table}: {len(rows)} rows dumped")
        except psycopg2.errors.UndefinedTable:
            conn.rollback()
            data[table] = []
            print(f"  [SKIP] {table}: table not found (skipping)")
        except Exception as e:
            conn.rollback()
            data[table] = []
            print(f"  [ERR] {table}: error - {e}")
    conn.close()
    return data


def dump_sqlite(db_path: str) -> dict:
    """Dump all rows from the local SQLite database."""
    import sqlite3
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    data = {}
    for table in TABLES:
        try:
            cur = conn.execute(f'SELECT * FROM "{table}" ORDER BY id')
            rows = [dict(r) for r in cur.fetchall()]
            # Parse JSON string columns for SQLite
            for row in rows:
                for k, v in row.items():
                    if isinstance(v, str) and v.startswith(("[", "{")):
                        try:
                            row[k] = json.loads(v)
                        except (json.JSONDecodeError, ValueError):
                            pass
            data[table] = rows
            print(f"  [OK] {table}: {len(rows)} rows dumped")
        except Exception as e:
            data[table] = []
            print(f"  [ERR] {table}: {e}")
    conn.close()
    return data


def create_supabase_schema(supabase_url: str):
    """Create all tables on Supabase (idempotent)."""
    conn = connect(supabase_url)
    cur = conn.cursor()
    cur.execute(CREATE_TABLES_SQL)
    conn.commit()
    print("  [OK] Schema created / verified on Supabase")
    conn.close()


def import_to_supabase(supabase_url: str, data: dict):
    """Insert all dumped data into Supabase, handling JSON columns and
    resetting sequences to avoid ID conflicts."""
    conn = connect(supabase_url)
    cur = conn.cursor()

    # JSON columns per table (need psycopg2 Json wrapper)
    json_columns = {
        "users": {"allergens"},
        "food_items": {"nutrition_json", "tags", "allergens"},
        "meal_logs": {"foods_json", "totals_json"},
        "model_versions": set(),
        "nutrition_reviews": {"per_100g", "allergens"},
    }

    for table in TABLES:
        rows = data.get(table, [])
        if not rows:
            print(f"  [SKIP] {table}: no data to import")
            continue

        # Clear existing data to avoid conflicts
        cur.execute(f'DELETE FROM "{table}"')

        cols = list(rows[0].keys())
        placeholders = ", ".join(["%s"] * len(cols))
        col_names = ", ".join([f'"{c}"' for c in cols])
        insert_sql = f'INSERT INTO "{table}" ({col_names}) VALUES ({placeholders})'

        json_cols = json_columns.get(table, set())
        count = 0
        for row in rows:
            values = []
            for c in cols:
                v = row[c]
                if c in json_cols and v is not None:
                    values.append(psycopg2.extras.Json(v))
                else:
                    values.append(v)
            try:
                cur.execute(insert_sql, values)
                count += 1
            except Exception as e:
                print(f"  [ERR] {table} row {row.get('id', '?')}: {e}")
                conn.rollback()
                # Re-clear and retry remaining
                continue

        # Reset the sequence to avoid ID conflicts on future inserts
        try:
            cur.execute(
                f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), "
                f"COALESCE((SELECT MAX(id) FROM \"{table}\"), 1))"
            )
        except Exception:
            pass  # Table might not have a serial sequence

        conn.commit()
        print(f"  [OK] {table}: {count} rows imported")

    conn.close()


def save_backup(data: dict, path: str):
    """Save dumped data to a local JSON file as a safety backup."""
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, default=str)
    print(f"  [OK] Backup saved to {path}")


def main():
    parser = argparse.ArgumentParser(description="Migrate Render Postgres → Supabase")
    parser.add_argument("--render-url", help="Render PostgreSQL connection URL")
    parser.add_argument(
        "--supabase-url",
        required=True,
        help="Supabase PostgreSQL connection URL",
    )
    parser.add_argument(
        "--sqlite-path",
        default="food_analyzer.db",
        help="Path to local SQLite DB (fallback if --render-url is not set)",
    )
    parser.add_argument(
        "--backup-path",
        default="render_backup.json",
        help="Path to save JSON backup of dumped data",
    )
    args = parser.parse_args()

    print("=" * 60)
    print("  Render -> Supabase Migration")
    print("=" * 60)

    # Step 1: Dump source data
    print("\n[1/4] Dumping source data...")
    if args.render_url:
        data = dump_render(args.render_url)
    else:
        print("  No --render-url; falling back to local SQLite")
        data = dump_sqlite(args.sqlite_path)

    # Step 2: Save local backup
    print("\n[2/4] Saving local backup...")
    save_backup(data, args.backup_path)

    # Step 3: Create schema on Supabase
    print("\n[3/4] Creating schema on Supabase...")
    create_supabase_schema(args.supabase_url)

    # Step 4: Import data
    print("\n[4/4] Importing data to Supabase...")
    import_to_supabase(args.supabase_url, data)

    # Summary
    print("\n" + "=" * 60)
    print("  Migration complete!")
    print("=" * 60)
    total = sum(len(rows) for rows in data.values())
    print(f"  Total rows migrated: {total}")
    for table in TABLES:
        print(f"    {table}: {len(data.get(table, []))} rows")
    print(f"\n  Backup file: {args.backup_path}")
    print(f"  Supabase DB: ...{args.supabase_url[-40:]}")
    print()


if __name__ == "__main__":
    main()
