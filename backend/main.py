"""
Food Intelligence Analyzer — FastAPI Backend
=============================================
Entry point for the API server. Loads the YOLO model at startup,
configures CORS, mounts all route modules, and provides the
lifespan context for hot-swappable model management.
"""

import os
import yaml
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from api.analyze import router as analyze_router
from api.history import router as history_router
from api.profile import router as profile_router
from api.admin import router as admin_router
from api.foods import router as foods_router
from api.summary import router as summary_router
from core.model_manager import ModelManager
from core.gemini_recognizer import GeminiRecognizer
from core.config import load_config
from core.database import engine, Base, sync_schema

# ---------------------------------------------------------------------------
# Resolve paths relative to this file
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent
CONFIG_PATH = BASE_DIR / "config.yaml"


def _load_dotenv() -> None:
    """Minimal stdlib .env loader (no python-dotenv dependency).

    Reads KEY=VALUE pairs from backend/.env into os.environ if present, without
    overwriting variables already set in the real environment. This keeps secret
    loading (GEMINI_API_KEY) out of config.yaml while avoiding a new dependency.
    """
    env_path = BASE_DIR / ".env"
    if not env_path.exists():
        return
    try:
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if key and key not in os.environ:
                    os.environ[key] = value
    except Exception as e:
        print(f"[WARN] could not read .env: {e}")


# Load environment (GEMINI_API_KEY, etc.) once at import, before config use.
_load_dotenv()


# ---------------------------------------------------------------------------
# Application lifespan — load model once, share across requests
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load config + YOLO model on startup, clean up on shutdown."""
    config = load_config(CONFIG_PATH)
    app.state.config = config
    app.state.base_dir = BASE_DIR

    # Initialize database tables and apply additive column migrations.
    # create_all only adds missing tables; sync_schema ALTERs existing
    # tables to add any new ORM columns (e.g. User.gender).
    Base.metadata.create_all(bind=engine)
    migrated = sync_schema()
    if migrated:
        for table, cols in migrated.items():
            print(f"[DB] migrated {table}: added {', '.join(cols)}")

    # Load YOLO model
    model_manager = ModelManager(config, BASE_DIR)
    model_manager.load()
    app.state.model_manager = model_manager

    print(f"[OK] Model loaded: {config['model']['path']} "
          f"(v{config['model']['version']}, "
          f"{model_manager.class_count} classes)")

    # Initialize Gemini recognizer (hybrid recognition layer).
    # Reads GEMINI_API_KEY from env; degrades to disabled if absent, so the
    # app still boots in YOLO-only mode. Recognition mode is config-driven.
    gemini_recognizer = GeminiRecognizer(config, os.getenv("GEMINI_API_KEY"))
    app.state.gemini_recognizer = gemini_recognizer
    mode = config.get("recognition", {}).get("mode", "yolo")
    if mode in ("gemini", "hybrid") and not gemini_recognizer.enabled:
        print(f"[WARN] recognition.mode='{mode}' but Gemini is disabled — "
              f"falling back to YOLO. Set GEMINI_API_KEY to enable.")

    yield

    # Cleanup
    print("Shutting down Food Intelligence Analyzer")


# ---------------------------------------------------------------------------
# Create FastAPI app
# ---------------------------------------------------------------------------
app = FastAPI(
    title="Food Intelligence Analyzer",
    description="AI-powered food detection and nutritional analysis API",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS — allow mobile app and dev origins
config_for_cors = load_config(CONFIG_PATH)
app.add_middleware(
    CORSMiddleware,
    allow_origins=config_for_cors.get("server", {}).get("cors_origins", ["*"]),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Mount routers
# ---------------------------------------------------------------------------
app.include_router(analyze_router, prefix="/api/v1", tags=["Analysis"])
app.include_router(foods_router,   prefix="/api/v1", tags=["Foods"])
app.include_router(history_router, prefix="/api/v1", tags=["History"])
app.include_router(profile_router, prefix="/api/v1", tags=["Profile"])
app.include_router(summary_router, prefix="/api/v1", tags=["Summary"])
app.include_router(admin_router,   prefix="/api/admin", tags=["Admin"])


@app.get("/", tags=["Health"])
async def root():
    return {
        "service": "Food Intelligence Analyzer",
        "version": "1.0.0",
        "status": "healthy",
        "docs": "/docs",
    }


@app.get("/health", tags=["Health"])
async def health_check():
    return {"status": "ok"}


@app.get("/health/warmup", tags=["Health"])
async def warmup(request: Request):
    """Lightweight liveness + readiness probe.

    Render's free tier spins the service down after 15 min of inactivity.
    The mobile app calls this on startup to trigger a wake-up and confirm
    the model + DB (Supabase Postgres) are ready before attempting real
    requests. Returns the readiness state so the client can show an honest
    "waking up..." UI instead of silently timing out on a cold start.
    """
    ready = {
        "ready": True,
        "model_loaded": False,
        "db_ok": False,
        "classes": 0,
    }
    mm = getattr(request.app.state, "model_manager", None)
    if mm is not None and mm.class_count > 0:
        ready["model_loaded"] = True
        ready["classes"] = mm.class_count

    # Probe the DB with a trivial query — catches connection issues early.
    try:
        from sqlalchemy import text
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        ready["db_ok"] = True
    except Exception:
        ready["ready"] = False

    return ready
