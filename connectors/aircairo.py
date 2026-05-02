"""
Air Cairo connector — CDP Chrome + form fill + DOM scraping.

Air Cairo (IATA: SM) is an Egyptian low-cost carrier headquartered at
Cairo International Airport. Operates domestic Egyptian routes plus
regional flights to Saudi Arabia, UAE, Kuwait, Jordan, Turkey, and
European destinations (Germany, Italy, France, UK).

Strategy (CDP Chrome — form fill + search results scraping):
  1. Launch real Chrome via CDP (no headless — Laravel site may fingerprint).
  2. Navigate to aircairo.com/en-gl/book-flight.
  3. Wait for JS to populate the _csrf token (empty in static HTML).
  4. Fill booking form: departureFrom, departureTo, date, adult, tripType.
  5. Submit form → page navigates to /en-gl/search-results.
  6. Scrape flight result cards from DOM (price, times, flight number).

Discovered via probing (Jun 2026):
  - No reCAPTCHA on booking form (only on newsletter form).
  - CSRF token is populated by JavaScript after page load.
  - Form fields: departureFrom, departureTo, date, adult, child, infant, tripType.
  - Form action: /en-gl/search-results (or /{locale}/search-results).
  - jQuery 3.6.0 + app.bundle.04b9ee8.min.js frontend.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
import subprocess
import time
from datetime import date, datetime, timedelta
from typing import Optional
from urllib.parse import parse_qs, unquote, urlencode, urljoin, urlparse, urlunparse

from ..models.flights import (
    FlightOffer,
    FlightRoute,
    FlightSearchRequest,
    FlightSearchResponse,
    FlightSegment,
)
from .browser import find_chrome, stealth_popen_kwargs, _launched_procs, bandwidth_saving_args, disable_background_networking_args, apply_cdp_url_blocking

logger = logging.getLogger(__name__)

_BASE = "https://www.aircairo.com"
_BOOK_PATH = "/en-gl/book-flight"
_CDP_PORT = 9487
_USER_DATA_DIR = os.path.join(
    os.environ.get("TEMP", os.environ.get("TMPDIR", "/tmp")), ".aircairo_chrome_data"
)

_pw_instance = None
_browser = None
_chrome_proc = None
_browser_lock: Optional[asyncio.Lock] = None


def _get_lock() -> asyncio.Lock:
    global _browser_lock
    if _browser_lock is None:
        _browser_lock = asyncio.Lock()
    return _browser_lock


async def _get_browser():
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

        pw = None
        try:
            pw = await async_playwright().start()
            _browser = await pw.chromium.connect_over_cdp(f"http://127.0.0.1:{_CDP_PORT}")
            _pw_instance = pw
            return _browser
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
            f"--remote-debugging-port={_CDP_PORT}",
            f"--user-data-dir={_USER_DATA_DIR}",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-blink-features=AutomationControlled",
            "--disable-http2",
            "--window-position=-2400,-2400",
            "--window-size=1366,768",
            *bandwidth_saving_args(),
            *disable_background_networking_args(),
            "about:blank",
        ]
        _chrome_proc = subprocess.Popen(args, **stealth_popen_kwargs())
        _launched_procs.append(_chrome_proc)
        await asyncio.sleep(2.0)

        pw = await async_playwright().start()
        _pw_instance = pw
        _browser = await pw.chromium.connect_over_cdp(f"http://127.0.0.1:{_CDP_PORT}")
        logger.info("AirCairo: Chrome on CDP port %d (pid %d)", _CDP_PORT, _chrome_proc.pid)
        return _browser


class AirCairoConnectorClient:
    """Air Cairo (SM) — Egyptian LCC, CDP Chrome + form fill + DOM scraping."""

    def __init__(self, timeout: float = 45.0):
        self.timeout = timeout

    async def close(self):
        pass

    async def search_flights(self, req: FlightSearchRequest) -> FlightSearchResponse:
        ob_result = await self._search_ow(req)
        if req.return_from and ob_result.total_results > 0:
            ib_req = req.model_copy(update={
                "origin": req.destination, "destination": req.origin,
                "date_from": req.return_from, "return_from": None,
            })
            ib_result = await self._search_ow(ib_req)
            if ib_result.total_results > 0:
                ob_result.offers = self._combine_rt(ob_result.offers, ib_result.offers, req)
                ob_result.total_results = len(ob_result.offers)
        return ob_result

    async def _search_ow(self, req: FlightSearchRequest) -> FlightSearchResponse:
        t0 = time.monotonic()

        try:
            dt = (
                req.date_from
                if isinstance(req.date_from, (datetime, date))
                else datetime.strptime(str(req.date_from), "%Y-%m-%d")
            )
            if isinstance(dt, datetime):
                dt = dt.date()
        except (ValueError, TypeError):
            dt = date.today() + timedelta(days=30)

        date_str = dt.strftime("%Y-%m-%d")

        for attempt in range(2):
            try:
                offers = await self._do_search(req, date_str)
                if offers:
                    offers.sort(key=lambda o: o.price if o.price > 0 else float("inf"))
                    elapsed = time.monotonic() - t0
                    logger.info("AirCairo %s→%s: %d offers in %.1fs", req.origin, req.destination, len(offers), elapsed)
                    return self._build_response(offers, req, date_str)
            except Exception as e:
                logger.warning("AirCairo attempt %d failed: %s", attempt, e)

        return self._empty(req)

    async def _do_search(self, req: FlightSearchRequest, date_str: str) -> list[FlightOffer]:
        browser = await _get_browser()
        contexts = browser.contexts
        context = contexts[0] if contexts else await browser.new_context(
            viewport={"width": 1366, "height": 768}
        )
        page = await context.new_page()
        await apply_cdp_url_blocking(page)

        try:
            submit_date = datetime.strptime(date_str, "%Y-%m-%d").strftime("%d %b %y")
        except ValueError:
            submit_date = date_str

        # Capture any JSON API responses the page makes during search
        api_data: list[dict] = []
        redirect_url: str | None = None

        async def _on_response(response):
            nonlocal redirect_url
            url = response.url
            ct = response.headers.get("content-type", "")
            if response.status == 200 and "search-result" in url.lower() and "book=flightp" in url.lower():
                try:
                    body = await response.text()
                    data = json.loads(body)
                    if isinstance(data, dict):
                        payload_url = data.get("url")
                        if isinstance(payload_url, str) and payload_url.strip():
                            redirect_url = urljoin(_BASE, payload_url.strip())
                except Exception:
                    pass
                return
            if response.status == 200 and "json" in ct:
                if any(k in url.lower() for k in ["/search", "/flight", "/result", "/availab", "/fare"]):
                    try:
                        body = await response.text()
                        if len(body) > 100:
                            data = json.loads(body)
                            api_data.append(data)
                    except Exception:
                        pass

        page.on("response", _on_response)

        try:
            logger.info("AirCairo: loading booking page for %s→%s on %s", req.origin, req.destination, date_str)
            await page.goto(f"{_BASE}{_BOOK_PATH}", wait_until="domcontentloaded", timeout=20000)
            await asyncio.sleep(2)

            # Dismiss cookie consent + terms modals + header overlay via JS
            await page.evaluate("""() => {
                // Remove cookie consent
                document.querySelectorAll('.cookie-banner, .cookie-consent, #cookieConsent')
                    .forEach(el => el.remove());
                // Remove terms modal and backdrop
                const m = document.querySelector('#termsModal');
                if (m) m.remove();
                document.querySelectorAll('.modal-backdrop').forEach(b => b.remove());
                document.body.classList.remove('modal-open');
                document.body.style.overflow = '';
            }""")
            await asyncio.sleep(0.5)

            # Fill the actual booking form, not the site-search header form.
            filled = await page.evaluate("""([origin, dest, dateText, adults]) => {
                const bookingForm = Array.from(document.querySelectorAll('form')).find((form) =>
                    form.querySelector('input[name="departureFrom"]') &&
                    form.querySelector('input[name="departureTo"]')
                );
                if (!bookingForm) {
                    return {error: 'booking_form_not_found'};
                }

                const depInput = bookingForm.querySelector('input[name="departureFrom"], #departureFrom');
                const arrInput = bookingForm.querySelector('input[name="departureTo"], #departureTo');
                const dateInput = bookingForm.querySelector('input[name="date"]');
                const adultInput = bookingForm.querySelector('input[name="adult"], #adult, select[name="adult"]');
                const childInput = bookingForm.querySelector('input[name="child"], select[name="child"]');
                const infantInput = bookingForm.querySelector('input[name="infant"], select[name="infant"]');
                const tripSel = bookingForm.querySelector('select[name="tripType"]');
                const csrfInput = bookingForm.querySelector('input[name="_csrf"]');

                if (depInput) depInput.value = origin;
                if (arrInput) arrInput.value = dest;
                if (tripSel) tripSel.value = 'oneWay';
                if (dateInput) dateInput.value = dateText;
                if (adultInput) adultInput.value = String(adults);
                if (childInput) childInput.value = '0';
                if (infantInput) infantInput.value = '0';

                [depInput, arrInput, tripSel, dateInput, adultInput, childInput, infantInput].forEach((el) => {
                    if (!el) return;
                    el.dispatchEvent(new Event('input', {bubbles: true}));
                    el.dispatchEvent(new Event('change', {bubbles: true}));
                });

                return {
                    dep: depInput ? depInput.value : null,
                    arr: arrInput ? arrInput.value : null,
                    date: dateInput ? dateInput.value : null,
                    csrf: csrfInput ? csrfInput.value : null,
                    formId: bookingForm.id || null,
                    action: bookingForm.getAttribute('action') || null,
                };
            }""", [req.origin, req.destination, submit_date, req.adults or 1])
            logger.info("AirCairo: form filled via JS: %s", filled)
            await asyncio.sleep(0.5)

            # Submit the actual booking form and wait for the wrapper JSON redirect.
            submitted = await page.evaluate("""() => {
                document.querySelectorAll('#termsModal, .modal-backdrop').forEach(el => el.remove());
                document.body.classList.remove('modal-open');
                document.body.style.overflow = '';

                const bookingForm = Array.from(document.querySelectorAll('form')).find((form) =>
                    form.querySelector('input[name="departureFrom"]') &&
                    form.querySelector('input[name="departureTo"]')
                );
                if (!bookingForm) {
                    return {submitted: false, reason: 'booking_form_not_found'};
                }

                const submitBtn = bookingForm.querySelector('#bookingFormSubmit, button[type="submit"], input[type="submit"]');
                if (submitBtn) {
                    submitBtn.click();
                    return {submitted: true, method: 'button', formId: bookingForm.id || null};
                }
                if (typeof bookingForm.requestSubmit === 'function') {
                    bookingForm.requestSubmit();
                    return {submitted: true, method: 'requestSubmit', formId: bookingForm.id || null};
                }
                bookingForm.submit();
                return {submitted: true, method: 'submit', formId: bookingForm.id || null};
            }""")
            logger.info("AirCairo: form submitted via JS: %s", submitted)

            for _ in range(12):
                if redirect_url:
                    break
                await asyncio.sleep(1.0)

            if redirect_url:
                redirect_url = self._rewrite_redirect_search_data(redirect_url, req, date_str)
                logger.info("AirCairo: wrapper redirect captured: %s", redirect_url[:220])
                try:
                    await page.goto(redirect_url, wait_until="domcontentloaded", timeout=45000)
                    try:
                        await page.wait_for_load_state("load", timeout=15000)
                    except Exception:
                        pass
                    wait_state = await self._wait_for_booking_results(
                        page,
                        api_data,
                        expect_booking_host=True,
                    )
                    logger.info("AirCairo: post-redirect wait state=%s", wait_state)
                except Exception as exc:
                    logger.warning("AirCairo: redirect navigation failed: %s", exc)
            else:
                try:
                    await page.wait_for_load_state("domcontentloaded", timeout=15000)
                except Exception:
                    pass
                wait_state = await self._wait_for_booking_results(
                    page,
                    api_data,
                    expect_booking_host=False,
                )
                logger.info("AirCairo: post-submit wait state=%s", wait_state)

            results_booking_url = redirect_url or page.url

            if "online.aircairo.com/booking" in page.url.lower():
                for _ in range(8):
                    if any(
                        isinstance(data.get("data"), dict) and isinstance(data["data"].get("airBoundGroups"), list)
                        for data in api_data
                        if isinstance(data, dict)
                    ):
                        break
                    await asyncio.sleep(1.0)

            # Try API data first
            if api_data:
                for data in api_data:
                    offers = self._parse_api_data(data, req, date_str, booking_url=results_booking_url)
                    if offers:
                        return offers

            # DOM scraping for flight results
            offers = await self._extract_from_dom(page, req, date_str, booking_url=results_booking_url)
            if not offers:
                try:
                    title = await page.title()
                except Exception:
                    title = ""
                try:
                    body_text = await page.evaluate(
                        "() => ((document.body && (document.body.innerText || document.body.textContent)) || '')"
                    )
                except Exception:
                    body_text = ""
                excerpt = re.sub(r"\s+", " ", body_text).strip()[:600]
                logger.warning(
                    "AirCairo: zero offers after submit url=%s title=%s api_payloads=%d excerpt=%s",
                    page.url,
                    title,
                    len(api_data),
                    excerpt or "<empty>",
                )
            return offers

        except Exception as e:
            logger.error("AirCairo browser error: %s", e)
            return []
        finally:
            try:
                await page.close()
            except Exception:
                pass

    @staticmethod
    def _rewrite_redirect_search_data(redirect_url: str, req: FlightSearchRequest, date_str: str) -> str:
        if not redirect_url:
            return redirect_url
        try:
            parsed = urlparse(redirect_url)
            query = parse_qs(parsed.query, keep_blank_values=True)
            raw_search_data = query.get("searchData")
            if not raw_search_data:
                return redirect_url

            search_data = json.loads(unquote(raw_search_data[0]))
            if not isinstance(search_data, dict):
                return redirect_url

            itineraries = search_data.get("itineraries")
            if isinstance(itineraries, list) and itineraries:
                itinerary = itineraries[0]
                if isinstance(itinerary, dict):
                    itinerary["originLocationCode"] = req.origin
                    itinerary["destinationLocationCode"] = req.destination
                    itinerary["departureDateTime"] = date_str

            travelers: list[dict[str, str]] = []
            travelers.extend({"passengerTypeCode": "ADT"} for _ in range(max(1, int(req.adults or 1))))
            travelers.extend({"passengerTypeCode": "CHD"} for _ in range(max(0, int(req.children or 0))))
            travelers.extend({"passengerTypeCode": "INF"} for _ in range(max(0, int(req.infants or 0))))
            search_data["travelers"] = travelers

            query["searchData"] = [json.dumps(search_data, separators=(",", ":"))]
            return urlunparse(parsed._replace(query=urlencode(query, doseq=True)))
        except Exception:
            return redirect_url

    async def _wait_for_booking_results(
        self,
        page,
        api_data: list[dict],
        *,
        expect_booking_host: bool,
    ) -> dict:
        last_state: dict = {}

        for attempt in range(35):
            if api_data:
                return {
                    "reason": "api",
                    "attempt": attempt,
                    "url": page.url,
                }

            try:
                last_state = await page.evaluate(r"""() => {
                    const body = ((document.body && (document.body.innerText || document.body.textContent)) || '')
                        .replace(/\s+/g, ' ')
                        .trim();
                    const lower = body.toLowerCase();
                    const title = document.title || '';
                    const href = location.href || '';
                    const resultNodes = document.querySelectorAll(
                        '.flight-card, .flight-row, .flight-result, .result-item, .booking-result, ' +
                        '[class*="availability"], [class*="flight"], [class*="result"], ' +
                        '[class*="fare"], [class*="bound"]'
                    ).length;
                    const hasTimes = /\b\d{1,2}:\d{2}\b/.test(body);
                    const hasPrice =
                        /(EGP|USD|EUR|GBP|SAR|AED)\s*\d/i.test(body) ||
                        /\b\d[\d,.]*\s*(EGP|USD|EUR|GBP|SAR|AED)\b/i.test(body);
                    const hasFlightNo = /\bSM\s*\d{2,4}\b/i.test(body);
                    const isLoading =
                        /loading|please wait|searching for flights|fetching results|just a moment/i.test(lower) ||
                        document.querySelector(
                            '.spinner, .loading, [class*="spinner"], [class*="loading"], .skeleton, [class*="skeleton"]'
                        ) !== null;
                    const hasNoAvailability =
                        /no flights|no availability|sold out|not available|no results/i.test(lower);
                    const isBlocked =
                        /sorry, you have been blocked|attention required|captcha|verify you are human|cloudflare/i.test(lower) ||
                        /attention required/i.test(title.toLowerCase());

                    return {
                        url: href,
                        title,
                        resultNodes,
                        hasTimes,
                        hasPrice,
                        hasFlightNo,
                        isLoading,
                        hasNoAvailability,
                        isBlocked,
                        textSample: body.slice(0, 220),
                    };
                }""")
            except Exception:
                last_state = {}

            url = str(last_state.get("url") or "")
            url_lower = url.lower()
            on_booking_surface = any(
                part in url_lower
                for part in (
                    "/booking/availability",
                    "/booking/select",
                    "/booking/shopping-cart",
                    "/booking/search",
                )
            )
            has_dom_results = bool(
                last_state.get("hasPrice") and
                (last_state.get("hasTimes") or last_state.get("hasFlightNo"))
            )

            if has_dom_results:
                last_state["reason"] = "dom-results"
                last_state["attempt"] = attempt
                return last_state

            if last_state.get("hasNoAvailability"):
                last_state["reason"] = "no-availability"
                last_state["attempt"] = attempt
                return last_state

            if last_state.get("isBlocked"):
                last_state["reason"] = "blocked"
                last_state["attempt"] = attempt
                return last_state

            if on_booking_surface and last_state.get("resultNodes", 0) > 0 and not last_state.get("isLoading"):
                last_state["reason"] = "booking-surface"
                last_state["attempt"] = attempt
                return last_state

            if (
                expect_booking_host and
                "online.aircairo.com/booking" in url_lower and
                attempt >= 5 and
                not last_state.get("isLoading") and
                (last_state.get("hasTimes") or last_state.get("resultNodes", 0) > 0)
            ):
                last_state["reason"] = "booking-host"
                last_state["attempt"] = attempt
                return last_state

            await asyncio.sleep(1.0 if attempt < 10 else 1.5)

        last_state["reason"] = "timeout"
        last_state["attempt"] = 34
        return last_state

    async def _extract_from_dom(
        self,
        page,
        req: FlightSearchRequest,
        date_str: str,
        booking_url: str | None = None,
    ) -> list[FlightOffer]:
        """Scrape flight result cards from the search results page."""
        offers: list[FlightOffer] = []
        seen: set[str] = set()

        # Get page HTML for parsing
        html = await page.content()

        # Look for price elements — Air Cairo uses various selectors
        price_patterns = [
            r'(?:price|fare|cost|amount)["\s:]*?(\d[\d,]*\.?\d*)\s*(?:EGP|USD|EUR|GBP|SAR|AED)',
            r'(?:EGP|USD|EUR|GBP|SAR|AED)\s*(\d[\d,]*\.?\d*)',
            r'class="[^"]*price[^"]*"[^>]*>[\s\S]*?(\d[\d,]*\.?\d*)',
        ]

        # Try structured extraction via JS
        try:
            flight_data = await page.evaluate("""() => {
                const results = [];
                // Look for flight cards/rows
                const cards = document.querySelectorAll(
                    '.flight-card, .flight-row, .flight-result, .result-item, ' +
                    '[class*="flight"], [class*="result"], .search-result, ' +
                    'tr[class*="flight"], .booking-result'
                );
                for (const card of cards) {
                    const text = card.textContent || '';
                    // Extract price
                    const priceMatch = text.match(/(\\d[\\d,]*\\.?\\d*)\\s*(?:EGP|USD|EUR|GBP|SAR|AED)/i)
                        || text.match(/(?:EGP|USD|EUR|GBP|SAR|AED)\\s*(\\d[\\d,]*\\.?\\d*)/i);
                    if (!priceMatch) continue;

                    // Extract currency
                    const curMatch = text.match(/\\b(EGP|USD|EUR|GBP|SAR|AED)\\b/i);

                    // Extract flight number (SM followed by digits)
                    const fnMatch = text.match(/\\b(SM\\s*\\d{3,4})\\b/i);

                    // Extract times (HH:MM format)
                    const times = text.match(/\\b(\\d{1,2}:\\d{2})\\b/g) || [];

                    results.push({
                        price: priceMatch[1].replace(/,/g, ''),
                        currency: curMatch ? curMatch[1].toUpperCase() : 'EGP',
                        flightNo: fnMatch ? fnMatch[1].replace(/\\s/g, '') : '',
                        depTime: times[0] || '',
                        arrTime: times[1] || '',
                        text: text.substring(0, 500)
                    });
                }
                return results;
            }""")
        except Exception:
            flight_data = []

        if not flight_data:
            # Broader fallback: look for ANY price on page
            try:
                flight_data = await page.evaluate("""() => {
                    const text = document.body.textContent || '';
                    const results = [];
                    const priceMatches = text.matchAll(/(\\d[\\d,]*\\.?\\d*)\\s*(EGP|USD|EUR|GBP|SAR|AED)/gi);
                    for (const m of priceMatches) {
                        const price = parseFloat(m[1].replace(/,/g, ''));
                        if (price > 10 && price < 100000) {
                            results.push({
                                price: m[1].replace(/,/g, ''),
                                currency: m[2].toUpperCase(),
                                flightNo: '',
                                depTime: '',
                                arrTime: ''
                            });
                        }
                    }
                    return results;
                }""")
            except Exception:
                flight_data = []

        for fd in flight_data:
            try:
                price_f = round(float(fd["price"]), 2)
            except (ValueError, TypeError):
                continue
            if price_f <= 0:
                continue

            currency = fd.get("currency", "EGP")
            flight_no = fd.get("flightNo", "")
            dep_time_str = fd.get("depTime", "")
            arr_time_str = fd.get("arrTime", "")

            dedup_key = f"{req.origin}_{req.destination}_{date_str}_{price_f}_{flight_no}"
            if dedup_key in seen:
                continue
            seen.add(dedup_key)

            dep_dt = datetime.strptime(date_str, "%Y-%m-%d")
            arr_dt = dep_dt
            dur_sec = 0

            if dep_time_str and arr_time_str:
                try:
                    h, m = map(int, dep_time_str.split(":"))
                    dep_dt = dep_dt.replace(hour=h, minute=m)
                    h2, m2 = map(int, arr_time_str.split(":"))
                    arr_dt = arr_dt.replace(hour=h2, minute=m2)
                    dur_sec = max(0, int((arr_dt - dep_dt).total_seconds()))
                    if dur_sec < 0:
                        dur_sec += 86400
                        arr_dt = arr_dt + timedelta(days=1)
                except (ValueError, TypeError):
                    pass

            _sm_cabin = {"M": "economy", "W": "premium_economy", "C": "business", "F": "first"}.get(req.cabin_class or "M", "economy")
            seg = FlightSegment(
                airline="SM",
                airline_name="Air Cairo",
                flight_no=flight_no,
                origin=req.origin,
                destination=req.destination,
                departure=dep_dt,
                arrival=arr_dt,
                duration_seconds=dur_sec,
                cabin_class=_sm_cabin,
            )
            route = FlightRoute(segments=[seg], total_duration_seconds=dur_sec, stopovers=0)

            fid = hashlib.md5(
                f"sm_{req.origin}{req.destination}{date_str}{price_f}{flight_no}".encode()
            ).hexdigest()[:12]

            offers.append(FlightOffer(
                id=f"sm_{fid}",
                price=price_f,
                currency=currency,
                price_formatted=f"{price_f:.2f} {currency}",
                outbound=route,
                inbound=None,
                airlines=["Air Cairo"],
                owner_airline="SM",
                booking_url=booking_url or (
                    f"https://www.aircairo.com/en-gl/book-flight?"
                    f"departureFrom={req.origin}&departureTo={req.destination}"
                    f"&date={date_str}&adult={req.adults or 1}"
                ),
                is_locked=False,
                source="aircairo_direct",
                source_tier="free",
            ))

        return offers

    def _parse_api_data(
        self,
        data: dict,
        req: FlightSearchRequest,
        date_str: str,
        booking_url: str | None = None,
    ) -> list[FlightOffer]:
        """Parse intercepted API JSON responses."""
        if isinstance(data.get("data"), dict) and isinstance(data["data"].get("airBoundGroups"), list):
            return self._parse_air_bounds_payload(data, req, date_str, booking_url=booking_url)

        offers: list[FlightOffer] = []
        seen: set[str] = set()

        flights = (
            data.get("flights", data.get("availability", data.get("fares", data.get("data", []))))
        )
        if isinstance(flights, dict):
            flights = flights.get("items", flights.get("journeys", flights.get("flights", [])))
        if not isinstance(flights, list):
            return offers

        for flight in flights:
            if not isinstance(flight, dict):
                continue
            price = (
                flight.get("price") or flight.get("totalPrice")
                or flight.get("fareAmount") or flight.get("amount")
            )
            if isinstance(price, dict):
                price = price.get("amount", price.get("value"))
            if not price:
                continue
            try:
                price_f = round(float(price), 2)
            except (ValueError, TypeError):
                continue
            if price_f <= 0:
                continue

            currency = flight.get("currency", "EGP")
            flight_no = str(flight.get("flightNumber", flight.get("number", "")))
            dep_time = str(flight.get("departureTime", flight.get("departure", date_str)))
            arr_time = str(flight.get("arrivalTime", flight.get("arrival", date_str)))

            dep_dt = self._parse_dt(dep_time, date_str)
            arr_dt = self._parse_dt(arr_time, date_str)
            dur_sec = max(0, int((arr_dt - dep_dt).total_seconds())) if arr_dt > dep_dt else 0

            dedup_key = f"{req.origin}_{req.destination}_{date_str}_{price_f}_{flight_no}"
            if dedup_key in seen:
                continue
            seen.add(dedup_key)

            _sm_cabin = {"M": "economy", "W": "premium_economy", "C": "business", "F": "first"}.get(req.cabin_class or "M", "economy")
            seg = FlightSegment(
                airline="SM", airline_name="Air Cairo", flight_no=flight_no,
                origin=req.origin, destination=req.destination,
                departure=dep_dt, arrival=arr_dt, duration_seconds=dur_sec,
                cabin_class=_sm_cabin,
            )
            route = FlightRoute(segments=[seg], total_duration_seconds=dur_sec, stopovers=0)
            fid = hashlib.md5(f"sm_{dedup_key}".encode()).hexdigest()[:12]

            offers.append(FlightOffer(
                id=f"sm_{fid}", price=price_f, currency=currency,
                price_formatted=f"{price_f:.2f} {currency}",
                outbound=route, inbound=None,
                airlines=["Air Cairo"], owner_airline="SM",
                booking_url=booking_url or f"{_BASE}/en-gl/book-flight",
                is_locked=False, source="aircairo_direct", source_tier="free",
            ))

        return offers

    def _parse_air_bounds_payload(
        self,
        data: dict,
        req: FlightSearchRequest,
        date_str: str,
        booking_url: str | None = None,
    ) -> list[FlightOffer]:
        offers: list[FlightOffer] = []
        seen: set[str] = set()

        search_data = data.get("data", {}) if isinstance(data.get("data"), dict) else {}
        groups = search_data.get("airBoundGroups", []) if isinstance(search_data.get("airBoundGroups"), list) else []
        dicts = data.get("dictionaries", {}) if isinstance(data.get("dictionaries"), dict) else {}
        flight_dict = dicts.get("flight", {}) if isinstance(dicts.get("flight"), dict) else {}
        currency_dict = dicts.get("currency", {}) if isinstance(dicts.get("currency"), dict) else {}
        fare_family_dict = dicts.get("fareFamilyWithServices", {}) if isinstance(dicts.get("fareFamilyWithServices"), dict) else {}
        service_dict = dicts.get("service", {}) if isinstance(dicts.get("service"), dict) else {}
        fare_conditions = dicts.get("fareConditions", {}) if isinstance(dicts.get("fareConditions"), dict) else {}

        for group in groups:
            if not isinstance(group, dict):
                continue
            bound_details = group.get("boundDetails", {}) if isinstance(group.get("boundDetails"), dict) else {}
            seg_refs = bound_details.get("segments", []) if isinstance(bound_details.get("segments"), list) else []
            duration = bound_details.get("duration", 0)
            air_bounds = group.get("airBounds", []) if isinstance(group.get("airBounds"), list) else []

            for air_bound in air_bounds:
                if not isinstance(air_bound, dict):
                    continue
                raw_amount, currency = self._extract_total_price(air_bound)
                price = self._normalize_price(raw_amount, currency, currency_dict)
                if price <= 0:
                    continue

                fare_family = str(air_bound.get("fareFamilyCode") or "")
                family_meta = fare_family_dict.get(fare_family, {}) if isinstance(fare_family_dict, dict) else {}
                segments = []
                for seg_ref in seg_refs:
                    fid = seg_ref.get("flightId", "") if isinstance(seg_ref, dict) else str(seg_ref)
                    flight = flight_dict.get(fid, {}) if isinstance(flight_dict, dict) else {}
                    if not isinstance(flight, dict) or not flight:
                        continue
                    dep_info = flight.get("departure", {}) if isinstance(flight.get("departure"), dict) else {}
                    arr_info = flight.get("arrival", {}) if isinstance(flight.get("arrival"), dict) else {}
                    dep_dt = self._parse_dt(dep_info.get("dateTime", ""), date_str)
                    arr_dt = self._parse_dt(arr_info.get("dateTime", ""), date_str)
                    if dep_dt is None or arr_dt is None:
                        segments = []
                        break
                    airline = str(flight.get("marketingAirlineCode") or "SM").upper()
                    flight_num_raw = str(flight.get("marketingFlightNumber") or "").strip()
                    if flight_num_raw and not flight_num_raw.upper().startswith(airline):
                        flight_no = f"{airline}{flight_num_raw}"
                    else:
                        flight_no = flight_num_raw or airline

                    cabin_code = self._resolve_cabin_code(air_bound, family_meta, fid)
                    segments.append(FlightSegment(
                        airline=airline,
                        airline_name="Air Cairo" if airline == "SM" else airline,
                        flight_no=flight_no,
                        origin=str(dep_info.get("locationCode") or req.origin),
                        destination=str(arr_info.get("locationCode") or req.destination),
                        departure=dep_dt,
                        arrival=arr_dt,
                        duration_seconds=max(0, int((arr_dt - dep_dt).total_seconds())),
                        cabin_class=self._normalize_cabin(cabin_code),
                    ))

                if not segments:
                    continue

                route = FlightRoute(
                    segments=segments,
                    total_duration_seconds=duration if isinstance(duration, int) and duration > 0 else sum(s.duration_seconds for s in segments),
                    stopovers=max(0, len(segments) - 1),
                )

                conditions: dict[str, str] = {}
                bags_price: dict[str, float] = {}
                if fare_family:
                    conditions["fare_family"] = fare_family

                checked_bag = self._extract_checked_bag(air_bound.get("services", []), service_dict)
                if checked_bag:
                    conditions["checked_bag"] = f"included - {checked_bag}"
                    bags_price["checked_bag"] = 0.0

                conditions.update(self._extract_fare_conditions(air_bound.get("fareConditionsCodes", []), fare_conditions, currency, currency_dict))

                flight_ids = [segment.flight_no for segment in segments]
                dedup_key = f"{req.origin}_{req.destination}_{date_str}_{price}_{fare_family}_{','.join(flight_ids)}"
                if dedup_key in seen:
                    continue
                seen.add(dedup_key)

                offer_id = hashlib.md5(f"sm_{dedup_key}".encode()).hexdigest()[:12]
                offers.append(FlightOffer(
                    id=f"sm_{offer_id}",
                    price=price,
                    currency=currency or "USD",
                    price_formatted=f"{price:.2f} {currency or 'USD'}",
                    outbound=route,
                    inbound=None,
                    airlines=["Air Cairo"],
                    owner_airline="SM",
                    bags_price=bags_price,
                    conditions=conditions,
                    booking_url=booking_url or (
                        f"https://www.aircairo.com/en-gl/book-flight?"
                        f"departureFrom={req.origin}&departureTo={req.destination}"
                        f"&date={date_str}&adult={req.adults or 1}"
                    ),
                    is_locked=False,
                    source="aircairo_direct",
                    source_tier="free",
                ))

        offers.sort(key=lambda offer: offer.price if offer.price > 0 else float("inf"))
        return offers

    @staticmethod
    def _extract_total_price(bound: dict) -> tuple[object, str]:
        if not isinstance(bound, dict):
            return None, ""

        air_offer = bound.get("airOffer") if isinstance(bound.get("airOffer"), dict) else {}
        total_price = air_offer.get("totalPrice") if isinstance(air_offer.get("totalPrice"), dict) else {}
        raw_amount = total_price.get("value", total_price.get("total"))
        currency = str(total_price.get("currencyCode") or "")

        if raw_amount is None:
            prices = bound.get("prices") if isinstance(bound.get("prices"), dict) else {}
            total_prices = prices.get("totalPrices") if isinstance(prices.get("totalPrices"), list) else []
            if total_prices:
                p0 = total_prices[0] if isinstance(total_prices[0], dict) else {}
                raw_amount = p0.get("total", p0.get("value", p0.get("base")))
                if not currency:
                    currency = str(p0.get("currencyCode") or "")

        return raw_amount, currency

    @staticmethod
    def _normalize_price(raw_amount, currency: str, currency_dict: dict) -> float:
        try:
            if raw_amount is None:
                return 0.0

            if isinstance(raw_amount, str):
                s = raw_amount.strip().replace(",", "")
                if not s:
                    return 0.0
                if "." in s:
                    return round(float(s), 2)
                minor_units = int(s)
            elif isinstance(raw_amount, int):
                minor_units = raw_amount
            elif isinstance(raw_amount, float):
                if raw_amount.is_integer():
                    minor_units = int(raw_amount)
                else:
                    return round(raw_amount, 2)
            else:
                return round(float(raw_amount), 2)

            decimals = 2
            if currency and isinstance(currency_dict, dict):
                meta = currency_dict.get(currency)
                if isinstance(meta, dict):
                    d = meta.get("decimalPlaces")
                    if isinstance(d, int) and 0 <= d <= 6:
                        decimals = d

            return round(minor_units / (10 ** decimals), 2)
        except Exception:
            try:
                return round(float(raw_amount), 2)
            except Exception:
                return 0.0

    @staticmethod
    def _resolve_cabin_code(air_bound: dict, family_meta: dict, flight_id: str) -> str:
        for detail in air_bound.get("availabilityDetails", []):
            if isinstance(detail, dict) and detail.get("flightId") == flight_id:
                cabin = detail.get("cabin")
                if isinstance(cabin, str) and cabin.strip():
                    return cabin
        cabin = family_meta.get("cabin") if isinstance(family_meta, dict) else ""
        return cabin if isinstance(cabin, str) else ""

    @staticmethod
    def _normalize_cabin(cabin_code: str) -> str:
        code = (cabin_code or "").strip().lower()
        if code in {"business", "biz", "c"}:
            return "business"
        if code in {"premium", "premiumeconomy", "premium_economy", "w"}:
            return "premium_economy"
        if code in {"first", "f"}:
            return "first"
        return "economy"

    @staticmethod
    def _extract_checked_bag(services: list, service_dict: dict) -> str:
        for service in services if isinstance(services, list) else []:
            if not isinstance(service, dict):
                continue
            code = str(service.get("serviceCode") or "")
            meta = service_dict.get(code, {}) if isinstance(service_dict, dict) else {}
            if not isinstance(meta, dict) or meta.get("serviceType") != "freeCheckedBaggage":
                continue
            baggage = meta.get("baggagePolicyDescriptions", [])
            if not isinstance(baggage, list) or not baggage:
                continue
            first = baggage[0] if isinstance(baggage[0], dict) else {}
            if first.get("type") == "weight":
                quantity = first.get("quantity")
                unit = first.get("weightUnit")
                if quantity and unit == "kilogram":
                    return f"checked bag up to {quantity}kg"
            quantity = first.get("quantity")
            if quantity:
                return f"{quantity} checked bag"
        return ""

    def _extract_fare_conditions(
        self,
        condition_codes: list,
        fare_conditions: dict,
        currency: str,
        currency_dict: dict,
    ) -> dict[str, str]:
        merged: dict[str, str] = {}
        for code in condition_codes if isinstance(condition_codes, list) else []:
            meta = fare_conditions.get(code, {}) if isinstance(fare_conditions, dict) else {}
            if not isinstance(meta, dict):
                continue
            category = str(meta.get("category") or "").lower()
            if category not in {"refund", "change"}:
                continue
            status = ""
            for detail in meta.get("details", []) if isinstance(meta.get("details"), list) else []:
                if not isinstance(detail, dict):
                    continue
                if detail.get("isAllowed") is False:
                    status = self._merge_condition_status(status, "not_allowed")
                    continue
                if detail.get("isAllowed") is True:
                    penalty = detail.get("penalty") if isinstance(detail.get("penalty"), dict) else {}
                    price = penalty.get("price") if isinstance(price := penalty.get("price"), dict) else {}
                    total = price.get("total")
                    fee_currency = str(price.get("currencyCode") or currency)
                    fee_value = self._normalize_price(total, fee_currency, currency_dict) if total is not None else 0.0
                    status = self._merge_condition_status(status, "allowed_with_fee" if fee_value > 0 else "allowed")
            if status:
                merged[f"{category}_before_departure"] = status
        return merged

    @staticmethod
    def _merge_condition_status(current: str, incoming: str) -> str:
        order = {"": 0, "not_allowed": 1, "allowed": 2, "allowed_with_fee": 3}
        return incoming if order.get(incoming, 0) >= order.get(current, 0) else current

    @staticmethod
    def _parse_dt(s: str, fallback_date: str) -> datetime:
        for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
            try:
                return datetime.strptime(s[:19], fmt)
            except (ValueError, IndexError):
                continue
        try:
            return datetime.strptime(fallback_date, "%Y-%m-%d")
        except ValueError:
            return datetime(2000, 1, 1)

    def _build_response(self, offers: list[FlightOffer], req: FlightSearchRequest, date_str: str) -> FlightSearchResponse:
        h = hashlib.md5(
            f"aircairo{req.origin}{req.destination}{date_str}{req.return_from or ''}".encode()
        ).hexdigest()[:12]
        return FlightSearchResponse(
            search_id=f"fs_{h}",
            origin=req.origin,
            destination=req.destination,
            currency=offers[0].currency if offers else "EGP",
            offers=offers,
            total_results=len(offers),
        )

    @staticmethod
    def _combine_rt(
        ob: list[FlightOffer], ib: list[FlightOffer], req,
    ) -> list[FlightOffer]:
        combos: list[FlightOffer] = []
        for o in ob[:15]:
            for i in ib[:10]:
                price = round(o.price + i.price, 2)
                cid = hashlib.md5(f"{o.id}_{i.id}".encode()).hexdigest()[:12]
                combos.append(FlightOffer(
                    id=f"rt_sm_{cid}", price=price, currency=o.currency,
                    outbound=o.outbound, inbound=i.outbound,
                    airlines=list(dict.fromkeys(o.airlines + i.airlines)),
                    owner_airline=o.owner_airline,
                    booking_url=o.booking_url, is_locked=False,
                    source=o.source, source_tier=o.source_tier,
                ))
        combos.sort(key=lambda c: c.price)
        return combos[:20]

    @staticmethod
    def _empty(req: FlightSearchRequest) -> FlightSearchResponse:
        h = hashlib.md5(
            f"aircairo{req.origin}{req.destination}{req.date_from}{req.return_from or ''}".encode()
        ).hexdigest()[:12]
        return FlightSearchResponse(
            search_id=f"fs_{h}",
            origin=req.origin,
            destination=req.destination,
            currency="EGP",
            offers=[],
            total_results=0,
        )
