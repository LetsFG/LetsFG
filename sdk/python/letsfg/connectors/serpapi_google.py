"""
Google Flights connector — reverse-engineered API via fli + curl_cffi.

No browser required. Uses impersonate='chrome' for TLS fingerprint bypass.
Source: "serpapi_google" preserved for backwards-compat with stats pipeline
and website per-offer annotation.

Speed: OW ~3-8s, RT ~15-25s (vs Playwright: 30-75s).
Currency: fli returns geo-based currency (e.g. PLN for WAW routes).
         We convert to req.currency using the SDK fallback rate table.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Optional
from urllib.parse import quote

from letsfg.connectors.currency import _fallback_convert
from letsfg.models.flights import (
    FlightOffer,
    FlightRoute,
    FlightSearchRequest,
    FlightSearchResponse,
    FlightSegment as LegSegment,
)

logger = logging.getLogger(__name__)

# Metro code → canonical airport (fli Airport enum doesn't include metro codes)
_METRO_MAP: dict[str, str] = {
    "NYC": "JFK",
    "LON": "LHR",
    "PAR": "CDG",
    "ROM": "FCO",
    "MIL": "MXP",
    "WAS": "IAD",
    "TYO": "HND",
    "OSA": "KIX",
    "SEL": "ICN",
    "RIO": "GIG",
    "CHI": "ORD",
    "BJS": "PEK",
    "SHA": "PVG",
    "STO": "ARN",
    "MOW": "SVO",
    "BUE": "EZE",
    "SAO": "GRU",
    "JKT": "CGK",
    "YTO": "YYZ",
    "YMQ": "YUL",
    "REK": "KEF",
}

_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="fli_google")

# ─── Google Flights HTTP plumbing ─────────────────────────────────────────

_GF_API_URL = (
    "https://www.google.com/_/FlightsFrontendUi/data/"
    "travel.frontend.flights.FlightsFrontendService/GetShoppingResults"
)
_GF_WARMUP_URL = "https://www.google.com/travel/flights"


def _make_gf_session(proxy_url: Optional[str] = None):
    """Create a curl_cffi Session for Google Flights with warm-up cookie acquisition.

    We GET the Google Flights homepage first so Google sets session cookies.
    Without these cookies the GetShoppingResults endpoint returns ErrorResponse
    even from residential proxy IPs.
    """
    from curl_cffi.requests import Session

    kwargs: dict = {}
    if proxy_url:
        kwargs["proxies"] = {"http": proxy_url, "https": proxy_url}
    sess = Session(**kwargs)

    try:
        sess.get(
            _GF_WARMUP_URL,
            headers={
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
            },
            impersonate="chrome",
            timeout=12,
            allow_redirects=True,
        )
        logger.debug("Google Flights warm-up OK (proxy=%s)", bool(proxy_url))
    except Exception as e:
        logger.debug("Google Flights warm-up failed: %s", e)

    return sess


def _gf_search(sess, encoded: str) -> list:
    """POST to GetShoppingResults and parse results using fli's parser."""
    from fli.search.flights import SearchFlights

    resp = sess.post(
        _GF_API_URL,
        data=f"f.req={encoded}",
        headers={"content-type": "application/x-www-form-urlencoded;charset=UTF-8"},
        impersonate="chrome",
        timeout=30,
        allow_redirects=True,
    )
    resp.raise_for_status()

    body = resp.text.lstrip(")]}'\'\n")
    parsed_outer = json.loads(body)
    inner_json = parsed_outer[0][2]
    if not inner_json:
        return []
    parsed_inner = json.loads(inner_json)
    flights_data = [
        item
        for i in [2, 3]
        if isinstance(parsed_inner[i], list)
        for item in parsed_inner[i][0]
    ]
    return [SearchFlights._parse_flights_data(f) for f in flights_data]


def _resolve_airport(code: str):
    """Resolve IATA/metro code to fli Airport enum. Returns None if unknown."""
    from fli.models import Airport

    code = _METRO_MAP.get(code, code)
    try:
        return Airport[code]
    except (KeyError, Exception):
        return None


