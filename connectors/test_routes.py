"""
Connector smoke-test route registry.

Each entry maps a connector source tag (matching _FAST_MODE_SOURCES in engine.py)
to a deterministic test route and expected constraints. Routes are chosen to
exercise the connector on a high-frequency short-haul path with reliable
year-round schedules. All routes are one-way.

Used by connectors/tests/smoke_harness.py for Tier-2 targeted live smoke runs.
To add a new connector: append a TestRoute entry and register it in ROUTES.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class TestRoute:
    source_tag: str
    origin: str
    destination: str
    latency_s: float        # fail if search takes longer than this
    min_offers: int = 1     # fail if fewer offers returned
    max_price: Optional[float] = None  # fail if cheapest offer > this (sanity cap)
    note: str = ""


ROUTES: dict[str, TestRoute] = {
    # ── Meta-search / aggregators ──────────────────────────────────────────
    "skyscanner_meta": TestRoute(
        "skyscanner_meta", "LTN", "BCN", latency_s=20.0,
        note="Wizz Air UK dominates LTN-BCN; reliable year-round",
    ),
    "momondo_meta": TestRoute(
        "momondo_meta", "LTN", "BCN", latency_s=45.0,
        note="Booking Holdings scraper; same parse path as kayak_meta",
    ),
    "kayak_meta": TestRoute(
        "kayak_meta", "LTN", "BCN", latency_s=45.0,
        note="Booking Holdings scraper; shares _parse_booking_holdings_poll",
    ),
    "kiwi_connector": TestRoute(
        "kiwi_connector", "DUB", "STN", latency_s=20.0,
        note="Ryanair-heavy route; exercises Kiwi GraphQL + virtual interlining",
    ),

    # ── Direct LCC airlines ────────────────────────────────────────────────
    "ryanair_direct": TestRoute(
        "ryanair_direct", "DUB", "STN", latency_s=8.0,
        note="Ryanair home route; farfnd v4 endpoint",
    ),
    "wizzair_direct": TestRoute(
        "wizzair_direct", "WAW", "LTN", latency_s=15.0,
        note="Wizz Air flagship route; availability API",
    ),
    "easyjet_direct": TestRoute(
        "easyjet_direct", "LGW", "AMS", latency_s=40.0,
        note="CDP-based; exercises cookie/session handling",
    ),
    "norwegian_direct": TestRoute(
        "norwegian_direct", "OSL", "LHR", latency_s=30.0,
        note="Cookie-farm + curl_cffi; Amadeus DES API",
    ),
    "vueling_direct": TestRoute(
        "vueling_direct", "BCN", "MAD", latency_s=15.0,
        note="Short domestic Spain route; REST API",
    ),
    "transavia_direct": TestRoute(
        "transavia_direct", "AMS", "BCN", latency_s=15.0,
        note="Transavia REST API; no browser required",
    ),
    "jetblue_direct": TestRoute(
        "jetblue_direct", "JFK", "BOS", latency_s=20.0,
        note="JetBlue API; high-frequency US East Coast shuttle",
    ),
    "frontier_direct": TestRoute(
        "frontier_direct", "DEN", "LAS", latency_s=20.0,
        note="Frontier REST API; reliable year-round",
    ),
    "allegiant_direct": TestRoute(
        "allegiant_direct", "LAS", "LAX", latency_s=20.0,
        note="Allegiant API; short domestic route",
    ),
    "southwest_direct": TestRoute(
        "southwest_direct", "DAL", "HOU", latency_s=20.0,
        note="Southwest API; frequent Dallas-Houston shuttle",
    ),

    # ── Key full-service / long-haul direct ───────────────────────────────
    "emirates_direct": TestRoute(
        "emirates_direct", "DXB", "LHR", latency_s=15.0,
        note="Emirates REST API; flagship route EK001/EK002",
    ),
    "turkish_direct": TestRoute(
        "turkish_direct", "IST", "LHR", latency_s=20.0,
        note="Sputnik fare module; reliable IST-LHR year-round",
    ),
    "finnair_direct": TestRoute(
        "finnair_direct", "HEL", "LHR", latency_s=15.0,
        note="Finnair instantsearch API; HEL-LHR direct",
    ),

    # ── India domestic LCCs ───────────────────────────────────────────────
    "indigo_direct": TestRoute(
        "indigo_direct", "DEL", "BOM", latency_s=15.0,
        note="IndiGo API; highest-frequency India domestic route",
    ),
    "spicejet_direct": TestRoute(
        "spicejet_direct", "DEL", "BOM", latency_s=15.0,
        note="SpiceJet API; same DEL-BOM route for comparison",
    ),
    "akasa_direct": TestRoute(
        "akasa_direct", "BOM", "DEL", latency_s=15.0,
        note="Akasa Air API",
    ),
    "airindiaexpress_direct": TestRoute(
        "airindiaexpress_direct", "COK", "DXB", latency_s=15.0,
        note="Air India Express API; Kerala-Gulf corridor",
    ),
}
