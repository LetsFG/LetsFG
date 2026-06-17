"""LetsFG sandbox quickstart — try the API with ZERO signup, no card.

The sandbox returns deterministic fake flight offers that match the real API schema
exactly, so code you write against it works in production unchanged. It fires no
connectors and is keyless — perfect for wiring up and CI.

Run:  python sandbox_quickstart.py

When you're ready for real data, get a free key by email at:
  https://letsfg.co/developers?utm_source=github&utm_medium=sdk_example&utm_campaign=sandbox_first
(Sandbox first, then fund a Stripe balance only to go live.)
"""

from __future__ import annotations

import json
import urllib.request

SANDBOX_URL = "https://letsfg.co/developers/api/v1/sandbox/flights/search"


def sandbox_search(origin: str, destination: str, date_from: str) -> dict:
    """Keyless sandbox search — no API key, no charge."""
    body = json.dumps(
        {"origin": origin, "destination": destination, "date_from": date_from, "adults": 1, "currency": "EUR"}
    ).encode()
    req = urllib.request.Request(
        SANDBOX_URL,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:  # noqa: S310 (trusted URL)
        return json.loads(resp.read())


if __name__ == "__main__":
    result = sandbox_search("WAW", "BCN", "2026-07-15")
    offers = result.get("offers", [])
    print(f"Sandbox returned {result.get('total_results', len(offers))} fake results. Cheapest 3:")
    for offer in offers[:3]:
        seg = offer["outbound"]["segments"][0]
        print(f"  {seg['airline_name']:<20} {seg['origin']}→{seg['destination']}  {offer['price_formatted']}")
    # Every sandbox offer is unmistakably fake — never confuse it for live data.
    assert all(o["source"] == "sandbox" for o in offers), "expected sandbox-tagged offers"
    print("\nReady for real prices? Free key by email → "
          "https://letsfg.co/developers?utm_source=github&utm_medium=sdk_example&utm_campaign=sandbox_first")
