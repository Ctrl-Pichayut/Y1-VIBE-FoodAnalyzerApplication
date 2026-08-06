"""
Configuration loader — reads config.yaml and provides typed access.
"""

from functools import lru_cache
from pathlib import Path
import yaml

# backend/ root (this module lives one level under it, in core/)
BACKEND_DIR = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG_PATH = BACKEND_DIR / "config.yaml"


def load_config(config_path: Path = DEFAULT_CONFIG_PATH) -> dict:
    """Load and return the YAML configuration as a dictionary."""
    with open(config_path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def save_config(config_path: Path, config: dict) -> None:
    """Write updated configuration back to config.yaml."""
    with open(config_path, "w", encoding="utf-8") as f:
        yaml.dump(config, f, default_flow_style=False, sort_keys=False)


@lru_cache(maxsize=1)
def get_config() -> dict:
    """Return the cached config singleton, read from config.yaml.

    Modules that need a config value at import time (e.g. core/auth.py
    for the JWT secret, core/database.py for the DB URL) call this so
    config.yaml stays the single source of truth instead of hardcoded
    fallbacks. Read once at import; a server restart picks up edits.
    """
    return load_config(DEFAULT_CONFIG_PATH)
