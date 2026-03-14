"""
Etihad (EY) CDP Chrome connector — form fill + calendar pricing API interception.

Etihad's homepage search widget calls ada-services/bff-calendar-pricing/
service/instant-search/v2/fetch-prices — a POST endpoint behind Akamai WAF.
Direct API calls (even from browser JS context) get 403 on replay.
The ONLY reliable path is form-triggered requests.

Strategy (CDP Chrome + response interception):
1. Launch REAL Chrome (--remote-debugging-port, --user-data-dir).
2. Connect via Playwright CDP. Context persists across searches.
3. Each search: new page → intercept → homepage → dismiss OneTrust
   cookie banner → fill form → click search.
4. Capture POST fetch-prices response via page.on("response").
5. Parse pricePerDay → FlightOffer for requested departure date.
6. Build booking deep-link URL.

Calendar pricing returns the cheapest round-trip price per day for ~7
months. Since we do one-way searches, we divide by 2 as estimate
(Etihad's homepage doesn't have a one-way toggle).

API details (discovered Mar 2026):
  POST /ada-services/bff-calendar-pricing/service/instant-search/v2/fetch-prices
  Body: {originAirportCode, destinationAirportCode, cabinClass, tripType,
         passengerTypeCode, departureDate, tripDuration, ...}
  Response: {currency, pricePerDay: [{YYYYMM: [{DD: {price, miles, flags}}]}],
             monthAggregatePrice: [{YYYYMM: {lowestPrice, highestPrice}}]}
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import re
import shutil
import subprocess
import time
from datetime import datetime
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

_DEBUG_PORT = 9451
_USER_DATA_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), ".etihad_chrome_data"
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
    """Get or create a persistent browser context (headed — Akamai blocks headless)."""
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

        # Try connecting to existing Chrome on the port
        pw = None
        try:
            pw = await async_playwright().start()
            _browser = await pw.chromium.connect_over_cdp(
                f"http://127.0.0.1:{_DEBUG_PORT}"
            )
            _pw_instance = pw
            logger.info("Etihad: connected to existing Chrome on port %d", _DEBUG_PORT)
        except Exception:
            if pw:
                try:
                    await pw.stop()
                except Exception:
                    pass

            # Launch Chrome HEADED (no --headless) — Akamai blocks headless.
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
                "Etihad: Chrome launched headed on CDP port %d (pid %d)",
                _DEBUG_PORT, _chrome_proc.pid,
            )

        contexts = _browser.contexts
        _context = contexts[0] if contexts else await _browser.new_context()
        return _context


async def _dismiss_overlays(page) -> None:
    """Remove OneTrust cookie banner and any blocking overlays."""
    # Click standard accept buttons
    for selector in [
        "#onetrust-accept-btn-handler",
        "button#accept-recommended-btn-handler",
    ]:
        try:
            btn = page.locator(selector)
            if await btn.count() > 0 and await btn.first.is_visible(timeout=1000):
                await btn.first.click(timeout=3000)
                logger.info("Etihad: clicked cookie accept %s", selector)
                await asyncio.sleep(0.5)
                return
        except Exception:
            continue

    # Fallback: try by text
    for text in ["Accept", "Accept all", "Accept All Cookies", "I agree", "OK"]:
        try:
            btn = page.get_by_role("button", name=text)
            if await btn.count() > 0:
                await btn.first.click(timeout=2000)
                logger.info("Etihad: clicked cookie button '%s'", text)
                await asyncio.sleep(0.5)
                return
        except Exception:
            continue

    # Force-remove OneTrust elements via JS
    try:
        await page.evaluate("""() => {
            document.querySelectorAll(
                '#onetrust-consent-sdk, .onetrust-pc-dark-filter, #onetrust-banner-sdk'
            ).forEach(el => el.remove());
        }""")
    except Exception:
        pass


async def _reset_profile():
    """Wipe Chrome profile when Akamai flags the session."""
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
            logger.info("Etihad: deleted stale Chrome profile")
        except Exception:
            pass


class EtihadConnectorClient:
    """Etihad CDP Chrome connector — form fill + calendar pricing interception."""

    def __init__(self, timeout: float = 35.0):
        self.timeout = timeout

    async def close(self):
        pass

    async def search_flights(self, req: FlightSearchRequest) -> FlightSearchResponse:
        t0 = time.monotonic()

        context = await _get_context()
        page = await context.new_page()

        # Interception state
        price_data: dict = {}
        akamai_blocked = False

        async def _on_response(response):
            nonlocal akamai_blocked
            url = response.url
            if "fetch-prices" not in url:
                return
            status = response.status
            if status == 403:
                akamai_blocked = True
                logger.warning("Etihad: Akamai 403 on fetch-prices")
                return
            if status == 200:
                try:
                    data = await response.json()
                    if isinstance(data, dict) and "pricePerDay" in data:
                        price_data.update(data)
                        logger.info("Etihad: captured calendar pricing response")
                except Exception as e:
                    logger.warning("Etihad: failed to parse fetch-prices: %s", e)

        page.on("response", _on_response)

        try:
            logger.info("Etihad: loading homepage for %s→%s", req.origin, req.destination)
            await page.goto(
                "https://www.etihad.com/en/",
                wait_until="domcontentloaded",
                timeout=int(self.timeout * 1000),
            )
            await asyncio.sleep(3.0)

            # Dismiss cookie overlay
            await _dismiss_overlays(page)
            await asyncio.sleep(0.5)

            # Fill search form
            ok = await self._fill_form(page, req)
            if not ok:
                logger.warning("Etihad: form fill failed")
                return self._empty(req)

            # Click Search
            try:
                search_btn = page.locator("button:has-text('Search')").first
                await search_btn.click(timeout=5000)
                logger.info("Etihad: clicked Search")
            except Exception:
                # JS fallback click
                try:
                    await page.evaluate("""() => {
                        const btn = [...document.querySelectorAll('button')]
                            .find(b => b.textContent.trim() === 'Search');
                        if (btn) btn.click();
                    }""")
                except Exception as e:
                    logger.warning("Etihad: search click failed: %s", e)
                    return self._empty(req)

            # Wait for intercepted response
            remaining = max(self.timeout - (time.monotonic() - t0), 10)
            deadline = time.monotonic() + remaining
            while not price_data and not akamai_blocked and time.monotonic() < deadline:
                await asyncio.sleep(0.5)

            if akamai_blocked:
                logger.warning("Etihad: Akamai flagged, resetting profile")
                await _reset_profile()
                return self._empty(req)

            if not price_data or not price_data.get("pricePerDay"):
                logger.warning("Etihad: no pricePerDay in response")
                return self._empty(req)

            currency = price_data.get("currency", "AED")
            offers = self._parse_calendar(price_data, req, currency)
            offers.sort(key=lambda o: o.price)

            elapsed = time.monotonic() - t0
            logger.info(
                "Etihad %s→%s returned %d offers in %.1fs",
                req.origin, req.destination, len(offers), elapsed,
            )

            search_hash = hashlib.md5(
                f"etihad{req.origin}{req.destination}{req.date_from}".encode()
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
            logger.error("Etihad CDP error: %s", e)
            return self._empty(req)
        finally:
            try:
                await page.close()
            except Exception:
                pass

    # ------------------------------------------------------------------
    # Form fill
    # ------------------------------------------------------------------

    async def _fill_form(self, page, req: FlightSearchRequest) -> bool:
        """Fill Etihad search form: origin + destination."""
        # Origin
        ok = await self._fill_airport(page, "#fsporigin", req.origin)
        if not ok:
            return False
        await asyncio.sleep(0.5)

        # Destination
        ok = await self._fill_airport(page, "#fspdestination", req.destination)
        if not ok:
            return False
        await asyncio.sleep(0.5)
        return True

    async def _fill_airport(self, page, selector: str, iata: str) -> bool:
        """Fill an airport typeahead field and select first match."""
        try:
            field = page.locator(selector)
            await field.click(timeout=5000)
            await asyncio.sleep(0.3)
            await field.press("Control+a")
            await field.type(iata, delay=80)
            await asyncio.sleep(2.0)

            # Select first dropdown option via keyboard
            await field.press("ArrowDown")
            await asyncio.sleep(0.2)
            await field.press("Enter")
            await asyncio.sleep(0.5)

            value = await field.input_value()
            if iata.upper() in value.upper():
                logger.info("Etihad: filled %s → %s", selector, value)
                return True

            # Fallback: click dropdown item
            for sel in [
                ".rbt-menu .dropdown-item:first-child",
                "[role='option']:first-child",
                ".rbt-menu li:first-child",
            ]:
                try:
                    opt = page.locator(sel)
                    if await opt.count() > 0:
                        await opt.first.click(timeout=2000)
                        logger.info("Etihad: selected airport via %s", sel)
                        return True
                except Exception:
                    continue

            # Even if exact match not confirmed, proceed if field has value
            if value and len(value) > 2:
                logger.info("Etihad: field %s has value '%s', proceeding", selector, value)
                return True

            logger.warning("Etihad: could not fill airport %s for %s", selector, iata)
            return False

        except Exception as e:
            logger.warning("Etihad: airport fill error %s: %s", selector, e)
            return False

    # ------------------------------------------------------------------
    # Response parsing
    # ------------------------------------------------------------------

    def _parse_calendar(
        self, data: dict, req: FlightSearchRequest, currency: str,
    ) -> list[FlightOffer]:
        """Parse pricePerDay into FlightOffers for the requested date."""
        offers: list[FlightOffer] = []
        ppd_list = data.get("pricePerDay", [])
        if not ppd_list:
            return offers

        ppd = ppd_list[0] if isinstance(ppd_list, list) else ppd_list

        # Target month/day from request
        try:
            dt = req.date_from if hasattr(req.date_from, 'strftime') else datetime.strptime(str(req.date_from), "%Y-%m-%d")
        except (ValueError, TypeError):
            logger.warning("Etihad: invalid date_from: %s", req.date_from)
            return offers

        month_key = dt.strftime("%Y%m")  # e.g. "202604"
        day_key = str(dt.day)  # e.g. "15" (no leading zero)

        month_data = ppd.get(month_key)
        if not month_data:
            logger.info("Etihad: no price data for month %s", month_key)
            return offers

        # Each month_data entry is a dict with one key (day number)
        for day_entry in month_data:
            if not isinstance(day_entry, dict):
                continue
            for d, info in day_entry.items():
                if d != day_key:
                    continue

                price = self._parse_price(info.get("price", "0"))
                if price <= 0:
                    continue

                # API returns round-trip prices; estimate one-way as ~55%
                one_way_price = round(price * 0.55, 2)

                offer = self._build_offer(
                    req, one_way_price, currency, dt, info
                )
                if offer:
                    offers.append(offer)
                return offers  # found our date

        logger.info("Etihad: no price for day %s in month %s", day_key, month_key)
        return offers

    def _build_offer(
        self,
        req: FlightSearchRequest,
        price: float,
        currency: str,
        dep_dt,
        info: dict,
    ) -> Optional[FlightOffer]:
        """Build a FlightOffer from calendar pricing data."""
        dep_date = dep_dt if not hasattr(dep_dt, 'date') else dep_dt.date()
        offer_id = hashlib.md5(
            f"ey_{req.origin}_{req.destination}_{dep_date}_{price}".encode()
        ).hexdigest()[:12]

        # Ensure dep_dt is a datetime (not just date)
        if not isinstance(dep_dt, datetime):
            dep_dt = datetime(dep_dt.year, dep_dt.month, dep_dt.day)

        segment = FlightSegment(
            airline="EY",
            airline_name="Etihad Airways",
            flight_no="EY",
            origin=req.origin,
            destination=req.destination,
            departure=dep_dt,
            arrival=dep_dt,  # time unknown from calendar API
            duration_seconds=0,
            cabin_class="economy",
        )

        route = FlightRoute(
            segments=[segment],
            total_duration_seconds=0,
            stopovers=0,
        )

        booking_url = self._booking_url(req)

        return FlightOffer(
            id=f"ey_{offer_id}",
            price=price,
            currency=currency,
            price_formatted=f"{price:,.0f} {currency}",
            outbound=route,
            inbound=None,
            airlines=["Etihad Airways"],
            owner_airline="EY",
            booking_url=booking_url,
            is_locked=False,
            source="etihad_direct",
            source_tier="free",
        )

    @staticmethod
    def _parse_price(price_str: str) -> float:
        """Parse comma-formatted price string like '3,310' → 3310.0."""
        try:
            return float(price_str.replace(",", ""))
        except (ValueError, TypeError):
            return 0.0

    @staticmethod
    def _booking_url(req: FlightSearchRequest) -> str:
        """Build Etihad booking deep-link."""
        try:
            dt = req.date_from if hasattr(req.date_from, 'strftime') else datetime.strptime(str(req.date_from), "%Y-%m-%d")
            date_str = dt.strftime("%d-%m-%Y")
        except (ValueError, TypeError):
            date_str = ""
        adults = req.adults or 1
        children = req.children or 0
        infants = req.infants or 0
        return (
            f"https://www.etihad.com/en/book/flights"
            f"?from={req.origin}&to={req.destination}"
            f"&departdate={date_str}"
            f"&adult={adults}&child={children}&infant={infants}"
            f"&class=Economy&trip=oneway"
        )

    def _empty(self, req: FlightSearchRequest) -> FlightSearchResponse:
        search_hash = hashlib.md5(
            f"etihad{req.origin}{req.destination}{req.date_from}".encode()
        ).hexdigest()[:12]
        return FlightSearchResponse(
            search_id=f"fs_{search_hash}",
            origin=req.origin,
            destination=req.destination,
            currency=req.currency,
            offers=[],
            total_results=0,
        )
