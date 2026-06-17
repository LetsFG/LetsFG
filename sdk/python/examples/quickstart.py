"""
LetsFG Programmatic Flight Search — 5-minute quickstart.

Authentication is free and takes ~30 seconds (Twitter/X, 90-day token).
Once authenticated, search returns in seconds with no local browsers needed.

Run:
    pip install letsfg
    python quickstart.py
"""

from __future__ import annotations

import asyncio
from letsfg.connectors.auth import twitter_auth, get_bearer_token, BearerTokenError
from letsfg.local import search_local


def authenticate():
    """Run the Twitter/X auth flow if no valid token exists."""
    try:
        get_bearer_token()
        print("  Already authenticated.")
    except BearerTokenError:
        print("  No token found — starting Twitter/X auth flow...")
        twitter_auth()


async def main():
    authenticate()

    print("\n  Searching WAW → BCN on 2026-07-15...")
    result = await search_local("WAW", "BCN", "2026-07-15", currency="EUR", limit=5)

    offers = result.get("offers", [])
    print(f"\n  {result.get('total_results', len(offers))} offers found. Top {len(offers)}:\n")
    for i, offer in enumerate(offers, 1):
        ob = offer.get("outbound", {})
        segs = ob.get("segments", [])
        route = "→".join(
            [segs[0]["origin"]] + [s["destination"] for s in segs]
        ) if segs else "?"
        price = offer.get("price", 0)
        currency = offer.get("currency", "EUR")
        stops = ob.get("stopovers", 0)
        airlines = ", ".join(offer.get("airlines", [offer.get("owner_airline", "?")]))
        print(f"  {i}. {currency} {price:.2f}  {airlines:<20}  {route}  ({stops} stop{'s' if stops != 1 else ''})")

    if offers:
        print(f"\n  To reveal the booking link for offer #{1}:")
        print(f"    letsfg unlock {offers[0].get('id', '<offer_id>')}\n")


if __name__ == "__main__":
    asyncio.run(main())
