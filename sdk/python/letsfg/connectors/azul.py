"""
Azul Brazilian Airlines connector — direct API (no browser required).

Azul (IATA: AD) is Brazil's third-largest airline with the widest domestic network.
Website: www.voeazul.com.br — React SPA with Navitaire/New Skies backend.

Architecture:
- b2c-api.voeazul.com.br is the REST backend, separate from the Akamai-protected SPA
- Auth: POST /authentication/v1/token -> JWT (no credentials needed, empty body)
- Search: POST /reservationavailability/v5/availability with JWT + static subscription key
- Static OCP-APIM key is embedded in the SPA JS bundle

Strategy:
1. POST auth endpoint -> get short-lived JWT token
2. POST availability endpoint with criteria -> parse Navitaire format -> FlightOffer objects

Performance: ~2-5s per search (2 HTTP calls, no Chrome needed).
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import time
from datetime import datetime, date
from typing import Any, Optional
from urllib.parse import urlparse, urlunparse

import httpx

from letsfg.models.flights import (
    FlightOffer,
    FlightRoute,
    FlightSearchRequest,
    FlightSearchResponse,
    FlightSegment,
)
from letsfg.connectors.browser import get_proxy

logger = logging.getLogger(__name__)

# -- Constants -------------------------------------------------------------

_AUTH_URL = "https://b2c-api.voeazul.com.br/authentication/api/authentication/v1/token"
_AVAIL_URL = (
    "https://b2c-api.voeazul.com.br"
    "/reservationavailability/api/reservation/availability/v5/availability"
)
_OCP_KEY = "fb38e642c899485e893eb8d0a373cc17"  # static, embedded in SPA JS bundle

_COMMON_HEADERS = {
    "sec-ch-ua-platform": '"Windows"',
    "sec-ch-ua": '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
    "sec-ch-ua-mobile": "?0",
    "device": "novosite",
    "ocp-apim-subscription-key": _OCP_KEY,
    "accept": "application/json, text/plain, */*",
    "culture": "pt-BR",
    "referer": "https://www.voeazul.com.br/",
    "origin": "https://www.voeazul.com.br",
    "user-agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/147.0.0.0 Safari/537.36"
    ),
}

_MAX_ATTEMPTS = 2
_TIMEOUT = 30.0


class AzulConnectorClient:
    """Azul connector -- direct REST API (auth token + availability)."""

    def __init__(self, timeout: float = 60.0):
        self.timeout = timeout

    async def close(self):
        pass

    async def search_flights(self, req: FlightSearchRequest) -> FlightSearchResponse:
        t0 = time.monotonic()

        ob_result = None
        for attempt in range(1, _MAX_ATTEMPTS + 1):
            try:
                ob_result = await self._attempt_search(req, t0)
                if ob_result is not None:
                    break
            except Exception as e:
                logger.warning("Azul: attempt %d/%d error: %s", attempt, _MAX_ATTEMPTS, e)

        if ob_result is None:
            return self._empty(req)

        if req.return_from and ob_result.total_results > 0:
            ib_req = req.model_copy(update={
                "origin": req.destination,
                "destination": req.origin,
                "date_from": req.return_from,
                "return_from": None,
            })
            ib_result = None
            for attempt in range(1, _MAX_ATTEMPTS + 1):
                try:
                    ib_result = await self._attempt_search(ib_req, t0)
                    if ib_result is not None:
                        break
                except Exception:
                    pass
            if ib_result and ib_result.total_results > 0:
                ob_result.offers = self._combine_rt(ob_result.offers, ib_result.offers, req)
                ob_result.total_results = len(ob_result.offers)

        return ob_result

    async def _attempt_search(
        self, req: FlightSearchRequest, t0: float
    ) -> Optional[FlightSearchResponse]:
        dep = req.date_from
        dep_mm_dd_yyyy = dep.strftime("%m/%d/%Y")
        dep_iso = dep.strftime("%Y-%m-%d")
        n_pax = max(1, req.adults)
        currency = req.currency or "BRL"
        logger.info("Azul: searching %s->%s on %s", req.origin, req.destination, dep_iso)

        # Build proxy URL for httpx (if configured)
        proxy_url: Optional[str] = None
        raw_proxy = get_proxy("AZUL_PROXY")
        if raw_proxy:
            server = raw_proxy.get("server", "")
            username = raw_proxy.get("username")
            password = raw_proxy.get("password")
            if username and password:
                p = urlparse(server)
                proxy_url = urlunparse(p._replace(
                    netloc=f"{username}:{password}@{p.hostname}:{p.port}"
                ))
            else:
                proxy_url = server
            logger.debug("Azul: using proxy")

        async with httpx.AsyncClient(
            proxy=proxy_url,
            timeout=_TIMEOUT,
            verify=True,
            follow_redirects=True,
        ) as client:
            # Step 1: get auth token
            try:
                auth_resp = await client.post(
                    _AUTH_URL,
                    headers={**_COMMON_HEADERS, "authorization": ""},
                    content=b"",
                )
                auth_resp.raise_for_status()
                token = auth_resp.json().get("data", "")
                if not token:
                    logger.warning("Azul: empty auth token in response")
                    return None
                logger.debug("Azul: auth token obtained")
            except Exception as e:
                logger.warning("Azul: auth error: %s", e)
                return None

            # Step 2: availability
            avail_body = {
                "criteria": [{
                    "departureStation": req.origin,
                    "arrivalStation": req.destination,
                    "std": dep_mm_dd_yyyy,
                    "departureDate": dep_iso,
                }],
                "passengers": [{
                    "type": "ADT",
                    "count": str(n_pax),
                    "companionPass": False,
                }],
                "flexibleDays": {"daysToLeft": "0", "daysToRight": "0"},
                "currencyCode": currency,
            }
            try:
                avail_resp = await client.post(
                    _AVAIL_URL,
                    headers={
                        **_COMMON_HEADERS,
                        "authorization": f"Bearer {token}",
                        "content-type": "application/json",
                    },
                    json=avail_body,
                )
                avail_resp.raise_for_status()
                data = avail_resp.json()
                logger.debug("Azul: availability response received (status=%d)", avail_resp.status_code)
            except Exception as e:
                logger.warning("Azul: availability error: %s", e)
                return None

        elapsed = time.monotonic() - t0
        offers = self._parse_availability(data, req)
        logger.info("Azul: parsed %d offers in %.1fs", len(offers), elapsed)
        return self._build_response(offers, req, elapsed)

    # -- Navitaire availability parsing ------------------------------------

    def _parse_availability(self, data: dict, req: FlightSearchRequest) -> list[FlightOffer]:
        booking_url = self._build_booking_url(req)
        offers: list[FlightOffer] = []

        trips = data.get("data", {}).get("trips") or data.get("trips") or []
        for trip in trips:
            journeys = trip.get("journeys") or trip.get("journeysAvailable") or []
            if not isinstance(journeys, list):
                continue
            for journey in journeys:
                offer = self._parse_journey(journey, req, booking_url)
                if offer:
                    offers.append(offer)

        return offers

    def _parse_journey(
        self, journey: dict, req: FlightSearchRequest, booking_url: str
    ) -> Optional[FlightOffer]:
        best_price = self._extract_journey_price(journey)
        if best_price is None or best_price <= 0:
            return None

        currency = self._extract_currency(journey) or "BRL"
        identifier = journey.get("identifier") or journey.get("designator") or {}
        segments_raw = journey.get("segments", [])
        segments: list[FlightSegment] = []

        if segments_raw and isinstance(segments_raw, list):
            for seg in segments_raw:
                segments.append(self._parse_segment(seg, req))
        else:
            dep_str = identifier.get("std") or journey.get("departureDateTime") or ""
            arr_str = identifier.get("sta") or journey.get("arrivalDateTime") or ""
            origin = identifier.get("departureStation") or req.origin
            dest = identifier.get("arrivalStation") or req.destination
            carrier = identifier.get("carrierCode") or "AD"
            flight_num = str(identifier.get("flightNumber") or "")
            segments.append(FlightSegment(
                airline=carrier, airline_name="Azul",
                flight_no=f"{carrier}{flight_num}" if flight_num else "",
                origin=origin, destination=dest,
                departure=self._parse_dt(dep_str), arrival=self._parse_dt(arr_str),
                cabin_class="economy",
            ))

        if not segments:
            return None

        total_dur = 0
        if segments[0].departure and segments[-1].arrival:
            diff = (segments[-1].arrival - segments[0].departure).total_seconds()
            total_dur = int(diff) if diff > 0 else 0

        stops = max(len(segments) - 1, 0)
        route = FlightRoute(segments=segments, total_duration_seconds=total_dur, stopovers=stops)

        journey_key = journey.get("journeyKey") or ""
        if not journey_key and segments:
            journey_key = f"{segments[0].departure.isoformat()}_{segments[0].flight_no}"

        conditions, bags_price = self._extract_azul_bag_info(journey, currency)

        return FlightOffer(
            id=f"ad_{hashlib.md5(journey_key.encode()).hexdigest()[:12]}",
            price=round(best_price, 2), currency=currency,
            price_formatted=f"{best_price:.2f} {currency}",
            outbound=route, inbound=None,
            airlines=list(set(s.airline for s in segments)) or ["AD"],
            owner_airline="AD",
            conditions=conditions,
            bags_price=bags_price,
            booking_url=booking_url,
            is_locked=False, source="azul_direct", source_tier="free",
        )

    @staticmethod
    def _extract_azul_bag_info(journey: dict, currency: str) -> tuple[dict, dict]:
        conditions: dict[str, str] = {}
        bags_price: dict[str, float] = {}

        fares = journey.get("fares", [])
        if not fares:
            return conditions, bags_price

        best_price = float("inf")
        cheapest_fare: dict = {}
        for fare in fares:
            if not isinstance(fare, dict):
                continue
            pax_fares = fare.get("paxFares") or fare.get("passengerFares") or []
            fare_min = float("inf")
            for pf in pax_fares:
                for key in ("totalAmount", "originalAmount", "fareAmount"):
                    val = pf.get(key)
                    if val is not None:
                        try:
                            v = float(val)
                            if v > 0:
                                fare_min = min(fare_min, v)
                        except (TypeError, ValueError):
                            pass
            if fare_min < best_price:
                best_price = fare_min
                cheapest_fare = fare

        if not cheapest_fare and fares:
            cheapest_fare = fares[0] if isinstance(fares[0], dict) else {}

        product_class = cheapest_fare.get("productClass") or {}
        bundle_code = str(
            product_class.get("code")
            or cheapest_fare.get("bundleCode") or cheapest_fare.get("bundleInformation")
            or cheapest_fare.get("fareClass") or cheapest_fare.get("fareName")
            or cheapest_fare.get("fareCode") or cheapest_fare.get("fareSellKey") or ""
        ).upper()

        if bundle_code:
            conditions["fare_family"] = product_class.get("name") or bundle_code

        if bundle_code in ("F+", "F"):
            conditions["checked_bag"] = "no free checked bag (Azul base fare)"
        elif bundle_code in ("PR",):
            conditions["checked_bag"] = "1x 23kg bag included"
            bags_price["checked_bag"] = 0.0
        elif "BLACK" in bundle_code:
            conditions["checked_bag"] = "2x 23kg bags included"
            bags_price["checked_bag"] = 0.0
        elif "BLUE" in bundle_code or bundle_code in ("BU", "XTRA", "XT"):
            conditions["checked_bag"] = "1x 23kg bag included"
            bags_price["checked_bag"] = 0.0

        conditions["carry_on"] = "1x 10kg carry-on included"
        bags_price["carry_on"] = 0.0
        conditions["seat"] = "seat selection from ~BRL 30 -- add at checkout"
        bags_price.setdefault("seat", 30.0)

        return conditions, bags_price

    def _parse_segment(self, seg: dict, req: FlightSearchRequest) -> FlightSegment:
        identifier = seg.get("identifier") or seg.get("designator") or {}
        flight_des = seg.get("flightDesignator") or {}

        dep_str = identifier.get("std") or seg.get("departureDateTime") or ""
        arr_str = identifier.get("sta") or seg.get("arrivalDateTime") or ""
        origin = identifier.get("departureStation") or seg.get("departureStation") or req.origin
        dest = identifier.get("arrivalStation") or seg.get("arrivalStation") or req.destination
        carrier = identifier.get("carrierCode") or flight_des.get("carrierCode") or "AD"
        flight_num = str(identifier.get("flightNumber") or flight_des.get("flightNumber") or "")

        return FlightSegment(
            airline=carrier, airline_name="Azul",
            flight_no=f"{carrier}{flight_num}" if flight_num else "",
            origin=origin, destination=dest,
            departure=self._parse_dt(dep_str), arrival=self._parse_dt(arr_str),
            cabin_class="economy",
        )

    @staticmethod
    def _extract_journey_price(journey: dict) -> Optional[float]:
        best = float("inf")
        for fare in journey.get("fares", []):
            if not isinstance(fare, dict):
                continue
            pax_fares = fare.get("paxFares") or fare.get("passengerFares") or []
            for pf in pax_fares:
                for key in ("totalAmount", "originalAmount", "fareAmount"):
                    val = pf.get(key)
                    if val is not None:
                        try:
                            v = float(val)
                            if 0 < v < best:
                                best = v
                        except (TypeError, ValueError):
                            pass
                total_charge = 0.0
                for charge in pf.get("serviceCharges", []):
                    try:
                        total_charge += float(charge.get("amount", 0))
                    except (TypeError, ValueError):
                        pass
                if total_charge > 0 and total_charge < best:
                    best = total_charge
        return best if best < float("inf") else None

    @staticmethod
    def _extract_currency(journey: dict) -> Optional[str]:
        for fare in journey.get("fares", []):
            if not isinstance(fare, dict):
                continue
            for pf in fare.get("paxFares") or fare.get("passengerFares") or []:
                cc = pf.get("currencyCode")
                if cc:
                    return cc
        return None

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
                return datetime.strptime(s[:len(fmt) + 2], fmt)
            except (ValueError, IndexError):
                continue
        return datetime(2000, 1, 1)

    @staticmethod
    def _build_booking_url(req: FlightSearchRequest) -> str:
        dep = req.date_from.strftime("%m/%d/%Y")
        n_pax = max(1, req.adults)
        return (
            f"https://www.voeazul.com.br/br/pt/home/selecao-voo"
            f"?c[0].ds={req.origin}&c[0].as={req.destination}&c[0].std={dep}"
            f"&p[0].t=ADT&p[0].c={n_pax}&p[0].cp=false&cc=BRL&f.dl=3&f.dr=3"
        )

    @staticmethod
    def _combine_rt(ob: list, ib: list, req) -> list:
        combos = []
        for o in sorted(ob, key=lambda x: x.price)[:15]:
            for i in sorted(ib, key=lambda x: x.price)[:10]:
                combos.append(FlightOffer(
                    id=f"ad_rt_{o.id}_{i.id}",
                    price=round(o.price + i.price, 2),
                    currency=o.currency,
                    outbound=o.outbound,
                    inbound=i.outbound,
                    owner_airline=o.owner_airline,
                    airlines=list(set(o.airlines + i.airlines)),
                    source=o.source,
                    booking_url=o.booking_url,
                    conditions=o.conditions,
                ))
        combos.sort(key=lambda x: x.price)
        return combos[:20]

    def _empty(self, req: FlightSearchRequest) -> FlightSearchResponse:
        h = hashlib.md5(
            f"azul{req.origin}{req.destination}{req.date_from}{req.return_from or ''}".encode()
        ).hexdigest()[:12]
        return FlightSearchResponse(
            connector_id="azul_direct",
            search_id=h,
            origin=req.origin, destination=req.destination,
            date_from=req.date_from, return_from=req.return_from,
            currency=req.currency or "BRL",
            offers=[], total_results=0,
        )

    def _build_response(
        self, offers: list[FlightOffer], req: FlightSearchRequest, elapsed: float
    ) -> FlightSearchResponse:
        h = hashlib.md5(
            f"azul{req.origin}{req.destination}{req.date_from}{req.return_from or ''}".encode()
        ).hexdigest()[:12]
        return FlightSearchResponse(
            connector_id="azul_direct",
            search_id=h,
            origin=req.origin, destination=req.destination,
            date_from=req.date_from, return_from=req.return_from,
            elapsed_seconds=round(elapsed, 1),
            currency=offers[0].currency if offers else req.currency or "BRL",
            offers=offers, total_results=len(offers),
        )
