"""
Google Flights — Playwright scraper.

This connector intentionally does NOT implement the standard
``search_flights(req) -> FlightSearchResponse`` interface used by airline
connectors, because its output is a price-flexibility grid rather than a
list of bookable offers. It is meant to be invoked **on demand** (e.g. when
the website needs to show the ±3-day price grid on the refine page), not as
part of the main fan-out engine.

No caching is performed here. The caller decides whether and how to cache.

See ``google_flights_date_grid.md`` for the selector discovery write-up
this implementation is based on (verified 2026-05-25).
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Optional

logger = logging.getLogger(__name__)

_MONTH_ABBR = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

# Matches strings like "PLN 1,250, Jun 7 to Jun 11" or "EUR 187, Jun 10 to Jun 11"
_GRID_CELL_LABEL_RE = re.compile(
    r"^([A-Z]{3})\s+([\d.,]+),\s*(\w+\s+\d+)\s+to\s+(\w+\s+\d+)$"
)


@dataclass
class GridCell:
    outbound_date: date
    return_date: date
    price: int
    currency: str
    is_cheaper: bool  # Google flags some cells as cheaper than the rest in the grid


@dataclass
class DateGridResult:
    origin: str
    destination: str
    currency: Optional[str]
    selected_outbound: date
    selected_return: Optional[date]
    scraped_at: datetime
    grid: list[GridCell] = field(default_factory=list)

    def cheapest(self) -> Optional[GridCell]:
        priced = [c for c in self.grid if c.price > 0]
        if not priced:
            return None
        return min(priced, key=lambda c: c.price)


def _resolve_abbrev_date(abbrev: str, anchor: date) -> Optional[date]:
    """Resolve an abbreviated date like 'Jun 7' to a full ``date``.

    The grid spans ±3 days from ``anchor``, so the resolved date must be
    within ~7 days of it. Handles month-boundary and year-boundary rollovers
    (e.g. anchor = 2026-01-02, abbrev = 'Dec 30' → 2025-12-30).
    """
    parts = abbrev.split()
    if len(parts) != 2:
        return None
    try:
        month_num = _MONTH_ABBR.index(parts[0]) + 1
        day_num = int(parts[1])
    except (ValueError, IndexError):
        return None
    for year_offset in (0, -1, 1):
        try:
            candidate = date(anchor.year + year_offset, month_num, day_num)
        except ValueError:
            continue
        if abs((candidate - anchor).days) <= 7:
            return candidate
    return None


def _parse_price(raw: str) -> Optional[int]:
    """Parse '1,250' or '1.250' or '187' into an integer."""
    digits = re.sub(r"[^0-9]", "", raw)
    if not digits:
        return None
    try:
        return int(digits)
    except ValueError:
        return None


def _to_iso(d: date | str) -> str:
    if isinstance(d, date):
        return d.isoformat()
    return d


class GoogleFlightsClient:
    """On-demand Google Flights scraper for the date-flexibility price grid.

    Usage:
        client = GoogleFlightsClient()
        result = await client.scrape_date_grid(
            origin="GDN", destination="LTN",
            dep_date="2026-06-10", ret_date="2026-06-14",
        )
        for cell in result.grid:
            print(cell.outbound_date, "→", cell.return_date, cell.currency, cell.price)
    """

    def __init__(self, timeout_s: float = 30.0, headless: bool = True):
        self.timeout_s = timeout_s
        self.headless = headless

    async def close(self) -> None:
        # No persistent state — kept for symmetry with other connectors.
        pass

    async def scrape_date_grid(
        self,
        origin: str,
        destination: str,
        dep_date: date | str,
        ret_date: date | str | None = None,
        *,
        attempts: int = 2,
    ) -> DateGridResult:
        """Scrape the ±3-day Google Flights Date Grid for a round-trip (or one-way).

        Returns a populated ``DateGridResult``. On failure across all attempts,
        returns an empty grid (``result.grid == []``); the caller decides how
        to surface the failure.
        """
        dep = dep_date if isinstance(dep_date, date) else date.fromisoformat(dep_date)
        ret = (
            ret_date
            if isinstance(ret_date, date) or ret_date is None
            else date.fromisoformat(ret_date)
        )

        last_err: Optional[Exception] = None
        for attempt in range(1, attempts + 1):
            try:
                t0 = time.monotonic()
                cells, currency = await self._scrape_once(origin, destination, dep, ret)
                elapsed = time.monotonic() - t0
                logger.info(
                    "GOOGLE_FLIGHTS_GRID %s→%s dep=%s ret=%s: %d cells in %.1fs",
                    origin, destination, dep, ret, len(cells), elapsed,
                )
                return DateGridResult(
                    origin=origin,
                    destination=destination,
                    currency=currency,
                    selected_outbound=dep,
                    selected_return=ret,
                    scraped_at=datetime.now(timezone.utc),
                    grid=cells,
                )
            except Exception as e:
                last_err = e
                logger.warning(
                    "GOOGLE_FLIGHTS_GRID attempt %d failed for %s→%s: %s",
                    attempt, origin, destination, e,
                )
                if attempt < attempts:
                    await asyncio.sleep(1.5 * attempt)

        logger.error(
            "GOOGLE_FLIGHTS_GRID giving up after %d attempts (%s→%s): %s",
            attempts, origin, destination, last_err,
        )
        return DateGridResult(
            origin=origin,
            destination=destination,
            currency=None,
            selected_outbound=dep,
            selected_return=ret,
            scraped_at=datetime.now(timezone.utc),
            grid=[],
        )

    async def _scrape_once(
        self,
        origin: str,
        destination: str,
        dep: date,
        ret: Optional[date],
    ) -> tuple[list[GridCell], Optional[str]]:
        from playwright.async_api import async_playwright

        # Build the deep-link search URL. Google parses this human-readable
        # form and pre-fills/runs the search with no clicks needed.
        if ret:
            q = (
                f"Flights from {origin} to {destination} "
                f"on {_to_iso(dep)} through {_to_iso(ret)}"
            )
        else:
            q = f"Flights from {origin} to {destination} on {_to_iso(dep)}"
        from urllib.parse import quote
        url = f"https://www.google.com/travel/flights?q={quote(q)}"

        pw = await async_playwright().start()
        try:
            from .browser import get_proxy
            proxy = get_proxy("GOOGLE_FLIGHTS_PROXY") or get_proxy("GFLIGHTS_PROXY")

            launch_kw: dict = {
                "headless": self.headless,
                "args": [
                    "--window-position=-2400,-2400",
                    "--window-size=1440,900",
                    "--disable-blink-features=AutomationControlled",
                ],
            }
            if proxy:
                launch_kw["proxy"] = proxy

            browser = await pw.chromium.launch(**launch_kw)
            ctx = await browser.new_context(
                viewport={"width": 1440, "height": 900},
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/135.0.0.0 Safari/537.36"
                ),
                locale="en-US",
            )
            page = await ctx.new_page()
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=self.timeout_s * 1000)

                # Consent gate — Google may redirect to consent.google.com on
                # a fresh profile. Reject all to keep things minimal.
                if "consent.google.com" in page.url:
                    btn = page.locator("button:has-text('Reject all')").first
                    if await btn.count():
                        await btn.click()
                        await page.wait_for_url(re.compile(r"travel/flights"), timeout=8000)

                # Open the Date grid modal.
                grid_btn = page.locator("button:has-text('Date grid')").first
                await grid_btn.wait_for(state="visible", timeout=self.timeout_s * 1000)
                await grid_btn.click()

                # Wait for cells in the accessibility layer. We expect ≥ 30
                # priced cells under normal conditions; we'll accept as soon
                # as there are some + the "Loading prices" placeholders are
                # gone (or after a hard ceiling).
                deadline = time.monotonic() + self.timeout_s
                cells_raw: list[dict] = []
                currency: Optional[str] = None

                while time.monotonic() < deadline:
                    cells_raw = await page.eval_on_selector_all(
                        ".mrywM [role='button'][data-row][data-col]",
                        """nodes => nodes.map(n => ({
                            row: parseInt(n.dataset.row, 10),
                            col: parseInt(n.dataset.col, 10),
                            label: (n.getAttribute('aria-label') || '').replace(/\\u00a0/g, ' '),
                            cls: n.className || '',
                        }))""",
                    )
                    loading = await page.eval_on_selector_all(
                        ".mrywM [aria-label='Loading prices']",
                        "nodes => nodes.filter(n => !n.closest('[aria-hidden=\"true\"]')).length",
                    )
                    if cells_raw and loading == 0:
                        break
                    await asyncio.sleep(0.4)

                # Parse cells
                parsed: list[GridCell] = []
                anchor = dep if ret is None else dep + timedelta(
                    days=((ret - dep).days // 2)
                )
                for raw in cells_raw:
                    label = raw.get("label", "").strip()
                    if not label or label.startswith("no flights"):
                        continue
                    m = _GRID_CELL_LABEL_RE.match(label)
                    if not m:
                        continue
                    ccy, price_str, out_abbrev, ret_abbrev = m.groups()
                    price = _parse_price(price_str)
                    out_date = _resolve_abbrev_date(out_abbrev, dep)
                    ret_date_resolved = _resolve_abbrev_date(ret_abbrev, ret or dep)
                    if price is None or out_date is None or ret_date_resolved is None:
                        continue
                    currency = currency or ccy
                    parsed.append(
                        GridCell(
                            outbound_date=out_date,
                            return_date=ret_date_resolved,
                            price=price,
                            currency=ccy,
                            is_cheaper="pIviAd" not in raw.get("cls", "")
                            # NOTE: pIviAd marks cells styled as "less attractive";
                            # absence of the class = cheaper / typical. Inverting
                            # so is_cheaper = True means "Google considers this
                            # a good price".
                        )
                    )

                # de-anchor reference so the warning is clear if nothing parsed
                _ = anchor
                return parsed, currency
            finally:
                await ctx.close()
                await browser.close()
        finally:
            await pw.stop()
