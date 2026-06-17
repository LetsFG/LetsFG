"""LetsFG local configuration utilities."""
from __future__ import annotations

import os
from pathlib import Path


def get_config_dir() -> Path:
    """Return the LetsFG config directory, creating it if needed."""
    if os.name == "nt":
        base = Path(os.environ.get("APPDATA", Path.home()))
    else:
        base = Path.home()
    d = base / ".letsfg"
    d.mkdir(parents=True, exist_ok=True)
    return d


def get_config_file() -> Path:
    return get_config_dir() / "config.json"
