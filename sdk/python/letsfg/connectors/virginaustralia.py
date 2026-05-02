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
            if feed:
                logger.info("VirginAustralia: sale feed returned fare-only data without schedule times; suppressing offers")
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
        logger.info("VirginAustralia: sale-feed parsing is disabled until real schedule times are available")
        return []


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
