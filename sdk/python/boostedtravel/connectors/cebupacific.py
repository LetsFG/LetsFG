"""
Cebu Pacific Playwright scraper -- navigates to cebupacificair.com and searches flights.

Cebu Pacific (IATA: 5J) is the Philippines' largest LCC. Uses Navitaire
booking engine. Heavy bot protection (Akamai + Datadome).

Strategy:
1. Navigate to cebupacificair.com/en-ph homepage
2. Dismiss cookie/overlay banners
3. Fill search form (origin, destination, date, one-way)
4. Intercept API responses (Navitaire availability endpoints)
5. Parse results -> FlightOffers

Homepage observations (Mar 2026):
- Navitaire booking engine at book.cebupacificair.com
- Heavy tracking (TikTok, Facebook, Kakao, Appier, DTM)
- Search form with origin/destination autocomplete, date picker
- One-way / round-trip toggle
- API: Navitaire nskts/navi availability endpoints
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import random
import re
import subprocess
import time
from datetime import datetime
from typing import Any, Optional

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
_LOCALES = ["en-US", "en-GB", "en-PH", "en-SG"]
_TIMEZONES = [
    "Asia/Manila", "Asia/Singapore", "Asia/Kuala_Lumpur",
    "Asia/Bangkok", "Asia/Ho_Chi_Minh",
]

# ── Shared browser singleton via CDP ────────────────────────────────────
_CDP_PORT = 9459
_chrome_proc = None
_browser = None
_browser_lock: Optional[asyncio.Lock] = None


def _get_lock() -> asyncio.Lock:
    global _browser_lock
    if _browser_lock is None:
        _browser_lock = asyncio.Lock()
    return _browser_lock


async def _get_browser():
    """Connect to a real Chrome instance via CDP (launched once, reused)."""
    global _chrome_proc, _browser
    lock = _get_lock()
    async with lock:
        if _browser and _browser.is_connected():
            return _browser
        from playwright.async_api import async_playwright

        from boostedtravel.connectors.browser import find_chrome, stealth_args, stealth_popen_kwargs
        chrome_path = find_chrome()
        user_data = os.path.join(os.environ.get("TEMP", "/tmp"), "chrome-cdp-cebupacific")
        _chrome_proc = subprocess.Popen([
            chrome_path,
            f"--remote-debugging-port={_CDP_PORT}",
            f"--user-data-dir={user_data}",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-blink-features=AutomationControlled",
            *stealth_args(),
        ], **stealth_popen_kwargs())
        await asyncio.sleep(1.5)

        pw = await async_playwright().start()
        _browser = await pw.chromium.connect_over_cdp(f"http://127.0.0.1:{_CDP_PORT}")
        logger.info("CebuPacific: Connected to real Chrome via CDP (port %d)", _CDP_PORT)
        return _browser


class CebuPacificConnectorClient:
    """CebuPacific Playwright scraper -- homepage form search + API interception."""

    def __init__(self, timeout: float = 45.0):
        self.timeout = timeout

    async def close(self):
        pass

    async def search_flights(self, req: FlightSearchRequest) -> FlightSearchResponse:
        t0 = time.monotonic()
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

            try:
                cdp = await context.new_cdp_session(page)
                await cdp.send("Network.setCacheDisabled", {"cacheDisabled": True})
            except Exception:
                pass

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

            logger.info("CebuPacific: loading homepage for %s->%s", req.origin, req.destination)
            await page.goto(
                "https://www.cebupacificair.com/en-ph",
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
                logger.warning("CebuPacific: origin fill failed")
                return self._empty(req)
            await asyncio.sleep(0.5)

            ok = await self._fill_airport_field(page, "To", req.destination, 1)
            if not ok:
                logger.warning("CebuPacific: destination fill failed")
                return self._empty(req)
            await asyncio.sleep(0.5)

            ok = await self._fill_date(page, req)
            if not ok:
                logger.warning("CebuPacific: date fill failed")
                return self._empty(req)
            await asyncio.sleep(0.3)

            await self._click_search(page)

            remaining = max(self.timeout - (time.monotonic() - t0), 10)
            try:
                await asyncio.wait_for(api_event.wait(), timeout=remaining)
            except asyncio.TimeoutError:
                logger.warning("CebuPacific: timed out waiting for API response")
                offers = await self._extract_from_dom(page, req)
                if offers:
                    return self._build_response(offers, req, time.monotonic() - t0)
                return self._empty(req)

            data = captured_data.get("json", {})
            if not data:
                return self._empty(req)

            elapsed = time.monotonic() - t0
            offers = self._parse_response(data, req)
            return self._build_response(offers, req, elapsed)

        except Exception as e:
            logger.error("CebuPacific Playwright error: %s", e)
            return self._empty(req)
        finally:
            await context.close()

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
        try:
            await page.evaluate("""() => {
                document.querySelectorAll(
                    '[class*="cookie"], [id*="cookie"], [class*="consent"], [id*="consent"], ' +
                    '[class*="Cookie"], [id*="Cookie"], [class*="onetrust"], [id*="onetrust"], ' +
                    '[class*="modal-overlay"], [class*="popup"], [id*="popup"], ' +
                    '[class*="privacy"], [id*="privacy"], [class*="smartech"], [class*="notification"]'
                ).forEach(el => { if (el.offsetHeight > 0) el.remove(); });
                document.body.style.overflow = 'auto';
            }""")
        except Exception:
            pass

    async def _set_one_way(self, page) -> None:
        # Radio / tab / toggle button for one-way selection
        for label in ["One-way", "One Way", "One way", "ONE WAY"]:
            try:
                radio = page.get_by_role("radio", name=re.compile(rf"{re.escape(label)}", re.IGNORECASE))
                if await radio.count() > 0:
                    await radio.first.click(timeout=2000)
                    return
            except Exception:
                continue
        for role in ["tab", "button"]:
            try:
                el = page.get_by_role(role, name=re.compile(r"one.?way", re.IGNORECASE))
                if await el.count() > 0:
                    await el.first.click(timeout=2000)
                    return
            except Exception:
                continue
        for label in ["One-way", "One Way", "One way"]:
            try:
                el = page.get_by_text(label, exact=False).first
                if await el.count() > 0:
                    await el.click(timeout=2000)
                    return
            except Exception:
                continue
        # JS fallback: click one-way elements by data attributes or class
        try:
            await page.evaluate("""() => {
                const sels = [
                    '[data-testid*="one-way"]', '[class*="one-way"]', '[class*="oneway"]',
                    'label[for*="oneway"]', 'label[for*="one-way"]',
                    'input[value="OW"]', 'input[value="oneway"]',
                ];
                for (const sel of sels) {
                    const el = document.querySelector(sel);
                    if (el && el.offsetHeight > 0) { el.click(); return; }
                }
            }""")
        except Exception:
            pass

    @staticmethod
    def _sanitize_iata(code: str) -> str:
        """Return a sanitized IATA code (2-4 uppercase letters) safe for selectors."""
        clean = re.sub(r"[^A-Za-z]", "", code)[:4].upper()
        return clean if 2 <= len(clean) <= 4 else ""

    async def _fill_airport_field(self, page, label: str, iata: str, index: int) -> bool:
        """Fill origin/destination on CebuPacific's Navitaire booking form.

        Uses multiple strategies to locate the station input and select the
        autocomplete suggestion, modelled after the Scoot connector's approach
        for Navitaire Angular SPAs.
        """
        iata = self._sanitize_iata(iata)
        if not iata:
            return False
        is_origin = index == 0

        # ── Strategy 1: Navitaire-standard element IDs via JS ────────────
        # Navitaire Angular SPAs often duplicate IDs across hidden tabs; use
        # JS to target the *visible* instance (offsetHeight > 0).
        navitaire_ids = (
            ["originStation", "origin", "flight-OriginStationCode", "fromCity", "departureStation"]
            if is_origin
            else ["destinationStation", "destination", "flight-DestinationStationCode", "toCity", "arrivalStation"]
        )
        # Shared JS helper finds a visible <input> by ID / name / data-testid.
        _FIND_VISIBLE_INPUT_JS = """(fieldId) => {
            const sel = 'input#' + CSS.escape(fieldId) +
                ', input[name="' + CSS.escape(fieldId) + '"]' +
                ', input[data-testid="' + CSS.escape(fieldId) + '"]';
            const els = document.querySelectorAll(sel);
            for (const el of els) {
                if (el.offsetHeight > 0 || el.offsetParent !== null) return el;
            }
            return null;
        }"""
        for field_id in navitaire_ids:
            try:
                clicked = await page.evaluate(
                    """(fieldId) => {
                        const find = """ + _FIND_VISIBLE_INPUT_JS + """;
                        const el = find(fieldId);
                        if (!el) return false;
                        el.scrollIntoView({block: 'center'});
                        el.click();
                        el.focus();
                        return true;
                    }""",
                    field_id,
                )
                if clicked:
                    await asyncio.sleep(0.4)
                    await page.evaluate(
                        """(fieldId) => {
                            const find = """ + _FIND_VISIBLE_INPUT_JS + """;
                            const el = find(fieldId);
                            if (!el) return;
                            el.value = '';
                            el.dispatchEvent(new Event('input', {bubbles: true}));
                            el.dispatchEvent(new Event('change', {bubbles: true}));
                        }""",
                        field_id,
                    )
                    await asyncio.sleep(0.2)
                    await page.keyboard.type(iata, delay=80)
                    await asyncio.sleep(2.5)
                    if await self._click_station_suggestion(page, iata):
                        logger.info("CebuPacific: selected %s via Navitaire ID #%s", iata, field_id)
                        return True
            except Exception:
                continue

        # ── Strategy 2: Playwright role-based selectors ──────────────────
        labels = ["From", "Origin", "Departure", "Flying from", "Where from"] if is_origin else ["To", "Destination", "Arrival", "Flying to", "Where to"]
        try:
            for lbl in labels:
                for role in ["combobox", "textbox", "searchbox"]:
                    field = page.get_by_role(role, name=re.compile(rf"{lbl}", re.IGNORECASE))
                    if await field.count() > 0:
                        await field.first.click(timeout=3000)
                        await asyncio.sleep(0.3)
                        await field.first.fill("")
                        await asyncio.sleep(0.2)
                        await field.first.fill(iata)
                        await asyncio.sleep(2.5)
                        if await self._click_station_suggestion(page, iata):
                            logger.info("CebuPacific: selected %s via role=%s name=%s", iata, role, lbl)
                            return True
                        await page.keyboard.press("Enter")
                        return True
        except Exception as e:
            logger.debug("CebuPacific: role-based %s field error: %s", label, e)

        # ── Strategy 3: placeholder / aria-label attribute selectors ─────
        placeholders = (
            ["From", "Origin", "Departure City", "Flying from", "Where from"]
            if is_origin
            else ["To", "Destination", "Arrival City", "Flying to", "Where to"]
        )
        for ph in placeholders:
            try:
                field = page.locator(
                    f"input[placeholder*='{ph}' i], "
                    f"input[aria-label*='{ph}' i]"
                ).first
                if await field.count() > 0:
                    await field.click(timeout=3000)
                    await asyncio.sleep(0.3)
                    await field.fill("")
                    await asyncio.sleep(0.2)
                    await field.fill(iata)
                    await asyncio.sleep(2.5)
                    if await self._click_station_suggestion(page, iata):
                        logger.info("CebuPacific: selected %s via placeholder/aria '%s'", iata, ph)
                        return True
                    await page.keyboard.press("Enter")
                    return True
            except Exception:
                continue

        # ── Strategy 4: index-based fallback (last resort) ───────────────
        try:
            inputs = page.locator("input[type='text'], input[type='search'], input[placeholder]")
            if await inputs.count() > index:
                field = inputs.nth(index)
                await field.click(timeout=3000)
                await field.fill("")
                await asyncio.sleep(0.2)
                await field.fill(iata)
                await asyncio.sleep(2.5)
                if await self._click_station_suggestion(page, iata):
                    return True
                await page.keyboard.press("Enter")
                return True
        except Exception:
            pass
        return False

    async def _click_station_suggestion(self, page, iata: str) -> bool:
        """Click the autocomplete suggestion matching *iata* in the station overlay.

        Tries multiple Navitaire-specific selector patterns used across
        CebuPacific, Scoot, Spirit, and other Navitaire Angular SPAs.
        *iata* is already sanitized by the caller (_sanitize_iata).
        """
        # JS-based: search overlay containers for a matching station.
        # The iata parameter is pre-validated as 2-4 alpha chars by
        # _sanitize_iata, so it is safe to use in textContent comparisons.
        # Attribute selectors use CSS.escape() for defence-in-depth.
        try:
            clicked = await page.evaluate("""(iata) => {
                const esc = CSS.escape(iata);
                const overlays = document.querySelectorAll(
                    '.stations-overlay, .station-list, .airport-list, ' +
                    '[class*="suggestion"], [class*="autocomplete"], [class*="dropdown"], ' +
                    '[class*="search-result"], [class*="station-picker"], [class*="airport-picker"], ' +
                    'ul[role="listbox"], div[role="listbox"]'
                );
                for (const ov of overlays) {
                    if (ov.offsetHeight === 0) continue;
                    const byAria = ov.querySelector('div[aria-label="' + esc + '"], li[aria-label="' + esc + '"]');
                    if (byAria && byAria.offsetHeight > 0) { byAria.click(); return 'aria-label'; }
                    const codes = ov.querySelectorAll('.code, .iata, .station-code, .airport-code, [class*="iata"], [class*="code"]');
                    for (const c of codes) {
                        if (c.textContent.trim() === iata && c.offsetHeight > 0) {
                            (c.closest('[role="option"], [role="button"], li, .station-item, .airport-item') || c.parentElement).click();
                            return 'code-class';
                        }
                    }
                    const items = ov.querySelectorAll(
                        'div.station-item, div.airport-item, li, ' +
                        '[role="option"], [role="button"], [role="listitem"]'
                    );
                    for (const item of items) {
                        if (item.textContent.includes(iata) && item.offsetHeight > 0) {
                            item.click();
                            return 'text-match';
                        }
                    }
                }
                // Global fallback: any visible element with role="option" containing IATA
                const opts = document.querySelectorAll('[role="option"], [role="listitem"]');
                for (const o of opts) {
                    if (o.textContent.includes(iata) && o.offsetHeight > 0) {
                        o.click();
                        return 'role-option';
                    }
                }
                return null;
            }""", iata)
            if clicked:
                await asyncio.sleep(0.5)
                return True
        except Exception:
            pass

        # Playwright fallback: role-based option/listitem selectors
        for role in ["option", "button", "listitem", "link"]:
            try:
                option = page.get_by_role(role, name=re.compile(rf"{re.escape(iata)}", re.IGNORECASE)).first
                if await option.count() > 0:
                    await option.click(timeout=3000)
                    return True
            except Exception:
                continue

        # CSS class-based fallback
        try:
            item = page.locator(
                "[class*='suggestion'], [class*='option'], [class*='result'], "
                "[class*='autocomplete'] li, [class*='dropdown'] li, "
                "[class*='airport'] li, [class*='station'] li"
            ).filter(has_text=re.compile(rf"{re.escape(iata)}", re.IGNORECASE)).first
            if await item.count() > 0:
                await item.click(timeout=3000)
                return True
        except Exception:
            pass
        return False

    async def _fill_date(self, page, req: FlightSearchRequest) -> bool:
        target = req.date_from
        try:
            # ── Open the date picker ─────────────────────────────────
            # Try Navitaire-specific IDs first (e.g. #departureDate)
            opened = False
            for sel in [
                "#departureDate", "#depart-date", "#date-picker-origin",
                "input[name='departureDate']", "input[data-testid*='date']",
            ]:
                try:
                    el = page.locator(sel).first
                    if await el.count() > 0:
                        await el.click(timeout=3000)
                        opened = True
                        break
                except Exception:
                    continue
            if not opened:
                for name in ["Depart", "Departure", "Depart Date", "Date", "When", "Travel date"]:
                    field = page.get_by_role("textbox", name=re.compile(rf"{name}", re.IGNORECASE))
                    if await field.count() > 0:
                        await field.first.click(timeout=3000)
                        opened = True
                        break
            if not opened:
                date_el = page.locator("[class*='date'], [data-testid*='date'], [id*='date']").first
                if await date_el.count() > 0:
                    await date_el.click(timeout=3000)
            await asyncio.sleep(0.8)

            # ── Navigate calendar to target month ────────────────────
            target_my = target.strftime("%B %Y")
            for _ in range(12):
                for variant in [target_my, target_my.upper()]:
                    if await page.locator(f"text={variant}").first.count() > 0:
                        break
                else:
                    try:
                        fwd = page.get_by_role("button", name=re.compile(r"(next|forward|>|>>|›|»)", re.IGNORECASE))
                        if await fwd.count() > 0:
                            await fwd.first.click(timeout=2000)
                            await asyncio.sleep(0.4)
                            continue
                    except Exception:
                        pass
                    try:
                        fwd = page.locator(
                            "[class*='next'], [class*='right'], "
                            "[aria-label*='next'], [aria-label*='Next'], "
                            "[aria-label*='forward'], button:has-text('>')"
                        ).first
                        await fwd.click(timeout=2000)
                        await asyncio.sleep(0.4)
                        continue
                    except Exception:
                        break
                break

            # ── Select the target day ────────────────────────────────
            day = target.day
            # Navitaire gridcell pattern (like Condor): button[role='gridcell']
            target_label_mmddyyyy = target.strftime("%m/%d/%Y")
            try:
                gridcell = page.locator(
                    f"button[role='gridcell'][aria-label*='{target_label_mmddyyyy}']"
                ).first
                if await gridcell.count() > 0:
                    await gridcell.click(timeout=3000)
                    await asyncio.sleep(0.5)
                    return True
            except Exception:
                pass

            for fmt in [
                f"{day} {target.strftime('%B')} {target.year}",
                f"{target.strftime('%B')} {day}, {target.year}",
                f"{target.strftime('%B')} {day}",
                target.strftime("%Y-%m-%d"),
                target_label_mmddyyyy,
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
                "table button, .calendar button, [class*='calendar'] button, [class*='datepicker'] button"
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
            logger.warning("CebuPacific: date error: %s", e)
            return False

    async def _click_search(self, page) -> None:
        for label in [
            "Search flights", "Search Flights", "Search", "SEARCH",
            "Find flights", "Find Flights", "Book Now", "Let's Go",
            "Search Now", "Show flights", "Show Flights",
        ]:
            try:
                btn = page.get_by_role("button", name=re.compile(rf"^{re.escape(label)}$", re.IGNORECASE))
                if await btn.count() > 0:
                    await btn.first.click(timeout=5000)
                    logger.info("CebuPacific: clicked search")
                    return
            except Exception:
                continue
        # Submit-type button or search icon
        try:
            submit = page.locator(
                "button[type='submit'], "
                "button[class*='search'], button[class*='submit'], "
                "button[data-testid*='search'], button[id*='search']"
            ).first
            if await submit.count() > 0:
                await submit.click(timeout=5000)
                logger.info("CebuPacific: clicked submit-type search")
                return
        except Exception:
            pass
        try:
            await page.keyboard.press("Enter")
        except Exception:
            pass

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
        currency = "PHP" if req.currency == "EUR" else req.currency
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
            id=f"5j_{hashlib.md5(str(flight_key).encode()).hexdigest()[:12]}",
            price=round(best_price, 2), currency=currency,
            price_formatted=f"{best_price:.2f} {currency}",
            outbound=route, inbound=None,
            airlines=["Cebu Pacific"], owner_airline="5J",
            booking_url=booking_url, is_locked=False,
            source="cebupacific_direct", source_tier="free",
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
        carrier = seg.get("carrierCode") or seg.get("carrier") or seg.get("airline") or "5J"
        return FlightSegment(
            airline=carrier, airline_name="Cebu Pacific", flight_no=flight_no,
            origin=origin, destination=destination,
            departure=self._parse_dt(dep_str), arrival=self._parse_dt(arr_str),
            cabin_class="M",
        )

    def _build_response(self, offers: list[FlightOffer], req: FlightSearchRequest, elapsed: float) -> FlightSearchResponse:
        offers.sort(key=lambda o: o.price)
        logger.info("CebuPacific %s->%s returned %d offers in %.1fs (Playwright)", req.origin, req.destination, len(offers), elapsed)
        h = hashlib.md5(f"cebupacific{req.origin}{req.destination}{req.date_from}".encode()).hexdigest()[:12]
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
    def _build_booking_url(req: FlightSearchRequest) -> str:
        dep = req.date_from.strftime("%Y-%m-%d")
        return (
            f"https://book.cebupacificair.com/flights/select?from={req.origin}"
            f"&to={req.destination}&depart={dep}&pax={req.adults}&type=OW"
        )

    def _empty(self, req: FlightSearchRequest) -> FlightSearchResponse:
        h = hashlib.md5(f"cebupacific{req.origin}{req.destination}{req.date_from}".encode()).hexdigest()[:12]
        return FlightSearchResponse(
            search_id=f"fs_{h}", origin=req.origin, destination=req.destination,
            currency=req.currency, offers=[], total_results=0,
        )
