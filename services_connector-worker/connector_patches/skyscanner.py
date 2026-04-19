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

from letsfg.models.flights import (
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


def _currency_to_market(currency: str) -> str:
    return _CURRENCY_MARKET.get(currency.upper(), "UK")


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

        d = req.date_from
        origin = req.origin.upper()
        dest = req.destination.upper()
        cabin = _SKY_CABIN.get(req.cabin_class, "economy") if req.cabin_class else "economy"
        cabin_api = _SKY_CABIN_API.get(req.cabin_class, "ECONOMY") if req.cabin_class else "ECONOMY"
        currency = req.currency or "EUR"
        market = _currency_to_market(currency)
        date_str = f"{d.year % 100:02d}{d.month:02d}{d.day:02d}"

        # Prefer SKYSCANNER_PROXY directly (bypass local relay which doesn't support curl_cffi CONNECT)
        proxy_url = os.environ.get("SKYSCANNER_PROXY", "").strip() or os.environ.get("LETSFG_PROXY", "").strip() or None
        # Skip local relay — curl_cffi handles authenticated proxies natively
        if proxy_url and "127.0.0.1" in proxy_url:
            proxy_url = os.environ.get("SKYSCANNER_PROXY", "").strip() or None
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
                    o, d = _extract_entity_ids(r_page.text, origin, dest)
                    if o:
                        origin_eid = o
                        _ENTITY_CACHE[origin] = o
                    if d:
                        dest_eid = d
                        _ENTITY_CACHE[dest] = d
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
                        "year": str(d.year),
                        "month": f"{d.month:02d}",
                        "day": f"{d.day:02d}",
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

    itineraries = data.get("itineraries", {})
    results = itineraries.get("results", [])

    for result in results:
        try:
            price_obj = result.get("price", {})
            raw_price = price_obj.get("raw")
            if not raw_price or raw_price <= 0:
                continue

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
            h = hashlib.md5(f"ss_{itin_id}_{raw_price}".encode()).hexdigest()[:10]
            formatted = price_obj.get("formatted", f"{target_cur} {raw_price:.2f}")

            offers.append(FlightOffer(
                id=f"ss_{h}",
                price=raw_price,
                currency=target_cur,
                price_formatted=formatted,
                outbound=outbound,
                inbound=inbound,
                airlines=all_airlines,
                owner_airline=all_airlines[0] if all_airlines else "",
                source="skyscanner_meta",
                source_tier="free",
                is_locked=False,
                booking_url=(
                    f"https://www.skyscanner.net/transport/flights/"
                    f"{req.origin.lower()}/{req.destination.lower()}/"
                ),
            ))
        except Exception as e:
            logger.warning("SKYSCANNER: parse itinerary failed: %s", e)

    return offers


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