def _max_stops_enum(max_stops: int):
    from fli.models.google_flights.base import MaxStops

    if max_stops == 0:
        return MaxStops.NON_STOP
    if max_stops == 1:
        return MaxStops.ONE_STOP_OR_FEWER
    return MaxStops.ANY


def _seat_type_enum(cabin: Optional[str]):
    from fli.models.google_flights.base import SeatType

    mapping = {
        "M": SeatType.ECONOMY,
        "W": SeatType.PREMIUM_ECONOMY,
        "C": SeatType.BUSINESS,
        "F": SeatType.FIRST,
    }
    return mapping.get(cabin or "M", SeatType.ECONOMY)


def _airline_code(airline_enum) -> str:
    """Convert fli Airline enum to IATA code string.

    fli prefixes numeric codes (e.g. "2P" -> "_2P") to make them valid
    Python identifiers. We strip the leading underscore.
    """
    name = airline_enum.name
    if name.startswith("_"):
        name = name[1:]
    return name


def _make_leg_segment(leg) -> LegSegment:
    origin = leg.departure_airport.name
    dest = leg.arrival_airport.name
    code = _airline_code(leg.airline)
    # fli Airline.value is the full airline name (e.g. "Wizz Air")
    name = leg.airline.value if leg.airline.value != leg.airline.name else ""
    dep = leg.departure_datetime
    arr = leg.arrival_datetime
    dur = getattr(leg, "duration", 0) or 0
    return LegSegment(
        airline=code,
        airline_name=name,
        flight_no=getattr(leg, "flight_number", "") or "",
        origin=origin,
        destination=dest,
        departure=dep if isinstance(dep, datetime) else datetime(*dep.timetuple()[:6]),
        arrival=arr if isinstance(arr, datetime) else datetime(*arr.timetuple()[:6]),
        duration_seconds=dur * 60,
    )


def _make_route(fli_result) -> FlightRoute:
    segments = [_make_leg_segment(leg) for leg in (fli_result.legs or [])]
    duration_s = (getattr(fli_result, "duration", 0) or 0) * 60
    if not duration_s and segments:
        duration_s = sum(s.duration_seconds for s in segments)
    stops = getattr(fli_result, "stops", max(0, len(segments) - 1))
    return FlightRoute(segments=segments, total_duration_seconds=duration_s, stopovers=stops)


def _booking_url(origin: str, dest: str, dep_date: str, ret_date: Optional[str], currency: str) -> str:
    o = _METRO_MAP.get(origin, origin)
    d = _METRO_MAP.get(dest, dest)
    q = f"Flights from {o} to {d} on {dep_date}"
    if ret_date:
        q += f" return {ret_date}"
    return f"https://www.google.com/travel/flights?q={quote(q)}&curr={currency}&hl=en"


def _offer_id(origin: str, dest: str, dep_date: str, ret_date: Optional[str], price: float, airline: str) -> str:
    key = f"gf:{origin}:{dest}:{dep_date}:{ret_date}:{price:.2f}:{airline}"
    return "gf_" + hashlib.sha1(key.encode()).hexdigest()[:16]


# ─── Synchronous fli calls (run in thread pool) ────────────────────────────

def _fli_ow(origin_ap, dest_ap, dep_date: str, adults: int, max_stops, seat_type) -> list:
    from fli.models import FlightSearchFilters, FlightSegment, PassengerInfo, TripType

    seg = FlightSegment(
        departure_airport=[[origin_ap, 0]],
        arrival_airport=[[dest_ap, 0]],
        travel_date=dep_date,
    )
    filters = FlightSearchFilters(
        flight_segments=[seg],
        trip_type=TripType.ONE_WAY,
        passenger_info=PassengerInfo(adults=adults),
        stops=max_stops,
        seat_type=seat_type,
    )
    encoded = filters.encode()
    proxy_url = os.environ.get("LETSFG_PROXY", "").strip() or None
    sess = _make_gf_session(proxy_url)
    try:
        results = _gf_search(sess, encoded)
    except Exception as e:
        logger.warning("GF API OW %s->%s error: %s", origin_ap, dest_ap, e)
        results = []
    if not results and not proxy_url:
        # Retry with proxy in case direct GCP IP is blocked
        fallback_proxy = os.environ.get("RESIDENTIAL_PROXY_URL", "").strip() or None
        if fallback_proxy:
            try:
                sess2 = _make_gf_session(fallback_proxy)
                results = _gf_search(sess2, encoded)
            except Exception as e:
                logger.warning("GF API OW proxy retry error: %s", e)
    logger.info(
        "GF API OW %s->%s: %d results (proxy=%s)",
        origin_ap, dest_ap, len(results), bool(proxy_url),
    )
    return results


