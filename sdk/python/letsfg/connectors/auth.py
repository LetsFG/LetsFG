"""
LetsFG Programmatic Flight Search (PFS) — token management.

Get your free 90-day Bearer token at:
    https://letsfg.co/for-agents

Once you have it:
    letsfg auth --token <your-token>
    # or
    export LETSFG_BEARER_TOKEN=<your-token>

The token is passed as "Authorization: Bearer <token>" on every API call.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path


class BearerTokenError(Exception):
    """No valid Bearer token. Get one at https://letsfg.co/for-agents"""
    pass


def _config_path() -> Path:
    if os.name == "nt":
        base = Path(os.environ.get("APPDATA", Path.home()))
    else:
        base = Path.home()
    return base / ".letsfg" / "config.json"


def _load_config() -> dict:
    p = _config_path()
    if p.exists():
        try:
            return json.loads(p.read_text())
        except Exception:
            return {}
    return {}


def _save_config(cfg: dict) -> None:
    p = _config_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(cfg, indent=2))


def get_bearer_token() -> str:
    """Return a valid Bearer token or raise BearerTokenError."""
    env = os.environ.get("LETSFG_BEARER_TOKEN")
    if env:
        return env

    cfg = _load_config()
    auth = cfg.get("pfs_auth", {})
    token = auth.get("token")
    expires_at = auth.get("expires_at", 0)

    if token and time.time() < expires_at - 3600:  # 1h buffer
        return token

    raise BearerTokenError(
        "No valid LetsFG Bearer token.\n"
        "  Get one: https://letsfg.co/for-agents\n"
        "  Then:    letsfg auth --token <token>\n"
        "  Or:      export LETSFG_BEARER_TOKEN=<token>"
    )


def save_token(token: str, expires_at: float | None = None) -> None:
    """Save a Bearer token to the local config."""
    if expires_at is None:
        expires_at = time.time() + 90 * 24 * 3600
    cfg = _load_config()
    cfg["pfs_auth"] = {"token": token, "expires_at": expires_at}
    _save_config(cfg)
