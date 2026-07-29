"""
Payment-token authentication for LetsFG Programmatic Flight Search (PFS).

PFS requires a payment method on file. Nothing is charged to authenticate — it
is a zero-amount Stripe setup that validates and vaults a card, with no charge
and no authorization hold. Having a card on file is what lets your agent go all
the way to booking.

Flow (one-time):
  1. POST https://letsfg.co/api/agent-access/request
     → 402 { setup_url, setup_session_id, accepts, verify_url }
  2. Present a payment method, either:
       hosted   — a human opens setup_url and adds a card, then you send
                  { "setup_session_id": "cs_..." }
       headless — you already hold a Stripe credential, so send
                  { "payment_method_id": "pm_..." } or { "card_token": "tok_..." }
  3. POST https://letsfg.co/api/agent-access/verify
     → { token, payer, expires_at }   (90-day Bearer token)

After that, every call uses:
    Authorization: Bearer <token>
    POST https://letsfg.co/api/search
    GET  https://letsfg.co/api/results/<search_id>
    POST https://letsfg.co/api/agent-book

Run `letsfg auth` to do this interactively.

This replaces the Twitter/X challenge flow, retired 2026-07-29. Tokens issued
that way keep working until the announced sunset date; re-run `letsfg auth` to
move over.

NOTE: this has nothing to do with `letsfg register` / `letsfg setup-payment`,
which belong to the separate, paid Developer API and create a billing account
most agents do not want.
"""

from __future__ import annotations

import json
import os
import time
import webbrowser
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError

_BASE_URL = os.environ.get("LETSFG_BASE_URL", "https://letsfg.co")
_TOKEN_TTL = 90 * 24 * 3600  # 90 days


class BearerTokenError(Exception):
    """No valid Bearer token. Run `letsfg auth` to add a payment method."""
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
        "  Run:  letsfg auth        (adds a payment method — nothing is charged)\n"
        "  Or:   export LETSFG_BEARER_TOKEN=<token>"
    )


def save_token(token: str, expires_at: float | None = None) -> None:
    """Save a Bearer token to ~/.letsfg/config.json."""
    if expires_at is None:
        expires_at = time.time() + _TOKEN_TTL
    cfg = _load_config()
    cfg["pfs_auth"] = {"token": token, "expires_at": expires_at}
    _save_config(cfg)


def _post_json(path: str, payload: dict, timeout: int = 30) -> tuple[int, dict]:
    """POST and return (status, body). A 402 is an expected answer here, not an
    error, so HTTPError is unwrapped rather than raised."""
    body = json.dumps(payload).encode()
    req = Request(
        f"{_BASE_URL}{path}",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(req, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read())
    except HTTPError as e:
        raw = e.read().decode(errors="replace")
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"error": raw[:400]}


def _parse_expiry(raw_exp) -> float:
    if isinstance(raw_exp, (int, float)):
        return float(raw_exp)
    if isinstance(raw_exp, str):
        from datetime import datetime
        try:
            return datetime.fromisoformat(raw_exp.replace("Z", "+00:00")).timestamp()
        except ValueError:
            pass
    return time.time() + _TOKEN_TTL


def request_enrolment() -> dict:
    """Start enrolment. Returns the 402 body with setup_url / setup_session_id."""
    status, data = _post_json("/api/agent-access/request", {})
    if status not in (200, 402):
        raise BearerTokenError(
            f"Could not start authentication (HTTP {status}): {data.get('error', '')}"
        )
    return data


def verify_payment_method(
    *,
    setup_session_id: str | None = None,
    payment_method_id: str | None = None,
    card_token: str | None = None,
) -> str:
    """
    Exchange a payment method for a Bearer token. Saves and returns the token.

    Pass exactly one of setup_session_id / payment_method_id / card_token.
    """
    payload: dict[str, str] = {}
    if setup_session_id:
        payload["setup_session_id"] = setup_session_id
    elif payment_method_id:
        payload["payment_method_id"] = payment_method_id
    elif card_token:
        payload["card_token"] = card_token
    else:
        raise BearerTokenError(
            "Provide one of setup_session_id, payment_method_id, or card_token."
        )

    status, result = _post_json("/api/agent-access/verify", payload)
    if status != 200 or "token" not in result:
        raise BearerTokenError(
            f"Verification failed (HTTP {status}). "
            f"{result.get('hint') or result.get('error') or ''}".strip()
        )

    token = result["token"]
    expires_at = _parse_expiry(result.get("expires_at"))
    save_token(token, expires_at)
    return token


def payment_auth(open_browser: bool = True) -> str:
    """
    Interactive auth — call once to get a 90-day Bearer token.

    Opens Stripe's hosted card page, waits for you to finish, then verifies.
    Nothing is charged.
    """
    print("\n  Connecting to LetsFG...")
    data = request_enrolment()

    setup_url = data.get("setup_url")
    session_id = data.get("setup_session_id")
    if not setup_url or not session_id:
        raise BearerTokenError(
            "Server did not return a setup URL. Check https://letsfg.co/for-agents"
        )

    print("\n  LetsFG needs a payment method on file before it can search or book.")
    print("  Nothing is charged now — this is a zero-amount card setup.\n")
    print(f"  Step 1 — add a card here:\n")
    print(f"     {setup_url}\n")
    if open_browser:
        try:
            webbrowser.open(setup_url)
        except Exception:
            pass
    print("  Step 2 — press Enter once you've finished.")
    input()

    print("  Verifying... ", end="", flush=True)
    token = verify_payment_method(setup_session_id=session_id)

    from datetime import datetime
    cfg_exp = _load_config().get("pfs_auth", {}).get("expires_at", time.time() + _TOKEN_TTL)
    print(f"done. Token valid until {datetime.fromtimestamp(cfg_exp).strftime('%Y-%m-%d')}.")
    return token


def twitter_auth() -> str:
    """Deprecated alias — Twitter/X auth was retired 2026-07-29.

    Kept so existing scripts calling it keep working; it now runs the payment
    flow instead of asking for a tweet. Note the previous implementation had
    been broken for some time regardless: it posted {"challenge_code": ...} to
    /api/agent-access/verify, which has always required {"tweet_url",
    "challenge_signed"} and so always answered 400.
    """
    import warnings
    warnings.warn(
        "twitter_auth() is deprecated: LetsFG retired Twitter/X auth on 2026-07-29. "
        "Use payment_auth() — nothing is charged.",
        DeprecationWarning,
        stacklevel=2,
    )
    return payment_auth()
