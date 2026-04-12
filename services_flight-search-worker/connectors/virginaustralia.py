"""
Virgin Australia connector — Australia's second-largest airline.

Virgin Australia (IATA: VA) — SYD/MEL/BNE hubs.
110+ domestic and short-haul international routes (NZ, Fiji, Bali).

Strategy:
  VA exposes a public JSON feed of promotional/sale fares at:
    GET https://www.virginaustralia.com/feeds/specials.fares_by_origin.json

  Returns ~170KB JSON keyed by origin IATA (lowercase):
    { "syd": { "port_name":"Sydney", "sale_items": [
        { "origin":"SYD", "destination":"MEL", "cabin":"Economy",
          "from_price":79, "display_price":79, "dir":"One Way",
          "travel_periods": [{"start_date":1776211200,"end_date":1782086400,
                              "from_price":79,"fare_brand":"choice"}],
          "url":"https://www.virginaustralia.com/au/en/specials/the-sale/",
          ... }, ...
    ]}}

  ~70 domestic AUS routes with real AUD prices. For each matching O/D pair
  we check whether the requested travel date falls inside any travel_period.
  Feed is cached for the lifetime of the client instance.
"""

from __future__ import annotations

import hashlib
import logging
import time
from datetime import datetime
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
from .airline_routes import city_match_set

logger = logging.getLogger(__name__)

_FARES_URL = "https://www.virginaustralia.com/feeds/specials.fares_by_origin.json"
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
    "Accept-Language": "en-AU,en;q=0.9",
}


