"""
Malaysia Airlines (MH) connector — httpx-only, no browser.

Uses two public endpoints on www.malaysiaairlines.com:
  1. GET  /bin/mh/revamp/lowFares   → daily lowest fares (~151 days)
  2. POST /bin/mh/revamp/flightSearch → Amadeus e-Retail booking redirect

The lowFares endpoint returns aggregated daily prices (no specific flight
times or flight numbers). Each offer therefore represents "the cheapest
MH fare on that date" rather than a specific scheduled flight.
"""

from __future__ import annotations

import hashlib
import logging
import time
from datetime import date, datetime, timedelta
from typing import Optional

import httpx

from ..models.flights import (
    FlightOffer,
    FlightRoute,
    FlightSearchRequest,
    FlightSearchResponse,
    FlightSegment,
)
from .browser import get_httpx_proxy_url

logger = logging.getLogger(__name__)

_BASE = "https://www.malaysiaairlines.com"
_LOW_FARES_PATH = "/bin/mh/revamp/lowFares"
_FLIGHT_SEARCH_PATH = "/bin/mh/revamp/flightSearch"

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/135.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
}

# Cabin class mapping: internal code → MH API value
_CABIN_MAP = {
    "M": "Economy",
    "W": "Economy",       # MH has no premium-economy in this API
    "C": "Business",
    "F": "First",
    None: "Economy",
}


