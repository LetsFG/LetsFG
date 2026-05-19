"""
Skyscanner connector - curl_cffi + radar API.

Strategy:
1.  Use curl_cffi with Chrome TLS impersonation to bypass PerimeterX.
2.  Establish session: homepage -> search page (collects PX cookies).
3.  POST to /g/radar/api/v2/web-unified-search/ with entity-based payload.
4.  Poll via GET for progressive results.
5.  Parse itineraries from the flat JSON response.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
import time
import uuid
from datetime import datetime, date as date_type
from typing import Any, Optional
from urllib.parse import parse_qs, urljoin, urlparse

from ..models.flights import (
    FlightOffer,
    FlightRoute,
    FlightSearchRequest,
    FlightSearchResponse,
    FlightSegment,
)

logger = logging.getLogger(__name__)

_CURRENCY_MARKET: dict[str, str] = {
    "EUR": "UK",  # EU is not a valid Skyscanner market; UK has broadest EU coverage
    "INR": "IN", "USD": "US", "GBP": "UK", "CAD": "CA", "AUD": "AU",
    "NZD": "NZ", "JPY": "JP", "CNY": "CN", "KRW": "KR", "SGD": "SG",
    "MYR": "MY", "THB": "TH", "IDR": "ID", "PHP": "PH", "VND": "VN",
    "HKD": "HK", "AED": "AE", "SAR": "SA", "KWD": "KW", "BRL": "BR",
    "MXN": "MX", "ARS": "AR", "ZAR": "ZA", "KES": "KE", "NGN": "NG",
    "EGP": "EG", "TRY": "TR", "PLN": "PL", "CZK": "CZ", "HUF": "HU",
    "RON": "RO", "BGN": "BG", "SEK": "SE", "NOK": "NO", "DKK": "DK",
    "CHF": "CH",
}

_ENTITY_CACHE: dict[str, str] = {
    "AGP": "95565095", "AKL": "95673805", "ALC": "95565083", "AMS": "95565044",
    "ARN": "95673495", "ATH": "95673624", "ATL": "27541735", "AUH": "95673509",
    "BCN": "95565085", "BEG": "95673488", "BER": "95673383", "BGY": "95565071",
    "BJS": "27545090", "BKK": "27536671", "BLR": "95673351", "BNE": "95673551",
    "BOG": "95673344", "BOM": "27539520", "BOS": "27539525", "BRE": "128668286",
    "BRU": "27539565", "BSB": "95673410", "BUD": "95673439", "CAN": "128668169",
    "CCU": "128668366", "CDG": "95565041", "CFU": "95674252", "CGK": "95673340",
    "CHC": "95673841", "CHQ": "95674143", "CLJ": "95673885", "CNF": "95673408",
    "CPH": "95673519", "CTA": "95673893", "CTS": "128668447", "CTU": "27540574",
    "CUN": "95673718", "CWB": "95673436", "DBV": "95674145", "DEL": "95673498",
    "DEN": "95673705", "DFW": "27536457", "DOH": "95673852", "DTW": "95673555",
    "DUB": "95673529", "DUS": "27540831", "DXB": "27540839", "EDI": "95673668",
    "EWR": "95565059", "EZE": "95673318", "FAO": "95673306", "FCO": "95565065",
    "FLL": "27541669", "FRA": "27541706", "FUE": "95673312", "GDL": "95673440",
    "GDN": "95673773", "GIG": "95673347", "GRU": "95673332", "GVA": "95674055",
    "HAM": "27536295", "HEL": "95673700", "HER": "95674142", "HKG": "128668132",
    "HND": "128667143", "IAD": "95673665", "IAH": "95673412", "IBZ": "95565093",
    "ICN": "95673659", "IST": "27542903", "JED": "95673390", "JFK": "95565058",
    "KIX": "128667802", "KRK": "95673613", "KTW": "95673614", "KUL": "27543923",
    "LAX": "27536211", "LCA": "95674028", "LEJ": "95673741", "LGW": "95565051",
    "LHR": "95565050", "LIM": "95673342", "LIS": "95565055", "LON": "27544008",
    "LPA": "95673301", "MAA": "95673361", "MAD": "95565077", "MAN": "95673540",
    "MCO": "95674009", "MEL": "27544894", "MEX": "39151418", "MIA": "27536644",
    "MIL": "27544068", "MLE": "104120258", "MOW": "27539438", "MSP": "27540996",
    "MUC": "95673491", "MXP": "95565070", "NAP": "95673535", "NRT": "128668889",
    "NUE": "95673744", "NYC": "27537542", "OPO": "95566290", "ORD": "95673392",
    "ORY": "95565040", "OSL": "27538634", "OTP": "95673426", "PAR": "27539733",
    "PDX": "95673720", "PEK": "128668664", "PER": "128668924", "PHL": "27545954",
    "PHX": "27540837", "PMI": "95565111", "PMO": "95673647", "POA": "95673477",
    "POZ": "128667756", "PRG": "95673502", "PVG": "128667077", "REC": "95673454",
    "RHO": "104120264", "RIX": "95673617", "ROM": "27539793", "RUH": "95673362",
    "SAN": "27545066", "SCL": "104120223", "SEA": "27538444", "SEL": "27538638",
    "SFO": "95673577", "SHA": "27546079", "SIN": "27546111", "SJC": "27546164",
    "SKG": "95673847", "SOF": "95673503", "SPU": "95674071", "SSA": "95673396",
    "STN": "95565052", "STR": "95673677", "SVQ": "95565089", "SYD": "27547097",
    "TFS": "95673303", "TLL": "128667052", "TPA": "27544873", "TPE": "27547236",
    "TYO": "27542089", "VCE": "27547373", "VIE": "95673444", "VLC": "95565090",
    "VNO": "95673717", "WAW": "27547454", "WMI": "128667439", "WRO": "95674155",
    "YOW": "27536667", "YUL": "95673384", "YVR": "27537411", "YYC": "95673531",
    "YYZ": "95673353", "ZAG": "95673639", "ZRH": "95673856",
}

_AIRPORT_TO_SKY_CITY: dict[str, str] | None = None


def _currency_to_market(currency: str) -> str:
    return _CURRENCY_MARKET.get(currency.upper(), "UK")


def _skyscanner_search_code(code: str) -> str:
    normalized = code.upper().strip()
    if not normalized:
        return normalized
    return _airport_to_skyscanner_city().get(normalized, normalized)


def _airport_to_skyscanner_city() -> dict[str, str]:
    global _AIRPORT_TO_SKY_CITY
    if _AIRPORT_TO_SKY_CITY is not None:
        return _AIRPORT_TO_SKY_CITY

    mapping: dict[str, str] = {}
    try:
        from .airline_routes import CITY_AIRPORTS

        city_sizes = {
            city_code: len(airports)
            for city_code, airports in CITY_AIRPORTS.items()
            if city_code in _ENTITY_CACHE
        }

        for city_code, airports in CITY_AIRPORTS.items():
            if city_code not in _ENTITY_CACHE:
                continue
            for airport_code in airports:
                airport = str(airport_code or "").upper().strip()
                if not airport or airport == city_code:
                    continue

                current = mapping.get(airport)
                if current is None:
                    mapping[airport] = city_code
                    continue

                current_size = city_sizes.get(current, 0)
                candidate_size = city_sizes.get(city_code, 0)
                if candidate_size > current_size or (
                    candidate_size == current_size and city_code < current
                ):
                    mapping[airport] = city_code
    except Exception:
        mapping = {}

    _AIRPORT_TO_SKY_CITY = mapping
    return mapping


def _parse_dt(s: Any) -> datetime:
    if not s:
        return datetime(2000, 1, 1)
    s = str(s)
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00").split("+")[0])
    except (ValueError, AttributeError):
        return datetime(2000, 1, 1)


_SKY_CABIN = {"M": "economy", "W": "premiumeconomy", "C": "business", "F": "first"}
_SKY_CABIN_API = {"M": "ECONOMY", "W": "PREMIUM_ECONOMY", "C": "BUSINESS", "F": "FIRST"}


class SkyscannerConnectorClient:
    """Skyscanner - meta-search, curl_cffi + radar API."""

    def __init__(self, timeout: float = 55.0):
        self.timeout = timeout

    async def close(self):
        pass

    async def search_flights(
        self, req: FlightSearchRequest
    ) -> FlightSearchResponse:
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

    async def _search_ow(
        self, req: FlightSearchRequest
    ) -> FlightSearchResponse:
        t0 = time.monotonic()
        for attempt in range(2):
            try:
                offers = await self._do_search(req)
                if offers is not None:
                    offers.sort(key=lambda o: o.price if o.price > 0 else float("inf"))
                    elapsed = time.monotonic() - t0
                    logger.info(
                        "SKYSCANNER %s->%s: %d offers in %.1fs",
                        req.origin, req.destination, len(offers), elapsed,
                    )
                    h = hashlib.md5(
                        f"skyscanner{req.origin}{req.destination}{req.date_from}{req.return_from or ''}".encode()
                    ).hexdigest()[:12]
                    return FlightSearchResponse(
                        search_id=f"fs_ss_{h}",
                        origin=req.origin,
                        destination=req.destination,
                        currency=req.currency,
                        offers=offers,
                        total_results=len(offers),
                    )
            except Exception as e:
                logger.warning("SKYSCANNER attempt %d failed: %s", attempt, e)
        return self._empty(req)

    async def _do_search(
        self, req: FlightSearchRequest
    ) -> list[FlightOffer] | None:
        import os
        from curl_cffi.requests import AsyncSession

        travel_date = req.date_from
        requested_origin = req.origin.upper()
        requested_dest = req.destination.upper()
        origin = _skyscanner_search_code(requested_origin)
        dest = _skyscanner_search_code(requested_dest)
        cabin = _SKY_CABIN.get(req.cabin_class, "economy") if req.cabin_class else "economy"
        cabin_api = _SKY_CABIN_API.get(req.cabin_class, "ECONOMY") if req.cabin_class else "ECONOMY"
        currency = req.currency or "EUR"
        market = _currency_to_market(currency)
        date_str = f"{travel_date.year % 100:02d}{travel_date.month:02d}{travel_date.day:02d}"

        if origin != requested_origin or dest != requested_dest:
            logger.debug(
                "SKYSCANNER: widened %s->%s to %s->%s",
                requested_origin,
                requested_dest,
                origin,
                dest,
            )

        proxy_url = os.environ.get("LETSFG_PROXY", "").strip() or None
        # Use sticky session so all requests share the same exit IP (PX ties cookies to IP)
        if proxy_url and "@" in proxy_url:
            sid = f"sky{uuid.uuid4().hex[:8]}"
            proxy_url = proxy_url.replace("@", f"_session-{sid}@", 1)
            logger.debug("SKYSCANNER: using sticky session %s", sid)

        async with AsyncSession(impersonate="chrome136", proxy=proxy_url) as session:
            # 1. Homepage - establish PX cookies on .net
            try:
                await session.get(
                    "https://www.skyscanner.net/",
                    headers={
                        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                        "Accept-Language": "en-GB,en;q=0.9",
                    },
                    timeout=15,
                )
            except Exception as e:
                logger.warning("SKYSCANNER: homepage failed: %s", e)
                return None

            # Check entity ID cache first — skip search page if both known
            origin_eid = _ENTITY_CACHE.get(origin, "")
            dest_eid = _ENTITY_CACHE.get(dest, "")

            # 2. Search page - get SSR data with entity IDs + more cookies
            search_url = (
                f"https://www.skyscanner.net/transport/flights/"
                f"{origin.lower()}/{dest.lower()}/{date_str}/"
                f"?adultsv2={req.adults or 1}"
                f"&cabinclass={cabin}"
                f"&currency={currency}"
                f"&locale=en-GB"
                f"&market={market}"
            )
            try:
                r_page = await session.get(
                    search_url,
                    headers={
                        "Accept": "text/html",
                        "Referer": "https://www.skyscanner.net/",
                    },
                    timeout=20,
                )
                if r_page.status_code == 200 and (not origin_eid or not dest_eid):
                    o, resolved_dest_eid = _extract_entity_ids(r_page.text, origin, dest)
                    if o:
                        origin_eid = o
                        _ENTITY_CACHE[origin] = o
                    if resolved_dest_eid:
                        dest_eid = resolved_dest_eid
                        _ENTITY_CACHE[dest] = resolved_dest_eid
            except Exception as e:
                logger.debug("SKYSCANNER: search page failed: %s", e)

            if not origin_eid or not dest_eid:
                logger.warning("SKYSCANNER: could not resolve entity IDs for %s->%s", origin, dest)
                return None

            # Get traveller_context cookie
            try:
                tc = session.cookies.get("traveller_context", "", domain="www.skyscanner.net")
            except Exception:
                tc = ""
            funnel_id = str(uuid.uuid4())

            # 3. POST to radar API
            payload = {
                "cabinClass": cabin_api,
                "childAges": [],
                "adults": req.adults or 1,
                "legs": [{
                    "legOrigin": {"@type": "entity", "entityId": origin_eid},
                    "legDestination": {"@type": "entity", "entityId": dest_eid},
                    "dates": {
                        "@type": "date",
                            "year": str(travel_date.year),
                            "month": f"{travel_date.month:02d}",
                            "day": f"{travel_date.day:02d}",
                    },
                }],
            }

            radar_headers = {
                "Accept": "application/json",
                "Content-Type": "application/json",
                "Origin": "https://www.skyscanner.net",
                "Referer": search_url,
                "x-skyscanner-channelid": "website",
                "x-skyscanner-currency": currency,
                "x-skyscanner-locale": "en-GB",
                "x-skyscanner-market": market,
                "x-skyscanner-viewid": funnel_id,
                "x-skyscanner-trustedfunnelid": funnel_id,
                "x-skyscanner-traveller-context": tc or funnel_id,
                "x-skyscanner-combined-results-rail": "true",
                "x-skyscanner-skip-accommodation-carhire": "true",
                "x-skyscanner-consent-adverts": "false",
            }

            try:
                r_api = await session.post(
                    "https://www.skyscanner.net/g/radar/api/v2/web-unified-search/",
                    json=payload,
                    headers=radar_headers,
                    timeout=20,
                )
            except Exception as e:
                logger.warning("SKYSCANNER: radar API POST failed: %s", e)
                return None

            if r_api.status_code != 200:
                logger.warning("SKYSCANNER: radar API status %d: %s", r_api.status_code, r_api.text[:200])
                return None

            data = r_api.json()
            all_offers = _parse_radar(data, req)

            # 4. Poll for more results if status is "incomplete"
            ctx = data.get("context", {})
            session_id = ctx.get("sessionId", "")
            status = ctx.get("status", "")

            poll_count = 0
            max_polls = 4
            seen_ids = {o.id for o in all_offers}

            while status == "incomplete" and session_id and poll_count < max_polls:
                poll_count += 1
                await asyncio.sleep(2.0)
                poll_url = f"https://www.skyscanner.net/g/radar/api/v2/web-unified-search/{session_id}"
                try:
                    r_poll = await session.get(
                        poll_url,
                        headers=radar_headers,
                        timeout=20,
                    )
                except Exception as e:
                    logger.debug("SKYSCANNER: poll %d failed: %s", poll_count, e)
                    break

                if r_poll.status_code != 200:
                    break

                poll_data = r_poll.json()
                new_offers = _parse_radar(poll_data, req)
                for o in new_offers:
                    if o.id not in seen_ids:
                        seen_ids.add(o.id)
                        all_offers.append(o)

                ctx = poll_data.get("context", {})
                session_id = ctx.get("sessionId", "")
                status = ctx.get("status", "")

            logger.info("SKYSCANNER: %d total offers after %d polls", len(all_offers), poll_count)
            all_offers.sort(key=lambda o: o.price if o.price > 0 else float("inf"))
            return all_offers

    def _empty(self, req: FlightSearchRequest) -> FlightSearchResponse:
        return FlightSearchResponse(
            search_id="",
            origin=req.origin,
            destination=req.destination,
            currency=req.currency,
            offers=[],
            total_results=0,
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
                    id=f"rt_ss_{cid}", price=price, currency=o.currency,
                    outbound=o.outbound, inbound=i.outbound,
                    airlines=list(dict.fromkeys(o.airlines + i.airlines)),
                    owner_airline=o.owner_airline,
                    booking_url=o.booking_url, is_locked=False,
                    source=o.source, source_tier=o.source_tier,
                ))
        combos.sort(key=lambda c: c.price)
        return combos[:20]


def _extract_entity_ids(html: str, origin_iata: str, dest_iata: str) -> tuple[str, str]:
    """Extract Skyscanner entity IDs from SSR __internal JSON."""
    origin_eid = ""
    dest_eid = ""
    try:
        m = re.search(r'"originId"\s*:\s*"?(\d+)"?', html)
        if m:
            origin_eid = m.group(1)
        m = re.search(r'"destinationId"\s*:\s*"?(\d+)"?', html)
        if m:
            dest_eid = m.group(1)
        if not origin_eid:
            m = re.search(r'"origin"\s*:\s*\{[^}]*"entityId"\s*:\s*"(\d+)"', html)
            if m:
                origin_eid = m.group(1)
        if not dest_eid:
            m = re.search(r'"destination"\s*:\s*\{[^}]*"entityId"\s*:\s*"(\d+)"', html)
            if m:
                dest_eid = m.group(1)
    except Exception as e:
        logger.debug("SKYSCANNER: entity ID extraction error: %s", e)
    return origin_eid, dest_eid


def _parse_radar(data: dict, req: FlightSearchRequest) -> list[FlightOffer]:
    """Parse Skyscanner radar API v2 response into FlightOffer list."""
    target_cur = req.currency or "EUR"
    offers: list[FlightOffer] = []
    search_origin = _skyscanner_search_code(req.origin).lower()
    search_dest = _skyscanner_search_code(req.destination).lower()

    itineraries = data.get("itineraries", {})
    results = itineraries.get("results", [])

    for result in results:
        try:
            legs = result.get("legs", [])
            if not legs:
                continue

            outbound = _build_route(legs[0], req)
            if not outbound or not outbound.segments:
                continue

            inbound = None
            if len(legs) > 1:
                inbound = _build_route(legs[1], req)

            all_airlines = list(dict.fromkeys(
                s.airline for s in outbound.segments if s.airline
            ))
            if inbound:
                all_airlines.extend(
                    s.airline for s in inbound.segments
                    if s.airline and s.airline not in all_airlines
                )

            itin_id = result.get("id", "")
            fallback_booking_url = (
                f"https://www.skyscanner.net/transport/flights/"
                f"{search_origin}/{search_dest}/"
            )

            pricing_options = _safe_pricing_options(result)
            if pricing_options:
                for option_index, option in enumerate(pricing_options):
                    raw_price = _pricing_option_amount(option)
                    if raw_price is None:
                        continue

                    option_key = _pricing_option_identifier(option, fallback=str(option_index))
                    h = hashlib.md5(f"ss_{itin_id}_{option_key}".encode()).hexdigest()[:10]
                    booking_url = _pricing_option_booking_url(option) or fallback_booking_url
                    conditions = _build_offer_conditions(result, option)

                    offers.append(FlightOffer(
                        id=f"ss_{h}",
                        price=raw_price,
                        currency=target_cur,
                        price_formatted=f"{target_cur} {raw_price:.2f}",
                        outbound=outbound,
                        inbound=inbound,
                        airlines=all_airlines,
                        owner_airline=all_airlines[0] if all_airlines else "",
                        source="skyscanner_meta",
                        source_tier="free",
                        is_locked=False,
                        booking_url=booking_url,
                        conditions=conditions,
                    ))
                continue

            selected_price = _select_display_price(result)
            if selected_price is None:
                continue
            raw_price, formatted = selected_price
            h = hashlib.md5(f"ss_{itin_id}_{raw_price}".encode()).hexdigest()[:10]
            conditions = _build_offer_conditions(result)

            offers.append(FlightOffer(
                id=f"ss_{h}",
                price=raw_price,
                currency=target_cur,
                price_formatted=formatted or f"{target_cur} {raw_price:.2f}",
                outbound=outbound,
                inbound=inbound,
                airlines=all_airlines,
                owner_airline=all_airlines[0] if all_airlines else "",
                source="skyscanner_meta",
                source_tier="free",
                is_locked=False,
                booking_url=fallback_booking_url,
                conditions=conditions,
            ))
        except Exception as e:
            logger.warning("SKYSCANNER: parse itinerary failed: %s", e)

    return offers


def _build_offer_conditions(result: dict, option: dict | None = None) -> dict[str, str]:
    conditions: dict[str, str] = {}

    fare_policy = result.get("farePolicy")
    if isinstance(fare_policy, dict):
        change_allowed = fare_policy.get("isChangeAllowed")
        partially_changeable = fare_policy.get("isPartiallyChangeable")
        if change_allowed is True:
            conditions["change_before_departure"] = "allowed"
        elif partially_changeable is True:
            conditions["change_before_departure"] = "allowed_with_fee"
        elif "isChangeAllowed" in fare_policy or "isPartiallyChangeable" in fare_policy:
            conditions["change_before_departure"] = "not_allowed"

        cancellation_allowed = fare_policy.get("isCancellationAllowed")
        partially_refundable = fare_policy.get("isPartiallyRefundable")
        if cancellation_allowed is True:
            conditions["refund_before_departure"] = "allowed"
        elif partially_refundable is True:
            conditions["refund_before_departure"] = "allowed_with_fee"
        elif "isCancellationAllowed" in fare_policy or "isPartiallyRefundable" in fare_policy:
            conditions["refund_before_departure"] = "not_allowed"

    if result.get("hasFlexibleOptions") is True:
        conditions["flexible_ticket_options"] = "available"
    elif result.get("hasFlexibleOptions") is False:
        conditions["flexible_ticket_options"] = "not_available"

    is_self_transfer = result.get("isSelfTransfer")
    is_protected_self_transfer = result.get("isProtectedSelfTransfer")
    if is_self_transfer is True:
        conditions["self_transfer"] = "protected" if is_protected_self_transfer is True else "unprotected"
    elif is_self_transfer is False:
        conditions["self_transfer"] = "not_self_transfer"

    deeplink_query = _pricing_option_deeplink_query(option) if option is not None else {}
    fare_type = deeplink_query.get("fare_type")
    if fare_type:
        conditions["fare_type"] = fare_type

    transfer_protection = deeplink_query.get("transfer_protection")
    if transfer_protection:
        conditions["self_transfer_protection"] = transfer_protection

    return conditions


def _safe_pricing_options(result: dict) -> list[dict]:
    price_obj = result.get("price", {})
    preferred_option_id = str(price_obj.get("pricingOptionId") or "")

    safe_options: list[dict] = []
    consistent_base_fare_options: list[dict] = []
    for option in result.get("pricingOptions", []) or []:
        amount = _pricing_option_amount(option)
        if amount is None:
            continue
        if _is_base_fare_pricing_option(option):
            if _is_consistent_base_fare_option(option):
                consistent_base_fare_options.append(option)
            continue
        safe_options.append(option)

    if safe_options:
        return _ordered_pricing_options(safe_options, preferred_option_id)

    if consistent_base_fare_options:
        return _ordered_pricing_options(consistent_base_fare_options, preferred_option_id)

    return []


def _select_safe_pricing_option(result: dict) -> dict | None:
    safe_options = _safe_pricing_options(result)
    if not safe_options:
        return None
    return safe_options[0]


def _select_display_price(result: dict) -> tuple[float, str] | None:
    selected_option = _select_safe_pricing_option(result)
    if selected_option is not None:
        amount = _pricing_option_amount(selected_option)
        if amount is not None:
            return amount, ""

    # Radar sometimes exposes only base-fare teaser prices. Those understate the final total,
    # so skip the itinerary entirely instead of surfacing a fake cheaper fare.
    price_obj = result.get("price", {})
    if result.get("pricingOptions"):
        return None

    raw_price = price_obj.get("raw")
    if not raw_price or raw_price <= 0:
        return None
    return float(raw_price), str(price_obj.get("formatted") or "")


def _select_booking_url(result: dict) -> str:
    selected_option = _select_safe_pricing_option(result)
    if selected_option is None:
        return ""
    return _pricing_option_booking_url(selected_option)


def _pricing_option_amount(option: dict) -> float | None:
    price = option.get("price", {})
    amount = _positive_price(price.get("amount"))
    if amount is not None:
        return amount

    for item in option.get("items", []) or []:
        item_price = item.get("price", {})
        item_amount = _positive_price(item_price.get("amount"))
        if item_amount is not None:
            return item_amount

    return None


def _pick_preferred_pricing_option(options: list[dict], preferred_option_id: str) -> dict:
    if preferred_option_id:
        for option in options:
            if str(option.get("pricingOptionId") or "") == preferred_option_id:
                return option
    return min(options, key=lambda option: _pricing_option_amount(option) or float("inf"))


def _ordered_pricing_options(options: list[dict], preferred_option_id: str) -> list[dict]:
    ordered: list[dict] = []
    remaining = list(options)
    if preferred_option_id:
        for idx, option in enumerate(remaining):
            if str(option.get("pricingOptionId") or "") == preferred_option_id:
                ordered.append(option)
                remaining.pop(idx)
                break
    remaining.sort(
        key=lambda option: (
            _pricing_option_amount(option) or float("inf"),
            str(option.get("pricingOptionId") or ""),
        )
    )
    ordered.extend(remaining)
    return ordered


def _positive_price(raw_value: object) -> float | None:
    if isinstance(raw_value, (int, float)) and raw_value > 0:
        return float(raw_value)
    if isinstance(raw_value, str):
        try:
            parsed = float(raw_value.strip())
        except ValueError:
            return None
        if parsed > 0:
            return parsed
    return None


def _pricing_option_booking_url(option: dict) -> str:
    for item in option.get("items", []) or []:
        url = item.get("url") or item.get("bookingUrl") or item.get("deepLink") or item.get("deeplink")
        normalized_url = _normalize_skyscanner_booking_url(url)
        if normalized_url:
            return normalized_url

    for agent in option.get("agents", []) or []:
        normalized_url = _normalize_skyscanner_booking_url(agent.get("url"))
        if normalized_url:
            return normalized_url

    for key in ("url", "bookingUrl", "deepLink", "deeplink"):
        normalized_url = _normalize_skyscanner_booking_url(option.get(key))
        if normalized_url:
            return normalized_url

    return ""


def _pricing_option_deeplink_query(option: dict | None) -> dict[str, str]:
    if not isinstance(option, dict):
        return {}

    deeplink = _pricing_option_booking_url(option)
    if not deeplink:
        return {}

    parsed_query = parse_qs(urlparse(deeplink).query)
    return {
        key: values[0]
        for key, values in parsed_query.items()
        if values and values[0]
    }


def _pricing_option_identifier(option: dict, *, fallback: str) -> str:
    option_id = str(option.get("pricingOptionId") or "").strip()
    if option_id:
        return option_id

    booking_url = _pricing_option_booking_url(option)
    if booking_url:
        return hashlib.md5(booking_url.encode()).hexdigest()[:10]

    amount = _pricing_option_amount(option)
    if amount is not None:
        return f"{fallback}_{amount:.2f}"

    return fallback


def _normalize_skyscanner_booking_url(raw_url: object) -> str:
    url = str(raw_url or "").strip()
    if not url:
        return ""
    if url.startswith("//"):
        return f"https:{url}"
    if url.startswith("http://") or url.startswith("https://"):
        return url
    return urljoin("https://www.skyscanner.net/", url)


def _is_base_fare_pricing_option(option: dict) -> bool:
    for item in option.get("items", []) or []:
        url = item.get("url")
        if not url:
            continue
        fare_type = parse_qs(urlparse(str(url)).query).get("fare_type", [""])[0]
        if fare_type.lower() == "base_fare":
            return True
    return False


def _is_consistent_base_fare_option(option: dict) -> bool:
    option_amount = _pricing_option_amount(option)
    if option_amount is None:
        return False

    ticket_price = _base_fare_ticket_price(option)
    if ticket_price is None or abs(ticket_price - option_amount) > 0.01:
        return False

    return True


def _base_fare_ticket_price(option: dict) -> float | None:
    for item in option.get("items", []) or []:
        url = item.get("url")
        if not url:
            continue
        query = parse_qs(urlparse(str(url)).query)
        fare_type = query.get("fare_type", [""])[0]
        if fare_type.lower() != "base_fare":
            continue
        ticket_price = _positive_price(query.get("ticket_price", [""])[0])
        if ticket_price is not None:
            return ticket_price
    return None


def _build_route(leg: dict, req: FlightSearchRequest) -> FlightRoute | None:
    """Build a FlightRoute from a radar leg object."""
    segments_data = leg.get("segments", [])
    if not segments_data:
        return None

    flight_segments: list[FlightSegment] = []
    for seg in segments_data:
        mkt_carrier = seg.get("marketingCarrier", {})
        carrier_code = mkt_carrier.get("displayCode", "")
        carrier_name = mkt_carrier.get("name", "")

        seg_origin = seg.get("origin", {})
        seg_dest = seg.get("destination", {})

        origin_city = ""
        dest_city = ""
        parent = seg_origin.get("parent", {})
        if parent:
            origin_city = parent.get("name", "")
        parent = seg_dest.get("parent", {})
        if parent:
            dest_city = parent.get("name", "")

        flight_segments.append(FlightSegment(
            airline=carrier_code,
            airline_name=carrier_name,
            flight_no=f"{carrier_code}{seg.get('flightNumber', '')}",
            origin=seg_origin.get("flightPlaceId", seg_origin.get("displayCode", "")),
            destination=seg_dest.get("flightPlaceId", seg_dest.get("displayCode", "")),
            origin_city=origin_city,
            destination_city=dest_city,
            departure=_parse_dt(seg.get("departure")),
            arrival=_parse_dt(seg.get("arrival")),
            duration_seconds=(seg.get("durationInMinutes") or 0) * 60,
        ))

    total_dur = (leg.get("durationInMinutes") or 0) * 60
    stopovers = leg.get("stopCount", max(0, len(flight_segments) - 1))

    return FlightRoute(
        segments=flight_segments,
        total_duration_seconds=total_dur,
        stopovers=stopovers,
    )