class VirginAustraliaConnectorClient:
    """Virgin Australia — public promotional fares feed (httpx, no auth)."""

    def __init__(self, timeout: float = 20.0):
        self.timeout = timeout
        self._http: Optional[httpx.AsyncClient] = None
        self._feed_cache: Optional[dict] = None

    async def _client(self) -> httpx.AsyncClient:
        if self._http is None or self._http.is_closed:
            self._http = httpx.AsyncClient(
                timeout=self.timeout, headers=_HEADERS, follow_redirects=True,
                proxy=get_httpx_proxy_url(),)
        return self._http

    async def close(self):
        if self._http and not self._http.is_closed:
            await self._http.aclose()

    async def _load_feed(self) -> dict:
        if self._feed_cache is not None:
            return self._feed_cache
        client = await self._client()
        resp = await client.get(_FARES_URL)
        resp.raise_for_status()
        self._feed_cache = resp.json()
        return self._feed_cache

    async def search_flights(self, req: FlightSearchRequest) -> FlightSearchResponse:
        ob_result = await self._search_ow(req)
        if req.return_from and ob_result.total_results > 0:
            ib_req = req.model_copy(update={"origin": req.destination, "destination": req.origin, "date_from": req.return_from, "return_from": None})
            ib_result = await self._search_ow(ib_req)
            if ib_result.total_results > 0:
                ob_result.offers = self._combine_rt(ob_result.offers, ib_result.offers, req)
                ob_result.total_results = len(ob_result.offers)
        return ob_result


    async def _search_ow(self, req: FlightSearchRequest) -> FlightSearchResponse:
        t0 = time.monotonic()
        offers: list[FlightOffer] = []

        try:
            feed = await self._load_feed()
            offers = self._parse(feed, req)
        except Exception as e:
            logger.error("VirginAustralia feed error: %s", e)

        offers.sort(key=lambda o: o.price)
        elapsed = time.monotonic() - t0
        logger.info(
            "VirginAustralia %s→%s: %d offers in %.1fs",
            req.origin, req.destination, len(offers), elapsed,
        )

        sh = hashlib.md5(
            f"va{req.origin}{req.destination}{req.date_from}{req.return_from or ''}".encode()
        ).hexdigest()[:12]
        return FlightSearchResponse(
            search_id=f"fs_{sh}",
            origin=req.origin,
            destination=req.destination,
            currency=offers[0].currency if offers else "AUD",
            offers=offers,
            total_results=len(offers),
        )

    def _parse(self, feed: dict, req: FlightSearchRequest) -> list[FlightOffer]:
        offers: list[FlightOffer] = []
        target_ts = int(datetime.combine(req.date_from, datetime.min.time()).timestamp())
        ret_ts = int(datetime.combine(req.return_from, datetime.min.time()).timestamp()) if req.return_from else 0
        valid_origins = city_match_set(req.origin)
        valid_dests = city_match_set(req.destination)

        # Feed is keyed by origin IATA (lowercase)
        origin_data = feed.get(req.origin.lower())
        if not origin_data or not isinstance(origin_data, dict):
            return offers

        for item in origin_data.get("sale_items", []):
            if item.get("origin", "").upper() not in valid_origins:
                continue
            if item.get("destination", "").upper() not in valid_dests:
                continue

            # Check if travel date falls within any travel_period
            best_price = None
            best_brand = None
            for tp in item.get("travel_periods", []):
                start = tp.get("start_date", 0)
                end = tp.get("end_date", 0)
                if start <= target_ts <= end:
                    tp_price = tp.get("from_price", 0)
                    if tp_price > 0 and (best_price is None or tp_price < best_price):
                        best_price = tp_price
                        best_brand = tp.get("fare_brand", "")

            # Fallback: if no period matches, use display_price if route matches
            if best_price is None:
                dp = item.get("display_price") or item.get("from_price") or 0
                if dp > 0:
                    best_price = dp
                    best_brand = item.get("display_fare_brand", "")

            if best_price is None or best_price <= 0:
                continue

            # RT: look up reverse route in same feed
            _ib_route = None
            _ib_price = 0.0
            if req.return_from:
                dest_data = feed.get(req.destination.lower())
                if dest_data and isinstance(dest_data, dict):
                    for ib_item in dest_data.get("sale_items", []):
                        if ib_item.get("destination", "").upper() not in valid_origins:
                            continue
                        if ib_item.get("origin", "").upper() not in valid_dests:
                            continue
                        ib_best = None
                        for tp in ib_item.get("travel_periods", []):
                            start = tp.get("start_date", 0)
                            end = tp.get("end_date", 0)
                            if start <= ret_ts <= end:
                                tp_price = tp.get("from_price", 0)
                                if tp_price > 0 and (ib_best is None or tp_price < ib_best):
                                    ib_best = tp_price
                        if ib_best is None:
                            dp = ib_item.get("display_price") or ib_item.get("from_price") or 0
                            if dp > 0:
                                ib_best = dp
                        if ib_best and ib_best > 0:
                            _ib_price = float(ib_best)
                            ib_dt = datetime.combine(req.return_from, datetime.min.time().replace(hour=8))
                            ib_seg = FlightSegment(
                                airline="VA", airline_name="Virgin Australia", flight_no="VA",
                                origin=req.destination, destination=req.origin,
                                departure=ib_dt, arrival=ib_dt,
                            )
                            _ib_route = FlightRoute(segments=[ib_seg], total_duration_seconds=0, stopovers=0)
                            break  # take first matching reverse route

            total_price = round(float(best_price) + _ib_price, 2) if _ib_route else round(float(best_price), 2)
            id_prefix = "va_rt_" if _ib_route else "va_"

            cabin = item.get("cabin", "Economy")
            dep_dt = datetime.combine(req.date_from, datetime.min.time().replace(hour=8))

            seg = FlightSegment(
                airline="VA",
                airline_name="Virgin Australia",
                flight_no="VA",
                origin=req.origin,
                destination=req.destination,
                departure=dep_dt,
                arrival=dep_dt,
            )
            route = FlightRoute(segments=[seg], total_duration_seconds=0, stopovers=0)

            bk_url = item.get("url") or (
                f"https://www.virginaustralia.com/au/en/booking/flights/search/"
                f"?origin={req.origin}&destination={req.destination}"
                f"&date={req.date_from.strftime('%Y-%m-%d')}"
                f"&adults={req.adults or 1}"
            )
            if _ib_route and req.return_from:
                bk_url += f"&returnDate={req.return_from.strftime('%Y-%m-%d')}"

            key = f"va_{req.origin}{req.destination}{total_price}{best_brand}{req.return_from or ''}"
            oid = hashlib.md5(key.encode()).hexdigest()[:12]

            offers.append(
                FlightOffer(
                    id=f"{id_prefix}{oid}",
                    price=total_price,
                    currency="AUD",
                    price_formatted=f"{total_price:.2f} AUD",
                    outbound=route,
                    inbound=_ib_route,
                    airlines=["Virgin Australia"],
                    owner_airline="VA",
                    conditions={
                        "cabin": cabin,
                        "fare_brand": best_brand,
                        "price_type": "sale_fare",
                        "connection": item.get("connection", ""),
                    },
                    booking_url=bk_url,
                    is_locked=False,
                    source="virginaustralia_direct",
                    source_tier="free",
                )
            )

        return offers


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
                    id=f"rt_virg_{cid}", price=price, currency=o.currency,
                    outbound=o.outbound, inbound=i.outbound,
                    airlines=list(dict.fromkeys(o.airlines + i.airlines)),
                    owner_airline=o.owner_airline,
                    booking_url=o.booking_url, is_locked=False,
                    source=o.source, source_tier=o.source_tier,
                ))
        combos.sort(key=lambda c: c.price)
        return combos[:20]