def _fli_rt(origin_ap, dest_ap, dep_date: str, ret_date: str, adults: int, max_stops, seat_type) -> list:
    from fli.models import FlightSearchFilters, FlightSegment, PassengerInfo, TripType

    seg_out = FlightSegment(
        departure_airport=[[origin_ap, 0]],
        arrival_airport=[[dest_ap, 0]],
        travel_date=dep_date,
    )
    seg_ret = FlightSegment(
        departure_airport=[[dest_ap, 0]],
        arrival_airport=[[origin_ap, 0]],
        travel_date=ret_date,
    )
    filters = FlightSearchFilters(
        flight_segments=[seg_out, seg_ret],
        trip_type=TripType.ROUND_TRIP,
        passenger_info=PassengerInfo(adults=adults),
        stops=max_stops,
        seat_type=seat_type,
    )
    encoded = filters.encode()
    proxy_url = os.environ.get("LETSFG_PROXY", "").strip() or None
    sess = _make_gf_session(proxy_url)
    # For RT we need fli's iterative leg selection logic;
    # inject our proxied+warmed session into a fresh SearchFlights instance.
    from fli.search.flights import SearchFlights as _SF
    sf = _SF()
    sf.client = sess  # patch with our session (has cookies + proxy)
    try:
        results = sf.search(filters, top_n=4) or []
    except Exception as e:
        logger.warning("GF API RT %s->%s error: %s", origin_ap, dest_ap, e)
        results = []
    if not results and not proxy_url:
        fallback_proxy = os.environ.get("RESIDENTIAL_PROXY_URL", "").strip() or None
        if fallback_proxy:
            try:
                sess2 = _make_gf_session(fallback_proxy)
                sf2 = _SF()
                sf2.client = sess2
                results = sf2.search(filters, top_n=4) or []
            except Exception as e:
                logger.warning("GF API RT proxy retry error: %s", e)
    logger.info(
        "GF API RT %s->%s: %d results (proxy=%s)",
        origin_ap, dest_ap, len(results), bool(proxy_url),
    )
    return results


# ─── Main connector class ──────────────────────────────────────────────────

