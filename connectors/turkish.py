"""
Turkish Airlines (TK) CDP Chrome connector — form fill + availability API interception.

TK's booking widget is a Next.js micro-frontend (availability_mf) that fires
POST /api/v1/availability after the homepage form is submitted.  Direct API
calls are blocked by PerimeterX (crypto-challenge 428 → proof-of-work).
The ONLY reliable path is form-triggered requests.

Strategy (CDP Chrome + response interception):
1. Launch REAL Chrome (--remote-debugging-port, --user-data-dir).
2. Connect via Playwright CDP.  Context persists across searches.
3. Each search: new page → homepage → accept cookies → One-way toggle
   → fill origin → fill destination → pick date → click "Search flights".
4. Page navigates to /availability-international/ and fires availability API.
5. First call may return 428 (crypto challenge) — page auto-solves it.
6. Capture the 200 response from POST /api/v1/availability.
7. Parse originDestinationOptionList → FlightOffer for each flight.

API details (discovered Mar 2026):
  POST /api/v1/availability
  Response: {data: {originDestinationInformationList: [{
    originDestinationOptionList: [{  optionId, startingPrice,
      fareCategory, segmentList, journeyDuration, ...}]  }],
    originalCurrency, economyStartingPrice, ...}}
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import shutil
import subprocess
import time
from datetime import datetime, date as date_type
from typing import Optional

from models.flights import (
    FlightOffer,
    FlightRoute,
    FlightSearchRequest,
    FlightSearchResponse,
    FlightSegment,
)
from connectors.browser import find_chrome, stealth_popen_kwargs, _launched_procs

logger = logging.getLogger(__name__)

_DEBUG_PORT = 9453
_USER_DATA_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), ".tk_chrome_data"
)

_browser = None
_context = None
_pw_instance = None
_chrome_proc = None
_browser_lock: Optional[asyncio.Lock] = None


def _get_lock() -> asyncio.Lock:
    global _browser_lock
    if _browser_lock is None:
        _browser_lock = asyncio.Lock()
    return _browser_lock


async def _get_context():
    """Get or create a persistent browser context (headed — PX blocks headless)."""
    global _browser, _context, _pw_instance, _chrome_proc
    lock = _get_lock()
    async with lock:
        if _browser:
            try:
                if _browser.is_connected():
                    if _context:
                        try:
                            _ = _context.pages
                            return _context
                        except Exception:
                            pass
                    contexts = _browser.contexts
                    if contexts:
                        _context = contexts[0]
                        return _context
            except Exception:
                pass

        from playwright.async_api import async_playwright

        pw = None
        try:
            pw = await async_playwright().start()
            _browser = await pw.chromium.connect_over_cdp(
                f"http://127.0.0.1:{_DEBUG_PORT}"
            )
            _pw_instance = pw
            logger.info("TK: connected to existing Chrome on port %d", _DEBUG_PORT)
        except Exception:
            if pw:
                try:
                    await pw.stop()
                except Exception:
                    pass

            chrome = find_chrome()
            os.makedirs(_USER_DATA_DIR, exist_ok=True)
            args = [
                chrome,
                f"--remote-debugging-port={_DEBUG_PORT}",
                f"--user-data-dir={_USER_DATA_DIR}",
                "--no-first-run",
                "--no-default-browser-check",
                "--disable-blink-features=AutomationControlled",
                "--disable-http2",
                "--window-position=-2400,-2400",
                "--window-size=1400,900",
                "about:blank",
            ]
            _chrome_proc = subprocess.Popen(args, **stealth_popen_kwargs())
            _launched_procs.append(_chrome_proc)
            await asyncio.sleep(2.0)

            pw = await async_playwright().start()
            _pw_instance = pw
            _browser = await pw.chromium.connect_over_cdp(
                f"http://127.0.0.1:{_DEBUG_PORT}"
            )
            logger.info(
                "TK: Chrome launched headed on CDP port %d (pid %d)",
                _DEBUG_PORT, _chrome_proc.pid,
            )

        contexts = _browser.contexts
        _context = contexts[0] if contexts else await _browser.new_context()
        return _context


async def _reset_profile():
    """Wipe Chrome profile when PerimeterX flags the session beyond repair."""
    global _browser, _context, _pw_instance, _chrome_proc
    try:
        if _browser:
            await _browser.close()
    except Exception:
        pass
    try:
        if _pw_instance:
            await _pw_instance.stop()
    except Exception:
        pass
    if _chrome_proc:
        try:
            _chrome_proc.terminate()
        except Exception:
            pass
    _browser = None
    _context = None
    _pw_instance = None
    _chrome_proc = None
    if os.path.isdir(_USER_DATA_DIR):
        try:
            shutil.rmtree(_USER_DATA_DIR)
            logger.info("TK: deleted stale Chrome profile")
        except Exception:
            pass


# ── Date format helpers ──────────────────────────────────────────────────────

def _to_datetime(val) -> datetime:
    """Convert date or datetime to datetime."""
    if isinstance(val, datetime):
        return val
    if isinstance(val, date_type):
        return datetime(val.year, val.month, val.day)
    return datetime.strptime(str(val), "%Y-%m-%d")


def _parse_tk_datetime(s: str) -> datetime:
    """Parse TK datetime string like '28-03-2026 08:50'."""
    return datetime.strptime(s, "%d-%m-%Y %H:%M")


class TurkishConnectorClient:
    """Turkish Airlines CDP Chrome connector — form fill + availability interception."""

    def __init__(self, timeout: float = 45.0):
        self.timeout = timeout

    async def close(self):
        pass

    async def search_flights(self, req: FlightSearchRequest) -> FlightSearchResponse:
        t0 = time.monotonic()

        context = await _get_context()
        page = await context.new_page()

        avail_data: dict = {}
        px_blocked = False

        async def _on_response(response):
            nonlocal px_blocked
            url = response.url
            # Only capture the main availability endpoint (not validate, price-calendar, etc.)
            if "/api/v1/availability" not in url:
                return
            if any(x in url for x in ("validate", "price-calendar", "cheapest", "info-by-ond",
                                       "additional-services", "banner")):
                return
            status = response.status
            if status == 428:
                logger.info("TK: 428 crypto challenge — page will auto-solve")
                return
            if status == 403:
                px_blocked = True
                logger.warning("TK: PerimeterX 403 on availability")
                return
            if status == 200:
                try:
                    data = await response.json()
                    if isinstance(data, dict) and "data" in data:
                        inner = data["data"]
                        if "originDestinationInformationList" in inner:
                            avail_data.update(inner)
                            opts = inner.get("originDestinationInformationList", [{}])[0]
                            n = len(opts.get("originDestinationOptionList", []))
                            logger.info("TK: captured availability — %d options", n)
                except Exception as e:
                    logger.warning("TK: failed to parse availability: %s", e)

        page.on("response", _on_response)

        try:
            logger.info("TK: loading homepage for %s->%s", req.origin, req.destination)
            await page.goto(
                "https://www.turkishairlines.com/en-int/",
                wait_until="domcontentloaded",
                timeout=int(self.timeout * 1000),
            )
            await asyncio.sleep(5.0)

            # Accept cookies
            await self._dismiss_cookies(page)
            await asyncio.sleep(1.0)

            # One-way toggle
            try:
                ow = page.locator("span:has-text('One way')").first
                if await ow.count() > 0:
                    await ow.click(timeout=3000)
                    logger.info("TK: One-way selected")
            except Exception:
                pass
            await asyncio.sleep(0.5)

            # Fill form
            ok = await self._fill_form(page, req)
            if not ok:
                logger.warning("TK: form fill failed")
                return self._empty(req)

            # Click Search
            try:
                btn = page.locator("button:has-text('Search flights')").first
                if await btn.count() > 0 and not await btn.is_disabled():
                    async with page.expect_navigation(timeout=30000, wait_until="domcontentloaded"):
                        await btn.click(timeout=5000)
                    logger.info("TK: search clicked, navigated")
                else:
                    logger.warning("TK: search button disabled or missing")
                    return self._empty(req)
            except Exception as e:
                logger.warning("TK: search click/nav: %s", e)

            # Wait for the availability response (may take time due to crypto challenge)
            remaining = max(self.timeout - (time.monotonic() - t0), 15)
            deadline = time.monotonic() + remaining
            while not avail_data and not px_blocked and time.monotonic() < deadline:
                await asyncio.sleep(0.5)

            if px_blocked:
                logger.warning("TK: PerimeterX blocked, resetting profile")
                await _reset_profile()
                return self._empty(req)

            if not avail_data:
                logger.warning("TK: no availability data captured")
                return self._empty(req)

            offers = self._parse_availability(avail_data, req)
            offers.sort(key=lambda o: o.price)

            currency = avail_data.get("originalCurrency", "TRY")
            elapsed = time.monotonic() - t0
            logger.info(
                "TK %s->%s returned %d offers in %.1fs",
                req.origin, req.destination, len(offers), elapsed,
            )

            search_hash = hashlib.md5(
                f"tk{req.origin}{req.destination}{req.date_from}".encode()
            ).hexdigest()[:12]

            return FlightSearchResponse(
                search_id=f"fs_{search_hash}",
                origin=req.origin,
                destination=req.destination,
                currency=currency,
                offers=offers,
                total_results=len(offers),
            )

        except Exception as e:
            logger.error("TK CDP error: %s", e)
            return self._empty(req)
        finally:
            try:
                await page.close()
            except Exception:
                pass

    # ------------------------------------------------------------------
    # Cookies
    # ------------------------------------------------------------------

    async def _dismiss_cookies(self, page) -> None:
        try:
            btn = page.locator("#allowCookiesButton")
            if await btn.count() > 0:
                await btn.first.click(timeout=3000)
                logger.info("TK: cookies accepted")
                await asyncio.sleep(0.5)
        except Exception:
            pass

    # ------------------------------------------------------------------
    # Form fill
    # ------------------------------------------------------------------

    async def _fill_form(self, page, req: FlightSearchRequest) -> bool:
        """Fill TK search form: origin, destination, date."""
        # Origin
        ok = await self._fill_airport(page, "#fromPort", req.origin)
        if not ok:
            return False
        await asyncio.sleep(0.8)

        # Destination
        ok = await self._fill_airport(page, "#toPort", req.destination)
        if not ok:
            return False
        await asyncio.sleep(0.8)

        # Date
        ok = await self._fill_date(page, req.date_from)
        if not ok:
            return False
        await asyncio.sleep(0.5)
        return True

    async def _fill_airport(self, page, selector: str, iata: str) -> bool:
        """Fill an airport typeahead and select first match."""
        try:
            field = page.locator(selector)
            await field.click(timeout=5000)
            await asyncio.sleep(0.3)
            await field.click(click_count=3)
            await asyncio.sleep(0.1)
            await field.fill("")
            await asyncio.sleep(0.1)
            await field.type(iata, delay=80)
            await asyncio.sleep(2.0)

            # Click first dropdown option
            opt = page.locator("[role='option']").first
            if await opt.count() > 0:
                await opt.click(timeout=3000)
                value = await field.input_value()
                logger.info("TK: filled %s -> %s", selector, value)
                return True

            # Keyboard fallback
            await field.press("ArrowDown")
            await asyncio.sleep(0.2)
            await field.press("Enter")
            await asyncio.sleep(0.5)
            value = await field.input_value()
            if value and len(value) > 1:
                logger.info("TK: filled %s -> %s (keyboard)", selector, value)
                return True

            logger.warning("TK: could not fill %s for %s", selector, iata)
            return False
        except Exception as e:
            logger.warning("TK: airport fill error %s: %s", selector, e)
            return False

    async def _fill_date(self, page, dep_date) -> bool:
        """Pick the departure date in the react-calendar widget."""
        dt = _to_datetime(dep_date)
        target_day = str(dt.day)
        target_month = dt.strftime("%B")  # e.g. "March"
        target_year = str(dt.year)

        try:
            # Calendar should be open after destination selection.
            # If not, click the date area to open it.
            cal = page.locator(".react-calendar")
            if await cal.count() == 0:
                # Try clicking the date input area
                date_area = page.locator("[class*='calendar-placeholder'], [class*='calendarValue']").first
                if await date_area.count() > 0:
                    await date_area.click(timeout=3000)
                    await asyncio.sleep(1.0)

            # Navigate calendar to the correct month
            for _ in range(12):
                nav_label = page.locator(".react-calendar__navigation__label").first
                if await nav_label.count() > 0:
                    label_text = await nav_label.text_content()
                    if target_month in label_text and target_year in label_text:
                        break
                    # Click next month arrow
                    next_btn = page.locator(".react-calendar__navigation__next-button").first
                    if await next_btn.count() > 0:
                        await next_btn.click(timeout=2000)
                        await asyncio.sleep(0.3)
                else:
                    break

            # Click the target day — use aria-label or exact text match
            # react-calendar day buttons have class react-calendar__tile
            day_tiles = page.locator("button.react-calendar__tile")
            count = await day_tiles.count()
            for i in range(count):
                tile = day_tiles.nth(i)
                text = (await tile.text_content() or "").strip()
                if text == target_day:
                    await tile.click(timeout=2000)
                    logger.info("TK: selected date %s %s %s", target_day, target_month, target_year)
                    return True

            # Fallback: find button with matching text
            day_btn = page.locator(f"button:has-text('{target_day}')").first
            if await day_btn.count() > 0 and await day_btn.is_visible(timeout=1000):
                await day_btn.click(timeout=2000)
                logger.info("TK: selected date via text match")
                return True

            logger.warning("TK: could not select date %s", dt.strftime("%Y-%m-%d"))
            return False
        except Exception as e:
            logger.warning("TK: date fill error: %s", e)
            return False

    # ------------------------------------------------------------------
    # Response parsing
    # ------------------------------------------------------------------

    def _parse_availability(self, data: dict, req: FlightSearchRequest) -> list[FlightOffer]:
        """Parse availability response into FlightOffers."""
        offers: list[FlightOffer] = []
        currency = data.get("originalCurrency", "TRY")

        odil = data.get("originDestinationInformationList", [])
        if not odil:
            return offers

        option_list = odil[0].get("originDestinationOptionList", [])
        for opt in option_list:
            if opt.get("soldOut"):
                continue

            sp = opt.get("startingPrice", {})
            price = sp.get("amount", 0)
            cur = sp.get("currencyCode", currency)
            if price <= 0:
                continue

            seg_list = opt.get("segmentList", [])
            if not seg_list:
                continue

            segments = []
            for seg in seg_list:
                fc = seg.get("flightCode", {})
                airline_code = fc.get("airlineCode", "TK")
                flight_number = fc.get("flightNumber", "")
                dep_dt = _parse_tk_datetime(seg["departureDateTime"])
                arr_dt = _parse_tk_datetime(seg["arrivalDateTime"])
                dur_ms = seg.get("journeyDurationInMillis", 0)

                segments.append(FlightSegment(
                    airline=airline_code,
                    airline_name="Turkish Airlines" if airline_code == "TK" else airline_code,
                    flight_no=f"{airline_code}{flight_number}",
                    origin=seg["departureAirportCode"],
                    destination=seg["arrivalAirportCode"],
                    departure=dep_dt,
                    arrival=arr_dt,
                    duration_seconds=dur_ms // 1000,
                    cabin_class="economy",
                    aircraft=seg.get("equipmentName", ""),
                ))

            total_dur = opt.get("journeyDuration", 0) // 1000
            stopovers = max(len(segments) - 1, 0)

            route = FlightRoute(
                segments=segments,
                total_duration_seconds=total_dur,
                stopovers=stopovers,
            )

            oid = opt.get("optionId", 0)
            offer_id = hashlib.md5(
                f"tk_{req.origin}_{req.destination}_{oid}_{price}".encode()
            ).hexdigest()[:12]

            all_airlines = list({s.airline for s in segments})

            offers.append(FlightOffer(
                id=f"tk_{offer_id}",
                price=price,
                currency=cur,
                price_formatted=f"{price:,.0f} {cur}",
                outbound=route,
                inbound=None,
                airlines=[("Turkish Airlines" if a == "TK" else a) for a in all_airlines],
                owner_airline="TK",
                booking_url=self._booking_url(req),
                is_locked=False,
                source="turkish_direct",
                source_tier="free",
            ))

        return offers

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _booking_url(req: FlightSearchRequest) -> str:
        dt = _to_datetime(req.date_from)
        date_str = dt.strftime("%d-%m-%Y")
        adults = req.adults or 1
        return (
            f"https://www.turkishairlines.com/en-int/flights/booking/"
            f"availability-international/"
            f"?originAirportCode={req.origin}"
            f"&destinationAirportCode={req.destination}"
            f"&departureDate={date_str}"
            f"&adult={adults}"
        )

    def _empty(self, req: FlightSearchRequest) -> FlightSearchResponse:
        search_hash = hashlib.md5(
            f"tk{req.origin}{req.destination}{req.date_from}".encode()
        ).hexdigest()[:12]
        return FlightSearchResponse(
            search_id=f"fs_{search_hash}",
            origin=req.origin,
            destination=req.destination,
            currency=req.currency,
            offers=[],
            total_results=0,
        )
