"""
Jetstar Playwright scraper — CDP Chrome + bundle-data-v2 JSON extraction.

Jetstar (IATA: JQ) is an Australian low-cost airline in the Qantas Group,
operating domestic/international flights across Asia-Pacific.

Strategy:
1. Launch real Chrome via subprocess + connect via CDP (port 9444) to bypass
   Kasada bot challenge that blocks Playwright's bundled Chromium
2. Navigate to booking.jetstar.com/au/en/booking/search-flights with query
   params — Navitaire engine redirects to /select-flights with results
3. Handle deeplink redirect page (click "Continue to booking" button)
4. Dismiss "Multiple booking" overlay if present
5. Extract <script id="bundle-data-v2" type="application/json"> containing
   full flight data (~327KB) with Trips[].Flights[] structure
6. Parse JourneySellKey for flight number/times, Bundles for prices
7. Fallback: DOM extraction from aria-label price divs

Booking engine observations (Mar 2026):
- Navitaire-powered SSR booking at booking.jetstar.com
- Direct URL: /search-flights?origin1=SYD&destination1=MEL&departuredate1=2026-04-15&ADT=1
- Redirects through deeplinksv2 interim page → /select-flights with results
- bundle-data-v2 JSON: Trips[0].Flights[] with JourneySellKey, Bundles[]
- JourneySellKey format: "JQ~ 501~ ~~SYD~04/15/2026 06:00~MEL~04/15/2026 07:40~~"
- Bundles[].RegularInclusiveAmount = regular price, CjInclusiveAmount = member price
- Kasada challenge blocks Playwright Chromium; real Chrome bypasses it
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
import shutil
import subprocess
import tempfile
import time
from datetime import datetime
from typing import Any, Optional

from ..models.flights import (
    FlightOffer,
    FlightRoute,
    FlightSearchRequest,
    FlightSearchResponse,
    FlightSegment,
)
from .browser import auto_block_if_proxied, proxy_chrome_args, proxy_is_configured

logger = logging.getLogger(__name__)

_MAX_ATTEMPTS = 4
_CDP_PORT = 9444
_USER_DATA_DIR = os.path.join(
    os.environ.get("TEMP", os.environ.get("TMPDIR", "/tmp")), ".jetstar_chrome_data"
)
_FARE_CACHE_URL = (
    "https://digitalapi.jetstar.com/v1/farecache/deals/aggregated"
    "?dealsType=All&filterByRule=true"
)
_PUBLIC_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
    "Accept-Language": "en-AU,en;q=0.9",
    "Referer": "https://www.jetstar.com/",
    "Origin": "https://www.jetstar.com",
    "culture": "en-AU",
}

_pw_instance = None
_browser = None
_chrome_proc = None
_browser_lock: Optional[asyncio.Lock] = None
_active_user_data_dir: Optional[str] = None
_active_user_data_dir_is_ephemeral = False
_warmup_done = False
_WARMUP_URLS = (
    "https://www.jetstar.com/",
    "https://booking.jetstar.com/au/en",
)
_WORKER_USER_DATA_DIR_ENV = "LETSFG_CONNECTOR_USER_DATA_DIR"
_WORKER_USER_DATA_DIR_EPHEMERAL_ENV = "LETSFG_CONNECTOR_USER_DATA_DIR_EPHEMERAL"


def _use_fresh_profile() -> bool:
    if os.environ.get(_WORKER_USER_DATA_DIR_ENV, "").strip():
        return True
    raw = os.environ.get("LETSFG_JETSTAR_FRESH_PROFILE", "").strip().lower()
    if raw in {"1", "true", "yes", "on"}:
        return True
    return proxy_is_configured()


def _current_warmup_urls() -> tuple[str, ...]:
    if _use_fresh_profile():
        return ("https://booking.jetstar.com/au/en/booking",)
    return _WARMUP_URLS


def _ensure_user_data_dir() -> str:
    global _active_user_data_dir, _active_user_data_dir_is_ephemeral
    if _active_user_data_dir and os.path.isdir(_active_user_data_dir):
        return _active_user_data_dir
    worker_dir = os.environ.get(_WORKER_USER_DATA_DIR_ENV, "").strip()
    if worker_dir:
        os.makedirs(worker_dir, exist_ok=True)
        _active_user_data_dir = worker_dir
        _active_user_data_dir_is_ephemeral = os.environ.get(
            _WORKER_USER_DATA_DIR_EPHEMERAL_ENV,
            "",
        ).strip().lower() in {"1", "true", "yes", "on"}
        logger.info("Jetstar: using worker-provided Chrome profile %s", _active_user_data_dir)
        return _active_user_data_dir
    if _use_fresh_profile():
        root_dir = os.path.join(
            os.environ.get("TEMP", os.environ.get("TMPDIR", "/tmp")),
            ".jetstar_chrome_profiles",
        )
        os.makedirs(root_dir, exist_ok=True)
        _active_user_data_dir = tempfile.mkdtemp(prefix="profile_", dir=root_dir)
        _active_user_data_dir_is_ephemeral = True
        logger.info("Jetstar: using fresh Chrome profile %s", _active_user_data_dir)
        return _active_user_data_dir
    os.makedirs(_USER_DATA_DIR, exist_ok=True)
    _active_user_data_dir = _USER_DATA_DIR
    _active_user_data_dir_is_ephemeral = False
    return _active_user_data_dir


def _current_attempt_limit() -> int:
    return 2 if _use_fresh_profile() else _MAX_ATTEMPTS


def _result_wait_timeout_ms() -> int:
    return 45000 if _use_fresh_profile() else 20000


def _cdp_connect_delay_seconds() -> float:
    return 5.0 if _use_fresh_profile() else 2.5


def _find_chrome() -> Optional[str]:
    """Find Chrome executable on the system."""
    candidates = [
        os.path.expandvars(r"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%LocalAppData%\Google\Chrome\Application\chrome.exe"),
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium-browser",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ]
    for c in candidates:
        if os.path.isfile(c):
            return c
    return None


def _get_lock() -> asyncio.Lock:
    global _browser_lock
    if _browser_lock is None:
        _browser_lock = asyncio.Lock()
    return _browser_lock


async def _get_browser():
    """Launch real Chrome subprocess + connect via CDP.

    Uses persistent user-data-dir so Kasada clearance cookies persist.
    Falls back to regular Playwright launch if Chrome is not found.
    """
    global _pw_instance, _browser, _chrome_proc
    lock = _get_lock()
    async with lock:
        if _browser:
            try:
                if _browser.is_connected():
                    return _browser
            except Exception:
                pass

        from playwright.async_api import async_playwright

        if _pw_instance:
            try:
                await _pw_instance.stop()
            except Exception:
                pass
        _pw_instance = await async_playwright().start()

        chrome_path = _find_chrome()
        fresh_profile = _use_fresh_profile()
        user_data_dir = _ensure_user_data_dir()
        if chrome_path:
            # Try connecting to existing Chrome first
            if not fresh_profile:
                try:
                    _browser = await _pw_instance.chromium.connect_over_cdp(
                        f"http://127.0.0.1:{_CDP_PORT}"
                    )
                    logger.info("Jetstar: connected to existing Chrome via CDP")
                    return _browser
                except Exception:
                    pass

            popen_kw: dict[str, Any] = {}
            if hasattr(subprocess, "CREATE_NO_WINDOW"):
                popen_kw["creationflags"] = subprocess.CREATE_NO_WINDOW
            popen_kw["stdout"] = subprocess.DEVNULL
            popen_kw["stderr"] = subprocess.DEVNULL

            _chrome_proc = subprocess.Popen(
                [
                    chrome_path,
                    f"--remote-debugging-port={_CDP_PORT}",
                    f"--user-data-dir={user_data_dir}",
                    "--window-size=1366,768",
                    "--no-first-run",
                    *proxy_chrome_args(),
                    "--no-default-browser-check",
                    "--disable-blink-features=AutomationControlled",
                    "--window-position=-2400,-2400",
                    "about:blank",
                ],
                **popen_kw,
            )
            await asyncio.sleep(_cdp_connect_delay_seconds())
            try:
                _browser = await _pw_instance.chromium.connect_over_cdp(
                    f"http://127.0.0.1:{_CDP_PORT}"
                )
                logger.info("Jetstar: connected to real Chrome via CDP (port %d)", _CDP_PORT)
                return _browser
            except Exception as e:
                logger.warning("Jetstar: CDP connect failed: %s, falling back", e)
                if _chrome_proc:
                    _chrome_proc.terminate()
                    _chrome_proc = None

        # Fallback: regular Playwright headed Chrome
        try:
            _browser = await _pw_instance.chromium.launch(
                headless=False, channel="chrome",
                args=["--disable-blink-features=AutomationControlled",
                      "--window-position=-2400,-2400", "--window-size=1366,768"],
            )
        except Exception:
            _browser = await _pw_instance.chromium.launch(
                headless=True,
                args=["--disable-blink-features=AutomationControlled", "--no-sandbox"],
            )
        logger.info("Jetstar: Playwright browser launched (fallback)")
        return _browser


async def _reset_browser():
    """Reset browser connection and Chrome process."""
    global _pw_instance, _browser, _chrome_proc, _warmup_done
    global _active_user_data_dir, _active_user_data_dir_is_ephemeral
    lock = _get_lock()
    async with lock:
        _warmup_done = False
        if _browser:
            try:
                await _browser.close()
            except Exception:
                pass
            _browser = None
        if _pw_instance:
            try:
                await _pw_instance.stop()
            except Exception:
                pass
            _pw_instance = None
        if _chrome_proc:
            try:
                _chrome_proc.terminate()
                _chrome_proc.wait(timeout=5)
            except Exception:
                try:
                    _chrome_proc.kill()
                except Exception:
                    pass
            _chrome_proc = None
        stale_user_data_dir = _active_user_data_dir if _active_user_data_dir_is_ephemeral else None
        _active_user_data_dir = None
        _active_user_data_dir_is_ephemeral = False
        if stale_user_data_dir:
            shutil.rmtree(stale_user_data_dir, ignore_errors=True)


class JetstarConnectorClient:
    """Jetstar Playwright scraper -- direct URL to Navitaire booking engine + DOM extraction."""

    def __init__(self, timeout: float = 45.0):
        self.timeout = timeout
        self._last_attempt_blocked = False

    async def close(self):
        if _use_fresh_profile():
            await _reset_browser()

    async def search_flights(self, req: FlightSearchRequest) -> FlightSearchResponse:
        t0 = time.monotonic()
        adults = getattr(req, "adults", 1) or 1
        dep = req.date_from.strftime("%Y-%m-%d")
        attempt_limit = _current_attempt_limit()
        search_url = (
            f"https://booking.jetstar.com/au/en/booking/search-flights"
            f"?origin1={req.origin}&destination1={req.destination}"
            f"&departuredate1={dep}&ADT={adults}"
        )

        ob_offers = None
        for attempt in range(1, attempt_limit + 1):
            try:
                ob_offers = await self._attempt_search(search_url, req)
                if ob_offers is not None:
                    break
                if self._last_attempt_blocked:
                    logger.info(
                        "Jetstar: attempt %d/%d hit a challenge; resetting browser before retry",
                        attempt,
                        attempt_limit,
                    )
                    if attempt < attempt_limit:
                        await _reset_browser()
                        await asyncio.sleep(2.0)
                    continue
                logger.warning(
                    "Jetstar: attempt %d/%d got no results or blocked",
                    attempt, attempt_limit,
                )
                if attempt < attempt_limit:
                    await _reset_browser()
                    await asyncio.sleep(1.5)
            except Exception as e:
                logger.warning("Jetstar: attempt %d/%d error: %s", attempt, attempt_limit, e)
                if "ERR_CONNECTION" in str(e) or "ERR_HTTP2" in str(e) or "Target closed" in str(e):
                    await _reset_browser()
                    await asyncio.sleep(2.0)

        if not ob_offers:
            ob_offers = await self._search_cached_deals(req)
            if ob_offers:
                logger.info("Jetstar: using fare-cache fallback with %d outbound offers", len(ob_offers))

        if not ob_offers:
            return self._empty(req)

        # --- RT: second search for inbound ---
        if req.return_from:
            ret = req.return_from.strftime("%Y-%m-%d")
            ib_url = (
                f"https://booking.jetstar.com/au/en/booking/search-flights"
                f"?origin1={req.destination}&destination1={req.origin}"
                f"&departuredate1={ret}&ADT={adults}"
            )
            ib_req = req.model_copy(update={
                "origin": req.destination,
                "destination": req.origin,
                "date_from": req.return_from,
                "return_from": None,
            })
            ib_offers = None
            for attempt in range(1, attempt_limit + 1):
                try:
                    ib_offers = await self._attempt_search(ib_url, ib_req)
                    if ib_offers is not None:
                        break
                    if self._last_attempt_blocked:
                        logger.info(
                            "Jetstar: inbound attempt %d/%d hit a challenge; resetting browser before retry",
                            attempt,
                            attempt_limit,
                        )
                        if attempt < attempt_limit:
                            await _reset_browser()
                            await asyncio.sleep(2.0)
                        continue
                except Exception:
                    pass
            if not ib_offers:
                ib_offers = await self._search_cached_deals(ib_req)
                if ib_offers:
                    logger.info("Jetstar: using fare-cache fallback with %d inbound offers", len(ib_offers))
            if ib_offers:
                ob_offers = self._combine_rt(ob_offers, ib_offers, req)

        elapsed = time.monotonic() - t0
        return self._build_response(ob_offers, req, elapsed)

    async def _attempt_search(
        self, url: str, req: FlightSearchRequest
    ) -> Optional[list[FlightOffer]]:
        global _warmup_done
        self._last_attempt_blocked = False
        browser = await _get_browser()

        # CDP browsers use default context
        is_cdp = hasattr(browser, "contexts") and browser.contexts
        if is_cdp:
            context = browser.contexts[0]
        else:
            context = await browser.new_context(
                viewport={"width": 1366, "height": 768},
                locale="en-AU",
                timezone_id="Australia/Sydney",
                service_workers="block",
            )
        page = await context.new_page()
        await auto_block_if_proxied(page)

        try:
            # Kasada warm-up: follow the public Jetstar entry path first,
            # then the booking host before loading the deeplink search URL.
            if not _warmup_done:
                warmup_urls = _current_warmup_urls()
                if len(warmup_urls) == 1:
                    logger.info("Jetstar: Kasada warm-up on booking host only")
                else:
                    logger.info("Jetstar: Kasada warm-up on public and booking pages")
                try:
                    warmup_ok = True
                    for warmup_url in warmup_urls:
                        await page.goto(
                            warmup_url,
                            wait_until="domcontentloaded",
                            timeout=20000,
                        )
                        await asyncio.sleep(3)
                        warmup_title = await page.title()
                        logger.info(
                            "Jetstar: warm-up page title/url: %s | %s",
                            warmup_title,
                            page.url,
                        )
                        if any(
                            marker in warmup_title.lower()
                            for marker in ("challenge", "not found", "error", "processing")
                        ):
                            warmup_ok = False
                            break
                    if warmup_ok:
                        _warmup_done = True
                except Exception as e:
                    logger.debug("Jetstar: warm-up navigation error (non-fatal): %s", e)

            logger.info("Jetstar: loading %s", url[:120])
            await page.goto(
                url,
                wait_until="domcontentloaded",
                timeout=int(self.timeout * 1000),
            )
            await asyncio.sleep(4)

            # Handle deeplink redirect page ("Continue to booking" button)
            await self._handle_deeplink_redirect(page)

            title = await page.title()
            if "challenge" in title.lower():
                logger.warning("Jetstar: Kasada challenge on search page, will retry")
                self._last_attempt_blocked = True
                _warmup_done = False
                return None
            if "not found" in title.lower() or "error" in title.lower():
                logger.warning("Jetstar: got error page: %s", title)
                return None

            # Dismiss privacy notices and "Multiple booking" overlay
            await self._dismiss_overlays(page)

            # Wait for flight results (bundle-data-v2 script or flight cards)
            try:
                await page.wait_for_selector(
                    "script#bundle-data-v2, [class*='flight-row'], "
                    "div[aria-label*='Departure'], div[aria-label*='price']",
                    timeout=_result_wait_timeout_ms(),
                )
            except Exception:
                pass
            await asyncio.sleep(2)

            # Strategy 1: Extract bundle-data-v2 JSON (full structured flight data)
            flight_data = await self._extract_bundle_data_v2(page)
            if flight_data:
                offers = self._parse_bundle_data_v2(flight_data, req)
                if offers:
                    logger.info("Jetstar: extracted %d offers from bundle-data-v2", len(offers))
                    return offers

            # Strategy 2: Try Navitaire FlightData JSON from inline scripts
            flight_data = await self._extract_flight_data(page)
            if flight_data:
                offers = self._parse_navitaire_data(flight_data, req)
                if offers:
                    return offers

            # Strategy 3: DOM extraction from flight cards
            offers = await self._extract_from_dom(page, req)
            if offers:
                return offers

            return None
        finally:
            if page:
                try:
                    await page.close()
                except Exception:
                    pass
            if not is_cdp and context:
                try:
                    await context.close()
                except Exception:
                    pass

    async def _handle_deeplink_redirect(self, page) -> None:
        """Handle the deeplinksv2 interim page that shows 'Continue to booking'."""
        try:
            current_url = page.url
            if "deeplink" in current_url.lower() or "continue" in (await page.title()).lower():
                # Click "Continue to booking" or similar button
                for selector in [
                    "button:has-text('Continue')",
                    "a:has-text('Continue to booking')",
                    "a:has-text('Continue')",
                    "button[type='submit']",
                ]:
                    try:
                        btn = page.locator(selector).first
                        if await btn.count() > 0 and await btn.is_visible():
                            await btn.click(timeout=5000)
                            await page.wait_for_load_state("domcontentloaded", timeout=15000)
                            await asyncio.sleep(3)
                            logger.info("Jetstar: clicked through deeplink redirect")
                            return
                    except Exception:
                        continue
        except Exception:
            pass

    async def _dismiss_overlays(self, page) -> None:
        """Dismiss privacy notice, cookie banners, and 'Multiple booking' overlay."""
        # Click close buttons on banners and overlays
        for selector in [
            "img[alt*='close']",
            "[class*='privacy'] img[role='button']",
            "[class*='notice'] button",
            "[class*='banner'] button",
            "button:has-text('OK')",
            "button:has-text('Got it')",
            "button:has-text('No thanks')",
            "button:has-text('Continue')",
            "[class*='modal'] button[class*='close']",
            "[class*='multiple-booking'] button",
        ]:
            try:
                el = page.locator(selector).first
                if await el.count() > 0 and await el.is_visible():
                    await el.click(timeout=2000)
                    await asyncio.sleep(0.3)
            except Exception:
                continue

        # JS-remove overlays that intercept pointer events
        try:
            await page.evaluate("""() => {
                document.querySelectorAll(
                    '[class*="gdpr"], [class*="consent"], [class*="cookie"], [class*="onetrust"], ' +
                    '[class*="privacy-notice"], [class*="modal-overlay"], [class*="popup"], ' +
                    '[class*="multiple-booking"], [class*="overlay-backdrop"]'
                ).forEach(el => { if (el.offsetHeight > 0 && el.offsetHeight < 400) el.remove(); });
                document.body.style.overflow = 'auto';
            }""")
        except Exception:
            pass

    async def _extract_bundle_data_v2(self, page) -> Optional[dict]:
        """Extract bundle-data-v2 JSON — full structured flight data from Navitaire.

        The Jetstar select-flights page embeds a ~327KB JSON blob in:
        <script id="bundle-data-v2" type="application/json">{...}</script>

        Structure: { Trips: [{ Flights: [...] }], ... }
        """
        raw_json = await page.evaluate(r"""() => {
            const el = document.querySelector('script#bundle-data-v2');
            if (el) return el.textContent;
            // Fallback: look for bundle-data (v1)
            const el2 = document.querySelector('script#bundle-data');
            if (el2) return el2.textContent;
            return null;
        }""")
        if not raw_json:
            return None
        try:
            data = json.loads(raw_json)
            logger.debug("Jetstar: bundle-data-v2 extracted (%d bytes)", len(raw_json))
            return data
        except (json.JSONDecodeError, ValueError) as e:
            logger.debug("Jetstar: bundle-data-v2 parse error: %s", e)
            return None

    async def _extract_flight_data(self, page) -> Optional[dict]:
        """Fallback: try to extract Navitaire FlightData JSON from inline <script> tags."""
        import html as html_mod

        raw = await page.evaluate(r"""() => {
            const scripts = document.querySelectorAll('script');
            for (const s of scripts) {
                const t = s.textContent || '';
                const m = t.match(/FlightData\s*=\s*'([\s\S]*?)';/);
                if (m) return { type: 'flightdata', data: m[1] };
                const m2 = t.match(/(?:availability|AvailabilityV2|flightSearch)\s*=\s*({[\s\S]*?});/);
                if (m2) return { type: 'json', data: m2[1] };
            }
            if (window.FlightData) return { type: 'global', data: JSON.stringify(window.FlightData) };
            if (window.AvailabilityV2) return { type: 'global', data: JSON.stringify(window.AvailabilityV2) };
            return null;
        }""")
        if not raw:
            return None

        data_str = raw.get("data", "")
        if raw.get("type") == "flightdata":
            data_str = html_mod.unescape(data_str)

        try:
            return json.loads(data_str)
        except (json.JSONDecodeError, ValueError) as e:
            logger.debug("Jetstar: FlightData parse error: %s", e)
            return None

    def _parse_bundle_data_v2(self, data: dict, req: FlightSearchRequest) -> list[FlightOffer]:
        """Parse bundle-data-v2 JSON from Jetstar's Navitaire booking engine.

        Structure:
          { Trips: [{ Flights: [{ JourneySellKey, Bundles, Segments, ... }] }] }

        JourneySellKey format:
          "JQ~ 501~ ~~SYD~04/15/2026 06:00~MEL~04/15/2026 07:40~~"

        Bundles[].RegularInclusiveAmount = regular price
        Bundles[].CjInclusiveAmount = Club Jetstar (member) price
        """
        booking_url = self._build_booking_url(req)
        offers: list[FlightOffer] = []

        trips = data.get("Trips") or data.get("trips") or []
        for trip in trips:
            flights = trip.get("Flights") or trip.get("flights") or []
            for flight in flights:
                bundle_offers = self._parse_bundle_flight(flight, req, booking_url)
                if bundle_offers:
                    offers.extend(bundle_offers)

        return offers

    def _parse_bundle_flight(
        self, flight: dict, req: FlightSearchRequest, booking_url: str
    ) -> list[FlightOffer]:
        """Parse a single flight from bundle-data-v2 Trips[].Flights[].

        Jetstar exposes multiple sellable bundles per flight (Starter, Starter Plus,
        Flex, Flex Plus). Preserve those as separate offers instead of collapsing to
        the single cheapest bundle.
        """

        # Parse JourneySellKey for flight number, airports, times
        sell_key = flight.get("JourneySellKey") or flight.get("journeySellKey") or ""
        key_info = self._parse_journey_sell_key(sell_key)

        # Build segments from Segments array or from sell key
        segments_raw = flight.get("Segments") or flight.get("segments") or []
        segments: list[FlightSegment] = []

        if segments_raw:
            for seg_raw in segments_raw:
                legs = seg_raw.get("Legs") or seg_raw.get("legs") or [seg_raw]
                for leg in legs:
                    seg = self._build_bundle_segment(leg, req)
                    if seg:
                        segments.append(seg)

        # Fallback: build segment from sell key info
        if not segments and key_info:
            _jq_cabin = {"M": "economy", "W": "premium_economy", "C": "business", "F": "first"}.get(req.cabin_class or "M", "economy")
            seg = FlightSegment(
                airline=key_info.get("carrier", "JQ"),
                airline_name="Jetstar",
                flight_no=key_info.get("flight_no", ""),
                origin=key_info.get("origin", req.origin),
                destination=key_info.get("destination", req.destination),
                departure=key_info.get("departure", datetime(2000, 1, 1)),
                arrival=key_info.get("arrival", datetime(2000, 1, 1)),
                cabin_class=_jq_cabin,
            )
            segments.append(seg)

        if not segments:
            return []

        total_dur = 0
        if segments[0].departure and segments[-1].arrival:
            total_dur = int((segments[-1].arrival - segments[0].departure).total_seconds())

        route = FlightRoute(
            segments=segments,
            total_duration_seconds=max(total_dur, 0),
            stopovers=max(len(segments) - 1, 0),
        )

        flight_key = sell_key or f"{req.origin}_{req.destination}_{time.monotonic()}"
        bundle_entries = self._extract_bundle_entries(flight)
        if not bundle_entries:
            price = self._extract_bundle_price(flight)
            if price is None or price <= 0:
                return []
            return [
                FlightOffer(
                    id=f"jq_{hashlib.md5(flight_key.encode()).hexdigest()[:12]}",
                    price=round(price, 2),
                    currency="AUD",
                    price_formatted=f"${price:.2f} AUD",
                    outbound=route,
                    inbound=None,
                    airlines=["Jetstar"],
                    owner_airline="JQ",
                    booking_url=booking_url,
                    is_locked=False,
                    source="jetstar_direct",
                    source_tier="free",
                )
            ]

        offers: list[FlightOffer] = []
        for bundle in bundle_entries:
            price = bundle["regular_price"]
            fare_brand = bundle["bundle_name"]
            bundle_key = "|".join([
                flight_key,
                fare_brand,
                bundle.get("bundle_ssr_code", ""),
                bundle.get("service_bundle_code", ""),
                f"{price:.2f}",
            ])
            conditions = {
                "fare_brand": fare_brand,
                "bundle_name": fare_brand,
                "bundle_subheader": bundle.get("bundle_subheader", ""),
                "bundle_product_name": bundle.get("bundle_product_name", ""),
                "bundle_ssr_code": bundle.get("bundle_ssr_code", ""),
                "service_bundle_code": bundle.get("service_bundle_code", ""),
                "club_jetstar_price": bundle.get("club_price_formatted", ""),
                "is_starter_bundle": bundle.get("is_starter_bundle", ""),
                "price_type": "regular_inclusive_bundle",
            }
            offers.append(
                FlightOffer(
                    id=f"jq_{hashlib.md5(bundle_key.encode()).hexdigest()[:12]}",
                    price=round(price, 2),
                    currency="AUD",
                    price_formatted=f"${price:.2f} AUD",
                    outbound=route,
                    inbound=None,
                    airlines=["Jetstar"],
                    owner_airline="JQ",
                    conditions={k: v for k, v in conditions.items() if v},
                    booking_url=booking_url,
                    is_locked=False,
                    source="jetstar_direct",
                    source_tier="free",
                )
            )

        return offers

    @staticmethod
    def _extract_bundle_entries(flight: dict) -> list[dict[str, str | float]]:
        bundles = flight.get("Bundles") or flight.get("bundles") or []
        entries: list[dict[str, str | float]] = []

        for bundle in bundles:
            if not isinstance(bundle, dict):
                continue

            regular_price = JetstarConnectorClient._extract_bundle_amount(
                bundle,
                [
                    "RegularInclusiveAmount",
                    "regularInclusiveAmount",
                    "InclusiveAmount",
                    "inclusiveAmount",
                ],
            )
            if regular_price is None or regular_price <= 0:
                continue

            club_price = JetstarConnectorClient._extract_bundle_amount(
                bundle,
                ["CjInclusiveAmount", "cjInclusiveAmount"],
            )
            bundle_name = (
                bundle.get("BundleLabel")
                or bundle.get("BundleName")
                or bundle.get("bundleName")
                or bundle.get("BundleProductName")
                or bundle.get("bundleProductName")
                or bundle.get("ServiceBundleCode")
                or bundle.get("serviceBundleCode")
                or "Jetstar Bundle"
            )
            entries.append({
                "bundle_name": str(bundle_name).strip(),
                "bundle_subheader": str(bundle.get("BundleSubHeader") or bundle.get("bundleSubHeader") or "").strip(),
                "bundle_product_name": str(bundle.get("BundleProductName") or bundle.get("bundleProductName") or "").strip(),
                "bundle_ssr_code": str(bundle.get("BundleSsrCode") or bundle.get("bundleSsrCode") or "").strip(),
                "service_bundle_code": str(bundle.get("ServiceBundleCode") or bundle.get("serviceBundleCode") or "").strip(),
                "regular_price": regular_price,
                "club_price_formatted": f"${club_price:.2f} AUD" if isinstance(club_price, float) and club_price > 0 else "",
                "is_starter_bundle": str(bool(bundle.get("IsStarterBundle"))).lower() if bundle.get("IsStarterBundle") is not None else "",
            })

        return entries

    @staticmethod
    def _extract_bundle_amount(bundle: dict, keys: list[str]) -> Optional[float]:
        for key in keys:
            val = bundle.get(key)
            if val is not None:
                try:
                    amount = float(val)
                    if amount > 0:
                        return amount
                except (TypeError, ValueError):
                    pass

        price_obj = bundle.get("Price") or bundle.get("price") or {}
        if isinstance(price_obj, dict):
            for key in ["Amount", "amount", "Value", "value"]:
                val = price_obj.get(key)
                if val is not None:
                    try:
                        amount = float(val)
                        if amount > 0:
                            return amount
                    except (TypeError, ValueError):
                        pass

        return None

    @staticmethod
    def _extract_bundle_price(flight: dict) -> Optional[float]:
        """Extract best price from Bundles[].RegularInclusiveAmount."""
        entries = JetstarConnectorClient._extract_bundle_entries(flight)
        prices = [entry["regular_price"] for entry in entries if isinstance(entry.get("regular_price"), float)]
        return min(prices) if prices else None

    @staticmethod
    def _parse_journey_sell_key(sell_key: str) -> Optional[dict]:
        """Parse JourneySellKey: 'JQ~ 501~ ~~SYD~04/15/2026 06:00~MEL~04/15/2026 07:40~~'"""
        if not sell_key or "~" not in sell_key:
            return None
        parts = sell_key.split("~")
        # parts[0] = carrier (JQ), parts[1] = flight number (space + 501)
        # parts[4] = origin (SYD), parts[5] = dep datetime (04/15/2026 06:00)
        # parts[6] = destination (MEL), parts[7] = arr datetime (04/15/2026 07:40)
        try:
            carrier = parts[0].strip() if len(parts) > 0 else "JQ"
            flight_no = parts[1].strip() if len(parts) > 1 else ""
            origin = parts[4].strip() if len(parts) > 4 else ""
            dep_str = parts[5].strip() if len(parts) > 5 else ""
            destination = parts[6].strip() if len(parts) > 6 else ""
            arr_str = parts[7].strip() if len(parts) > 7 else ""

            dep_dt = datetime.strptime(dep_str, "%m/%d/%Y %H:%M") if dep_str else datetime(2000, 1, 1)
            arr_dt = datetime.strptime(arr_str, "%m/%d/%Y %H:%M") if arr_str else datetime(2000, 1, 1)

            full_flight_no = f"{carrier}{flight_no}" if flight_no else ""

            return {
                "carrier": carrier,
                "flight_no": full_flight_no,
                "origin": origin,
                "destination": destination,
                "departure": dep_dt,
                "arrival": arr_dt,
            }
        except (ValueError, IndexError) as e:
            logger.debug("Jetstar: JourneySellKey parse error: %s", e)
            return None

    def _build_bundle_segment(self, leg: dict, req: FlightSearchRequest) -> Optional[FlightSegment]:
        """Build a FlightSegment from a bundle-data-v2 Segments[].Legs[] entry."""
        carrier = leg.get("CarrierCode") or leg.get("carrierCode") or leg.get("Carrier") or "JQ"
        flight_no_raw = leg.get("FlightNumber") or leg.get("flightNumber") or leg.get("FlightDesignator") or ""
        if isinstance(flight_no_raw, dict):
            flight_no = str(flight_no_raw.get("FlightNumber", ""))
            carrier = flight_no_raw.get("CarrierCode", carrier)
        else:
            flight_no = str(flight_no_raw)

        full_flight_no = f"{carrier}{flight_no}" if flight_no else ""

        origin = (leg.get("DepartureStation") or leg.get("departureStation")
                  or leg.get("Origin") or leg.get("origin") or req.origin)
        destination = (leg.get("ArrivalStation") or leg.get("arrivalStation")
                       or leg.get("Destination") or leg.get("destination") or req.destination)

        dep_str = (leg.get("STD") or leg.get("std") or leg.get("DepartureDateTime")
                   or leg.get("departureDateTime") or leg.get("DepartureDate") or "")
        arr_str = (leg.get("STA") or leg.get("sta") or leg.get("ArrivalDateTime")
                   or leg.get("arrivalDateTime") or leg.get("ArrivalDate") or "")

        return FlightSegment(
            airline=carrier,
            airline_name="Jetstar",
            flight_no=full_flight_no,
            origin=origin,
            destination=destination,
            departure=self._parse_dt(dep_str),
            arrival=self._parse_dt(arr_str),
            cabin_class={"M": "economy", "W": "premium_economy", "C": "business", "F": "first"}.get(req.cabin_class or "M", "economy"),
        )

    def _parse_navitaire_data(self, data: dict, req: FlightSearchRequest) -> list[FlightOffer]:
        """Fallback: parse Navitaire-style FlightData JSON."""
        booking_url = self._build_booking_url(req)
        offers: list[FlightOffer] = []

        journeys = data.get("journeys") or data.get("trips") or []
        for journey in journeys:
            flights = journey.get("flights") or journey.get("segments") or []
            for flight in flights:
                offer = self._parse_navitaire_flight(flight, req, booking_url)
                if offer:
                    offers.append(offer)

        if not offers:
            flights = data.get("flights") or data.get("outboundFlights") or []
            for flight in flights:
                offer = self._parse_navitaire_flight(flight, req, booking_url)
                if offer:
                    offers.append(offer)

        return offers

    def _parse_navitaire_flight(
        self, flight: dict, req: FlightSearchRequest, booking_url: str
    ) -> Optional[FlightOffer]:
        price = self._extract_best_price(flight)
        if price is None or price <= 0:
            return None

        legs_raw = flight.get("legs") or flight.get("segments") or []
        segments: list[FlightSegment] = []
        for leg in legs_raw:
            segments.append(self._build_segment(leg, req.origin, req.destination, req.cabin_class or "M"))
        if not segments:
            segments.append(self._build_segment(flight, req.origin, req.destination, req.cabin_class or "M"))

        total_dur = 0
        if segments and segments[0].departure and segments[-1].arrival:
            total_dur = int((segments[-1].arrival - segments[0].departure).total_seconds())

        route = FlightRoute(
            segments=segments,
            total_duration_seconds=max(total_dur, 0),
            stopovers=max(len(segments) - 1, 0),
        )
        flight_key = (
            flight.get("journeyKey") or flight.get("standardFareKey")
            or flight.get("id") or f"{req.origin}_{req.destination}_{time.monotonic()}"
        )
        return FlightOffer(
            id=f"jq_{hashlib.md5(str(flight_key).encode()).hexdigest()[:12]}",
            price=round(price, 2), currency="AUD",
            price_formatted=f"${price:.2f} AUD",
            outbound=route, inbound=None,
            airlines=["Jetstar"], owner_airline="JQ",
            booking_url=booking_url, is_locked=False,
            source="jetstar_direct", source_tier="free",
        )

    async def _extract_from_dom(self, page, req: FlightSearchRequest) -> list[FlightOffer]:
        """Extract flight data from DOM flight cards on the select-flights page.
        
        Navitaire renders flight cards with:
        - Departure/arrival times (e.g. "6:00am", "7:40am")
        - Airport codes (e.g. "SYD - Departure", "MEL - Arrival")
        - Duration (e.g. "Direct flight - 1hr 40mins travel")
        - Prices (e.g. "Regular price from 83 AUD")
        """
        flights_data = await page.evaluate(r"""() => {
            const flights = [];
            
            // Find all flight row containers - they are clickable divs containing
            // departure/arrival info and price buttons
            const allButtons = document.querySelectorAll('button[aria-label]');
            const priceButtons = [];
            for (const btn of allButtons) {
                const label = btn.getAttribute('aria-label') || '';
                if (label.includes('AUD') && label.includes('price')) {
                    priceButtons.push(btn);
                }
            }
            
            for (const priceBtn of priceButtons) {
                // Walk up to find the flight row container
                let row = priceBtn.closest('[class]');
                // Keep walking up until we find a container with time info
                for (let i = 0; i < 10 && row; i++) {
                    const text = row.textContent || '';
                    if (/\d{1,2}:\d{2}(am|pm)/i.test(text) && text.includes('Departure') && text.includes('Arrival')) {
                        break;
                    }
                    row = row.parentElement;
                }
                if (!row) continue;
                
                const text = row.textContent || '';
                
                // Extract times: "6:00am" pattern
                const timeMatches = text.match(/(\d{1,2}:\d{2}(?:am|pm))/gi);
                if (!timeMatches || timeMatches.length < 2) continue;
                
                const depTime = timeMatches[0];
                const arrTime = timeMatches[1];
                
                // Extract airport codes: "SYD - Departure" / "MEL - Arrival" 
                const depAirportMatch = text.match(/([A-Z]{3})\s*-\s*Departure/);
                const arrAirportMatch = text.match(/([A-Z]{3})\s*-\s*Arrival/);
                const depAirport = depAirportMatch ? depAirportMatch[1] : '';
                const arrAirport = arrAirportMatch ? arrAirportMatch[1] : '';
                
                // Extract duration: "1hr 40mins" or "Direct flight - 1hr 40mins travel"
                const durMatch = text.match(/(\d+)hr\s*(\d+)min/i);
                const durationMins = durMatch ? parseInt(durMatch[1]) * 60 + parseInt(durMatch[2]) : 0;
                
                // Direct vs stops
                const isDirect = /direct\s*flight/i.test(text);
                const stopsMatch = text.match(/(\d+)\s*stop/i);
                const stops = isDirect ? 0 : (stopsMatch ? parseInt(stopsMatch[1]) : 0);
                
                // Extract prices from the button aria-label
                // Format: "Club Jetstar price from 76 AUD Regular price from 83 AUD"
                // or: "1 left at this price Club Jetstar price from 96 AUD Regular price from 103 AUD"
                const label = priceBtn.getAttribute('aria-label') || '';
                const regularPriceMatch = label.match(/Regular\s+price\s+from\s+(\d+(?:\.\d+)?)\s+AUD/i);
                const clubPriceMatch = label.match(/Club\s+Jetstar\s+price\s+from\s+(\d+(?:\.\d+)?)\s+AUD/i);
                
                // Use regular price (non-member price)
                const price = regularPriceMatch ? parseFloat(regularPriceMatch[1]) :
                              (clubPriceMatch ? parseFloat(clubPriceMatch[1]) : 0);
                
                if (price <= 0) continue;
                
                // Dedup check: don't add same dep+arr time twice
                const key = depTime + '_' + arrTime;
                if (flights.some(f => f.key === key)) continue;
                
                flights.push({
                    key: key,
                    depTime: depTime,
                    arrTime: arrTime,
                    depAirport: depAirport,
                    arrAirport: arrAirport,
                    durationMins: durationMins,
                    stops: stops,
                    price: price,
                    currency: 'AUD'
                });
            }
            
            return flights;
        }""")

        if not flights_data:
            return []

        booking_url = self._build_booking_url(req)
        offers: list[FlightOffer] = []
        dep_date = req.date_from

        for fd in flights_data:
            try:
                dep_dt = self._parse_time_ampm(fd["depTime"], dep_date)
                arr_dt = self._parse_time_ampm(fd["arrTime"], dep_date)
                # Handle overnight: if arrival is before departure, add a day
                if arr_dt < dep_dt:
                    from datetime import timedelta
                    arr_dt = arr_dt + timedelta(days=1)

                origin = fd.get("depAirport") or req.origin
                destination = fd.get("arrAirport") or req.destination

                seg = FlightSegment(
                    airline="JQ", airline_name="Jetstar",
                    flight_no="",
                    origin=origin, destination=destination,
                    departure=dep_dt, arrival=arr_dt,
                    cabin_class={"M": "economy", "W": "premium_economy", "C": "business", "F": "first"}.get(req.cabin_class or "M", "economy"),
                )
                dur = fd.get("durationMins", 0) * 60
                if dur == 0 and dep_dt and arr_dt:
                    dur = int((arr_dt - dep_dt).total_seconds())

                route = FlightRoute(
                    segments=[seg],
                    total_duration_seconds=max(dur, 0),
                    stopovers=fd.get("stops", 0),
                )
                price = fd["price"]
                flight_key = f"{origin}_{destination}_{fd['depTime']}_{fd['arrTime']}"
                offers.append(FlightOffer(
                    id=f"jq_{hashlib.md5(flight_key.encode()).hexdigest()[:12]}",
                    price=round(price, 2), currency="AUD",
                    price_formatted=f"${price:.2f} AUD",
                    outbound=route, inbound=None,
                    airlines=["Jetstar"], owner_airline="JQ",
                    booking_url=booking_url, is_locked=False,
                    source="jetstar_direct", source_tier="free",
                ))
            except Exception as e:
                logger.debug("Jetstar: DOM flight parse error: %s", e)
                continue

        return offers

    @staticmethod
    def _parse_time_ampm(time_str: str, base_date: datetime) -> datetime:
        """Parse '6:00am' / '7:40pm' into datetime on the given date."""
        m = re.match(r"(\d{1,2}):(\d{2})(am|pm)", time_str, re.IGNORECASE)
        if not m:
            return datetime(2000, 1, 1)
        hour = int(m.group(1))
        minute = int(m.group(2))
        ampm = m.group(3).lower()
        if ampm == "pm" and hour != 12:
            hour += 12
        elif ampm == "am" and hour == 12:
            hour = 0
        return datetime(base_date.year, base_date.month, base_date.day, hour, minute)

    @staticmethod
    def _extract_best_price(flight: dict) -> Optional[float]:
        fares = flight.get("fares") or flight.get("fareProducts") or flight.get("bundles") or []
        best = float("inf")
        for fare in fares:
            if isinstance(fare, dict):
                for key in ["price", "amount", "totalPrice", "basePrice", "fareAmount", "standardFare"]:
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
        for key in ["price", "lowestFare", "totalPrice", "farePrice", "amount", "standardFare"]:
            p = flight.get(key)
            if p is not None:
                try:
                    v = float(p) if not isinstance(p, dict) else float(p.get("amount", 0))
                    if 0 < v < best:
                        best = v
                except (TypeError, ValueError):
                    pass
        return best if best < float("inf") else None

    def _build_segment(self, seg: dict, default_origin: str, default_dest: str, cabin_class: str = "M") -> FlightSegment:
        dep_str = seg.get("departureDateTime") or seg.get("departure") or seg.get("departureDate") or seg.get("std") or ""
        arr_str = seg.get("arrivalDateTime") or seg.get("arrival") or seg.get("arrivalDate") or seg.get("sta") or ""
        flight_no = str(seg.get("flightNumber") or seg.get("flight_no") or seg.get("number") or "").replace(" ", "")
        origin = seg.get("origin") or seg.get("departureStation") or seg.get("departureAirport") or default_origin
        destination = seg.get("destination") or seg.get("arrivalStation") or seg.get("arrivalAirport") or default_dest
        carrier = seg.get("carrierCode") or seg.get("carrier") or seg.get("airline") or "JQ"
        _jq_cabin = {"M": "economy", "W": "premium_economy", "C": "business", "F": "first"}.get(cabin_class, "economy")
        return FlightSegment(
            airline=carrier, airline_name="Jetstar", flight_no=flight_no,
            origin=origin, destination=destination,
            departure=self._parse_dt(dep_str), arrival=self._parse_dt(arr_str),
            cabin_class=_jq_cabin,
        )

    def _build_response(self, offers: list[FlightOffer], req: FlightSearchRequest, elapsed: float) -> FlightSearchResponse:
        offers.sort(key=lambda o: o.price)
        logger.info("Jetstar %s->%s returned %d offers in %.1fs (Playwright)", req.origin, req.destination, len(offers), elapsed)
        h = hashlib.md5(f"jetstar{req.origin}{req.destination}{req.date_from}{req.return_from or ''}".encode()).hexdigest()[:12]
        return FlightSearchResponse(
            search_id=f"fs_{h}", origin=req.origin, destination=req.destination,
            currency="AUD", offers=offers, total_results=len(offers),
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

    async def _search_cached_deals(self, req: FlightSearchRequest) -> list[FlightOffer]:
        try:
            from curl_cffi.requests import AsyncSession
        except Exception as exc:
            logger.debug("Jetstar: fare-cache fallback unavailable: %s", exc)
            return []

        try:
            async with AsyncSession(impersonate="chrome") as session:
                response = await session.get(
                    _FARE_CACHE_URL,
                    headers=_PUBLIC_HEADERS,
                    timeout=30,
                )
        except Exception as exc:
            logger.warning("Jetstar: fare-cache fallback request failed: %s", exc)
            return []

        if response.status_code != 200:
            logger.warning("Jetstar: fare-cache fallback returned HTTP %s", response.status_code)
            return []

        try:
            payload = response.json()
        except Exception as exc:
            logger.warning("Jetstar: fare-cache fallback JSON parse failed: %s", exc)
            return []

        offers: list[FlightOffer] = []
        for sale in payload.get("sales") or []:
            if not self._sale_matches_request(sale, req):
                continue
            offer = self._build_cached_deal_offer(sale, req)
            if offer:
                offers.append(offer)

        offers.sort(key=lambda offer: offer.price)
        return offers

    def _sale_matches_request(self, sale: dict, req: FlightSearchRequest) -> bool:
        if sale.get("departureAirport") != req.origin or sale.get("arrivalAirport") != req.destination:
            return False

        dep_date = req.date_from.date() if isinstance(req.date_from, datetime) else req.date_from
        first = self._parse_dt(sale.get("firstTravelDate"))
        if first.year > 2000 and dep_date < first.date():
            return False
        last = self._parse_dt(sale.get("lastTravelDate"))
        if last.year > 2000 and dep_date > last.date():
            return False

        days_available = sale.get("daysAvailable") or []
        if days_available and dep_date.strftime("%a") not in days_available:
            return False

        return True

    def _build_cached_deal_offer(self, sale: dict, req: FlightSearchRequest) -> Optional[FlightOffer]:
        try:
            price = float(sale.get("dealPrice") or 0)
        except (TypeError, ValueError):
            return None
        if price <= 0:
            return None

        dep_date = req.date_from.date() if isinstance(req.date_from, datetime) else req.date_from
        dep_dt = datetime(dep_date.year, dep_date.month, dep_date.day, 0, 0)
        route = FlightRoute(
            segments=[
                FlightSegment(
                    airline="JQ",
                    airline_name="Jetstar",
                    flight_no="",
                    origin=req.origin,
                    destination=req.destination,
                    departure=dep_dt,
                    arrival=dep_dt,
                    cabin_class={"M": "economy", "W": "premium_economy", "C": "business", "F": "first"}.get(req.cabin_class or "M", "economy"),
                )
            ],
            total_duration_seconds=0,
            stopovers=1 if sale.get("via") else 0,
        )
        currency = sale.get("dealCurrency") or "AUD"
        member_price = sale.get("cjDealPrice")
        conditions: dict[str, Any] = {
            "fare_note": "Jetstar public fare-cache deal",
            "fare_type": sale.get("fareType") or "economy",
            "fare_class": sale.get("fareClass") or "",
            "travel_window_start": sale.get("firstTravelDate") or "",
            "travel_window_end": sale.get("lastTravelDate") or "",
            "days_available": ",".join(sale.get("daysAvailable") or []),
        }
        if member_price is not None:
            conditions["club_jetstar_price"] = f"{float(member_price):.2f}"
        if sale.get("seatLeft"):
            conditions["seat_left"] = sale.get("seatLeft")
        if sale.get("via"):
            conditions["via"] = sale.get("via")

        cache_key = json.dumps(
            {
                "origin": req.origin,
                "destination": req.destination,
                "date": dep_date.isoformat(),
                "price": price,
                "fare_class": sale.get("fareClass") or "",
                "via": sale.get("via") or "",
            },
            sort_keys=True,
        )
        return FlightOffer(
            id=f"jq_sale_{hashlib.md5(cache_key.encode()).hexdigest()[:12]}",
            price=round(price, 2),
            currency=currency,
            price_formatted=(f"${price:.2f} {currency}" if currency == "AUD" else f"{price:.2f} {currency}"),
            outbound=route,
            inbound=None,
            conditions=conditions,
            airlines=["Jetstar"],
            owner_airline="JQ",
            booking_url=self._build_booking_url(req),
            is_locked=False,
            source="jetstar_direct",
            source_tier="free",
        )

    def _combine_rt(
        self,
        ob_offers: list[FlightOffer],
        ib_offers: list[FlightOffer],
        req: FlightSearchRequest,
    ) -> list[FlightOffer]:
        """Cross-multiply OB x IB one-way offers into RT combos."""
        ob_sorted = sorted(ob_offers, key=lambda o: o.price)[:15]
        ib_sorted = sorted(ib_offers, key=lambda o: o.price)[:10]
        dep = req.date_from.strftime("%Y-%m-%d")
        ret = req.return_from.strftime("%Y-%m-%d")
        adults = getattr(req, "adults", 1) or 1
        bk_url = (
            f"https://booking.jetstar.com/au/en/booking/search-flights"
            f"?origin1={req.origin}&destination1={req.destination}"
            f"&departuredate1={dep}&origin2={req.destination}&destination2={req.origin}"
            f"&departuredate2={ret}&ADT={adults}"
        )
        combined: list[FlightOffer] = []
        for ob in ob_sorted:
            for ib in ib_sorted:
                total = round(ob.price + ib.price, 2)
                key = f"{ob.id}_{ib.id}"
                cid = f"jq_rt_{hashlib.md5(key.encode()).hexdigest()[:12]}"
                combined_conditions = {}
                ob_brand = ob.conditions.get("fare_brand") if ob.conditions else ""
                ib_brand = ib.conditions.get("fare_brand") if ib.conditions else ""
                if ob_brand or ib_brand:
                    combined_conditions["fare_brand"] = f"{ob_brand or 'Outbound'} / {ib_brand or 'Inbound'}"
                if ob_brand:
                    combined_conditions["outbound_fare_brand"] = ob_brand
                if ib_brand:
                    combined_conditions["inbound_fare_brand"] = ib_brand
                ob_subheader = ob.conditions.get("bundle_subheader") if ob.conditions else ""
                ib_subheader = ib.conditions.get("bundle_subheader") if ib.conditions else ""
                if ob_subheader:
                    combined_conditions["outbound_bundle_subheader"] = ob_subheader
                if ib_subheader:
                    combined_conditions["inbound_bundle_subheader"] = ib_subheader
                combined.append(FlightOffer(
                    id=cid,
                    price=total,
                    currency="AUD",
                    price_formatted=f"${total:.2f} AUD",
                    outbound=ob.outbound,
                    inbound=ib.outbound,
                    airlines=list(set(ob.airlines + ib.airlines)),
                    owner_airline="JQ",
                    conditions=combined_conditions,
                    booking_url=bk_url,
                    is_locked=False,
                    source="jetstar_direct",
                    source_tier="free",
                ))
        combined.sort(key=lambda o: o.price)
        return combined

    @staticmethod
    def _build_booking_url(req: FlightSearchRequest) -> str:
        dep = req.date_from.strftime("%Y-%m-%d")
        adults = getattr(req, "adults", 1) or 1
        return (
            f"https://booking.jetstar.com/au/en/booking/search-flights"
            f"?origin1={req.origin}&destination1={req.destination}"
            f"&departuredate1={dep}&ADT={adults}"
        )

    def _empty(self, req: FlightSearchRequest) -> FlightSearchResponse:
        h = hashlib.md5(f"jetstar{req.origin}{req.destination}{req.date_from}{req.return_from or ''}".encode()).hexdigest()[:12]
        return FlightSearchResponse(
            search_id=f"fs_{h}", origin=req.origin, destination=req.destination,
            currency="AUD", offers=[], total_results=0,
        )