class MalaysiaConnectorClient:
    """Malaysia Airlines direct connector (httpx, no browser)."""

    def __init__(self, timeout: float = 25.0) -> None:
        self.timeout = timeout
        self._http: Optional[httpx.AsyncClient] = None

    async def _client(self) -> httpx.AsyncClient:
        if self._http is None or self._http.is_closed:
            self._http = httpx.AsyncClient(
                timeout=self.timeout,
                follow_redirects=True,
                headers=_HEADERS,
                proxy=get_httpx_proxy_url(),)
        return self._http

    async def close(self) -> None:
        if self._http and not self._http.is_closed:
            await self._http.aclose()
            self._http = None

    # ── Public API ───────────────────────────────────────────────────────────

    async def search_flights(
        self, req: FlightSearchRequest
    ) -> FlightSearchResponse:
        ob_result = await self._search_ow(req)
        if req.return_from and ob_result.total_results > 0:
            ib_req = req.model_copy(update={"origin": req.destination, "destination": req.origin, "date_from": req.return_from, "return_from": None})
            ib_result = await self._search_ow(ib_req)
            if ib_result.total_results > 0:
                ob_result.offers = self._combine_rt(ob_result.offers, ib_result.offers, req)
                ob_result.total_results = len(ob_result.offers)
        return ob_result


    async def _search_ow(
        self, req: FlightSearchRequest
    ) -> FlightSearchResponse:
        t0 = time.monotonic()
        client = await self._client()

        # 1. Fetch low fares for the target date
        fare = await self._fetch_low_fare(client, req)
        if fare is None:
            logger.info(
                "Malaysia %s→%s no fare for %s",
                req.origin, req.destination, req.date_from,
            )
            return self._empty(req)

        price = float(fare["totalFareAmount"])
        currency = fare.get("currency", "MYR")

        # 2. Build booking URL
        booking_url = await self._build_booking_url(client, req)

        # 3. Build offer
        cabin = _CABIN_MAP.get(req.cabin_class, "Economy").lower()
        dep_dt = datetime.combine(req.date_from, datetime.min.time())

        segment = FlightSegment(
            airline="MH",
            airline_name="Malaysia Airlines",
            flight_no="",
            origin=req.origin,
            destination=req.destination,
            departure=dep_dt,
            arrival=dep_dt,          # unknown exact time
            duration_seconds=0,      # unknown
            cabin_class=cabin,
        )

        route = FlightRoute(
            segments=[segment],
            total_duration_seconds=0,
            stopovers=0,
        )

        # RT: fetch return leg low fare
        _ib_route = None
        _ib_price = 0.0
        if req.return_from:
            from copy import copy
            ib_req = copy(req)
            ib_req.origin = req.destination
            ib_req.destination = req.origin
            ib_req.date_from = req.return_from
            ib_fare = await self._fetch_low_fare(client, ib_req)
            if ib_fare:
                _ib_price = float(ib_fare["totalFareAmount"])
                ib_dt = datetime.combine(req.return_from, datetime.min.time())
                ib_seg = FlightSegment(
                    airline="MH", airline_name="Malaysia Airlines", flight_no="",
                    origin=req.destination, destination=req.origin,
                    departure=ib_dt, arrival=ib_dt,
                    duration_seconds=0, cabin_class=cabin,
                )
                _ib_route = FlightRoute(segments=[ib_seg], total_duration_seconds=0, stopovers=0)

        total_price = round(price + _ib_price, 2) if _ib_route else price
        offer_id = self._make_id(req, total_price)
        id_val = f"mh_rt_{offer_id[3:]}" if _ib_route else offer_id

        bk_url = booking_url
        if _ib_route:
            bk_url = self._fallback_booking_url(req).replace("isOneWay=true", "isOneWay=false")
            bk_url += f"&dateReturn={req.return_from.strftime('%Y-%m-%d')}"

        offer = FlightOffer(
            id=id_val,
            price=total_price,
            currency=currency,
            price_formatted=f"{total_price:.2f} {currency}",
            outbound=route,
            inbound=_ib_route,
            airlines=["Malaysia Airlines"],
            owner_airline="MH",
            booking_url=bk_url,
            is_locked=False,
            source="malaysia_direct",
            source_tier="free",
        )

        elapsed = time.monotonic() - t0
        logger.info(
            "Malaysia %s→%s %s %.2f %s in %.1fs",
            req.origin, req.destination, req.date_from, price, currency, elapsed,
        )

        search_hash = hashlib.md5(
            f"malaysia{req.origin}{req.destination}{req.date_from}{req.return_from or ''}".encode()
        ).hexdigest()[:12]

        return FlightSearchResponse(
            search_id=f"fs_{search_hash}",
            origin=req.origin,
            destination=req.destination,
            currency=currency,
            offers=[offer],
            total_results=1,
        )

    # ── Low Fares ────────────────────────────────────────────────────────────

    async def _fetch_low_fare(
        self, client: httpx.AsyncClient, req: FlightSearchRequest
    ) -> Optional[dict]:
        """GET /bin/mh/revamp/lowFares → find the fare for req.date_from."""
        ddmmyy = req.date_from.strftime("%d%m%y")
        params = {
            "origin": req.origin,
            "destination": req.destination,
            "firstdate": ddmmyy,
            "paymentType": "Cash",
        }

        try:
            resp = await client.get(f"{_BASE}{_LOW_FARES_PATH}", params=params)
        except (httpx.TimeoutException, httpx.ConnectError) as e:
            logger.warning("Malaysia lowFares timeout: %s", e)
            return None

        if resp.status_code != 200:
            logger.warning("Malaysia lowFares %d", resp.status_code)
            return None

        try:
            data = resp.json()
        except Exception:
            logger.warning("Malaysia lowFares non-JSON response")
            return None

        if not isinstance(data, list) or not data:
            return None

        # Response dates are DDMMYY — find the entry matching our target date
        target = req.date_from.strftime("%d%m%y")
        for entry in data:
            if entry.get("dateOfDeparture") == target:
                return entry

        # If exact date not found, return the first entry (usually the
        # firstdate itself) as a reasonable approximation
        first_date_str = data[0].get("dateOfDeparture", "")
        if first_date_str == target:
            return data[0]

        return None

    # ── Booking URL ──────────────────────────────────────────────────────────

    async def _build_booking_url(
        self, client: httpx.AsyncClient, req: FlightSearchRequest
    ) -> str:
        """Build a deep-link booking URL.

        First tries the flightSearch API to get an Amadeus redirect URL.
        Falls back to a simple search deep-link.
        """
        fallback = self._fallback_booking_url(req)

        cabin = _CABIN_MAP.get(req.cabin_class, "Economy")
        dep_str = req.date_from.strftime("%Y%m%d") + "0000"

        body = {
            "departDate1": dep_str,
            "returnDate1": "",
            "originAirportCode1": req.origin,
            "originCountry": "",
            "destAirportCode1": req.destination,
            "flightClass": cabin,
            "adultCount": str(req.adults or 1),
            "childCount": str(req.children or 0),
            "infantCount": str(req.infants or 0),
            "paymentType": "cash",
            "regionLanguage": "en-GB",
            "promoCode": "",
            "amcvId": "",
            "teaserCategory": "",
        }

        try:
            resp = await client.post(
                f"{_BASE}{_FLIGHT_SEARCH_PATH}",
                json=body,
                headers={"Content-Type": "application/json"},
            )
        except (httpx.TimeoutException, httpx.ConnectError):
            return fallback

        if resp.status_code != 200 or not resp.text:
            return fallback

        try:
            data = resp.json()
        except Exception:
            return fallback

        url = data.get("url", "")
        if not url:
            return fallback

        return fallback  # Amadeus redirect requires form POST — use deep-link

    @staticmethod
    def _fallback_booking_url(req: FlightSearchRequest) -> str:
        d = req.date_from.strftime("%Y-%m-%d")
        return (
            f"https://www.malaysiaairlines.com/hq/en/home.html"
            f"#?maintab=flight-search-tab&subtab=book-flight"
            f"&locationFrom={req.origin}&locationTo={req.destination}"
            f"&dateDeparture={d}&isOneWay=true"
            f"&adultsCount={req.adults or 1}"
        )

    # ── Helpers ──────────────────────────────────────────────────────────────

    @staticmethod
    def _make_id(req: FlightSearchRequest, price: float) -> str:
        raw = f"mh_{req.origin}_{req.destination}_{req.date_from}_{price}"
        return f"mh_{hashlib.md5(raw.encode()).hexdigest()[:12]}"

    def _empty(self, req: FlightSearchRequest) -> FlightSearchResponse:
        search_hash = hashlib.md5(
            f"malaysia{req.origin}{req.destination}{req.date_from}{req.return_from or ''}".encode()
        ).hexdigest()[:12]
        return FlightSearchResponse(
            search_id=f"fs_{search_hash}",
            origin=req.origin,
            destination=req.destination,
            currency=req.currency or "MYR",
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
                    id=f"rt_mala_{cid}", price=price, currency=o.currency,
                    outbound=o.outbound, inbound=i.outbound,
                    airlines=list(dict.fromkeys(o.airlines + i.airlines)),
                    owner_airline=o.owner_airline,
                    booking_url=o.booking_url, is_locked=False,
                    source=o.source, source_tier=o.source_tier,
                ))
        combos.sort(key=lambda c: c.price)
        return combos[:20]
