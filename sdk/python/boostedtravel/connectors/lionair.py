"""
Lion Air hybrid scraper — direct API (primary) + Playwright CDP fallback.

Lion Air (IATA: JT) is Indonesia's largest private airline group,
operating domestic and regional flights across SE Asia. Uses an IBE2
booking platform at secure2.lionair.co.id (previously booking.lionair.co.id
which is now defunct — ERR_CONNECTION_REFUSED).

Strategy (hybrid — direct API first, browser fallback):
1. (Primary) curl_cffi POST to search/availability endpoints (~1-3s).
   Try multiple base URLs (secure2.lionair.co.id, www.lionair.co.id).
   If direct API returns 403/challenge, use cookie-farm: Playwright generates
   cookies, curl_cffi reuses them for subsequent API calls.
   Cookies refreshed every ~20 minutes.
2. (Fallback) Playwright — navigate to secure2.lionair.co.id/lionairibe2/
   OnlineBooking.aspx with pre-filled search params, intercept API responses
   or scrape DOM for flight results.

Booking URL deep-link (discovered Mar 2026):
  https://secure2.lionair.co.id/lionairibe2/OnlineBooking.aspx
    ?depart=CGK&dest.1=DPS&trip_type=one+way
    &date.0=15Jun&date.1=&persons.0=1&persons.1=0&persons.2=0

Result: ~1-3s per search (API) instead of ~5-15s with full Playwright.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import random
import re
import time
from datetime import datetime
from typing import Any, Optional

try:
    from curl_cffi import requests as curl_requests
    HAS_CURL = True
except ImportError:
    HAS_CURL = False

from boostedtravel.models.flights import (
    FlightOffer,
    FlightRoute,
    FlightSearchRequest,
    FlightSearchResponse,
    FlightSegment,
)

logger = logging.getLogger(__name__)

_VIEWPORTS = [
    {"width": 1366, "height": 768},
    {"width": 1440, "height": 900},
    {"width": 1536, "height": 864},
    {"width": 1920, "height": 1080},
    {"width": 1280, "height": 720},
]
_LOCALES = ["en-US", "en-GB", "en-ID", "en-SG"]
_TIMEZONES = [
    "Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura",
    "Asia/Singapore", "Asia/Kuala_Lumpur",
]

_BOOKING_BASE = "https://secure2.lionair.co.id"
_MAIN_BASE = "https://www.lionair.co.id"

_SEARCH_URLS = [
    # New IBE2 booking platform (replaced defunct booking.lionair.co.id)
    f"{_BOOKING_BASE}/lionairibe2/api/search",
    f"{_BOOKING_BASE}/lionairibe2/api/availability",
    f"{_BOOKING_BASE}/api/search",
    f"{_BOOKING_BASE}/api/availability",
    # Main site may expose API endpoints
    f"{_MAIN_BASE}/api/search",
    f"{_MAIN_BASE}/api/availability",
]
_IMPERSONATE = "chrome131"
_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
_COOKIE_MAX_AGE = 20 * 60  # Re-farm cookies after 20 minutes

# ── Shared cookie farm state ───────────────────────────────────────────
_farm_lock: Optional[asyncio.Lock] = None
_farmed_cookies: list[dict] = []
_farm_timestamp: float = 0.0

# ── Shared browser singleton (Playwright-managed, for cookie farming + fallback)
_browser = None
_browser_lock: Optional[asyncio.Lock] = None


def _get_lock() -> asyncio.Lock:
    global _browser_lock
    if _browser_lock is None:
        _browser_lock = asyncio.Lock()
    return _browser_lock


def _get_farm_lock() -> asyncio.Lock:
    global _farm_lock
    if _farm_lock is None:
        _farm_lock = asyncio.Lock()
    return _farm_lock


async def _get_browser():
    """Shared headed Chromium (launched once, reused for cookie farming + fallback)."""
    global _browser
    lock = _get_lock()
    async with lock:
        if _browser and _browser.is_connected():
            return _browser

        from boostedtravel.connectors.browser import launch_headed_browser
        _browser = await launch_headed_browser()
        logger.info("LionAir: browser launched for hybrid flow")
        return _browser


class LionAirConnectorClient:
    """LionAir hybrid scraper — direct API + Playwright CDP fallback."""

    def __init__(self, timeout: float = 45.0):
        self.timeout = timeout

    async def close(self):
        pass  # Browser is shared singleton

    async def search_flights(self, req: FlightSearchRequest) -> FlightSearchResponse:
        """
        Search Lion Air flights via hybrid direct API + Playwright fallback.

        Fast path (~1-3s): curl_cffi direct POST to search endpoint.
        Cookie-farm path (~5s first time): Playwright farms cookies,
            then curl_cffi reuses them for API calls.
        Fallback (~5-15s): Full Playwright interception if API is unreachable.
        """
        t0 = time.monotonic()

        # ── Primary: direct API via curl_cffi ──
        if HAS_CURL:
            try:
                offers = await self._search_via_api(req)
                if offers:
                    elapsed = time.monotonic() - t0
                    logger.info(
                        "LionAir API %s->%s: %d offers in %.1fs",
                        req.origin, req.destination, len(offers), elapsed,
                    )
                    return self._build_response(offers, req, elapsed)
                logger.info("LionAir: direct API returned no offers, trying cookie-farm")
            except Exception as e:
                logger.warning("LionAir: direct API error: %s — trying cookie-farm", e)

            # ── Cookie-farm path: farm cookies then retry API ──
            try:
                cookies = await self._ensure_cookies(req)
                if cookies:
                    offers = await self._search_via_api(req, cookies=cookies)
                    if offers:
                        elapsed = time.monotonic() - t0
                        logger.info(
                            "LionAir API+cookies %s->%s: %d offers in %.1fs",
                            req.origin, req.destination, len(offers), elapsed,
                        )
                        return self._build_response(offers, req, elapsed)

                    # Re-farm once and retry
                    logger.info("LionAir: cookie API failed, re-farming")
                    cookies = await self._farm_cookies(req)
                    if cookies:
                        offers = await self._search_via_api(req, cookies=cookies)
                        if offers:
                            elapsed = time.monotonic() - t0
                            logger.info(
                                "LionAir API+refarm %s->%s: %d offers in %.1fs",
                                req.origin, req.destination, len(offers), elapsed,
                            )
                            return self._build_response(offers, req, elapsed)
            except Exception as e:
                logger.warning("LionAir: cookie-farm path error: %s", e)

        # ── Fallback: Full Playwright interception ──
        logger.info("LionAir: falling back to Playwright for %s->%s", req.origin, req.destination)
        try:
            return await self._playwright_fallback(req, t0)
        except Exception as e:
            logger.error("LionAir Playwright fallback error: %s", e)
            return self._empty(req)

    # ------------------------------------------------------------------
    # Direct API via curl_cffi
    # ------------------------------------------------------------------

    async def _search_via_api(
        self, req: FlightSearchRequest, cookies: list[dict] | None = None,
    ) -> list[FlightOffer] | None:
        """POST to search endpoint via curl_cffi. Returns offers or None."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None, self._api_search_sync, req, cookies,
        )

    def _api_search_sync(
        self, req: FlightSearchRequest, cookies: list[dict] | None = None,
    ) -> list[FlightOffer] | None:
        """Synchronous curl_cffi POST to search endpoint."""
        sess = curl_requests.Session(impersonate=_IMPERSONATE)

        if cookies:
            for c in cookies:
                domain = c.get("domain", "")
                sess.cookies.set(c["name"], c["value"], domain=domain)

        body = {
            "origin": req.origin,
            "destination": req.destination,
            "departureDate": req.date_from.strftime("%Y-%m-%d"),
            "adults": getattr(req, "adults", 1) or 1,
            "children": getattr(req, "children", 0) or 0,
            "infants": getattr(req, "infants", 0) or 0,
            "tripType": "OW",
            "cabin": "Economy",
            "currency": req.currency or "IDR",
        }

        headers = {
            "User-Agent": _UA,
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
            "Content-Type": "application/json",
            "Origin": _BOOKING_BASE,
            "Referer": f"{_BOOKING_BASE}/",
        }

        for url in _SEARCH_URLS:
            try:
                r = sess.post(
                    url,
                    json=body,
                    headers=headers,
                    timeout=15,
                )
            except Exception as e:
                logger.debug("LionAir API: %s failed: %s", url, e)
                continue

            if r.status_code == 403:
                logger.debug("LionAir API: 403 at %s (Cloudflare challenge)", url)
                continue
            if r.status_code != 200:
                logger.debug("LionAir API: HTTP %d at %s", r.status_code, url)
                continue

            try:
                data = r.json()
            except (ValueError, TypeError):
                logger.debug("LionAir API: non-JSON response from %s", url)
                continue

            if data and isinstance(data, (dict, list)):
                offers = self._parse_response(data, req)
                if offers:
                    return offers

        return None

    # ------------------------------------------------------------------
    # Cookie farm — Playwright generates Cloudflare cookies
    # ------------------------------------------------------------------

    async def _ensure_cookies(self, req: FlightSearchRequest) -> list[dict]:
        """Return valid farmed cookies, farming new ones if needed."""
        global _farmed_cookies, _farm_timestamp
        lock = _get_farm_lock()
        async with lock:
            age = time.monotonic() - _farm_timestamp
            if _farmed_cookies and age < _COOKIE_MAX_AGE:
                return _farmed_cookies
            return await self._farm_cookies(req)

    async def _farm_cookies(self, req: FlightSearchRequest) -> list[dict]:
        """Open Playwright, visit booking site, extract cookies."""
        global _farmed_cookies, _farm_timestamp

        browser = await _get_browser()
        context = await browser.new_context(
            viewport=random.choice(_VIEWPORTS),
            locale=random.choice(_LOCALES),
            timezone_id=random.choice(_TIMEZONES),
            service_workers="block",
        )

        try:
            try:
                from playwright_stealth import stealth_async
                page = await context.new_page()
                await stealth_async(page)
            except ImportError:
                page = await context.new_page()

            logger.info("LionAir: farming cookies via %s", _BOOKING_BASE)
            await page.goto(
                _BOOKING_BASE,
                wait_until="domcontentloaded",
                timeout=30000,
            )
            await asyncio.sleep(3)
            await self._dismiss_cookies(page)

            cookies = await context.cookies()
            _farmed_cookies = cookies
            _farm_timestamp = time.monotonic()
            logger.info("LionAir: farmed %d cookies", len(cookies))
            return cookies

        except Exception as e:
            logger.error("LionAir: cookie farm error: %s", e)
            return []
        finally:
            await context.close()

    # ------------------------------------------------------------------
    # Playwright fallback (full browser flow, used if API fails)
    # ------------------------------------------------------------------

    async def _playwright_fallback(
        self, req: FlightSearchRequest, t0: float,
    ) -> FlightSearchResponse:
        """Full Playwright interception flow as fallback."""
        browser = await _get_browser()
        context = await browser.new_context(
            viewport=random.choice(_VIEWPORTS),
            locale=random.choice(_LOCALES),
            timezone_id=random.choice(_TIMEZONES),
            service_workers="block",
        )

        try:
            try:
                from playwright_stealth import stealth_async
                page = await context.new_page()
                await stealth_async(page)
            except ImportError:
                page = await context.new_page()

            captured_data: dict = {}
            api_event = asyncio.Event()

            async def on_response(response):
                try:
                    url = response.url.lower()
                    if response.status == 200 and (
                        "availability" in url
                        or "navi" in url
                        or "nskts" in url
                        or "/api/search" in url
                        or "flights/search" in url
                        or "search/flights" in url
                        or "fares" in url
                        or "offers" in url
                        or "low-fare" in url
                        or "booking/search" in url
                        or "goquo" in url
                        or "flight-search" in url
                        or "lionairibe" in url
                        or "onlinebooking" in url
                        or "getflights" in url
                        or "flightresult" in url
                        or "searchresult" in url
                    ):
                        ct = response.headers.get("content-type", "")
                        if "json" in ct:
                            data = await response.json()
                            if data and isinstance(data, (dict, list)):
                                captured_data["json"] = data
                                api_event.set()
                except Exception:
                    pass

            page.on("response", on_response)

            booking_url = self._build_deep_link(req)
            logger.info("LionAir: Playwright fallback for %s->%s", req.origin, req.destination)
            await page.goto(
                booking_url,
                wait_until="domcontentloaded",
                timeout=int(self.timeout * 1000),
            )
            await asyncio.sleep(3.0)

            await self._dismiss_cookies(page)
            await asyncio.sleep(0.5)
            await self._dismiss_cookies(page)

            await self._set_one_way(page)
            await asyncio.sleep(0.5)

            ok = await self._fill_airport_field(page, "From", req.origin, 0)
            if not ok:
                logger.warning("LionAir: origin fill failed")
                return self._empty(req)
            await asyncio.sleep(0.5)

            ok = await self._fill_airport_field(page, "To", req.destination, 1)
            if not ok:
                logger.warning("LionAir: destination fill failed")
                return self._empty(req)
            await asyncio.sleep(0.5)

            ok = await self._fill_date(page, req)
            if not ok:
                logger.warning("LionAir: date fill failed")
                return self._empty(req)
            await asyncio.sleep(0.3)

            await self._click_search(page)

            remaining = max(self.timeout - (time.monotonic() - t0), 10)
            try:
                await asyncio.wait_for(api_event.wait(), timeout=remaining)
            except asyncio.TimeoutError:
                logger.warning("LionAir: timed out waiting for API response")
                offers = await self._extract_from_dom(page, req)
                if offers:
                    return self._build_response(offers, req, time.monotonic() - t0)
                return self._empty(req)

            # Also update cookie farm from this successful browser session
            global _farmed_cookies, _farm_timestamp
            lock = _get_farm_lock()
            async with lock:
                _farmed_cookies = await context.cookies()
                _farm_timestamp = time.monotonic()

            data = captured_data.get("json", {})
            if not data:
                return self._empty(req)

            elapsed = time.monotonic() - t0
            offers = self._parse_response(data, req)
            return self._build_response(offers, req, elapsed)

        except Exception as e:
            logger.error("LionAir Playwright error: %s", e)
            return self._empty(req)
        finally:
            await context.close()

    # ------------------------------------------------------------------
    # Browser interaction helpers (used by Playwright fallback)
    # ------------------------------------------------------------------

    async def _dismiss_cookies(self, page) -> None:
        for label in [
            "Accept all cookies", "Accept All", "Accept", "I agree",
            "Got it", "OK", "Close", "Dismiss", "Agree",
        ]:
            try:
                btn = page.get_by_role("button", name=re.compile(rf"^{re.escape(label)}$", re.IGNORECASE))
                if await btn.count() > 0:
                    await btn.first.click(timeout=2000)
                    await asyncio.sleep(0.5)
                    return
            except Exception:
                continue
        # Lion Air has a chatbot popup -- dismiss it
        try:
            close_btns = page.locator("[class*='close'], [aria-label*='close'], [aria-label*='Close']")
            for i in range(await close_btns.count()):
                try:
                    btn = close_btns.nth(i)
                    if await btn.is_visible():
                        await btn.click(timeout=1000)
                        break
                except Exception:
                    continue
        except Exception:
            pass
        try:
            await page.evaluate("""() => {
                document.querySelectorAll(
                    '[class*="cookie"], [id*="cookie"], [class*="consent"], [id*="consent"], ' +
                    '[class*="Cookie"], [id*="Cookie"], [class*="onetrust"], [id*="onetrust"], ' +
                    '[class*="modal-overlay"], [class*="popup"], [id*="popup"], ' +
                    '[class*="chatbot"], [class*="chat-widget"], [id*="ymDivBar"]'
                ).forEach(el => { if (el.offsetHeight > 0) el.remove(); });
                document.body.style.overflow = 'auto';
            }""")
        except Exception:
            pass

    async def _set_one_way(self, page) -> None:
        # Lion Air homepage shows "One Way" / "Return" as clickable tabs/radio
        for label in ["One Way", "One-way", "One way", "ONE WAY"]:
            try:
                radio = page.get_by_role("radio", name=re.compile(rf"{re.escape(label)}", re.IGNORECASE))
                if await radio.count() > 0:
                    await radio.first.click(timeout=2000)
                    return
            except Exception:
                continue
        for label in ["One Way", "One-way", "One way"]:
            try:
                el = page.get_by_text(label, exact=True).first
                if await el.count() > 0:
                    await el.click(timeout=2000)
                    return
            except Exception:
                continue
        try:
            toggle = page.locator("[data-testid*='one-way'], [class*='one-way'], [class*='oneway']").first
            if await toggle.count() > 0:
                await toggle.click(timeout=2000)
        except Exception:
            pass

    async def _fill_airport_field(self, page, label: str, iata: str, index: int) -> bool:
        try:
            for role in ["combobox", "textbox"]:
                field = page.get_by_role(role, name=re.compile(rf"{label}", re.IGNORECASE))
                if await field.count() > 0:
                    await field.first.click(timeout=3000)
                    await asyncio.sleep(0.3)
                    await field.first.fill("")
                    await asyncio.sleep(0.2)
                    await field.first.fill(iata)
                    await asyncio.sleep(2.5)
                    for role2 in ["option", "button", "listitem", "link"]:
                        try:
                            option = page.get_by_role(role2, name=re.compile(rf"{re.escape(iata)}", re.IGNORECASE)).first
                            if await option.count() > 0:
                                await option.click(timeout=3000)
                                return True
                        except Exception:
                            continue
                    item = page.locator(
                        "[class*='suggestion'], [class*='option'], [class*='result'], "
                        "[class*='autocomplete'] li, [class*='dropdown'] li, "
                        "[class*='airport'] li, [class*='station'] li"
                    ).filter(has_text=re.compile(rf"{re.escape(iata)}", re.IGNORECASE)).first
                    if await item.count() > 0:
                        await item.click(timeout=3000)
                        return True
                    await page.keyboard.press("Enter")
                    return True
        except Exception as e:
            logger.debug("LionAir: %s field error: %s", label, e)
        # Fallback: select-based dropdowns (Lion Air may use <select> elements)
        try:
            selects = page.locator("select")
            if await selects.count() > index:
                sel = selects.nth(index)
                await sel.select_option(value=iata)
                return True
        except Exception:
            pass
        try:
            inputs = page.locator("input[type='text'], input[type='search'], input[placeholder]")
            if await inputs.count() > index:
                field = inputs.nth(index)
                await field.click(timeout=3000)
                await field.fill("")
                await asyncio.sleep(0.2)
                await field.fill(iata)
                await asyncio.sleep(2.5)
                await page.keyboard.press("Enter")
                return True
        except Exception:
            pass
        return False

    async def _fill_date(self, page, req: FlightSearchRequest) -> bool:
        target = req.date_from
        try:
            for name in ["Depart", "Departure", "Depart Date", "Date", "When"]:
                field = page.get_by_role("textbox", name=re.compile(rf"{name}", re.IGNORECASE))
                if await field.count() > 0:
                    await field.first.click(timeout=3000)
                    break
            else:
                date_el = page.locator("[class*='date'], [data-testid*='date'], [id*='date']").first
                if await date_el.count() > 0:
                    await date_el.click(timeout=3000)
            await asyncio.sleep(0.8)

            target_my = target.strftime("%B %Y")
            for _ in range(12):
                for variant in [target_my, target_my.upper()]:
                    if await page.locator(f"text={variant}").first.count() > 0:
                        break
                else:
                    try:
                        fwd = page.get_by_role("button", name=re.compile(r"(next|forward|>|>>)", re.IGNORECASE))
                        if await fwd.count() > 0:
                            await fwd.first.click(timeout=2000)
                            await asyncio.sleep(0.4)
                            continue
                    except Exception:
                        pass
                    try:
                        fwd = page.locator("[class*='next'], [aria-label*='next'], [aria-label*='Next']").first
                        await fwd.click(timeout=2000)
                        await asyncio.sleep(0.4)
                        continue
                    except Exception:
                        break
                break

            day = target.day
            for fmt in [
                f"{day} {target.strftime('%B')} {target.year}",
                f"{target.strftime('%B')} {day}, {target.year}",
                f"{target.strftime('%B')} {day}",
                target.strftime("%Y-%m-%d"),
            ]:
                try:
                    day_btn = page.locator(f"[aria-label*='{fmt}']").first
                    if await day_btn.count() > 0:
                        await day_btn.click(timeout=3000)
                        await asyncio.sleep(0.5)
                        return True
                except Exception:
                    continue
            day_btn = page.locator(
                "table button, .calendar button, [class*='calendar'] button, " +
                "[class*='datepicker'] button, table td a, table td span"
            ).filter(has_text=re.compile(rf"^{day}$")).first
            if await day_btn.count() > 0:
                await day_btn.click(timeout=3000)
                await asyncio.sleep(0.5)
                return True
            day_btn = page.get_by_role("button", name=re.compile(rf"^{day}$")).first
            await day_btn.click(timeout=3000)
            await asyncio.sleep(0.5)
            return True
        except Exception as e:
            logger.warning("LionAir: date error: %s", e)
            return False

    async def _click_search(self, page) -> None:
        for label in ["SEARCH FLIGHT", "Search Flight", "Search flights", "Search Flights", "Search", "SEARCH"]:
            try:
                btn = page.get_by_role("button", name=re.compile(rf"^{re.escape(label)}$", re.IGNORECASE))
                if await btn.count() > 0:
                    await btn.first.click(timeout=5000)
                    logger.info("LionAir: clicked search")
                    return
            except Exception:
                continue
        # Lion Air may use a link-styled button
        for label in ["SEARCH FLIGHT", "Search Flight"]:
            try:
                link = page.get_by_role("link", name=re.compile(rf"{re.escape(label)}", re.IGNORECASE))
                if await link.count() > 0:
                    await link.first.click(timeout=5000)
                    return
            except Exception:
                continue
        # Try text match
        try:
            btn = page.get_by_text("SEARCH FLIGHT", exact=True).first
            if await btn.count() > 0:
                await btn.click(timeout=5000)
                return
        except Exception:
            pass
        try:
            await page.locator("button[type='submit']").first.click(timeout=3000)
        except Exception:
            await page.keyboard.press("Enter")

    async def _extract_from_dom(self, page, req: FlightSearchRequest) -> list[FlightOffer]:
        try:
            await asyncio.sleep(3)
            data = await page.evaluate("""() => {
                if (window.__NEXT_DATA__) return window.__NEXT_DATA__;
                if (window.__NUXT__) return window.__NUXT__;
                const scripts = document.querySelectorAll('script[type="application/json"]');
                for (const s of scripts) {
                    try {
                        const d = JSON.parse(s.textContent);
                        if (d && (d.flights || d.journeys || d.fares || d.availability)) return d;
                    } catch {}
                }
                return null;
            }""")
            if data:
                return self._parse_response(data, req)
        except Exception:
            pass
        return []

    def _parse_response(self, data: Any, req: FlightSearchRequest) -> list[FlightOffer]:
        if isinstance(data, list):
            data = {"flights": data}
        currency = "IDR" if req.currency == "EUR" else req.currency
        booking_url = self._build_booking_url(req)
        offers: list[FlightOffer] = []

        flights_raw = (
            data.get("outboundFlights")
            or data.get("outbound")
            or data.get("journeys")
            or data.get("flights")
            or data.get("availability", {}).get("trips", [])
            or data.get("data", {}).get("flights", [])
            or data.get("data", {}).get("journeys", [])
            or []
        )
        if isinstance(flights_raw, dict):
            flights_raw = flights_raw.get("outbound", []) or flights_raw.get("journeys", [])
        if not isinstance(flights_raw, list):
            flights_raw = []

        for flight in flights_raw:
            offer = self._parse_single_flight(flight, currency, req, booking_url)
            if offer:
                offers.append(offer)
        return offers

    def _parse_single_flight(self, flight: dict, currency: str, req: FlightSearchRequest, booking_url: str) -> Optional[FlightOffer]:
        best_price = self._extract_best_price(flight)
        if best_price is None or best_price <= 0:
            return None
        segments_raw = flight.get("segments") or flight.get("legs") or flight.get("flights") or []
        segments: list[FlightSegment] = []
        if segments_raw and isinstance(segments_raw, list):
            for seg in segments_raw:
                segments.append(self._build_segment(seg, req.origin, req.destination))
        else:
            segments.append(self._build_segment(flight, req.origin, req.destination))
        total_dur = 0
        if segments and segments[0].departure and segments[-1].arrival:
            total_dur = int((segments[-1].arrival - segments[0].departure).total_seconds())
        route = FlightRoute(segments=segments, total_duration_seconds=max(total_dur, 0), stopovers=max(len(segments) - 1, 0))
        flight_key = flight.get("journeyKey") or flight.get("id") or f"{flight.get('departureDate', '')}_{time.monotonic()}"
        return FlightOffer(
            id=f"jt_{hashlib.md5(str(flight_key).encode()).hexdigest()[:12]}",
            price=round(best_price, 2), currency=currency,
            price_formatted=f"{best_price:.2f} {currency}",
            outbound=route, inbound=None,
            airlines=["Lion Air"], owner_airline="JT",
            booking_url=booking_url, is_locked=False,
            source="lionair_direct", source_tier="free",
        )

    @staticmethod
    def _extract_best_price(flight: dict) -> Optional[float]:
        fares = flight.get("fares") or flight.get("fareProducts") or flight.get("bundles") or flight.get("fareBundles") or []
        best = float("inf")
        for fare in fares:
            if isinstance(fare, dict):
                for key in ["price", "amount", "totalPrice", "basePrice", "fareAmount", "totalAmount"]:
                    val = fare.get(key)
                    if isinstance(val, dict):
                        val = val.get("amount") or val.get("value")
                    if val is not None:
                        try:
                            v = float(val)
                            if 0 < v < best:
                                best = v
                        except (TypeError, ValueError):
                            pass
        for key in ["price", "lowestFare", "totalPrice", "farePrice", "amount", "lowestPrice"]:
            p = flight.get(key)
            if p is not None:
                try:
                    v = float(p) if not isinstance(p, dict) else float(p.get("amount", 0))
                    if 0 < v < best:
                        best = v
                except (TypeError, ValueError):
                    pass
        return best if best < float("inf") else None

    def _build_segment(self, seg: dict, default_origin: str, default_dest: str) -> FlightSegment:
        dep_str = seg.get("departureDateTime") or seg.get("departure") or seg.get("departureDate") or seg.get("std") or ""
        arr_str = seg.get("arrivalDateTime") or seg.get("arrival") or seg.get("arrivalDate") or seg.get("sta") or ""
        flight_no = str(seg.get("flightNumber") or seg.get("flight_no") or seg.get("number") or "").replace(" ", "")
        origin = seg.get("origin") or seg.get("departureStation") or seg.get("departureAirport") or default_origin
        destination = seg.get("destination") or seg.get("arrivalStation") or seg.get("arrivalAirport") or default_dest
        carrier = seg.get("carrierCode") or seg.get("carrier") or seg.get("airline") or "JT"
        return FlightSegment(
            airline=carrier, airline_name="Lion Air", flight_no=flight_no,
            origin=origin, destination=destination,
            departure=self._parse_dt(dep_str), arrival=self._parse_dt(arr_str),
            cabin_class="M",
        )

    def _build_response(self, offers: list[FlightOffer], req: FlightSearchRequest, elapsed: float) -> FlightSearchResponse:
        offers.sort(key=lambda o: o.price)
        logger.info("LionAir %s->%s returned %d offers in %.1fs", req.origin, req.destination, len(offers), elapsed)
        h = hashlib.md5(f"lionair{req.origin}{req.destination}{req.date_from}".encode()).hexdigest()[:12]
        return FlightSearchResponse(
            search_id=f"fs_{h}", origin=req.origin, destination=req.destination,
            currency=req.currency, offers=offers, total_results=len(offers),
        )

    @staticmethod
    def _parse_dt(s: Any) -> datetime:
        if not s:
            return datetime(2000, 1, 1)
        s = str(s)
        try:
            return datetime.fromisoformat(s.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            pass
        for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M:%S", "%m/%d/%Y %H:%M"):
            try:
                return datetime.strptime(s[:len(fmt) + 2], fmt)
            except (ValueError, IndexError):
                continue
        return datetime(2000, 1, 1)

    @staticmethod
    def _build_deep_link(req: FlightSearchRequest) -> str:
        """Build a deep-link URL to the IBE2 booking page with pre-filled search params."""
        dep = req.date_from.strftime("%d%b")  # e.g. "15Jun"
        adults = getattr(req, "adults", 1) or 1
        children = getattr(req, "children", 0) or 0
        infants = getattr(req, "infants", 0) or 0
        return (
            f"{_BOOKING_BASE}/lionairibe2/OnlineBooking.aspx"
            f"?depart={req.origin}&dest.1={req.destination}"
            f"&trip_type=one+way&date.0={dep}&date.1="
            f"&persons.0={adults}&persons.1={children}&persons.2={infants}"
            f"&date_flexibility=undefined"
        )

    @staticmethod
    def _build_booking_url(req: FlightSearchRequest) -> str:
        dep = req.date_from.strftime("%d%b")
        return (
            f"{_BOOKING_BASE}/lionairibe2/OnlineBooking.aspx"
            f"?depart={req.origin}&dest.1={req.destination}"
            f"&trip_type=one+way&date.0={dep}"
            f"&persons.0={getattr(req, 'adults', 1) or 1}"
        )

    def _empty(self, req: FlightSearchRequest) -> FlightSearchResponse:
        h = hashlib.md5(f"lionair{req.origin}{req.destination}{req.date_from}".encode()).hexdigest()[:12]
        return FlightSearchResponse(
            search_id=f"fs_{h}", origin=req.origin, destination=req.destination,
            currency=req.currency, offers=[], total_results=0,
        )
