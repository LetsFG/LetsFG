"""
Local configuration for LetsFG SDK.
"""

from __future__ import annotations

import json
import os
from pathlib import Path


def get_config_dir() -> Path:
    """Get the LetsFG config directory (~/.letsfg)."""
    if os.name == "nt":
        base = Path(os.environ.get("APPDATA", Path.home()))
        config_dir = base / "letsfg"
    else:
        config_dir = Path.home() / ".letsfg"

    config_dir.mkdir(parents=True, exist_ok=True)
    return config_dir


def get_config_file() -> Path:
    """Get the config file path."""
    return get_config_dir() / "config.json"


def _load_config() -> dict:
    """Load config from disk."""
    config_file = get_config_file()
    if config_file.exists():
        try:
            return json.loads(config_file.read_text())
        except (json.JSONDecodeError, OSError):
            return {}
    return {}


def _save_config(config: dict) -> None:
    """Save config to disk."""
    config_file = get_config_file()
    config_file.write_text(json.dumps(config, indent=2))
