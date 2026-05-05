"""
Google Flights via SerpAPI -- massive global coverage (900+ airlines).

SerpAPI wraps Google Flights into a clean JSON API. This is the single
highest-ROI connector: one integration covers virtually every airline globally.

Requires: SERPAPI_KEY environment variable.
Docs: https://serpapi.com/google-flights-api

Strategy:
1. GET serpapi.com/search?engine=google_flights
2. Collect best_flights + other_flights from all pages (up to _MAX_PAGES)
3. Follow next_page_token for pagination
4. Map to FlightOffer objects including bags_price and conditions
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import time
from datetime import datetime
from typing import Any, Optional

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

_SERPAPI_URL = "https://serpapi.com/search"
_MAX_PAGES = 5  # max pages to fetch per direction (initial + up to 4 pagination calls)

_CABIN_MAP = {"M": "1", "W": "2", "C": "3", "F": "4"}


class SerpApiGoogleConnectorClient:
    """Google Flights via SerpAPI -- global coverage metasearch.

    Paginates through SerpAPI results (best_flights + other_flights on each page)
    following next_page_token until exhausted or _MAX_PAGES reached.
    Includes bags_price and conditions parsing.
    """

    def __init__(self, timeout: float = 90.0):
        self.timeout = timeout
        self._api_key = os.environ.get("SERPAPI_KEY", "")
        self._http: Optional[httpx.AsyncClient] = None

    async def _client(self) -> httpx.AsyncClient:
        if self._http is None or self._http.is_closed:
            self._http = httpx.AsyncClient(
                timeout=self.timeout,
                follow_redirects=True,
                proxy=get_httpx_proxy_url(),
            )
        return self._http

    async def close(self):
        if self._http and not self._http.is_closed:
            await self._http.aclose()

    async def search_flights(self, req: FlightSearchRequest) -> FlightSearchResponse:
        if req.return_from:
            # Run both directions concurrently to halve wall-clock time
            ib_req = req.model_copy(update={
                "origin": req.destination,
                "destination": req.origin,
                "date_from": req.return_from,
                "return_from": None,
            })
            ob_result, ib_result = await asyncio.gather(
                self._search_ow(req),
                self._search_ow(ib_req),
            )
            if ob_result.total_results > 0 and ib_result.total_results > 0:
                ob_result.offers = self._combine_rt(ob_result.offers, ib_result.offers)
                ob_result.total_results = len(ob_result.offers)
            return ob_result
        return await self._search_ow(req)

    async def _search_ow(self, req: FlightSearchRequest) -> FlightSearchResponse:
        if not self._api_key:
            return self._empty(req)

        t0 = time.monotonic()
        client = await self._client()

        base_params: dict[str, str] = {
            "engine": "google_flights",
            "departure_id": req.origin,
            "arrival_id": req.destination,
            "outbound_date": req.date_from.strftime("%Y-%m-%d"),
            "type": "1",  # 1=one-way; we handle RT by calling twice
            "adults": str(req.adults or 1),
            "children": str(req.children or 0),
            "infants_in_seat": str(req.infants or 0),
            "travel_class": _CABIN_MAP.get(req.cabin_class or "", "1"),
            "currency": req.currency or "USD",
            "hl": "en",
            "api_key": self._api_key,
        }

        all_offers: list[FlightOffer] = []
        seen_ids: set[str] = set()
        next_page_token: Optional[str] = None
        pages_fetched = 0

        while pages_fetched < _MAX_PAGES:
            params = dict(base_params)
            if next_page_token:
                params["next_page_token"] = next_page_token

            try:
                resp = await client.get(_SERPAPI_URL, params=params)
            except Exception as exc:
                logger.warning("SerpAPI Google Flights error (page %d): %s", pages_fetched + 1, exc)
                break

            if resp.status_code != 200:
                logger.warning("SerpAPI %d (page %d): %s", resp.status_code, pages_fetched + 1, resp.text[:300])
                break

            try:
                data = resp.json()
            except Exception:
                break

            pages_fetched += 1
            page_new = 0

            for flight_list in (data.get("best_flights") or [], data.get("other_flights") or []):
                for item in flight_list:
                    offer = self._parse_flight(item, req)
                    if offer and offer.id not in seen_ids:
                        seen_ids.add(offer.id)
                        all_offers.append(offer)
                        page_new += 1

            logger.debug(
                "SerpAPI page %d: %d new offers (running total: %d)",
                pages_fetched, page_new, len(all_offers),
            )

            next_page_token = (data.get("serpapi_pagination") or {}).get("next_page_token")
            if not next_page_token:
                break

        all_offers.sort(key=lambda o: o.price if o.price > 0 else float("inf"))
        elapsed = time.monotonic() - t0

        logger.info(
            "SerpAPI Google %s->%s: %d offers across %d page(s) in %.1fs",
            req.origin, req.destination, len(all_offers), pages_fetched, elapsed,
        )

        search_hash = hashlib.md5(
            f"serpapi_google{req.origin}{req.destination}{req.date_from}{req.return_from or ''}".encode()
        ).hexdigest()[:12]

        return FlightSearchResponse(
            search_id=f"fs_{search_hash}",
            origin=req.origin,
            destination=req.destination,
            currency=req.currency or "USD",
            offers=all_offers,
            total_results=len(all_offers),
        )

    def _parse_flight(self, item: dict, req: FlightSearchRequest) -> Optional[FlightOffer]:
        price = item.get("price")
        if not price or float(price) <= 0:
            return None

        flights = item.get("flights") or []
        if not flights:
            return None

        segments: list[FlightSegment] = []
        airlines: list[str] = []
        seen_airlines: set[str] = set()

        for leg in flights:
            dep_airport = leg.get("departure_airport") or {}
            arr_airport = leg.get("arrival_airport") or {}

            dep_dt = self._parse_dt(dep_airport.get("time", ""))
            arr_dt = self._parse_dt(arr_airport.get("time", ""))

            airline_name = leg.get("airline", "")
            flight_no = leg.get("flight_number", "")
            # SerpAPI gives duration in minutes
            duration_secs = int(leg.get("duration", 0) or 0) * 60

            if airline_name and airline_name not in seen_airlines:
                airlines.append(airline_name)
                seen_airlines.add(airline_name)

            segments.append(FlightSegment(
                airline=airline_name,
                flight_no=flight_no,
                origin=dep_airport.get("id", ""),
                destination=arr_airport.get("id", ""),
                departure=dep_dt,
                arrival=arr_dt,
                duration_seconds=duration_secs,
                aircraft=leg.get("airplane", ""),
            ))

        if not segments:
            return None

        # total_duration is in minutes
        total_duration_secs = int(item.get("total_duration", 0) or 0) * 60
        layovers = item.get("layovers") or []
        stopovers = len(layovers) if layovers else max(0, len(segments) - 1)

        route = FlightRoute(
            segments=segments,
            total_duration_seconds=total_duration_secs,
            stopovers=stopovers,
        )

        # Stable offer ID: route + price + date
        flight_key = "_".join(s.flight_no for s in segments if s.flight_no) or "_".join(
            f"{s.origin}{s.destination}" for s in segments
        )
        offer_id = hashlib.md5(
            f"gf_{flight_key}_{req.origin}_{req.destination}_{req.date_from}_{price}".encode()
        ).hexdigest()[:12]

        currency = req.currency or "USD"

        # Baggage pricing: SerpAPI returns {"1": 29.95, "2": 54.90, ...} (extra checked bags)
        bags_price: dict[str, Any] = {}
        raw_bags = item.get("bags_price") or {}
        if isinstance(raw_bags, dict):
            bags_price = {str(k): float(v) for k, v in raw_bags.items() if isinstance(v, (int, float))}

        # Conditions: parse from extensions strings list
        conditions: dict[str, str] = {}
        extensions = item.get("extensions") or []
        ext_text = " ".join(str(e).lower() for e in extensions)
        if "non-refundable" in ext_text or "nonrefundable" in ext_text:
            conditions["refund_before_departure"] = "not_allowed"
        elif "refundable" in ext_text:
            conditions["refund_before_departure"] = "allowed_with_fee"
        if "no carry-on" in ext_text or "carry-on not" in ext_text:
            conditions["carry_on_bag"] = "not_allowed"
        elif "carry-on" in ext_text or "carry on" in ext_text:
            conditions["carry_on_bag"] = "allowed"
        if "no checked bag" in ext_text:
            conditions["checked_bag"] = "not_allowed"
        elif "checked bag" in ext_text:
            conditions["checked_bag"] = "allowed"

        owner_airline = airlines[0] if airlines else ""

        return FlightOffer(
            id=f"gf_{offer_id}",
            price=float(price),
            currency=currency,
            price_formatted=f"{price} {currency}",
            outbound=route,
            inbound=None,
            airlines=airlines,
            owner_airline=owner_airline,
            bags_price=bags_price,
            conditions=conditions,
            booking_url=item.get("booking_token", ""),
            is_locked=False,
            source="serpapi_google",
            source_tier="free",
        )

    @staticmethod
    def _parse_dt(dt_str: str) -> datetime:
        for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M"):
            try:
                return datetime.strptime(dt_str, fmt)
            except (ValueError, TypeError):
                continue
        return datetime(2000, 1, 1)

    @staticmethod
    def _combine_rt(ob: list[FlightOffer], ib: list[FlightOffer]) -> list[FlightOffer]:
        """Cross-combine top OB + IB one-way offers into round-trip pairs.

        Uses top 30 from each direction (up to 900 combos) to maximise variety,
        then caps at 200 cheapest pairs.
        """
        combos: list[FlightOffer] = []
        for o in ob[:30]:
            for i in ib[:30]:
                price = round(o.price + i.price, 2)
                cid = hashlib.md5(f"{o.id}_{i.id}".encode()).hexdigest()[:12]
                combos.append(FlightOffer(
                    id=f"rt_gf_{cid}",
                    price=price,
                    currency=o.currency,
                    price_formatted=f"{price} {o.currency}",
                    outbound=o.outbound,
                    inbound=i.outbound,
                    airlines=list(dict.fromkeys(o.airlines + i.airlines)),
                    owner_airline=o.owner_airline,
                    bags_price=o.bags_price,
                    conditions=o.conditions,
                    booking_url=o.booking_url,
                    is_locked=False,
                    source=o.source,
                    source_tier=o.source_tier,
                ))
        combos.sort(key=lambda c: c.price)
        return combos[:200]

    @staticmethod
    def _empty(req: FlightSearchRequest) -> FlightSearchResponse:
        return FlightSearchResponse(
            search_id="fs_empty",
            origin=req.origin,
            destination=req.destination,
            currency=req.currency or "USD",
            offers=[],
            total_results=0,
        )
