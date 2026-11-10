"""
Authentication for LetsFG Programmatic Flight Search (PFS).

Connecting is one tap at letsfg.co/connect and needs no card; the token
searches at once. The card is asked for only at the first booking: the booking
returns an add_card_url for a 0.00 Revolut setup, nothing charged. You pay the
fare only when you book, and it is held, not taken, until the airline confirms.

This is a normal OAuth 2.1 + PKCE authorization-code flow. LetsFG advertises
authorization_endpoint = https://letsfg.co/connect and leaves /oauth/register
open (RFC 7591), so any client can register itself -- there is no allowlist and
no hosted-connector requirement.

Flow (one-time, `letsfg auth`):
  1. GET  /developers/api/.well-known/oauth-authorization-server   (discovery)
  2. POST /developers/api/oauth/register   with a loopback redirect_uri
  3. Open  https://letsfg.co/connect?...   a PERSON approves (one tap)
  4. POST /developers/api/oauth/token      code -> access + refresh token

The access token lasts about an hour; the refresh token lasts 30 days and
rotates on every use. Use ensure_bearer_token() in a long-lived process and it
refreshes silently.

There is NO endpoint that mints a token from card details. A person must
approve once in a browser -- do not ask a user for a card number.

RETIRED 2026-09-02: the Stripe enrolment lanes (setup_url, setup_session_id,
payment_method_id, card_token) and every token they issued.

NOTE: unrelated to `letsfg register` / `letsfg connect-payment`, which belong to
the separate, paid Developer API and create a billing account most agents do
not want.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import secrets
import threading
import time
import webbrowser
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlencode, urlparse, parse_qs
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

from letsfg.connectors import pending_auth

_BASE_URL = os.environ.get("LETSFG_BASE_URL", "https://letsfg.co")
_DEV_ROOT = f"{_BASE_URL}/developers/api"

# Access tokens are ~1h. Used only when the server does not say expires_in.
_FALLBACK_TTL = 55 * 60
# Refresh this long before expiry rather than racing the clock.
_REFRESH_SKEW = 5 * 60

# Must match client.py: Cloudflare blocks the urllib default UA with error 1010.
_USER_AGENT = "LetsFG-Python-SDK/1.0.3"
_CLIENT_NAME = "letsfg-python"
# The scopes the server advertises in `scopes_supported` (RFC 8414 discovery):
# flights:search, flights:book, hotels:search, hotels:book, profile:read. The
# CLI searches and books flights, nothing else. This used to be the bare word
# "flights" (LetsFG/LetsFG#212): the server silently drops any scope it does
# not know, so the consent succeeded and the grant carried NO scope at all --
# every hosted-connector tool then refused it with "does not include
# 'flights:search'". Keep every entry here one the server advertises.
_SCOPE = "flights:search flights:book profile:read"


class BearerTokenError(Exception):
    """No valid Bearer token. Run `letsfg auth` to connect (one tap, no card)."""
    pass


# ── config ────────────────────────────────────────────────────────────────

def _config_path() -> Path:
    if os.name == "nt":
        base = Path(os.environ.get("APPDATA", Path.home()))
    else:
        base = Path.home()
    return base / ".letsfg" / "config.json"


def _pending_path() -> Path:
    """Where `letsfg auth` keeps the sign-in in flight for `letsfg auth --finish`."""
    return _config_path().with_name("pending_auth.json")


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


def save_token(
    token: str,
    expires_at: float | None = None,
    *,
    refresh_token: str | None = None,
    client_id: str | None = None,
) -> None:
    """Save a Bearer token (and its refresh material) to ~/.letsfg/config.json."""
    cfg = _load_config()
    auth = dict(cfg.get("pfs_auth") or {})
    auth["token"] = token
    auth["expires_at"] = expires_at if expires_at is not None else time.time() + _FALLBACK_TTL
    if refresh_token:
        auth["refresh_token"] = refresh_token
    if client_id:
        auth["client_id"] = client_id
    cfg["pfs_auth"] = auth
    _save_config(cfg)


def get_bearer_token() -> str:
    """
    Return a stored Bearer token, or raise. SYNCHRONOUS, so it cannot refresh --
    access tokens last about an hour, so a long-lived process should call
    ensure_bearer_token() and let it refresh silently.
    """
    env = os.environ.get("LETSFG_BEARER_TOKEN")
    if env:
        return env

    auth = _load_config().get("pfs_auth") or {}
    token = auth.get("token")
    if token and time.time() < float(auth.get("expires_at", 0)) - _REFRESH_SKEW:
        return token

    if auth.get("refresh_token"):
        raise BearerTokenError(
            "LetsFG token expired. Call ensure_bearer_token() to refresh it, "
            "or run:  letsfg auth"
        )

    raise BearerTokenError(
        "No valid LetsFG Bearer token.\n"
        "  Run:  letsfg auth        (one tap at letsfg.co/connect, no card)\n"
        "  Or:   export LETSFG_BEARER_TOKEN=<token>"
    )


def ensure_bearer_token() -> str:
    """Return a valid token, refreshing with the stored refresh token if needed."""
    env = os.environ.get("LETSFG_BEARER_TOKEN")
    if env:
        return env

    auth = _load_config().get("pfs_auth") or {}
    token = auth.get("token")
    if token and time.time() < float(auth.get("expires_at", 0)) - _REFRESH_SKEW:
        return token
    if auth.get("refresh_token") and auth.get("client_id"):
        return refresh_access_token()
    return get_bearer_token()  # raises with the right guidance


# ── HTTP helpers ──────────────────────────────────────────────────────────

def _post_json(path: str, payload: dict, timeout: int = 30) -> tuple[int, dict]:
    """POST JSON and return (status, body). A 402 is an expected answer on the
    enrolment route, not an error, so HTTPError is unwrapped rather than raised."""
    req = Request(
        f"{_BASE_URL}{path}",
        data=json.dumps(payload).encode(),
        headers={
            "Content-Type": "application/json",
            "User-Agent": _USER_AGENT,
        },
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


def _post_form(url: str, fields: dict, timeout: int = 30) -> tuple[int, dict]:
    """POST application/x-www-form-urlencoded -- the OAuth token endpoint."""
    req = Request(
        url,
        data=urlencode(fields).encode(),
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
            "User-Agent": _USER_AGENT,
        },
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


def _discover() -> dict:
    """RFC 8414 metadata, with the documented defaults as a fallback."""
    meta = {
        "authorization_endpoint": f"{_BASE_URL}/connect",
        "token_endpoint": f"{_DEV_ROOT}/oauth/token",
        "registration_endpoint": f"{_DEV_ROOT}/oauth/register",
    }
    try:
        req = Request(
            f"{_DEV_ROOT}/.well-known/oauth-authorization-server",
            headers={"User-Agent": _USER_AGENT},
        )
        with urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
        for k in meta:
            if isinstance(data.get(k), str):
                meta[k] = data[k]
    except (HTTPError, URLError, ValueError, OSError):
        pass  # the defaults above are the advertised values
    return meta


def _pkce() -> tuple[str, str]:
    """Return (verifier, S256 challenge)."""
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode()
    digest = hashlib.sha256(verifier.encode()).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
    return verifier, challenge


_DONE_HTML = (
    b"<!doctype html><meta charset=utf-8>"
    b"<title>LetsFG connected</title>"
    b"<body style=\"font:16px system-ui;padding:3rem;text-align:center\">"
    b"<h2>Connected.</h2>"
    b"<p>You can close this tab and go back to the terminal.</p>"
)
_FAIL_HTML = (
    b"<!doctype html><meta charset=utf-8>"
    b"<title>LetsFG</title>"
    b"<body style=\"font:16px system-ui;padding:3rem;text-align:center\">"
    b"<h2>Something went wrong.</h2>"
    b"<p>Go back to the terminal for the error.</p>"
)


class _CallbackServer:
    """Loopback listener for the OAuth redirect (RFC 8252)."""

    def __init__(self, expected_state: str):
        self._expected_state = expected_state
        self._result: dict = {}
        self._event = threading.Event()

        outer = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):  # noqa: N802
                q = parse_qs(urlparse(self.path).query)
                code = (q.get("code") or [""])[0]
                state = (q.get("state") or [""])[0]
                err = (q.get("error") or [""])[0]

                ok = bool(code) and state == outer._expected_state and not err
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.end_headers()
                self.wfile.write(_DONE_HTML if ok else _FAIL_HTML)

                if not outer._event.is_set():
                    if err:
                        outer._result = {"error": err}
                    elif not code:
                        outer._result = {"error": "no authorization code in the redirect"}
                    elif state != outer._expected_state:
                        # A mismatched state is the CSRF case: refuse the code.
                        outer._result = {"error": "state mismatch on the OAuth redirect"}
                    else:
                        outer._result = {"code": code}
                    outer._event.set()

            def log_message(self, *args):  # silence the default stderr logging
                pass

        self._httpd = HTTPServer(("127.0.0.1", 0), Handler)
        self.port = self._httpd.server_address[1]
        self._thread = threading.Thread(target=self._httpd.serve_forever, daemon=True)
        self._thread.start()

    def wait_for_code(self, timeout: float = 600) -> str:
        if not self._event.wait(timeout):
            raise BearerTokenError(
                "Timed out waiting for the browser to come back. Run `letsfg auth` again."
            )
        if "error" in self._result:
            raise BearerTokenError(f"Authorization failed: {self._result['error']}")
        return self._result["code"]

    def close(self) -> None:
        try:
            self._httpd.shutdown()
            self._httpd.server_close()
        except Exception:
            pass


def refresh_access_token() -> str:
    """Swap the stored refresh token for a fresh access token. Rotates both."""
    auth = _load_config().get("pfs_auth") or {}
    refresh_token = auth.get("refresh_token")
    client_id = auth.get("client_id")
    if not refresh_token or not client_id:
        raise BearerTokenError("No refresh token stored. Run:  letsfg auth")

    meta = _discover()
    status, data = _post_form(
        meta["token_endpoint"],
        {
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": client_id,
        },
    )
    if status != 200 or not data.get("access_token"):
        raise BearerTokenError(
            f"Could not refresh the LetsFG token (HTTP {status}). Run:  letsfg auth"
        )

    expires_in = data.get("expires_in")
    expires_at = time.time() + (float(expires_in) if isinstance(expires_in, (int, float)) else _FALLBACK_TTL)
    save_token(
        str(data["access_token"]),
        expires_at,
        # The refresh token rotates on every use: store the new one or the next
        # refresh replays a spent token.
        refresh_token=data.get("refresh_token") or refresh_token,
        client_id=client_id,
    )
    return str(data["access_token"])


# ── hosted code hand-off ──────────────────────────────────────────────────
#
# A loopback listener needs this process alive, on the machine with the browser, when the person
# presses Authorize. When letsfg.co offers a hand-off, the redirect is its own page
# (https://letsfg.co/connect/done?h=<handle>), the consent parks the code there, and this process
# polls for it - from a sandbox, a remote box or an agent alike. PKCE still guards the redeem.
# A server without it (404) means the loopback, exactly as before.

_HANDOFF_ENDPOINT = f"{_DEV_ROOT}/oauth/handoff"
_HANDOFF_FETCH_ENDPOINT = f"{_DEV_ROOT}/oauth/handoff/fetch"
# The server keeps a waiting handle 30 minutes; people open the link late.
_HANDOFF_WAIT_S = 30 * 60
_HANDOFF_POLL_BOUNDS_S = (2.0, 10.0)
_HANDLE_RE = re.compile(r"[A-Za-z0-9_-]{32,128}")


@dataclass(frozen=True)
class _Handoff:
    handle: str
    redirect_uri: str
    poll_interval: float


def _start_handoff() -> "_Handoff | None":
    """A hand-off handle from letsfg.co, or None when the server has none (or cannot be reached)."""
    try:
        status, data = _post_json_abs(_HANDOFF_ENDPOINT, {}, timeout=15)
    except (URLError, OSError, ValueError):
        return None
    if status != 201 or not isinstance(data, dict):
        return None
    handle = data.get("handle")
    if not isinstance(handle, str) or not _HANDLE_RE.fullmatch(handle):
        return None
    # Only ever our own landing page: a redirect named by the network is registered as given,
    # so anything but exactly this address is refused and the loopback used instead.
    redirect_uri = f"{_BASE_URL}/connect/done?h={handle}"
    if data.get("redirect_uri") != redirect_uri:
        return None
    try:
        interval = float(data.get("poll_interval") or 3)
    except (TypeError, ValueError):
        interval = 3.0
    lo, hi = _HANDOFF_POLL_BOUNDS_S
    return _Handoff(handle, redirect_uri, min(max(interval, lo), hi))


def _same_secret(a: str, b: str) -> bool:
    return secrets.compare_digest(a.encode("utf-8"), b.encode("utf-8"))


def _wait_for_handoff(handoff: _Handoff, expected_state: str, timeout: float = _HANDOFF_WAIT_S,
                      sleep=time.sleep, now=time.monotonic) -> str:
    """Poll until the approved code is parked, then return it. The handle goes in the body only."""
    deadline = now() + timeout
    while True:
        try:
            status, data = _post_json_abs(_HANDOFF_FETCH_ENDPOINT, {"handle": handoff.handle}, timeout=15)
        except (URLError, OSError, ValueError):
            status, data = 0, {}       # a blip: the code waits on the server, so just ask again
        if status == 200 and isinstance(data, dict) and data.get("status") == "ready":
            state, code = str(data.get("state") or ""), str(data.get("code") or "")
            if not _same_secret(state, expected_state):
                raise BearerTokenError(
                    "The approval that came back belongs to another sign-in (its state does not match). "
                    "Run `letsfg auth` again."
                )
            if not code:
                raise BearerTokenError("letsfg.co returned no code. Run `letsfg auth` again.")
            return code
        if status == 404:
            raise BearerTokenError(
                "That sign-in expired or was already used before it was approved. Run `letsfg auth` again."
            )
        if now() + handoff.poll_interval > deadline:
            raise BearerTokenError(
                "Timed out waiting for the approval. If you approved, copy the address your browser "
                "ended on and run:  letsfg auth --finish '<the address>'  (within 10 minutes); "
                "otherwise run `letsfg auth` again."
            )
        sleep(handoff.poll_interval)


def connect_auth(open_browser: bool = True) -> str:
    """
    Interactive auth -- connects at letsfg.co/connect and stores a token.

    Registers this client, opens the connect page (one tap, no card), and waits
    for the redirect. Nothing is charged. A person must approve in the browser.
    """
    meta = _discover()
    verifier, challenge = _pkce()
    state = base64.urlsafe_b64encode(secrets.token_bytes(16)).rstrip(b"=").decode()

    # The hosted hand-off when letsfg.co offers one; otherwise bind the loopback
    # listener FIRST: redirect_uri has to match what we register byte for byte,
    # so the port must be known before registration.
    handoff = _start_handoff()
    server = None
    if handoff is not None:
        redirect_uri = handoff.redirect_uri
    else:
        server = _CallbackServer(state)
        redirect_uri = f"http://127.0.0.1:{server.port}/callback"

    try:
        status, reg = _post_json_abs(
            meta["registration_endpoint"],
            {
                "client_name": _CLIENT_NAME,
                "redirect_uris": [redirect_uri],
                "grant_types": ["authorization_code", "refresh_token"],
                "response_types": ["code"],
                "token_endpoint_auth_method": "none",
            },
        )
        client_id = reg.get("client_id") if isinstance(reg, dict) else None
        if status not in (200, 201) or not client_id:
            raise BearerTokenError(
                f"Could not register with LetsFG (HTTP {status}). See {_BASE_URL}/for-agents"
            )

        auth_url = meta["authorization_endpoint"] + "?" + urlencode({
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "state": state,
            "scope": _SCOPE,
        })

        # KEPT ON DISK BEFORE WE WAIT (2026-11-10): about one SDK consent in three never reached the token
        # endpoint - the listener was gone (an agent's tool call killed, a sandbox, another machine) when the
        # browser came back. With this record `letsfg auth --finish '<address>'` can still end the sign-in.
        pending_auth.save(_pending_path(), pending_auth.PendingAuth(
            client_id=str(client_id), redirect_uri=redirect_uri, verifier=verifier, state=state,
            token_endpoint=meta["token_endpoint"], created_at=time.time(),
        ))

        print("\n  LetsFG needs you to approve this CLI once at letsfg.co/connect.")
        print("  Nothing is charged now - a card is asked for at your first booking,")
        print("  and the fare is held, not taken, until the airline confirms.\n")
        print("  Open this and approve:\n")
        print(f"     {auth_url}\n")
        print("  If this stops waiting before you approve, copy the address your browser")
        print("  ends on after you approve and run, within 10 minutes:")
        print("     letsfg auth --finish '<the address>'\n")
        if open_browser:
            try:
                webbrowser.open(auth_url)
            except Exception:
                pass
        print("  Waiting for you to finish... ", end="", flush=True)

        code = server.wait_for_code() if server is not None else _wait_for_handoff(handoff, expected_state=state)
        token = _exchange_code(
            meta["token_endpoint"], code=code, client_id=str(client_id),
            redirect_uri=redirect_uri, verifier=verifier,
        )
        pending_auth.clear(_pending_path())
        return token
    finally:
        if server is not None:
            server.close()


def finish_auth(callback_url: str) -> str:
    """Finish a `letsfg auth` whose listener is gone, from the address the browser landed on."""
    path = _pending_path()
    try:
        pending = pending_auth.load(path, now=time.time())
    except pending_auth.PendingAuthError as e:
        pending_auth.clear(path)
        raise BearerTokenError(str(e)) from None
    try:
        code = pending_auth.code_from_callback(callback_url, pending)
    except pending_auth.PendingAuthError as e:
        raise BearerTokenError(str(e)) from None

    try:
        token = _exchange_code(
            pending.token_endpoint, code=code, client_id=pending.client_id,
            redirect_uri=pending.redirect_uri, verifier=pending.verifier,
        )
    except (URLError, TimeoutError, ConnectionError) as e:
        # The request may never have reached the server, so the code may still be good: keep the record.
        raise BearerTokenError(f"Could not reach LetsFG ({e}). Run the same --finish command again.") from None
    except BearerTokenError:
        # The token endpoint answered, and any answer spends the code (single-use): the record is dead.
        pending_auth.clear(path)
        raise
    pending_auth.clear(path)
    return token


def _exchange_code(token_endpoint: str, *, code: str, client_id: str, redirect_uri: str, verifier: str) -> str:
    """Swap an authorization code for tokens, store them, and return the access token."""
    status, data = _post_form(
        token_endpoint,
        {
            "grant_type": "authorization_code",
            "code": code,
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "code_verifier": verifier,
        },
    )
    if status != 200 or not data.get("access_token"):
        detail = str(data.get("error_description") or data.get("error") or "").strip()
        raise BearerTokenError(
            f"Could not complete authentication (HTTP {status}). {detail}".strip()
        )

    expires_in = data.get("expires_in")
    expires_at = time.time() + (
        float(expires_in) if isinstance(expires_in, (int, float)) else _FALLBACK_TTL
    )
    save_token(
        str(data["access_token"]),
        expires_at,
        refresh_token=data.get("refresh_token"),
        client_id=client_id,
    )
    print("done. Connected - the token refreshes itself from now on.")
    # RFC 6749 s3.3: when the granted scope differs from the requested one the
    # server says so in `scope`. A grant that lost `flights:search` still
    # searches through letsfg.co/api (that lane reads the card/account, not
    # the scope) but every hosted-connector tool will refuse it -- say so
    # here, once, instead of letting the next command fail on it.
    granted = str(data.get("scope") or "").split() if "scope" in data else None
    if granted is not None and "flights:search" not in granted:
        print(
            "\n  Warning: the grant came back without 'flights:search' "
            f"(server granted: {' '.join(granted) or 'nothing'}).\n"
            "  Searching via letsfg.co still works; the hosted connector\n"
            "  (letsfg.co/mcp) will refuse this token. Run `letsfg auth`\n"
            "  again and, if it repeats, report it at github.com/LetsFG/LetsFG/issues."
        )
    return str(data["access_token"])


def _post_json_abs(url: str, payload: dict, timeout: int = 30) -> tuple[int, dict]:
    """_post_json against an absolute URL (registration_endpoint comes from
    discovery, so it is not necessarily under _BASE_URL)."""
    req = Request(
        url,
        data=json.dumps(payload).encode(),
        headers={
            "Content-Type": "application/json",
            "User-Agent": _USER_AGENT,
        },
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


# Back-compat name: `letsfg auth` used to mean the Stripe lane, now it is /connect.
payment_auth = connect_auth


def request_enrolment() -> dict:
    """
    The 402 envelope from /api/agent-access/request -- `add_card_url` and `how`.

    Still useful for an agent that wants the current instructions as JSON; it no
    longer carries a `setup_url`, because that lane is retired.
    """
    status, data = _post_json("/api/agent-access/request", {})
    if status not in (200, 402):
        raise BearerTokenError(
            f"Could not start authentication (HTTP {status}): {data.get('error', '')}"
        )
    return data


def verify_payment_method(*_args, **_kwargs) -> str:
    """Retired 2026-09-02. There is no endpoint that mints a token from card details."""
    raise BearerTokenError(
        "setup_session_id / payment_method_id / card_token were part of the Stripe\n"
        "enrolment, retired 2026-09-02, and every token they issued was revoked.\n"
        "There is no endpoint that mints a token from card details.\n"
        "  Run:  letsfg auth        (one tap at letsfg.co/connect, no card)"
    )


def twitter_auth() -> str:
    """Deprecated alias -- Twitter/X auth was retired 2026-07-29."""
    import warnings
    warnings.warn(
        "twitter_auth() is deprecated: LetsFG retired Twitter/X auth on 2026-07-29. "
        "Use connect_auth() - nothing is charged.",
        DeprecationWarning,
        stacklevel=2,
    )
    return connect_auth()
