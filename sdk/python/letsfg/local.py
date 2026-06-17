"""
Cloud-backed flight search for LetsFG.

Connectors run server-side at letsfg.co — same response schema, results
in seconds. Authenticate once via Twitter/X (`letsfg auth`) for a free
90-day Bearer token.

API flow:
    POST /api/search         → { search_id }
    GET  /api/results/<id>   → { status, offers[], total_results }  (poll every 10s)
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

    Requires a Bearer token — run `letsfg auth` once to authenticate via Twitter/X.
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


async def _resolve_location_local(query: str) -> list[dict]:
    """Stub — location resolution is handled server-side."""
    return []