class SerpApiGoogleConnectorClient:
    """Google Flights via reverse-engineered API (fli + curl_cffi impersonate='chrome').

    No browser. No proxy required. Significantly faster than Playwright.
    """

    def __init__(self, timeout: float = 45.0):
        self.timeout = timeout

    @staticmethod
    def _empty(req: FlightSearchRequest) -> FlightSearchResponse:
        return FlightSearchResponse(
            origin=req.origin,
            destination=req.destination,
            currency=req.currency,
            offers=[],
            total_results=0,
        )

    async def search_flights(self, req: FlightSearchRequest) -> FlightSearchResponse:
        try:
            return await asyncio.wait_for(self._search(req), timeout=self.timeout)
        except asyncio.TimeoutError:
            logger.warning("Google Flights (fli) timed out for %s->%s", req.origin, req.destination)
            return self._empty(req)
        except Exception as e:
            logger.warning("Google Flights (fli) error for %s->%s: %s", req.origin, req.destination, e)
            return self._empty(req)

    async def _search(self, req: FlightSearchRequest) -> FlightSearchResponse:
        is_rt = req.return_from is not None
        dep_date = req.date_from.strftime("%Y-%m-%d")
        ret_date = req.return_from.strftime("%Y-%m-%d") if is_rt else None

        origin_ap = _resolve_airport(req.origin)
        dest_ap = _resolve_airport(req.destination)
        if origin_ap is None or dest_ap is None:
            logger.warning(
                "Google Flights (fli): unknown airport %s or %s — skipping",
                req.origin,
                req.destination,
            )
            return self._empty(req)

        max_stops = _max_stops_enum(req.max_stopovers)
        seat_type = _seat_type_enum(req.cabin_class)
        adults = req.adults
        loop = asyncio.get_event_loop()

        if is_rt:
            fn = lambda: _fli_rt(origin_ap, dest_ap, dep_date, ret_date, adults, max_stops, seat_type)
            fli_results = await loop.run_in_executor(_executor, fn)
            offers = self._build_rt_offers(fli_results, req, dep_date, ret_date)
        else:
            fn = lambda: _fli_ow(origin_ap, dest_ap, dep_date, adults, max_stops, seat_type)
            fli_results = await loop.run_in_executor(_executor, fn)
            offers = self._build_ow_offers(fli_results, req, dep_date)

        logger.info(
            "Google Flights (fli) %s->%s %s: %d offers",
            req.origin,
            req.destination,
            dep_date,
            len(offers),
        )
        return FlightSearchResponse(
            origin=req.origin,
            destination=req.destination,
            currency=req.currency,
            offers=offers,
            total_results=len(offers),
        )

    def _convert(self, price: float, from_cur: Optional[str], to_cur: str) -> float:
        if not from_cur or from_cur == to_cur:
            return price
        return _fallback_convert(price, from_cur, to_cur)

    def _build_ow_offers(self, fli_results: list, req: FlightSearchRequest, dep_date: str) -> list[FlightOffer]:
        offers = []
        url = _booking_url(req.origin, req.destination, dep_date, None, req.currency)
        for r in fli_results:
            try:
                price = self._convert(r.price or 0.0, r.currency, req.currency)
                if price <= 0:
                    continue
                route = _make_route(r)
                airlines = list(dict.fromkeys(s.airline for s in route.segments))
                first = airlines[0] if airlines else ""
                offers.append(FlightOffer(
                    id=_offer_id(req.origin, req.destination, dep_date, None, price, first),
                    price=round(price, 2),
                    currency=req.currency,
                    outbound=route,
                    airlines=airlines,
                    owner_airline=first,
                    source="serpapi_google",
                    source_tier="free",
                    booking_url=url,
                ))
            except Exception as e:
                logger.debug("Google Flights (fli): OW offer build error: %s", e)
        return offers

    def _build_rt_offers(
        self,
        fli_results: list,
        req: FlightSearchRequest,
        dep_date: str,
        ret_date: str,
    ) -> list[FlightOffer]:
        offers = []
        url = _booking_url(req.origin, req.destination, dep_date, ret_date, req.currency)
        for r in fli_results:
            try:
                if not isinstance(r, tuple) or len(r) < 2:
                    continue
                out_r, ret_r = r[0], r[-1]
                # fli assigns the combined RT price to the return leg.
                # Using max() guards against the edge case where both legs share
                # the same total (fli v0.1.x bug where total was set on both).
                raw_price = max(out_r.price or 0.0, ret_r.price or 0.0)
                raw_currency = ret_r.currency or out_r.currency
                price = self._convert(raw_price, raw_currency, req.currency)
                if price <= 0:
                    continue
                out_route = _make_route(out_r)
                ret_route = _make_route(ret_r)
                all_airlines = list(dict.fromkeys(
                    [s.airline for s in out_route.segments]
                    + [s.airline for s in ret_route.segments]
                ))
                first = all_airlines[0] if all_airlines else ""
                offers.append(FlightOffer(
                    id=_offer_id(req.origin, req.destination, dep_date, ret_date, price, first),
                    price=round(price, 2),
                    currency=req.currency,
                    outbound=out_route,
                    inbound=ret_route,
                    airlines=all_airlines,
                    owner_airline=first,
                    source="serpapi_google",
                    source_tier="free",
                    booking_url=url,
                ))
            except Exception as e:
                logger.debug("Google Flights (fli): RT offer build error: %s", e)
        return offers
