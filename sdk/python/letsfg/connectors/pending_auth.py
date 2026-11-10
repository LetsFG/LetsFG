"""
The sign-in in flight, kept on disk so `letsfg auth --finish <url>` can end it.

`letsfg auth` waits for the browser on a loopback listener. When that process is
gone before the person presses Authorize (an agent's tool call timed out, the
CLI ran in a sandbox or on another machine), letsfg.co sends the browser to an
address nobody answers, with the code in it. This module keeps what the token
exchange needs -- client_id, redirect_uri, the PKCE verifier and the state --
for PENDING_TTL_S, the server's code lifetime, and checks a pasted address
against it.

Pure: no network, no printing. auth.py does the exchange.
"""

from __future__ import annotations

import json
import os
import secrets
from dataclasses import asdict, dataclass
from pathlib import Path
from urllib.parse import parse_qs, urlparse

# The server keeps an authorization code for ten minutes (oauth_store.AUTH_CODE_TTL_S).
# A record older than that can only hold a dead code.
PENDING_TTL_S = 10 * 60

_START_AGAIN = "Run `letsfg auth` again to start a new sign-in."


class PendingAuthError(ValueError):
    """The pending sign-in cannot be finished; the message says why and what to do."""


@dataclass(frozen=True)
class PendingAuth:
    client_id: str
    redirect_uri: str
    verifier: str
    state: str
    token_endpoint: str
    created_at: float


def save(path: Path, pending: PendingAuth) -> None:
    """Write the record readable by this user only (0600) from its first byte."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + f".{secrets.token_hex(4)}.tmp")
    fd = os.open(str(tmp), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w") as fh:
            json.dump(asdict(pending), fh)
        os.replace(tmp, path)
    except BaseException:
        try:
            tmp.unlink()
        except OSError:
            pass
        raise


def load(path: Path, now: float) -> PendingAuth:
    """The record, or PendingAuthError when it is missing, unreadable or past PENDING_TTL_S."""
    try:
        raw = json.loads(path.read_text())
        pending = PendingAuth(**{k: raw[k] for k in PendingAuth.__dataclass_fields__})
    except FileNotFoundError:
        raise PendingAuthError("No sign-in is waiting to be finished. " + _START_AGAIN) from None
    except (OSError, ValueError, KeyError, TypeError):
        raise PendingAuthError("The saved sign-in could not be read. " + _START_AGAIN) from None
    if now - float(pending.created_at) > PENDING_TTL_S:
        raise PendingAuthError(
            "That sign-in is more than 10 minutes old and its code has expired. " + _START_AGAIN
        )
    return pending


def clear(path: Path) -> None:
    try:
        path.unlink()
    except FileNotFoundError:
        pass


def code_from_callback(url: str, pending: PendingAuth) -> str:
    """The authorization code in a pasted redirect address, after checking it is ours.

    A `state` other than ours is refused: exchanging it would sign this CLI in to
    whatever account approved someone else's request (the CSRF case RFC 6749
    s10.12 describes)."""
    text = url.strip().strip("'\"").strip()
    query = urlparse(text).query or (text if "=" in text and "://" not in text else "")
    params = parse_qs(query)
    state = (params.get("state") or [""])[0]
    error = (params.get("error") or [""])[0]
    code = (params.get("code") or [""])[0]

    if not state or not secrets.compare_digest(state, pending.state):
        raise PendingAuthError(
            "That address does not belong to the sign-in this computer started (its state does not match). "
            "Paste the address from the browser tab that `letsfg auth` opened, or " + _START_AGAIN[0].lower()
            + _START_AGAIN[1:]
        )
    if error:
        raise PendingAuthError(f"The sign-in was not approved ({error}). " + _START_AGAIN)
    if not code:
        raise PendingAuthError("That address carries no authorization code. " + _START_AGAIN)
    return code
