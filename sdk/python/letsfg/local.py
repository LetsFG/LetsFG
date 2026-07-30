"""
Cloud-backed flight search and booking for LetsFG.

Connectors run server-side at letsfg.co — same response schema, results
in seconds. Authenticate once with `letsfg auth`, which puts a payment method
on file via a zero-amount Stripe setup (nothing is charged) and returns a
90-day Bearer token.

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
_POLL_INTERVAL = 10   # seconds
_MAX_POLLS = 36       # 6 minutes max


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
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
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

    print(f"  Searching [{search_id[:8]}] ", end="", flush=True)
    for _ in range(_MAX_POLLS):
        await asyncio.sleep(_POLL_INTERVAL)
        print(".", end="", flush=True)
        poll_req = Request(
            f"{_BASE_URL}/api/results/{search_id}",
            headers={"Authorization": f"Bearer {token}"},
            method="GET",
        )
        with urlopen(poll_req, timeout=15) as resp:
            data = json.loads(resp.read())
        status = data.get("status", "")
        if status in ("done", "complete", "finished") or (
            data.get("offers") and status not in ("pending", "running")
        ):
            print()
            return data

    print()
    return {"offers": [], "total_results": 0, "search_id": search_id}


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
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
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
