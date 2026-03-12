"""
SpiceJet hybrid connector — direct API first, Playwright fallback.

SpiceJet (IATA: SG) is an Indian low-cost carrier (Navitaire/dotREZ platform).
Website: www.spicejet.com — React Native Web SPA with REST API backend.

Hybrid strategy (Mar 2026):
1. PRIMARY: curl_cffi GET spicejet.com (Chrome TLS fingerprint) → establishes WAF
   session cookies → POST /api/v1/token → JWT → POST /api/v3/search/availability.
   ~3-5s total, no browser needed.
2. FALLBACK: Playwright headed Chrome — load homepage to get WAF session, then
   navigate to search URL and intercept the availability API response.

Key API details (discovered March 2026):
- Token: POST /api/v1/token — returns JWT (10-15min idle timeout)
- Availability: POST /api/v3/search/availability
  Body: {"originStationCode":"DEL","destinationStationCode":"BOM",
         "onWardDate":"2026-03-20","currency":"INR",
         "pax":{"journeyClass":"ff","adult":1,"child":0,"infant":0,"srCitizen":0}}
  Response: {"data":{"trips":[{"journeysAvailable":[...segments, fares...]}]}}
- Fare pricing encoded in base64url fareAvailabilityKey: first number / 10 = INR base fare
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import logging
import random
import re
import time
from datetime import datetime
from typing import Any, Optional

from models.flights import (
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
]
_LOCALES = ["en-IN", "en-US", "en-GB"]
_TIMEZONES = ["Asia/Kolkata", "Asia/Dubai", "Europe/London"]

_pw_instance = None
_browser = None
_browser_lock: Optional[asyncio.Lock] = None


def _get_lock() -> asyncio.Lock:
    global _browser_lock
    if _browser_lock is None:
        _browser_lock = asyncio.Lock()
    return _browser_lock


async def _get_browser():
    """Shared headed Chromium (launched once, reused)."""
    global _pw_instance, _browser
    lock = _get_lock()
    async with lock:
        if _browser and _browser.is_connected():
            return _browser
        from playwright.async_api import async_playwright

        _pw_instance = await async_playwright().start()
        try:
            _browser = await _pw_instance.chromium.launch(
                headless=False,
                channel="chrome",
                args=["--disable-blink-features=AutomationControlled"],
            )
        except Exception:
            _browser = await _pw_instance.chromium.launch(
                headless=False,
                args=["--disable-blink-features=AutomationControlled", "--no-sandbox"],
            )
        logger.info("SpiceJet: Playwright browser launched (headed Chrome)")
        return _browser


def _decode_fare_price(fare_key: str) -> Optional[float]:
    """Extract base fare from Navitaire fareAvailabilityKey (base64url encoded).

    Key format decoded: '...!journeyIdx:baseFare:tax1:tax2:...'
    The number after '!0:' divided by 10 gives the base fare in INR.
    """
    try:
        # base64url decode
        padded = fare_key + "=" * (4 - len(fare_key) % 4)
        decoded = base64.urlsafe_b64decode(padded).decode("utf-8", errors="replace")
        # Extract pricing section after '!'
        if "!" not in decoded:
            return None
        pricing = decoded.split("!")[-1]
        parts = pricing.split(":")
        if len(parts) >= 2:
            raw_value = int(parts[1])
            return raw_value / 10.0
    except Exception:
        pass
    return None


class SpiceJetConnectorClient:
    """SpiceJet hybrid connector — curl_cffi direct API first, Playwright fallback."""

    def __init__(self, timeout: float = 45.0):
        self.timeout = timeout

    async def close(self):
        pass

    async def search_flights(self, req: FlightSearchRequest) -> FlightSearchResponse:
        # ── Hybrid: try direct API first (no browser) ──
        try:
            result = await self._try_direct_api(req)
            if result and result.total_results > 0:
                return result
            logger.info(
                "SpiceJet: direct API returned no results, falling back to Playwright"
            )
        except Exception as e:
            logger.info("SpiceJet: direct API failed (%s), falling back to Playwright", e)

        # ── Fallback: Playwright browser flow (retry up to 2×) ──
        for attempt in range(2):
            result = await self._try_search(req)
            if result.total_results > 0:
                return result
            if attempt == 0:
                logger.info(
                    "SpiceJet: Playwright attempt %d yielded 0 results, retrying",
                    attempt + 1,
                )
                await asyncio.sleep(2.0)
        return result

    # ── Direct API path (curl_cffi) ──────────────────────────────────────

    async def _try_direct_api(self, req: FlightSearchRequest) -> FlightSearchResponse | None:
        """Fetch WAF session via curl_cffi, get JWT, call availability API."""
        t0 = time.monotonic()
        try:
            from curl_cffi.requests import Session as CffiSession

            currency = req.currency if req.currency != "EUR" else "INR"
            headers_common = {
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/131.0.0.0 Safari/537.36"
                ),
                "Accept": "application/json, text/plain, */*",
                "Accept-Language": "en-US,en;q=0.9",
                "Origin": "https://www.spicejet.com",
                "Referer": "https://www.spicejet.com/",
            }

            with CffiSession(impersonate="chrome131") as ses:
                # Step 1: GET homepage to establish WAF session cookies
                hw = ses.get("https://www.spicejet.com/", timeout=15)
                if hw.status_code not in (200, 301, 302):
                    logger.debug("SpiceJet: homepage GET %d", hw.status_code)
                    return None

                # Step 2: POST to get JWT token
                tok_r = ses.post(
                    "https://www.spicejet.com/api/v1/token",
                    json={},
                    headers={**headers_common, "Content-Type": "application/json"},
                    timeout=10,
                )
                if tok_r.status_code != 200:
                    logger.debug("SpiceJet: token HTTP %d", tok_r.status_code)
                    return None

                token_data = tok_r.json()
                token = (
                    token_data.get("token")
                    or token_data.get("accessToken")
                    or token_data.get("jwt")
                )
                if not token:
                    logger.debug(
                        "SpiceJet: no token in response: %s", list(token_data.keys())
                    )
                    return None

                # Step 3: POST availability search
                dep_date = req.date_from.strftime("%Y-%m-%d")
                payload = {
                    "originStationCode": req.origin,
                    "destinationStationCode": req.destination,
                    "onWardDate": dep_date,
                    "currency": currency,
                    "pax": {
                        "journeyClass": "ff",
                        "adult": req.adults,
                        "child": req.children or 0,
                        "infant": req.infants or 0,
                        "srCitizen": 0,
                    },
                }

                avail_r = ses.post(
                    "https://www.spicejet.com/api/v3/search/availability",
                    json=payload,
                    headers={
                        **headers_common,
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {token}",
                    },
                    timeout=20,
                )

            if avail_r.status_code != 200:
                logger.debug("SpiceJet: availability HTTP %d", avail_r.status_code)
                return None

            data = avail_r.json()
            elapsed = time.monotonic() - t0
            offers = self._parse_availability(data, req)

            for o in offers:
                o.source = "spicejet_api"

            logger.info(
                "SpiceJet %s→%s: %d offers in %.1fs (direct API)",
                req.origin, req.destination, len(offers), elapsed,
            )
            return self._build_response(offers, req, elapsed)

        except Exception as e:
            logger.debug("SpiceJet direct API error: %s", e)
            return None

    async def _try_search(self, req: FlightSearchRequest) -> FlightSearchResponse:
        """Playwright browser fallback — homepage session + search URL navigation."""
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

            captured_data: dict = {}
            api_event = asyncio.Event()

            async def on_response(response):
                url = response.url
                if "/api/v3/search/availability" in url and response.status == 200:
                    try:
                        body = await response.text()
                        if body and len(body) > 500:
                            import json as _json
                            captured_data["availability"] = _json.loads(body)
                            api_event.set()
                    except Exception:
                        pass
                elif "/api/v2/search/lowfare" in url and response.status == 200:
                    try:
                        body = await response.text()
                        if body and len(body) > 100:
                            import json as _json
                            captured_data["lowfare"] = _json.loads(body)
                    except Exception:
                        pass

            page.on("response", on_response)

            # Phase 1: Load homepage to establish session (WAF cookies + token)
            logger.info("SpiceJet: loading homepage for %s→%s", req.origin, req.destination)
            await page.goto(
                "https://www.spicejet.com/",
                wait_until="domcontentloaded",
                timeout=int(self.timeout * 1000),
            )
            await asyncio.sleep(4.0)

            # Phase 2: Navigate to search URL — the SPA reads params and calls
            # the availability + lowfare APIs automatically with proper auth
            search_url = self._build_search_nav_url(req)
            logger.info("SpiceJet: navigating to search page")
            await page.goto(
                search_url,
                wait_until="domcontentloaded",
                timeout=int(self.timeout * 1000),
            )

            # Wait for the availability API response
            remaining = max(self.timeout - (time.monotonic() - t0), 10)
            try:
                await asyncio.wait_for(api_event.wait(), timeout=remaining)
            except asyncio.TimeoutError:
                logger.warning("SpiceJet: timed out waiting for availability API")
                return self._empty(req)

            data = captured_data.get("availability", {})
            if not data:
                return self._empty(req)

            elapsed = time.monotonic() - t0
            offers = self._parse_availability(data, req)
            return self._build_response(offers, req, elapsed)

        except Exception as e:
            logger.error("SpiceJet error: %s", e)
            return self._empty(req)
        finally:
            await context.close()

    def _parse_availability(self, data: Any, req: FlightSearchRequest) -> list[FlightOffer]:
        """Parse /api/v3/search/availability response into FlightOffer list."""
        booking_url = self._build_booking_url(req)
        offers: list[FlightOffer] = []

        trips = data.get("data", {}).get("trips", [])
        for trip in trips:
            journeys = trip.get("journeysAvailable", [])
            for journey in journeys:
                offer = self._parse_journey(journey, req, booking_url)
                if offer:
                    offers.append(offer)
        return offers

    def _parse_journey(
        self, journey: dict, req: FlightSearchRequest, booking_url: str
    ) -> Optional[FlightOffer]:
        """Parse a single journey from the availability response."""
        # Extract cheapest fare price from fare keys
        fares = journey.get("fares", {})
        best_price = float("inf")
        for fare_key, fare_info in fares.items():
            if isinstance(fare_info, dict):
                key_str = fare_info.get("fareAvailabilityKey", "")
                decoded_price = _decode_fare_price(key_str)
                if decoded_price and 0 < decoded_price < best_price:
                    best_price = decoded_price

        if best_price == float("inf") or best_price <= 0:
            return None

        # Add estimated taxes (~19% for Indian domestic, ~12% international)
        designator = journey.get("designator", {})
        is_international = journey.get("isInternational", False)
        tax_rate = 0.12 if is_international else 0.19
        total_price = round(best_price * (1 + tax_rate))

        # Parse segments
        segments_raw = journey.get("segments", [])
        segments: list[FlightSegment] = []
        for seg in segments_raw:
            seg_obj = self._parse_segment(seg, req)
            if seg_obj:
                segments.append(seg_obj)

        if not segments:
            # Use journey-level designator
            dep_str = designator.get("departure", "")
            arr_str = designator.get("arrival", "")
            carrier_str = journey.get("carrierString", "SG ???")
            parts = carrier_str.split()
            carrier = parts[0] if parts else "SG"
            flight_no = parts[1] if len(parts) > 1 else ""

            segments.append(
                FlightSegment(
                    airline=carrier,
                    airline_name="SpiceJet",
                    flight_no=flight_no,
                    origin=designator.get("origin", req.origin),
                    destination=designator.get("destination", req.destination),
                    departure=self._parse_dt(dep_str),
                    arrival=self._parse_dt(arr_str),
                    cabin_class="economy",
                )
            )

        # Calculate total duration
        total_dur = 0
        if segments and segments[0].departure and segments[-1].arrival:
            total_dur = int((segments[-1].arrival - segments[0].departure).total_seconds())

        route = FlightRoute(
            segments=segments,
            total_duration_seconds=max(total_dur, 0),
            stopovers=max(len(segments) - 1, 0),
        )

        journey_key = journey.get("journeyKey", "")
        currency = req.currency if req.currency != "EUR" else "INR"

        return FlightOffer(
            id=f"sg_{hashlib.md5(journey_key.encode()).hexdigest()[:12]}",
            price=total_price,
            currency=currency,
            price_formatted=f"{total_price:.0f} {currency}",
            outbound=route,
            inbound=None,
            airlines=["SpiceJet"],
            owner_airline="SG",
            booking_url=booking_url,
            is_locked=False,
            source="spicejet_direct",
            source_tier="protocol",
        )

    def _parse_segment(self, seg: dict, req: FlightSearchRequest) -> Optional[FlightSegment]:
        """Parse a segment from the availability response."""
        designator = seg.get("designator", {})
        identifier = seg.get("identifier", {})
        carrier = identifier.get("carrierCode", "SG")
        flight_no = str(identifier.get("identifier", ""))

        dep_str = designator.get("departure", "")
        arr_str = designator.get("arrival", "")
        origin = designator.get("origin", req.origin)
        destination = designator.get("destination", req.destination)

        # Get equipment type from legs
        aircraft = ""
        legs = seg.get("legs", [])
        if legs:
            leg_info = legs[0].get("legInfo", {})
            aircraft = leg_info.get("equipmentType", "")

        dep_dt = self._parse_dt(dep_str)
        arr_dt = self._parse_dt(arr_str)
        dur = int((arr_dt - dep_dt).total_seconds()) if dep_dt and arr_dt else 0

        return FlightSegment(
            airline=carrier,
            airline_name="SpiceJet",
            flight_no=flight_no,
            origin=origin,
            destination=destination,
            origin_city=designator.get("originFullName", ""),
            destination_city=designator.get("destinationFullName", ""),
            departure=dep_dt,
            arrival=arr_dt,
            duration_seconds=max(dur, 0),
            cabin_class="economy",
            aircraft=aircraft,
        )

    def _build_response(
        self, offers: list[FlightOffer], req: FlightSearchRequest, elapsed: float
    ) -> FlightSearchResponse:
        offers.sort(key=lambda o: o.price)
        logger.info(
            "SpiceJet %s→%s returned %d offers in %.1fs",
            req.origin, req.destination, len(offers), elapsed,
        )
        h = hashlib.md5(f"spicejet{req.origin}{req.destination}{req.date_from}".encode()).hexdigest()[:12]
        return FlightSearchResponse(
            search_id=f"fs_{h}",
            origin=req.origin,
            destination=req.destination,
            currency=req.currency,
            offers=offers,
            total_results=len(offers),
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
        for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M:%S"):
            try:
                return datetime.strptime(s[: len(fmt) + 2], fmt)
            except (ValueError, IndexError):
                continue
        return datetime(2000, 1, 1)

    def _build_search_nav_url(self, req: FlightSearchRequest) -> str:
        """Build the SPA search URL. The SPA reads params and calls the API."""
        dep = req.date_from.strftime("%Y-%m-%d")
        return (
            f"https://www.spicejet.com/search?from={req.origin}&to={req.destination}"
            f"&tripType=1&departure={dep}&adult={req.adults}&child={req.children}"
            f"&srCitizen=0&infant={req.infants}&currency="
            f"{req.currency if req.currency != 'EUR' else 'INR'}"
        )

    @staticmethod
    def _build_booking_url(req: FlightSearchRequest) -> str:
        dep = req.date_from.strftime("%Y-%m-%d")
        return (
            f"https://www.spicejet.com/search?from={req.origin}&to={req.destination}"
            f"&tripType=1&departure={dep}&adult={req.adults}&child={req.children}"
            f"&srCitizen=0&infant={req.infants}&currency=INR"
        )

    def _empty(self, req: FlightSearchRequest) -> FlightSearchResponse:
        h = hashlib.md5(f"spicejet{req.origin}{req.destination}{req.date_from}".encode()).hexdigest()[:12]
        return FlightSearchResponse(
            search_id=f"fs_{h}",
            origin=req.origin,
            destination=req.destination,
            currency=req.currency,
            offers=[],
            total_results=0,
        )
