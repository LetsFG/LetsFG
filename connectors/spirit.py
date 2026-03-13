"""
Spirit Airlines hybrid scraper — cookie-farm + curl_cffi direct API.

Spirit (IATA: NK) is a US ultra-low-cost carrier operating domestic and
Caribbean/Latin America routes.  Heavy PerimeterX bot protection.

Strategy (hybrid cookie-farm):
1. ONCE per ~15 min: Playwright opens homepage, lets PerimeterX complete its
   JS challenge, then extracts all cookies (_px*, session, etc.).
2. For each search curl_cffi (impersonate="chrome131") uses farmed cookies to:
   a. GET  /api/prod-token/api/v1/token           → bearer token
   b. POST /api/prod-availability/api/availability/v3/search → flight data
3. If API fails, falls back to full Playwright interception flow.

Result: ~2-5 s per search instead of ~30 s with full Playwright.

API details (Navitaire New Skies, discovered Mar 2026):
  Token : GET  https://www.spirit.com/api/prod-token/api/v1/token
  Search: POST https://www.spirit.com/api/prod-availability/api/availability/v3/search
  Body  : {criteria:[{stations:{…},dates:{…}}], passengers:{types:[…]}, codes:{currencyCode}}
  Response: {data:{trips:[{journeysAvailable:[…]}]}}
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import random
import re
import time
from datetime import datetime
from typing import Any, Optional

try:
    from curl_cffi import requests as cffi_requests
    HAS_CURL = True
except ImportError:
    HAS_CURL = False

from models.flights import (
    FlightOffer,
    FlightRoute,
    FlightSearchRequest,
    FlightSearchResponse,
    FlightSegment,
)

logger = logging.getLogger(__name__)

# ── Anti-fingerprint pools ──────────────────────────────────────────────
_VIEWPORTS = [
    {"width": 1366, "height": 768},
    {"width": 1440, "height": 900},
    {"width": 1536, "height": 864},
    {"width": 1920, "height": 1080},
    {"width": 1280, "height": 720},
]
_LOCALES = ["en-US", "en-GB", "en-CA"]
_TIMEZONES = [
    "America/New_York", "America/Chicago", "America/Denver",
    "America/Los_Angeles", "America/Phoenix",
]

# ── API endpoints & curl_cffi settings ──────────────────────────────────
_TOKEN_URL = "https://www.spirit.com/api/prod-token/api/v1/token"
_SEARCH_URL = "https://www.spirit.com/api/prod-availability/api/availability/v3/search"
_HOMEPAGE_URL = "https://www.spirit.com/"
_IMPERSONATE = "chrome131"
_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
_COOKIE_MAX_AGE = 15 * 60  # Re-farm cookies after 15 minutes

# ── Shared cookie-farm state ────────────────────────────────────────────
_farm_lock: Optional[asyncio.Lock] = None
_farmed_cookies: list[dict] = []
_farm_timestamp: float = 0.0

# ── Shared browser singleton via CDP ────────────────────────────────────
_CDP_PORT = 9463
_chrome_proc = None
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
    """Connect to a real Chrome instance via CDP (launched once, reused)."""
    global _chrome_proc, _browser
    lock = _get_lock()
    async with lock:
        if _browser and _browser.is_connected():
            return _browser
        from connectors.browser import get_or_launch_cdp
        _user_data = os.path.join(os.environ.get("TEMP", "/tmp"), "chrome-cdp-spirit")
        _browser, _chrome_proc = await get_or_launch_cdp(_CDP_PORT, _user_data)
        logger.info("Spirit: Chrome ready via CDP (port %d)", _CDP_PORT)
        return _browser


class SpiritConnectorClient:
    """Spirit hybrid scraper — cookie-farm + curl_cffi direct API."""

    def __init__(self, timeout: float = 45.0):
        self.timeout = timeout

    async def close(self):
        pass  # Browser and cookie-farm state are shared singletons

    # ------------------------------------------------------------------
    # Main entry point
    # ------------------------------------------------------------------

    async def search_flights(self, req: FlightSearchRequest) -> FlightSearchResponse:
        """
        Search Spirit flights via hybrid approach.

        Fast path  (~2-5 s): curl_cffi with farmed PX cookies → token → search.
        Slow path (~20-30 s): Playwright farms cookies first, then curl_cffi.
        Fallback  (~30-45 s): Full Playwright interception flow.
        """
        t0 = time.monotonic()

        try:
            # -- Fast path: direct API via curl_cffi --
            api_result = await self._search_via_api(req)
            if api_result is not None:
                elapsed = time.monotonic() - t0
                offers = self._parse_response(api_result, req)
                if offers:
                    return self._build_response(offers, req, elapsed, method="hybrid API")

            # -- API returned no usable data — fall back to Playwright --
            logger.info("Spirit: API path did not return offers, falling back to Playwright")
            return await self._playwright_fallback(req, t0)

        except Exception as e:
            logger.error("Spirit hybrid error: %s", e)
            return self._empty(req)

    # ------------------------------------------------------------------
    # Cookie management  (PX cookie-farm)
    # ------------------------------------------------------------------

    async def _ensure_cookies(self) -> list[dict]:
        """Return valid session cookies, bootstrapping or farming as needed."""
        global _farmed_cookies, _farm_timestamp
        age = time.monotonic() - _farm_timestamp
        if _farmed_cookies and age < _COOKIE_MAX_AGE:
            return _farmed_cookies
        # Try lightweight bootstrap first (curl_cffi homepage visit)
        cookies = await self._bootstrap_session()
        if cookies:
            return cookies
        # Fall back to Playwright cookie farm
        return await self._farm_cookies()

    async def _bootstrap_session(self) -> list[dict]:
        """Try to get PX/session cookies by visiting the homepage with curl_cffi."""
        global _farmed_cookies, _farm_timestamp
        if not HAS_CURL:
            return []
        loop = asyncio.get_event_loop()
        try:
            cookies = await loop.run_in_executor(None, self._bootstrap_session_sync)
            if cookies:
                _farmed_cookies = cookies
                _farm_timestamp = time.monotonic()
                logger.info("Spirit: bootstrapped %d cookies via curl_cffi", len(cookies))
                return cookies
        except Exception as e:
            logger.debug("Spirit: curl_cffi bootstrap failed: %s", e)
        return []

    @staticmethod
    def _bootstrap_session_sync() -> list[dict]:
        """Synchronous: visit spirit.com homepage to capture PX cookies."""
        sess = cffi_requests.Session(impersonate=_IMPERSONATE)
        try:
            r = sess.get(
                _HOMEPAGE_URL,
                headers={
                    "User-Agent": _UA,
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.9",
                },
                timeout=15,
                allow_redirects=True,
            )
            if r.status_code == 200:
                cookies = []
                for name, value in sess.cookies.items():
                    cookies.append({"name": name, "value": value, "domain": ".spirit.com"})
                if cookies:
                    return cookies
        except Exception as e:
            logger.debug("Spirit: homepage fetch failed: %s", e)
        return []

    async def _farm_cookies(self) -> list[dict]:
        """Open Playwright, load Spirit page, let PX solve, extract cookies."""
        global _farmed_cookies, _farm_timestamp
        lock = _get_farm_lock()
        async with lock:
            # Double-check after acquiring lock
            age = time.monotonic() - _farm_timestamp
            if _farmed_cookies and age < _COOKIE_MAX_AGE:
                return _farmed_cookies

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

                logger.info("Spirit: farming cookies via Playwright homepage visit")
                await page.goto(
                    _HOMEPAGE_URL,
                    wait_until="domcontentloaded",
                    timeout=30000,
                )
                await asyncio.sleep(12.0)  # Let PerimeterX fully initialize
                await self._dismiss_cookies(page)
                await asyncio.sleep(1.0)

                cookies = await context.cookies()
                if cookies:
                    _farmed_cookies = cookies
                    _farm_timestamp = time.monotonic()
                    logger.info("Spirit: farmed %d cookies via Playwright", len(cookies))
                    return cookies
                return []

            except Exception as e:
                logger.error("Spirit: cookie farm error: %s", e)
                return []
            finally:
                await context.close()

    # ------------------------------------------------------------------
    # Direct API via curl_cffi
    # ------------------------------------------------------------------

    async def _search_via_api(self, req: FlightSearchRequest) -> Optional[dict]:
        """Try direct API search via curl_cffi with PX cookies.

        Acquires token, POSTs availability search.  Re-farms cookies once if needed.
        Returns parsed JSON on success, None on failure.
        """
        if not HAS_CURL:
            return None
        cookies = await self._ensure_cookies()
        if not cookies:
            logger.info("Spirit: no cookies available for API search")
            return None

        data = await self._api_search(req, cookies)

        # If first attempt fails, re-farm cookies and retry once
        if data is None:
            logger.info("Spirit: API search failed, re-farming cookies")
            cookies = await self._farm_cookies()
            if cookies:
                data = await self._api_search(req, cookies)

        return data

    async def _api_search(
        self, req: FlightSearchRequest, cookies: list[dict],
    ) -> Optional[dict]:
        """GET token + POST search via curl_cffi with given cookies."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._api_search_sync, req, cookies)

    def _api_search_sync(
        self, req: FlightSearchRequest, cookies: list[dict],
    ) -> Optional[dict]:
        """Synchronous curl_cffi: acquire token then POST availability search."""
        sess = cffi_requests.Session(impersonate=_IMPERSONATE)

        # Load farmed cookies into session
        for c in cookies:
            domain = c.get("domain", ".spirit.com")
            sess.cookies.set(c["name"], c["value"], domain=domain)

        # -- Step 1: acquire bearer token --
        token = self._get_token_sync(sess)
        if not token:
            return None

        # -- Step 2: POST availability search --
        dep = req.date_from.strftime("%Y-%m-%d")
        body = {
            "criteria": [{
                "stations": {
                    "originStationCodes": [req.origin],
                    "destinationStationCodes": [req.destination],
                    "searchOriginMacs": True,
                    "searchDestinationMacs": True,
                },
                "dates": {
                    "beginDate": dep,
                    "endDate": dep,
                },
            }],
            "passengers": {
                "types": [{"count": req.adults, "type": "ADT"}],
            },
            "codes": {
                "currencyCode": "USD",
            },
            "numberOfFaresPerJourney": 10,
            "taxesAndFees": "TaxesAndFees",
        }

        if req.children:
            body["passengers"]["types"].append({"count": req.children, "type": "CHD"})
        if req.infants:
            body["passengers"]["types"].append({"count": req.infants, "type": "INF"})

        try:
            r = sess.post(
                _SEARCH_URL,
                json=body,
                headers={
                    "Accept": "application/json, text/plain, */*",
                    "Accept-Language": "en-US,en;q=0.9",
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {token}",
                    "Referer": "https://www.spirit.com/",
                    "Origin": "https://www.spirit.com",
                },
                timeout=20,
            )
        except Exception as e:
            logger.error("Spirit: API search request failed: %s", e)
            return None

        if r.status_code == 403:
            logger.warning("Spirit: API search blocked (403) — PX cookies likely stale")
            return None
        if r.status_code != 200:
            logger.warning("Spirit: API search returned %d", r.status_code)
            return None

        try:
            data = r.json()
        except Exception:
            logger.warning("Spirit: API search returned non-JSON body")
            return None

        # Validate we have flight data
        inner = data.get("data", data) if isinstance(data, dict) else None
        if not inner:
            return None
        trips = inner.get("trips", []) if isinstance(inner, dict) else []
        if not trips:
            logger.debug("Spirit: API search returned no trips")
            return None

        return data

    @staticmethod
    def _get_token_sync(sess) -> Optional[str]:
        """GET /api/prod-token/api/v1/token → bearer token string."""
        try:
            r = sess.get(
                _TOKEN_URL,
                headers={
                    "Accept": "application/json, text/plain, */*",
                    "Accept-Language": "en-US,en;q=0.9",
                    "Referer": "https://www.spirit.com/",
                },
                timeout=10,
            )
        except Exception as e:
            logger.error("Spirit: token request failed: %s", e)
            return None

        if r.status_code == 403:
            logger.warning("Spirit: token endpoint blocked (403) — PerimeterX active")
            return None
        if r.status_code != 200:
            logger.warning("Spirit: token endpoint returned %d", r.status_code)
            return None

        try:
            body = r.json()
        except Exception:
            logger.warning("Spirit: token endpoint returned non-JSON")
            return None

        # Token may be at body.data.token, body.token, or body itself
        if isinstance(body, dict):
            d = body.get("data", body)
            if isinstance(d, dict):
                tok = d.get("token") or d.get("access_token")
                if tok:
                    logger.info("Spirit: acquired bearer token (len=%d)", len(str(tok)))
                    return str(tok)
            # Fallback: top-level
            tok = body.get("token") or body.get("access_token")
            if tok:
                return str(tok)

        logger.warning("Spirit: could not extract token from response")
        return None

    # ------------------------------------------------------------------
    # Playwright fallback (full browser flow)
    # ------------------------------------------------------------------

    async def _playwright_fallback(
        self, req: FlightSearchRequest, t0: float,
    ) -> FlightSearchResponse:
        """Full Playwright interception flow as fallback when API path fails."""
        for attempt in range(3):
            browser = await _get_browser()
            context = await browser.new_context(
                viewport=random.choice(_VIEWPORTS),
                locale=random.choice(_LOCALES),
                timezone_id=random.choice(_TIMEZONES),
                service_workers="block",
            )
            try:
                result = await self._attempt_search(context, req, t0)
                if result and result.total_results > 0:
                    # Also update cookie farm from this successful session
                    global _farmed_cookies, _farm_timestamp
                    try:
                        _farmed_cookies = await context.cookies()
                        _farm_timestamp = time.monotonic()
                    except Exception:
                        pass
                    return result
                if attempt < 2:
                    logger.info(
                        "Spirit: Playwright attempt %d returned no results, retrying",
                        attempt + 1,
                    )
            except Exception as e:
                logger.warning("Spirit: Playwright attempt %d error: %s", attempt + 1, e)
            finally:
                await context.close()
            await asyncio.sleep(2.0)

        logger.warning("Spirit: all Playwright attempts exhausted for %s->%s", req.origin, req.destination)
        return self._empty(req)

    async def _attempt_search(self, context, req: FlightSearchRequest, t0: float) -> FlightSearchResponse:
        """Single Playwright search attempt within a fresh browser context."""
        try:
            from playwright_stealth import stealth_async
            page = await context.new_page()
            await stealth_async(page)
        except ImportError:
            page = await context.new_page()

        captured_data: dict = {}
        api_event = asyncio.Event()
        px_blocked = {"token": False}

        async def on_response(response):
            try:
                url = response.url
                # Detect PX block on token endpoint
                if "/api/prod-token/" in url and response.status == 403:
                    px_blocked["token"] = True
                if response.status == 200 and (
                    "/api/prod-availability/api/availability/v3/search" in url
                    or ("/availability" in url and "/search" in url)
                ):
                    ct = response.headers.get("content-type", "")
                    if "json" in ct:
                        data = await response.json()
                        if data and isinstance(data, dict):
                            captured_data["json"] = data
                            api_event.set()
                            logger.info("Spirit: captured search API response")
            except Exception:
                pass

        page.on("response", on_response)

        logger.info("Spirit: loading homepage for %s->%s (Playwright)", req.origin, req.destination)
        await page.goto(
            _HOMEPAGE_URL,
            wait_until="domcontentloaded",
            timeout=int(self.timeout * 1000),
        )
        await asyncio.sleep(12.0)  # Let PerimeterX fully initialize

        await self._dismiss_cookies(page)
        await asyncio.sleep(0.5)
        await self._dismiss_cookies(page)

        # Check if PX already blocked the token (Angular fetches it on page load)
        if px_blocked["token"]:
            logger.warning("Spirit: PerimeterX blocked token endpoint — session poisoned")
            return self._empty(req)

        await self._set_one_way(page)
        await asyncio.sleep(0.5)

        ok = await self._fill_airport_field(page, "From", req.origin, 0)
        if not ok:
            logger.warning("Spirit: origin fill failed")
            return self._empty(req)
        await asyncio.sleep(0.5)

        ok = await self._fill_airport_field(page, "To", req.destination, 1)
        if not ok:
            logger.warning("Spirit: destination fill failed")
            return self._empty(req)
        await asyncio.sleep(0.5)

        # Check PX again after form fill (Angular may refresh token)
        if px_blocked["token"]:
            logger.warning("Spirit: PerimeterX blocked token during form fill")
            return self._empty(req)

        ok = await self._fill_date(page, req)
        if not ok:
            logger.warning("Spirit: date fill failed")
            return self._empty(req)
        await asyncio.sleep(0.3)

        await self._click_search(page)

        remaining = max(self.timeout - (time.monotonic() - t0), 10)
        try:
            await asyncio.wait_for(api_event.wait(), timeout=min(remaining, 25))
        except asyncio.TimeoutError:
            if px_blocked["token"]:
                logger.warning("Spirit: search timed out (PX blocked token)")
            else:
                logger.warning("Spirit: timed out waiting for API response")
            return self._empty(req)

        data = captured_data.get("json", {})
        if not data:
            return self._empty(req)

        elapsed = time.monotonic() - t0
        offers = self._parse_response(data, req)
        return self._build_response(offers, req, elapsed, method="Playwright")

    # ------------------------------------------------------------------
    # UI helpers (Playwright form interaction)
    # ------------------------------------------------------------------

    async def _dismiss_cookies(self, page) -> None:
        for label in [
            "Accept all cookies", "Accept All", "Accept", "I agree",
            "Got it", "OK", "Close", "Dismiss",
        ]:
            try:
                btn = page.get_by_role("button", name=re.compile(rf"^{re.escape(label)}$", re.IGNORECASE))
                if await btn.count() > 0:
                    await btn.first.click(timeout=2000)
                    await asyncio.sleep(0.5)
                    break
            except Exception:
                continue
        # Force-remove modals, PX captcha iframes, and overlays
        try:
            await page.evaluate("""() => {
                document.querySelectorAll(
                    'ngb-modal-window, ngb-modal-backdrop, [class*="modal-backdrop"], ' +
                    '#px-captcha-modal, [id*="px-captcha"], ' +
                    '[class*="cookie"], [id*="cookie"], [class*="consent"], [id*="consent"], ' +
                    '[class*="onetrust"], [id*="onetrust"]'
                ).forEach(el => el.remove());
                document.body.classList.remove('modal-open');
                document.body.style.overflow = 'auto';
            }""")
        except Exception:
            pass

    async def _set_one_way(self, page) -> None:
        """Select One Way trip type via the custom dropdown toggle."""
        try:
            # Spirit uses a checkbox toggle to open the trip type dropdown
            await page.evaluate("""() => {
                const toggle = document.getElementById('dropdown-toggle-controler-toggleId');
                if (toggle) toggle.click();
            }""")
            await asyncio.sleep(0.8)
            # Click the "One Way" label that appears
            ow_label = page.locator("label").filter(has_text=re.compile(r"one\s*way", re.IGNORECASE))
            if await ow_label.count() > 0:
                await ow_label.first.click(timeout=5000)
                await asyncio.sleep(0.5)
                logger.info("Spirit: selected One Way trip type")
                return
            # Fallback: JS click
            await page.evaluate("""() => {
                const labels = document.querySelectorAll('label');
                for (const l of labels) {
                    if (l.textContent.trim().match(/one\\s*way/i)) { l.click(); return; }
                }
            }""")
            await asyncio.sleep(0.5)
        except Exception as e:
            logger.debug("Spirit: trip type error: %s", e)

    async def _fill_airport_field(self, page, label: str, iata: str, index: int) -> bool:
        """Fill airport field using Spirit's station picker (requires city name, not IATA)."""
        field_id = "flight-OriginStationCode" if index == 0 else "flight-DestinationStationCode"
        label_cls = "label.fromStation" if index == 0 else "label.toStation"
        city_name = await self._iata_to_city(page, iata)
        try:
            await self._dismiss_cookies(page)
            # Click label to open the station picker
            await page.evaluate(f"() => document.querySelector('{label_cls}')?.click()")
            await asyncio.sleep(0.5)
            # Focus the input via JS (bypasses label overlay)
            await page.evaluate(f"""() => {{
                const el = document.getElementById('{field_id}');
                if (el) {{ el.focus(); el.select(); }}
            }}""")
            await asyncio.sleep(0.3)
            await page.keyboard.press("Control+a")
            await page.keyboard.press("Backspace")
            await asyncio.sleep(0.3)
            await page.keyboard.type(city_name, delay=80)
            await asyncio.sleep(2.5)
            # Click station suggestion using Playwright (not JS — Angular model needs real click)
            suggestion = page.locator(
                "div.station-picker-typeahead__station-list[role='button']"
            ).filter(has_text=re.compile(rf"\b{re.escape(iata)}\b", re.IGNORECASE))
            if await suggestion.count() > 0:
                await suggestion.first.click(timeout=5000)
                logger.info("Spirit: selected %s (%s) for %s", iata, city_name, label)
                return True
            # Fallback: try typing IATA directly
            await page.evaluate(f"""() => {{
                const el = document.getElementById('{field_id}');
                if (el) {{ el.focus(); el.value = ''; }}
            }}""")
            await asyncio.sleep(0.3)
            await page.keyboard.type(iata, delay=80)
            await asyncio.sleep(2.5)
            suggestion = page.locator(
                "div.station-picker-typeahead__station-list[role='button']"
            ).filter(has_text=re.compile(rf"\b{re.escape(iata)}\b", re.IGNORECASE))
            if await suggestion.count() > 0:
                await suggestion.first.click(timeout=5000)
                logger.info("Spirit: selected %s for %s (IATA fallback)", iata, label)
                return True
            logger.warning("Spirit: no suggestion found for %s/%s", iata, city_name)
            return False
        except Exception as e:
            logger.debug("Spirit: %s field error: %s", label, e)
            return False

    async def _iata_to_city(self, page, iata: str) -> str:
        """Look up city name for an IATA code via Spirit's station API."""
        try:
            stations = await page.evaluate("""() =>
                fetch('/api/prod-station/api/resources/v2/stations', {credentials: 'same-origin'})
                    .then(r => r.ok ? r.json() : null).catch(() => null)
            """)
            if stations and isinstance(stations, dict):
                items = stations.get("data", [])
                for s in (items if isinstance(items, list) else []):
                    code = s.get("stationCode", "")
                    if code.upper() == iata.upper():
                        # shortName is like "Fort Lauderdale, FL" — extract city part
                        name = s.get("shortName") or s.get("fullName") or ""
                        city = name.split(",")[0].strip() if name else ""
                        if city:
                            logger.debug("Spirit: station API: %s -> %s", iata, city)
                            return city
        except Exception as e:
            logger.debug("Spirit: station API lookup failed: %s", e)
        return iata

    async def _fill_date(self, page, req: FlightSearchRequest) -> bool:
        """Fill departure date via Spirit's calendar-selection trigger + bs-datepicker."""
        target = req.date_from
        try:
            await self._dismiss_cookies(page)
            # Open calendar by clicking the calendar-selection div
            cal_trigger = page.locator("div.calendar-selection").first
            try:
                await cal_trigger.click(timeout=5000)
            except Exception:
                await self._dismiss_cookies(page)
                await asyncio.sleep(0.3)
                await cal_trigger.click(force=True, timeout=5000)
            await asyncio.sleep(1)

            # Navigate to the target month (month name and year are separate button.current elements)
            target_month = target.strftime("%B")
            target_year = str(target.year)
            for _ in range(12):
                headers = await page.evaluate("""() => {
                    const el = document.querySelector('bs-datepicker-container, bs-daterangepicker-container');
                    if (!el || !el.offsetHeight) return [];
                    return Array.from(el.querySelectorAll('button.current')).map(b => b.textContent.trim());
                }""")
                month_ok = any(target_month.lower() in h.lower() for h in headers)
                year_ok = any(target_year in h for h in headers)
                if month_ok and year_ok:
                    break
                nxt = page.locator(
                    "bs-datepicker-container .next, bs-daterangepicker-container .next"
                ).first
                if await nxt.count() > 0:
                    await nxt.click(timeout=2000)
                    await asyncio.sleep(0.5)
                else:
                    break

            # Click the target day (exclude .is-other-month days)
            day_str = str(target.day)
            await page.evaluate(f"""() => {{
                const containers = document.querySelectorAll(
                    'bs-datepicker-container, bs-daterangepicker-container'
                );
                for (const c of containers) {{
                    const spans = c.querySelectorAll('td span');
                    for (const s of spans) {{
                        if (s.textContent.trim() === '{day_str}' && !s.closest('.is-other-month')) {{
                            s.click();
                            return;
                        }}
                    }}
                }}
            }}""")
            await asyncio.sleep(0.5)
            await page.keyboard.press("Escape")
            await asyncio.sleep(0.3)
            logger.info("Spirit: departure date set to %s", target.strftime("%m/%d/%Y"))
            return True
        except Exception as e:
            logger.warning("Spirit: date error: %s", e)
            return False

    async def _click_search(self, page) -> None:
        await self._dismiss_cookies(page)
        # Remove datepicker containers that may overlay the search button
        try:
            await page.evaluate("""() => {
                document.querySelectorAll(
                    'bs-datepicker-container, bs-daterangepicker-container'
                ).forEach(el => el.remove());
            }""")
        except Exception:
            pass
        await asyncio.sleep(0.3)
        btn = page.locator("button[type='submit']").filter(
            has_text=re.compile(r"search", re.IGNORECASE)
        )
        if await btn.count() > 0:
            try:
                await btn.first.click(timeout=10000)
                logger.info("Spirit: clicked search")
                return
            except Exception:
                pass
        # Fallback: any submit button
        try:
            await page.locator("button[type='submit']").first.click(timeout=5000)
        except Exception:
            await page.keyboard.press("Enter")

    # ------------------------------------------------------------------
    # Response parsing  (shared by API and Playwright paths)
    # ------------------------------------------------------------------

    def _parse_response(self, data: Any, req: FlightSearchRequest) -> list[FlightOffer]:
        """Parse Spirit availability/v3/search response.

        Structure: data.trips[].journeysAvailable[].fares{<key>: {details: {passengerFares: [{fareAmount}]}}}
        """
        booking_url = self._build_booking_url(req)
        offers: list[FlightOffer] = []

        trips = []
        if isinstance(data, dict):
            d = data.get("data", data)
            trips = d.get("trips", []) if isinstance(d, dict) else []
        if not isinstance(trips, list):
            trips = []

        for trip in trips:
            if not isinstance(trip, dict):
                continue
            journeys = trip.get("journeysAvailable", [])
            if not isinstance(journeys, list):
                continue
            for journey in journeys:
                if not isinstance(journey, dict) or not journey.get("isSelectable", True):
                    continue
                offer = self._parse_journey(journey, req, booking_url)
                if offer:
                    offers.append(offer)
        return offers

    def _parse_journey(self, journey: dict, req: FlightSearchRequest, booking_url: str) -> Optional[FlightOffer]:
        """Parse a single journey (one itinerary option) into a FlightOffer."""
        fares = journey.get("fares", {})
        if not isinstance(fares, dict) or not fares:
            return None

        # Find cheapest fare
        best_price = float("inf")
        for fare_val in fares.values():
            det = fare_val.get("details", {}) if isinstance(fare_val, dict) else {}
            for pf in det.get("passengerFares", []):
                amt = pf.get("fareAmount")
                if isinstance(amt, (int, float)) and 0 < amt < best_price:
                    best_price = amt
        if best_price == float("inf"):
            return None

        # Build segments from journey.segments
        segments_raw = journey.get("segments", [])
        segments: list[FlightSegment] = []
        for seg in (segments_raw if isinstance(segments_raw, list) else []):
            des = seg.get("designator", {})
            ident = seg.get("identifier", {})
            carrier = ident.get("carrierCode", "NK")
            flight_num = ident.get("identifier", "")
            segments.append(FlightSegment(
                airline=carrier,
                airline_name="Spirit Airlines" if carrier == "NK" else carrier,
                flight_no=f"{carrier}{flight_num}",
                origin=des.get("origin", req.origin),
                destination=des.get("destination", req.destination),
                departure=self._parse_dt(des.get("departure", "")),
                arrival=self._parse_dt(des.get("arrival", "")),
                cabin_class="M",
            ))

        if not segments:
            # Fallback: use journey-level designator
            des = journey.get("designator", {})
            segments.append(FlightSegment(
                airline="NK", airline_name="Spirit Airlines", flight_no="",
                origin=des.get("origin", req.origin),
                destination=des.get("destination", req.destination),
                departure=self._parse_dt(des.get("departure", "")),
                arrival=self._parse_dt(des.get("arrival", "")),
                cabin_class="M",
            ))

        total_dur = 0
        if segments[0].departure and segments[-1].arrival:
            total_dur = int((segments[-1].arrival - segments[0].departure).total_seconds())

        route = FlightRoute(
            segments=segments,
            total_duration_seconds=max(total_dur, 0),
            stopovers=max(len(segments) - 1, 0),
        )
        jk = journey.get("journeyKey", f"{time.monotonic()}")
        return FlightOffer(
            id=f"nk_{hashlib.md5(str(jk).encode()).hexdigest()[:12]}",
            price=round(best_price, 2),
            currency="USD",
            price_formatted=f"${best_price:.2f}",
            outbound=route,
            inbound=None,
            airlines=["Spirit"],
            owner_airline="NK",
            booking_url=booking_url,
            is_locked=False,
            source="spirit_direct",
            source_tier="free",
        )

    # ------------------------------------------------------------------
    # Utilities
    # ------------------------------------------------------------------

    def _build_response(
        self, offers: list[FlightOffer], req: FlightSearchRequest,
        elapsed: float, *, method: str = "hybrid",
    ) -> FlightSearchResponse:
        offers.sort(key=lambda o: o.price)
        logger.info(
            "Spirit %s->%s returned %d offers in %.1fs (%s)",
            req.origin, req.destination, len(offers), elapsed, method,
        )
        h = hashlib.md5(f"spirit{req.origin}{req.destination}{req.date_from}".encode()).hexdigest()[:12]
        return FlightSearchResponse(
            search_id=f"fs_{h}", origin=req.origin, destination=req.destination,
            currency="USD", offers=offers, total_results=len(offers),
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
    def _build_booking_url(req: FlightSearchRequest) -> str:
        dep = req.date_from.strftime("%Y-%m-%d")
        return (
            f"https://www.spirit.com/book/flights?from={req.origin}"
            f"&to={req.destination}&date={dep}&pax={req.adults}&tripType=OW"
        )

    def _empty(self, req: FlightSearchRequest) -> FlightSearchResponse:
        h = hashlib.md5(f"spirit{req.origin}{req.destination}{req.date_from}".encode()).hexdigest()[:12]
        return FlightSearchResponse(
            search_id=f"fs_{h}", origin=req.origin, destination=req.destination,
            currency="USD", offers=[], total_results=0,
        )
