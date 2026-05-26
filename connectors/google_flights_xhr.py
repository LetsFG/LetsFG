"""Google Flights date-grid scraper — direct XHR replay, no browser.

Discovered: Google Flights' "Date grid" UI is powered by an internal RPC at
``/_/FlightsFrontendUi/data/.../GetCalendarGrid``. The endpoint accepts a
plain ``application/x-www-form-urlencoded`` POST with an ``f.req`` body
encoding the search parameters, and returns the full 7×7 price grid as JSON.

Crucially, this endpoint works with NO browser, NO session token (``f.sid``),
and NO anti-bot challenge token (``x-goog-batchexecute-bgr``). A single
``httpx`` POST completes in ~500–800ms — versus 10–30 seconds for the
Playwright-driven version.

That means Cloud Run can scale to zero and every request stays sub-second.

This is meant to be the **default** Google Flights date-grid connector.
The Playwright version in ``google_flights.py`` is kept as a fallback in
case Google ever locks this endpoint down behind a real anti-bot challenge.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from datetime import date, datetime, timezone
from typing import Optional
from urllib.parse import urlencode

import httpx

from .google_flights import (
    DateGridResult,
    GridCell,
    _resolve_abbrev_date,
    _parse_price,
)

logger = logging.getLogger(__name__)

# The build label is part of Google's frontend bundle versioning. It's stable
# for weeks — the request still succeeds when slightly stale. Updated 2026-05-25.
# If Google rejects requests with this bl, we can swap to ``current`` mode by
# scraping the home page for the latest one (see _refresh_bl helper).
DEFAULT_BL = "boq_travel-frontend-flights-ui_20260515.02_p0"

_ENDPOINT = (
    "https://www.google.com/_/FlightsFrontendUi/data/"
    "travel.frontend.flights.FlightsFrontendService/GetCalendarGrid"
)

# IATA metro codes → list of operational airports inside that metro.
# Google's XHR rejects bare metro codes (LON, NYC, PAR, etc.) and returns
# an empty grid, but if you pass the underlying airports as a multi-airport
# array it returns the cheapest combo across all of them. This map lets the
# connector accept either a metro code or a specific airport.
#
# Keep this list focused on the metro codes Google Flights actually treats
# as multi-airport. If you find one Google handles but we don't, add it here.
METRO_CODE_AIRPORTS: dict[str, list[str]] = {
    "LON": ["LHR", "LGW", "STN", "LTN", "LCY", "SEN"],
    "NYC": ["JFK", "LGA", "EWR"],
    "PAR": ["CDG", "ORY", "BVA"],
    "TYO": ["NRT", "HND"],
    "WAS": ["IAD", "DCA", "BWI"],
    "CHI": ["ORD", "MDW"],
    "MIL": ["MXP", "LIN", "BGY"],
    "ROM": ["FCO", "CIA"],
    "BUE": ["EZE", "AEP"],
    "BJS": ["PEK", "PKX"],
    "SAO": ["GRU", "CGH", "VCP"],
    "RIO": ["GIG", "SDU"],
    "STO": ["ARN", "BMA", "NYO"],
    "BUH": ["OTP", "BBU"],
    "MOW": ["SVO", "DME", "VKO"],
    "OSA": ["KIX", "ITM"],
    "SEL": ["ICN", "GMP"],
    "BSL": ["BSL", "MLH", "EAP"],
    "QDF": ["DTW"],  # rare placeholder; keeps the format consistent
}


def _expand_iata(code: str) -> list[str]:
    """Expand a metro code (e.g. ``LON``) to its constituent airport codes.
    Returns ``[code]`` unchanged when ``code`` is already an airport.
    """
    upper = code.upper()
    return METRO_CODE_AIRPORTS.get(upper, [upper])


def _last_of_month(d: date) -> date:
    """Return the last day of the same month as ``d``."""
    from datetime import timedelta
    if d.month == 12:
        next_month_first = date(d.year + 1, 1, 1)
    else:
        next_month_first = date(d.year, d.month + 1, 1)
    return next_month_first - timedelta(days=1)

# The response is Google's "wrb.fr" format. The first non-anti-XSSI line is
# the byte-length of the next chunk, then a JSON array.
_ANTI_XSSI_PREFIX = ")]}'"


def _build_f_req(
    origin: str,
    destination: str,
    dep: date,
    ret: Optional[date],
) -> str:
    """Build the f.req body Google's frontend sends for a calendar-grid query.

    Reverse-engineered from a live request (see ``google_flights_date_grid.md``).
    The protocol is JSON-in-JSON: an outer 2-element envelope wrapping an
    inner JSON string that encodes the actual search parameters.

    Metro codes (LON, NYC, PAR, ...) are expanded to their constituent
    airports in a multi-airport array — Google's XHR rejects bare metro
    codes but accepts ``[[[LHR,0],[LGW,0],[STN,0],...]]`` for "any London".
    """
    origin_airports = _expand_iata(origin)
    dest_airports = _expand_iata(destination)
    origin_block = [[[c, 0] for c in origin_airports]]
    dest_block = [[[c, 0] for c in dest_airports]]

    outbound_leg = [
        origin_block,
        dest_block,
        None, 0, None, None,
        dep.isoformat(),
        None, None, None, None, None, None, None, 3,
    ]
    legs = [outbound_leg]
    if ret is not None:
        return_leg = [
            dest_block,
            origin_block,
            None, 0, None, None,
            ret.isoformat(),
            None, None, None, None, None, None, None, 3,
        ]
        legs.append(return_leg)

    inner = [
        None,
        [
            None, None, 1, None, [], 1, [1, 0, 0, 0],
            None, None, None, None, None, None,
            legs,
            None, None, None, 1,
        ],
        # Outbound date window (Google echoes back ±3 days)
        [
            (dep.replace(day=dep.day) - _days(3)).isoformat() if False else (dep - _days(3)).isoformat(),
            (dep + _days(3)).isoformat(),
        ],
        # Return date window
        (
            [(ret - _days(3)).isoformat(), (ret + _days(3)).isoformat()]
            if ret is not None
            else None
        ),
    ]
    # Outer envelope: [null, "<inner-json-string>"]
    envelope = [None, json.dumps(inner, separators=(",", ":"))]
    return json.dumps(envelope, separators=(",", ":"))


def _days(n: int):
    from datetime import timedelta
    return timedelta(days=n)


def _parse_response(text: str) -> tuple[list[GridCell], Optional[str]]:
    """Parse Google's wrb.fr-format response into GridCell objects.

    Format (simplified):
        )]}'
        <byte_count>
        [["wrb.fr", null, "<json-string>", ...]]
        <byte_count>
        [["wrb.fr", null, "<json-string with no-flights cells>", ...]]
        ...

    The first wrb.fr payload contains the priced cells; the second contains
    "no flights" cells. We only care about the first.
    """
    text = text.strip()
    if text.startswith(_ANTI_XSSI_PREFIX):
        text = text[len(_ANTI_XSSI_PREFIX):].lstrip()

    # Pull all wrb.fr payloads — they're balanced JSON arrays interleaved
    # with length-prefix lines we don't strictly need.
    chunks: list = []
    decoder = json.JSONDecoder()
    i = 0
    while i < len(text):
        # Skip whitespace + the length-prefix integer lines
        while i < len(text) and (text[i].isspace() or text[i].isdigit()):
            i += 1
        if i >= len(text):
            break
        if text[i] != "[":
            i += 1
            continue
        try:
            obj, end = decoder.raw_decode(text, i)
        except json.JSONDecodeError:
            break
        chunks.append(obj)
        i = end

    cells: list[GridCell] = []
    currency: Optional[str] = None
    for chunk in chunks:
        # chunk = [["wrb.fr", null, "<json-string>", ...]]
        if not isinstance(chunk, list) or not chunk:
            continue
        for entry in chunk:
            if not isinstance(entry, list) or len(entry) < 3:
                continue
            if entry[0] != "wrb.fr":
                continue
            payload_str = entry[2]
            if not isinstance(payload_str, str):
                continue
            try:
                payload = json.loads(payload_str)
            except (json.JSONDecodeError, TypeError):
                continue
            # payload = [meta, [cell, cell, ...]]
            if not isinstance(payload, list) or len(payload) < 2:
                continue
            cell_list = payload[1]
            if not isinstance(cell_list, list):
                continue
            for raw_cell in cell_list:
                if not isinstance(raw_cell, list) or len(raw_cell) < 3:
                    continue
                outbound, return_, price_block = raw_cell[0], raw_cell[1], raw_cell[2]
                # "no flights" cell looks like ["2026-06-11", "2026-06-11", null, 2]
                if price_block is None:
                    continue
                # price_block = [[null, price_int], "booking_token_b64"]
                try:
                    price = price_block[0][1]
                    if not isinstance(price, int) or price <= 0:
                        continue
                except (TypeError, IndexError):
                    continue
                cells.append(
                    GridCell(
                        outbound_date=date.fromisoformat(outbound),
                        return_date=date.fromisoformat(return_),
                        price=price,
                        currency="",  # filled in by caller — comes from request locale header
                        is_cheaper=False,  # XHR endpoint doesn't expose Google's "cheaper" flag
                    )
                )
    return cells, currency


class GoogleFlightsXhrClient:
    """Direct XHR replay of Google Flights date-grid — no browser, ~600ms.

    Pass ``currency`` (ISO 4217) and ``locale`` (e.g. "en-US") to control
    what currency Google returns. Maps to the ``x-goog-ext-259736195-jspb``
    header which is the locale/currency/country trio that Google's frontend
    uses.
    """

    def __init__(
        self,
        timeout_s: float = 12.0,
        currency: str = "EUR",
        locale: str = "en-US",
        country: str = "US",
        bl: str = DEFAULT_BL,
    ):
        self.timeout_s = timeout_s
        self.currency = currency
        self.locale = locale
        self.country = country
        self.bl = bl
        self._client: Optional[httpx.AsyncClient] = None

    async def _ensure_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=self.timeout_s,
                follow_redirects=False,
            )
        return self._client

    async def close(self) -> None:
        if self._client and not self._client.is_closed:
            await self._client.aclose()

    async def scrape_date_grid(
        self,
        origin: str,
        destination: str,
        dep_date,
        ret_date=None,
        *,
        attempts: int = 2,
    ) -> DateGridResult:
        dep = dep_date if isinstance(dep_date, date) else date.fromisoformat(dep_date)
        ret = (
            ret_date if isinstance(ret_date, date) or ret_date is None
            else date.fromisoformat(ret_date)
        )

        last_err: Optional[Exception] = None
        for attempt in range(1, attempts + 1):
            try:
                t0 = time.monotonic()
                cells = await self._call_once(origin, destination, dep, ret)
                elapsed = time.monotonic() - t0
                logger.info(
                    "GFLIGHTS_XHR %s→%s dep=%s ret=%s: %d cells in %.0fms",
                    origin, destination, dep, ret, len(cells), elapsed * 1000,
                )
                # Annotate currency from the request (Google reflects what we ask for)
                for c in cells:
                    c.currency = self.currency
                return DateGridResult(
                    origin=origin,
                    destination=destination,
                    currency=self.currency,
                    selected_outbound=dep,
                    selected_return=ret,
                    scraped_at=datetime.now(timezone.utc),
                    grid=cells,
                )
            except Exception as e:
                last_err = e
                logger.warning(
                    "GFLIGHTS_XHR attempt %d failed for %s→%s: %s",
                    attempt, origin, destination, e,
                )
                if attempt < attempts:
                    await asyncio.sleep(0.4 * attempt)

        logger.error(
            "GFLIGHTS_XHR giving up after %d attempts (%s→%s): %s",
            attempts, origin, destination, last_err,
        )
        return DateGridResult(
            origin=origin,
            destination=destination,
            currency=self.currency,
            selected_outbound=dep,
            selected_return=ret,
            scraped_at=datetime.now(timezone.utc),
            grid=[],
        )

    async def scrape_month_grid(
        self,
        origin: str,
        destination: str,
        dep_date,
        ret_date=None,
        *,
        attempts: int = 2,
    ) -> DateGridResult:
        """Fetch a full-month round-trip price grid by firing several parallel
        ±3 scrapes covering the month and merging the results.

        Google's ``GetCalendarGrid`` XHR caps each call at ~7-day windows, so
        whole-month coverage needs multiple calls. We anchor scrapes every
        ~6 days across the relevant date range, fire them in parallel, dedupe
        by (outbound, return) keeping the cheapest price.

        Trip length is preserved by the caller's resolver — this just returns
        the merged grid; filtering to ``return - outbound == user_nights`` is
        done in the website's resolver.

        Returns a ``DateGridResult`` with ``selected_outbound`` / ``selected_return``
        set to the user's original picks (not the cheapest combo). The merged
        ``grid`` typically contains 150-300 unique cells.
        """
        from datetime import timedelta

        dep = dep_date if isinstance(dep_date, date) else date.fromisoformat(dep_date)
        ret = (
            ret_date if isinstance(ret_date, date) or ret_date is None
            else date.fromisoformat(ret_date)
        )

        # Decide which date range to cover. Default: the whole month containing
        # the user's departure, plus the month containing the return if it
        # differs. Each anchor's ±3 window covers ~7 days.
        first_of_dep = dep.replace(day=1)
        last_of_dep = _last_of_month(dep)
        if ret is not None:
            last_of_ret = _last_of_month(ret)
        else:
            last_of_ret = last_of_dep
        # Range = [first_of_dep_month, last_of_ret_month]
        anchor_start = first_of_dep
        anchor_end = last_of_ret

        # Anchors every ~6 days so ±3 windows mostly tile without big gaps.
        trip_nights = (ret - dep).days if ret is not None else 0
        anchors: list[tuple[date, Optional[date]]] = []
        cur = anchor_start
        while cur <= anchor_end:
            cur_ret = cur + timedelta(days=trip_nights) if trip_nights > 0 else None
            anchors.append((cur, cur_ret))
            cur = cur + timedelta(days=6)
        # Also include the user's original anchor — guarantees we cover their
        # picked dates even if the tiling missed them.
        if (dep, ret) not in anchors:
            anchors.append((dep, ret))

        # Google appears to rate-limit / throttle when too many GetCalendarGrid
        # requests land at once — full parallel fan-out causes ReadTimeouts.
        # Cap concurrency at 4: empirically keeps Google happy and still gives
        # us ~2x speedup vs serial across a 30-day month.
        sem = asyncio.Semaphore(4)

        async def one(anchor: tuple[date, Optional[date]]) -> list[GridCell]:
            async with sem:
                try:
                    cells = await self._call_once(origin, destination, anchor[0], anchor[1])
                    logger.info(
                        "GFLIGHTS_MONTH anchor (%s, %s): %d cells",
                        anchor[0], anchor[1], len(cells),
                    )
                    return cells
                except Exception as e:
                    logger.warning(
                        "GFLIGHTS_MONTH anchor %s failed for %s→%s: %r",
                        anchor[0], origin, destination, e,
                    )
                    return []

        t0 = time.monotonic()
        results = await asyncio.gather(*(one(a) for a in anchors))
        elapsed = time.monotonic() - t0

        # Merge: dedupe by (outbound, return), keep cheapest
        merged: dict[tuple[date, date], GridCell] = {}
        for batch in results:
            for c in batch:
                c.currency = self.currency
                key = (c.outbound_date, c.return_date)
                existing = merged.get(key)
                if not existing or c.price < existing.price:
                    merged[key] = c

        cells = sorted(merged.values(), key=lambda c: (c.outbound_date, c.return_date))
        logger.info(
            "GFLIGHTS_MONTH %s→%s anchors=%d → %d unique cells in %.0fms",
            origin, destination, len(anchors), len(cells), elapsed * 1000,
        )

        return DateGridResult(
            origin=origin,
            destination=destination,
            currency=self.currency,
            selected_outbound=dep,
            selected_return=ret,
            scraped_at=datetime.now(timezone.utc),
            grid=cells,
        )

    async def _call_once(self, origin: str, destination: str, dep: date, ret: Optional[date]) -> list[GridCell]:
        client = await self._ensure_client()

        qs = {
            "bl": self.bl,
            "hl": self.locale,
            "soc-app": "162",
            "soc-platform": "1",
            "soc-device": "1",
            "_reqid": "1",
            "rt": "c",
        }
        url = f"{_ENDPOINT}?{urlencode(qs)}"

        f_req = _build_f_req(origin, destination, dep, ret)
        body = "f.req=" + urlencode({"x": f_req})[2:]

        # ext-259736195-jspb encodes: locale, country, currency, ...flags
        ext_jspb = json.dumps(
            [self.locale, self.country, self.currency, 1, None, [-120], None, None, 1, []],
            separators=(",", ":"),
        )

        headers = {
            "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
            "x-same-domain": "1",
            "x-goog-ext-259736195-jspb": ext_jspb,
            "referer": "https://www.google.com/travel/flights",
            "user-agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36"
            ),
            "accept-language": self.locale,
        }

        resp = await client.post(url, headers=headers, content=body)
        if resp.status_code != 200:
            raise RuntimeError(f"GetCalendarGrid HTTP {resp.status_code}")
        cells, _ = _parse_response(resp.text)
        return cells
