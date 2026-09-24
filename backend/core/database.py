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
    Add ORM columns that are missing from the physical SQLite schema.

    SQLAlchemy's ``create_all`` only creates missing *tables* — it never
    alters an existing table to add a column. Without this, a new model
    field (e.g. ``User.gender``) causes ``no such column`` errors against
    databases created before the field existed.

    Strategy: for every mapped table that already exists, compare its
    physical columns (via PRAGMA) against the ORM columns and run an
    additive ``ALTER TABLE ... ADD COLUMN`` for each missing one.

    SQLite only supports additive ALTERs (no type/nullable changes, no
    drops), which is exactly what we need for dev-schema drift. Returns a
    ``{table: [added_columns]}`` report so callers can log migrations.

    NOTE: intended for the SQLite dev DB. A production deployment should
    use a real migration tool (Alembic).
    """
    from sqlalchemy import inspect, text

    report: dict[str, list[str]] = {}
    if not DATABASE_URL.startswith("sqlite"):
        # P11: sync_schema only supports SQLite. For PostgreSQL (Supabase),
        # use Alembic migrations. Alembic has now been initialized in this project.
        # Run `alembic revision --autogenerate -m "Init"` to create migrations.
        return report

    inspector = inspect(engine)

    for mapper in Base.registry.mappers:
        table = mapper.local_table
        if table is None or table.name not in inspector.get_table_names():
            continue  # create_all handles entirely new tables

        existing_cols = {c["name"] for c in inspector.get_columns(table.name)}

        for column in table.columns:
            if column.name in existing_cols:
                continue

            col_type = column.type.compile(engine.dialect)
            # New columns must be nullable or have a server/Python default,
            # otherwise existing rows would violate NOT NULL on SQLite.
            null_clause = "" if column.nullable else " NOT NULL"
            default_clause = ""
            if column.server_default is not None:
                default_clause = f" DEFAULT {column.server_default.arg.text}"

            stmt = text(
                f'ALTER TABLE "{table.name}" '
                f'ADD COLUMN "{column.name}" {col_type}{null_clause}{default_clause}'
            )
            with engine.begin() as conn:
                conn.execute(stmt)
            report.setdefault(table.name, []).append(column.name)

    return report
