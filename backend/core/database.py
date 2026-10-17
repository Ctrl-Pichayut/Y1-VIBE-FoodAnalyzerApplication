"""
Database setup — SQLAlchemy engine, session factory, and base model.

URL resolution order (first wins):
  1. DATABASE_URL environment variable  — used in production (Render injects
     this, pointing to the Supabase PostgreSQL instance).
  2. config.yaml → database.url          — used for local dev (SQLite).

`check_same_thread` is a SQLite-only flag, so it's applied conditionally.
"""

import os

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

from core.config import get_config

# Prefer the environment (Render injects DATABASE_URL → Supabase Postgres);
# fall back to the committed config.yaml value for local development.
DATABASE_URL = os.getenv("DATABASE_URL") or get_config().get(
    "database", {}
).get("url", "sqlite:///./food_analyzer.db")

DATABASE_URL = DATABASE_URL.strip().strip("'").strip('"')

if DATABASE_URL.startswith("http://") or DATABASE_URL.startswith("https://"):
    raise ValueError(
        "DATABASE_URL cannot be an HTTP(S) URL. You provided a Supabase Project URL "
        "(e.g. https://xxx.supabase.co) instead of the PostgreSQL Database Connection String. "
        "Please copy the PostgreSQL connection string (starts with postgresql://) from "
        "Supabase Dashboard -> Project Settings -> Database -> Connection string -> URI."
    )

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+psycopg2://", 1)
elif DATABASE_URL.startswith("postgresql://") and not DATABASE_URL.startswith("postgresql+psycopg2://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+psycopg2://", 1)

# `check_same_thread` is a SQLite-only flag; passing it to other dialects
# (e.g. PostgreSQL) raises a TypeError. Add it only for SQLite URLs.
_is_sqlite = DATABASE_URL.startswith("sqlite")
connect_args = {"check_same_thread": False} if _is_sqlite else {}

engine = create_engine(
    DATABASE_URL,
    connect_args=connect_args,
    # pool_pre_ping: test connections before use — prevents "connection closed"
    # errors when using Supabase's connection pooler (Supavisor).
    pool_pre_ping=not _is_sqlite,
    echo=False,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    """Dependency that yields a database session per request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def sync_schema() -> dict:
    """
    Add ORM columns that are missing from the physical DB schema (SQLite or PostgreSQL).

    SQLAlchemy's ``create_all`` only creates missing *tables* — it never
    alters an existing table to add a column. This compares physical columns
    against ORM columns and executes an additive ``ALTER TABLE ... ADD COLUMN``
    for each missing nullable column.
    """
    from sqlalchemy import inspect, text

    report: dict[str, list[str]] = {}
    try:
        inspector = inspect(engine)
        existing_tables = set(inspector.get_table_names())
    except Exception:
        return report

    for mapper in Base.registry.mappers:
        table = mapper.local_table
        if table is None or table.name not in existing_tables:
            continue  # create_all handles entirely new tables

        try:
            existing_cols = {c["name"] for c in inspector.get_columns(table.name)}
        except Exception:
            continue

        for column in table.columns:
            if column.name in existing_cols:
                continue

            col_type = column.type.compile(engine.dialect)
            null_clause = "" if column.nullable else " NOT NULL"
            default_clause = ""
            if column.server_default is not None:
                default_clause = f" DEFAULT {column.server_default.arg.text}"

            stmt = text(
                f'ALTER TABLE "{table.name}" '
                f'ADD COLUMN "{column.name}" {col_type}{null_clause}{default_clause}'
            )
            try:
                with engine.begin() as conn:
                    conn.execute(stmt)
                report.setdefault(table.name, []).append(column.name)
            except Exception as e:
                print(f"[DB] sync_schema skipped {table.name}.{column.name}: {e}")

    return report
