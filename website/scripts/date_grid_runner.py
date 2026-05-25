"""Dev-only CLI shim for running the Google Flights date-grid scraper.

Used by ``app/api/date-grid/route.ts`` when ``LETSFG_DEV_DATE_GRID_PY=1`` is set.
In production the Next.js route calls the backend's ``/api/v1/flights/date-grid``
endpoint instead — this subprocess fallback exists so the website can be tested
end-to-end on a developer machine without a backend dependency.

Usage:
    python website/scripts/date_grid_runner.py GDN LTN 2026-06-10 2026-06-14

Outputs a JSON object on stdout matching the DateGridResponse contract.
Errors go to stderr, exit code 1.
"""

from __future__ import annotations

import asyncio
import dataclasses
import json
import os
import sys
from datetime import date, datetime
from pathlib import Path

# Make `connectors` importable when running from anywhere.
REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))


def _serialize(obj):
    if isinstance(obj, (date, datetime)):
        return obj.isoformat()
    if dataclasses.is_dataclass(obj):
        return dataclasses.asdict(obj)
    raise TypeError(f"unhandled type: {type(obj)}")


async def main(argv: list[str]) -> int:
    if len(argv) < 4:
        print("usage: date_grid_runner.py ORIGIN DEST DEP_DATE [RET_DATE]", file=sys.stderr)
        return 2

    origin, dest, dep = argv[1], argv[2], argv[3]
    ret = argv[4] if len(argv) > 4 else None

    # Prefer the direct-XHR client (~500ms, no browser). Fall back to the
    # Playwright connector only if the XHR endpoint stops working.
    from connectors.google_flights_xhr import GoogleFlightsXhrClient

    # Currency comes from env so the website can pass through the user's pref.
    currency = os.environ.get("LETSFG_DATE_GRID_CURRENCY", "EUR")
    client = GoogleFlightsXhrClient(currency=currency)
    try:
        result = await client.scrape_date_grid(
            origin=origin,
            destination=dest,
            dep_date=dep,
            ret_date=ret,
        )
    finally:
        await client.close()

    payload = {
        "origin": result.origin,
        "destination": result.destination,
        "currency": result.currency,
        "selected_outbound": result.selected_outbound.isoformat(),
        "selected_return": result.selected_return.isoformat() if result.selected_return else None,
        "scraped_at": result.scraped_at.isoformat(),
        "grid": [
            {
                "outbound": c.outbound_date.isoformat(),
                "return": c.return_date.isoformat(),
                "price": c.price,
                "currency": c.currency,
                "is_cheaper": c.is_cheaper,
            }
            for c in result.grid
        ],
    }
    sys.stdout.write(json.dumps(payload))
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main(sys.argv)))
