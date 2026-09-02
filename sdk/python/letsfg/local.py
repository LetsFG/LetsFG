"""
Cloud-backed flight search and booking for LetsFG.

Connectors run server-side at letsfg.co — same response schema, results
in seconds. Authenticate once with `letsfg auth`, which connects a card at
letsfg.co/connect in a 0.00 Revolut setup (nothing is charged) and stores an
OAuth token. The access token lasts about an hour and refreshes itself from a
30-day rotating refresh token.

API flow:
    POST /api/search         → { search_id }
    GET  /api/results/<id>   → { status, offers[], total_results }  (poll every 10s)
    POST /api/agent-book     → { ok, booked, order_id | booking_url }
"""

from __future__ import annotations

import asyncio
import json
import os
from urllib.request import Request, urlopen
from urllib.error import HTTPError

from letsfg.connectors.auth import get_bearer_token, BearerTokenError

_BASE_URL = os.environ.get("LETSFG_BASE_URL", "https://letsfg.co")
# Poll fast and poll FIRST. The old loop slept 10s before its opening poll,
# which put a hard 10s floor under every search however fast the engine
# answered.
_POLL_INTERVAL = 2    # seconds
_MAX_POLLS = 90       # ~3 minutes at 2s

# The API's own vocabulary. `searching` is in-progress; anything else is
# terminal. The old check tested membership in ("done", "complete", "finished")
# -- none of which the API ever sends -- and then fell through to "has offers
# and is not pending/running", which returns a HALF-FINISHED search the moment
# the first connector lands.
_IN_PROGRESS = ("pending", "running", "searching")

# A search reports `completed` BEFORE its offer set stops growing. The split
# probe fires two extra connector fan-outs and merges late, so the cheapest
# itinerary is routinely one that does not exist yet when the status turns
# terminal; the server publishes `split_ticket_pending` / `gf_enrich_pending`
# until it lands. Stopping at `completed` silently discards the cheaper offer.
#
# Costs nothing on most searches: the probe is gated server-side and never
# fires on the majority of routes, so the flags are already false on poll one.
# How long to wait is NOT a guess: the server stamps a result as settled
# SETTLE_MS = 90s after it first reports `completed`, and that is the window in
# which it expects the set to still be growing. A measured GDN->SFO run had the
# split land at 51s -- a 45s ceiling would have given up ~6s short of the offer
# this feature exists to find. Set LETSFG_WAIT_FOR_SPLIT=0 to skip the wait.
_LATE_MERGE_INTERVAL = 3
_LATE_MERGE_GRACE = 90   # seconds; a flag that never clears must not hang us
_WAIT_FOR_SPLIT = os.environ.get("LETSFG_WAIT_FOR_SPLIT", "").strip() != "0" 

# Must match the UA the rest of the package sends. urllib's default
# ("Python-urllib/3.x") is blocked outright by Cloudflare with error 1010, so a
# request without this header gets a 403 before it ever reaches the app --
# regardless of IP reputation, rate, or a perfectly valid Bearer token.
#
# Build every request in this module through _headers(). That is the whole point
# of it existing: issue #163 was fixed once in connectors/auth.py and came
# straight back here, because the fix patched a call site instead of a helper.
_USER_AGENT = "LetsFG-Python-SDK/1.0.3"


def _headers(token: str, *, json_body: bool = True) -> dict[str, str]:
    headers = {
        "Authorization": f"Bearer {token}",
        "User-Agent": _USER_AGENT,
        "X-Client-Type": "python-sdk",
    }
    if json_body:
        headers["Content-Type"] = "application/json"
    return headers


