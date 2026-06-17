"""
Twitter/X authentication for LetsFG Programmatic Flight Search (PFS).

Flow (one-time, ~30 seconds):
  1. POST https://letsfg.co/api/agent-access/request
     → { challenge_code, tweet_text, expires_at }
  2. Post the tweet_text from your Twitter/X account.
  3. POST https://letsfg.co/api/agent-access/verify  { challenge_code }
     → { token, expires_at }   (90-day Bearer token)

After that, every search call uses:
    Authorization: Bearer <token>
    POST https://letsfg.co/api/search
    GET  https://letsfg.co/api/results/<search_id>

Run `letsfg auth` to do all of this interactively.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError

_BASE_URL = os.environ.get("LETSFG_BASE_URL", "https://letsfg.co")
_TOKEN_TTL = 90 * 24 * 3600  # 90 days


class BearerTokenError(Exception):
    """No valid Bearer token. Run `letsfg auth` to authenticate via Twitter/X."""
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
    try:
        p.chmod(0o600)
    except Exception:
        pass


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
        "  Run:  letsfg auth\n"
        "  Or:   export LETSFG_BEARER_TOKEN=<token>"
    )


def save_token(token: str, expires_at: float | None = None) -> None:
    """Save a Bearer token to ~/.letsfg/config.json."""
    if expires_at is None:
        expires_at = time.time() + _TOKEN_TTL
    cfg = _load_config()
    cfg["pfs_auth"] = {"token": token, "expires_at": expires_at}
    _save_config(cfg)


def _post_json(path: str, payload: dict, timeout: int = 30) -> dict:
    body = json.dumps(payload).encode()
    req = Request(
        f"{_BASE_URL}{path}",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())


def twitter_auth() -> str:
    """
    Interactive auth flow — call this once to get a 90-day Bearer token.

    Steps:
      1. Calls POST /api/agent-access/request to get a challenge.
      2. Prints the exact tweet to post.
      3. Waits for you to post it, then calls POST /api/agent-access/verify.
      4. Saves the token to ~/.letsfg/config.json and returns it.
    """
    print("\n  Connecting to LetsFG...")
    data = _post_json("/api/agent-access/request", {})
    challenge_code = data["challenge_code"]
    tweet_text = data.get("tweet_text") or f"@letsfg {challenge_code}"

    print(f"\n  Step 1 — post this tweet from your Twitter/X account:\n")
    print(f"     {tweet_text}\n")
    print(f"  Step 2 — press Enter once it's live.")
    input()

    print("  Verifying... ", end="", flush=True)
    try:
        result = _post_json("/api/agent-access/verify", {"challenge_code": challenge_code})
    except HTTPError as e:
        body = e.read().decode(errors="replace")
        raise BearerTokenError(
            f"Verification failed (HTTP {e.code}). "
            "Make sure you posted the exact tweet above.\n"
            f"Server: {body[:200]}"
        )

    token = result["token"]
    raw_exp = result.get("expires_at")
    if isinstance(raw_exp, (int, float)):
        expires_at = float(raw_exp)
    elif isinstance(raw_exp, str):
        from datetime import datetime, timezone
        expires_at = datetime.fromisoformat(raw_exp.replace("Z", "+00:00")).timestamp()
    else:
        expires_at = time.time() + _TOKEN_TTL

    save_token(token, expires_at)
    from datetime import datetime
    exp_str = datetime.fromtimestamp(expires_at).strftime("%Y-%m-%d")
    print(f"done. Token valid until {exp_str}.")
    return token
