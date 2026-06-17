"""
LetsFG Programmatic Flight Search — quickstart.

1. Get a free 90-day Bearer token at https://letsfg.co/for-agents
2. Save it:  letsfg auth --token <your-token>
             or set LETSFG_BEARER_TOKEN=<your-token>
3. Run this script.

Results come back in seconds from 400+ airlines — same schema as before,
no local browsers required.
"""

from __future__ import annotations

import asyncio
from letsfg.local import search_local


async def main():
    print("Searching WAW → BCN on 2026-07-15...")
    result = await search_local("WAW", "BCN", "2026-07-15", currency="EUR", limit=5)

    offers = result.get("offers", [])
    print(f"\n{result.get('total_results', len(offers))} offers. Top {len(offers)}:\n")
    for i, offer in enumerate(offers, 1):
        ob = offer.get("outbound", {})
        segs = ob.get("segments", [])
        route = "→".join(
            [segs[0]["origin"]] + [s["destination"] for s in segs]
        ) if segs else "?"
        price = offer.get("price", 0)
        currency = offer.get("currency", "EUR")
        airlines = ", ".join(offer.get("airlines", [offer.get("owner_airline", "?")]))
        print(f"  {i}. {currency} {price:.2f}  {airlines:<20}  {route}")

    if offers:
        print(f"\nTo reveal the booking link:")
        print(f"  letsfg unlock {offers[0].get('id', '<offer_id>')}\n")


if __name__ == "__main__":
    asyncio.run(main())