async def search_local(
    origin: str,
    destination: str,
    date_from: str,
    *,
    return_date: str | None = None,
    adults: int = 1,
    children: int = 0,
    infants: int = 0,
    cabin_class: str | None = None,
    currency: str = "EUR",
    limit: int = 50,
    max_stopovers: int | None = None,
    sort: str | None = None,
    **_kwargs,
) -> dict:
    """
    Search flights via the LetsFG cloud API.

    Requires a Bearer token — run `letsfg auth` once. Free and unlimited.
    Returns { offers: [...], total_results: N, search_id: "..." }.
    """
    token = get_bearer_token()

    payload: dict = {
        "origin": origin,
        "destination": destination,
        "date_from": date_from,
        "adults": adults,
        "children": children,
        "currency": currency,
        "limit": limit,
    }
    if return_date:
        payload["return_date"] = return_date
    if cabin_class:
        payload["cabin_class"] = cabin_class
    if infants:
        payload["infants"] = infants
    if max_stopovers is not None:
        payload["max_stopovers"] = max_stopovers
    if sort:
        payload["sort"] = sort

    req = Request(
        f"{_BASE_URL}/api/search",
        data=json.dumps(payload).encode(),
        headers=_headers(token),
        method="POST",
    )
    try:
        with urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read())
    except HTTPError as e:
        if e.code == 401:
            raise BearerTokenError(
                "Bearer token expired or revoked. Run `letsfg auth` to re-authenticate."
            )
        raise

    search_id = result.get("search_id") or result.get("id")
    if not search_id:
        return result  # direct response (e.g. sandbox mode)

    def _poll() -> dict:
        poll_req = Request(
            f"{_BASE_URL}/api/results/{search_id}",
            headers=_headers(token, json_body=False),
            method="GET",
        )
        with urlopen(poll_req, timeout=15) as resp:
            return json.loads(resp.read())

    def _late_merge_inbound(d: dict) -> bool:
        return bool(d.get("split_ticket_pending") or d.get("gf_enrich_pending"))

    print(f"  Searching [{search_id[:8]}] ", end="", flush=True)

    terminal: dict | None = None
    for i in range(_MAX_POLLS):
        if i:
            await asyncio.sleep(_POLL_INTERVAL)
        print(".", end="", flush=True)
        data = _poll()
        if data.get("status", "") not in _IN_PROGRESS:
            terminal = data
            break

    if terminal is None:
        print()
        return {"offers": [], "total_results": 0, "search_id": search_id}

    # Terminal, but the offer set may still be growing.
    waited = 0
    while _WAIT_FOR_SPLIT and _late_merge_inbound(terminal) and waited < _LATE_MERGE_GRACE:
        await asyncio.sleep(_LATE_MERGE_INTERVAL)
        waited += _LATE_MERGE_INTERVAL
        print("+", end="", flush=True)   # a late merge is landing, not a stall
        merged = _poll()
        if merged.get("status", "") not in _IN_PROGRESS:
            terminal = merged

    print()
    return terminal


async def book_offer(
    search_id: str,
    offer_id: str,
    passenger: dict,
    contact_email: str,
    *,
    offer_ref: str | None = None,
) -> dict:
    """
    Book an offer from a PFS search.

    Requires a Bearer token (`letsfg auth`). Use REAL passenger details — names
    must match the traveller's passport or government ID, and the airline sends
    e-tickets to contact_email.

    Returns either:
        { "ok": True,  "booked": True,  "order_id": "...", "charged": 0 }
      or, when the booking genuinely could not be completed:
        { "ok": False, "booked": False, "error": "booking_unavailable",
          "booking_url": "https://...", "charged": 0 }

    A "booking_unavailable" result is a normal outcome, not a transient error.
    Retrying will not book it — hand the user `booking_url`, which goes straight
    to that exact offer. Nothing is charged in either case.
    """
    token = get_bearer_token()

    payload: dict = {
        "search_id": search_id,
        "offer_id": offer_id,
        "passenger": passenger,
        "contact_email": contact_email,
    }
    if offer_ref:
        payload["offer_ref"] = offer_ref

    req = Request(
        f"{_BASE_URL}/api/agent-book",
        data=json.dumps(payload).encode(),
        headers=_headers(token),
        method="POST",
    )
    try:
        with urlopen(req, timeout=60) as resp:
            return json.loads(resp.read())
    except HTTPError as e:
        if e.code == 401:
            raise BearerTokenError(
                "Bearer token expired or revoked. Run `letsfg auth` to re-authenticate."
            )
        raw = e.read().decode(errors="replace")
        try:
            return json.loads(raw)
        except Exception:
            return {"ok": False, "booked": False, "error": raw[:400]}


async def _resolve_location_local(query: str) -> list[dict]:
    """Stub — location resolution is handled server-side."""
    return []
