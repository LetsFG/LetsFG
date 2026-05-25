"""Smoke test for the Google Flights date-grid connector.

This is a *live* test — it hits google.com/travel/flights. Skip by default;
run with:

    pytest connectors/tests/test_google_flights_smoke.py -m live -s

It validates that the date-grid scraper returns a non-empty grid for a
known-good route and that prices/currency/dates parse correctly.
"""

from __future__ import annotations

import asyncio
import os
import sys
from datetime import date, timedelta
from pathlib import Path

import pytest

# Allow `from connectors.google_flights import ...` when run from repo root.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))


@pytest.mark.skipif(
    os.environ.get("RUN_LIVE_GOOGLE_FLIGHTS") != "1",
    reason="Live network test — set RUN_LIVE_GOOGLE_FLIGHTS=1 to enable.",
)
def test_date_grid_gdn_to_ltn_live() -> None:
    from connectors.google_flights import GoogleFlightsClient

    # Pick a date ~3 weeks out so prices are stable and flights exist.
    dep = date.today() + timedelta(days=21)
    ret = dep + timedelta(days=4)

    async def run() -> None:
        client = GoogleFlightsClient(headless=True)
        result = await client.scrape_date_grid(
            origin="GDN", destination="LTN",
            dep_date=dep, ret_date=ret,
        )
        assert result.grid, "expected at least one priced cell in the grid"
        # Sanity-check first cell
        c = result.grid[0]
        assert c.price > 0
        assert len(c.currency) == 3
        assert abs((c.outbound_date - dep).days) <= 4
        assert abs((c.return_date - ret).days) <= 4
        cheapest = result.cheapest()
        assert cheapest is not None
        print(
            f"\nGrid: {len(result.grid)} cells, currency={result.currency}, "
            f"cheapest={cheapest.currency} {cheapest.price} "
            f"({cheapest.outbound_date} → {cheapest.return_date})"
        )

    asyncio.run(run())
