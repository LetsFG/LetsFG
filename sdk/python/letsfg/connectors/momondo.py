"""
Momondo connector — Playwright browser + API response interception.

Momondo (Booking Holdings / Kayak) is a global flight meta-search engine
known for finding obscure routes and low-cost carriers.

Strategy:
1.  Launch Playwright browser (non-headless).
2.  Navigate to Momondo search results URL.
3.  Intercept the FlightSearchPoll API response with progressive results.
4.  Parse itineraries from the JSON response.
"""

from __future__ import annotations

import asyncio
import hashlib
import html
import json
import logging
import re
import time
from datetime import datetime, date as date_type
from typing import Any, Optional
from urllib.parse import urljoin

from ..models.flights import (
    FlightOffer,
    FlightRoute,
    FlightSearchRequest,
    FlightSearchResponse,
    FlightSegment,
)

from .browser import block_meta_search_resources, get_proxy, meta_search_bandwidth_args

logger = logging.getLogger(__name__)

_BOOKING_HOLDINGS_AIRPORT_TO_CITY: dict[str, str] | None = None


def _parse_dt(s: Any) -> datetime:
    if not s:
        return datetime(2000, 1, 1)
    s = str(s)
    try:
        return datetime.fromisoformat(s.replace("Z", "").split("+")[0])
    except (ValueError, AttributeError):
        return datetime(2000, 1, 1)


def _booking_holdings_search_code(code: str) -> str:
    normalized = code.upper().strip()
    if not normalized:
        return normalized
    return _booking_holdings_airport_to_city().get(normalized, normalized)


def _booking_holdings_airport_to_city() -> dict[str, str]:
    global _BOOKING_HOLDINGS_AIRPORT_TO_CITY
    if _BOOKING_HOLDINGS_AIRPORT_TO_CITY is not None:
        return _BOOKING_HOLDINGS_AIRPORT_TO_CITY

    mapping: dict[str, str] = {}
    try:
        from .airline_routes import CITY_AIRPORTS

        city_sizes = {
            city_code: len(airports)
            for city_code, airports in CITY_AIRPORTS.items()
        }

        for city_code, airports in CITY_AIRPORTS.items():
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

    _BOOKING_HOLDINGS_AIRPORT_TO_CITY = mapping
    return mapping


class MomondoConnectorClient:
    """Momondo — meta-search (Kayak/Booking Holdings), Playwright + API interception."""

    def __init__(self, timeout: float = 55.0):
        self.timeout = timeout

    async def close(self):
        pass

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

        for attempt in range(2):
            try:
                offers = await self._do_search(req)
                if offers is not None:
                    offers.sort(
                        key=lambda o: o.price if o.price > 0 else float("inf")
                    )
                    elapsed = time.monotonic() - t0
                    logger.info(
                        "MOMONDO %s→%s: %d offers in %.1fs",
                        req.origin, req.destination, len(offers), elapsed,
                    )
                    h = hashlib.md5(
                        f"momondo{req.origin}{req.destination}{req.date_from}{req.return_from or ''}".encode()
                    ).hexdigest()[:12]
                    return FlightSearchResponse(
                        search_id=f"fs_mm_{h}",
                        origin=req.origin,
                        destination=req.destination,
                        currency=req.currency,
                        offers=offers,
                        total_results=len(offers),
                    )
            except Exception as e:
                logger.warning("MOMONDO attempt %d failed: %s", attempt, e)

        return self._empty(req)

    async def _do_search(
        self, req: FlightSearchRequest
    ) -> list[FlightOffer] | None:
        from playwright.async_api import async_playwright

        api_responses: list[dict] = []
        search_origin = _booking_holdings_search_code(req.origin)
        search_dest = _booking_holdings_search_code(req.destination)

        async def on_response(response):
            url = response.url
            # Momondo polls /i/api/search/dynamic/flights/poll for results
            if "/flights/poll" not in url and "/flights/results" not in url:
                return
            try:
                if response.status == 200:
                    ct = response.headers.get("content-type", "")
                    if "json" not in ct:
                        return
                    body = await response.text()
                    if len(body) > 5000:
                        data = json.loads(body)
                        if data.get("results") and data.get("legs"):
                            api_responses.append(data)
            except Exception:
                pass

        pw = await async_playwright().start()
        try:
            proxy = get_proxy("MOMONDO_PROXY") or get_proxy("KAYAK_PROXY")
            launch_kw: dict = {
                "headless": False,
                "args": [
                    *meta_search_bandwidth_args(),
                    "--window-position=-2400,-2400",
                    "--window-size=1366,768",
                    "--disable-blink-features=AutomationControlled",
                ],
            }
            if proxy:
                launch_kw["proxy"] = proxy
            browser = await pw.chromium.launch(**launch_kw)
            ctx = await browser.new_context(
                viewport={"width": 1366, "height": 768},
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/135.0.0.0 Safari/537.36"
                ),
            )
            page = await ctx.new_page()
            await block_meta_search_resources(page)
            page.on("response", on_response)

            dep_date = req.date_from.isoformat()
            _mom_cabin = {"M": "e", "W": "p", "C": "b", "F": "f"}
            cabin = _mom_cabin.get(req.cabin_class, "e") if req.cabin_class else "e"
            url = (
                f"https://www.momondo.com/flight-search/"
                f"{search_origin}-{search_dest}/{dep_date}/"
                f"{req.adults or 1}adult"
                f"?sort=price_a&cabin={cabin}"
            )

            await page.goto(url, wait_until="domcontentloaded", timeout=25000)

            # Momondo progressively polls for results (multiple poll rounds)
            for _ in range(10):
                await page.wait_for_timeout(3000)
                if len(api_responses) >= 3:
                    # Wait for more poll rounds
                    await page.wait_for_timeout(5000)
                    break

            await page.close()
            await ctx.close()
            await browser.close()
        except Exception as e:
            logger.error("MOMONDO browser error: %s", e)
            return None
        finally:
            try:
                await pw.stop()
            except Exception:
                pass

        if not api_responses:
            logger.warning("MOMONDO: no flight API response captured")
            return None

        # Merge all poll responses (later ones may have more results)
        return _parse_booking_holdings_poll(api_responses, req)

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
                    id=f"rt_mm_{cid}", price=price, currency=o.currency,
                    outbound=o.outbound, inbound=i.outbound,
                    airlines=list(dict.fromkeys(o.airlines + i.airlines)),
                    owner_airline=o.owner_airline,
                    booking_url=o.booking_url, is_locked=False,
                    source=o.source, source_tier=o.source_tier,
                ))
        combos.sort(key=lambda c: c.price)
        return combos[:20]

def _parse_booking_holdings_poll(
    responses: list[dict],
    req: FlightSearchRequest,
    source: str = "momondo_meta",
    id_prefix: str = "mm",
    booking_base_url: str = "https://www.momondo.com/flight-search",
) -> list[FlightOffer]:
    """Parse Kayak/Momondo/Cheapflights poll responses into FlightOffer list.

    All three sites (Booking Holdings) share the same /flights/poll API:
      results[] — each has bookingOptions[] with legFarings[].legId
      legs{}    — dict keyed by composite leg ID, each has segments[].id
      segments{}— dict keyed by composite segment ID with flight details
      airlines{}— dict keyed by code with name
      airports{}— dict keyed by IATA code
    """
    target_cur = req.currency or "EUR"
    seen_result_ids: set[str] = set()
    offers: list[FlightOffer] = []
    search_origin = _booking_holdings_search_code(req.origin)
    search_dest = _booking_holdings_search_code(req.destination)

    merged_results: dict[str, dict] = {}
    anonymous_results: list[dict] = []
    legs_map: dict[str, dict] = {}
    segs_map: dict[str, dict] = {}
    airlines_map: dict[str, dict] = {}
    providers_map: dict[str, dict] = {}

    for response in responses:
        if not isinstance(response, dict):
            continue
        response_legs = response.get("legs")
        if isinstance(response_legs, dict):
            legs_map.update(response_legs)
        response_segments = response.get("segments")
        if isinstance(response_segments, dict):
            segs_map.update(response_segments)
        response_airlines = response.get("airlines")
        if isinstance(response_airlines, dict):
            airlines_map.update(response_airlines)
        response_providers = response.get("providers")
        if isinstance(response_providers, dict):
            providers_map.update(response_providers)

        for result in response.get("results", []) or []:
            if not isinstance(result, dict):
                continue
            rid = str(result.get("resultId") or "").strip()
            if rid:
                merged_results[rid] = result
            else:
                anonymous_results.append(result)

    for result in [*merged_results.values(), *anonymous_results]:
        try:
            if result.get("type") != "core":
                continue

            fallback_booking_url = (
                f"{booking_base_url}/"
                f"{search_origin}-{search_dest}/{req.date_from.isoformat()}"
            )
            rid = str(result.get("resultId") or "").strip()
            if rid:
                if rid in seen_result_ids:
                    continue
                seen_result_ids.add(rid)

            result_conditions = _build_booking_holdings_result_conditions(result)

            for option_index, option in enumerate(
                _iter_booking_holdings_options(
                    result,
                    booking_base_url=booking_base_url,
                    fallback_url=fallback_booking_url,
                    target_currency=target_cur,
                )
            ):
                price_obj = option.get("displayPrice") or {}
                price = float(price_obj.get("price", 0))
                currency = price_obj.get("currency", target_cur)
                leg_farings = option.get("legFarings") or []

                outbound = _build_route(leg_farings[0], legs_map, segs_map, airlines_map, req)
                if outbound is None:
                    continue

                inbound = None
                if len(leg_farings) > 1:
                    inbound = _build_route(leg_farings[1], legs_map, segs_map, airlines_map, req)

                all_airlines = list(dict.fromkeys(
                    s.airline for s in outbound.segments if s.airline
                ))

                booking_url = _resolve_booking_holdings_booking_url(
                    option,
                    booking_base_url=booking_base_url,
                    fallback_url=fallback_booking_url,
                )
                option_conditions, bags_price = _build_booking_holdings_option_metadata(
                    option,
                    provider=providers_map.get(str(option.get("providerCode") or "").strip()),
                    currency=currency,
                )
                conditions = {**result_conditions, **option_conditions}
                option_key = rid or f"anon_{option_index}"
                h = hashlib.md5(
                    f"{id_prefix}_{option_key}_{option_index}_{price}_{booking_url}".encode()
                ).hexdigest()[:10]

                offers.append(FlightOffer(
                    id=f"{id_prefix}_{h}",
                    price=price,
                    currency=currency,
                    price_formatted=f"{currency} {price:.2f}",
                    outbound=outbound,
                    inbound=inbound,
                    airlines=all_airlines,
                    owner_airline=all_airlines[0] if all_airlines else "",
                    bags_price=bags_price,
                    conditions=conditions,
                    source=source,
                    source_tier="free",
                    is_locked=False,
                    booking_url=booking_url,
                ))
        except Exception as e:
            logger.warning("MOMONDO: parse result failed: %s", e)

    return offers


def _iter_booking_holdings_options(
    result: dict,
    *,
    booking_base_url: str,
    fallback_url: str,
    target_currency: str,
) -> list[dict]:
    seen_options: set[tuple[float, str, str, tuple[str, ...]]] = set()
    options: list[dict] = []
    for option in result.get("bookingOptions") or []:
        if not isinstance(option, dict):
            continue
        price_obj = option.get("displayPrice") or {}
        try:
            price = float(price_obj.get("price", 0))
        except (TypeError, ValueError):
            continue
        if price <= 0:
            continue
        leg_farings = option.get("legFarings") or []
        if not leg_farings:
            continue
        booking_url = _resolve_booking_holdings_booking_url(
            option,
            booking_base_url=booking_base_url,
            fallback_url=fallback_url,
        )
        currency = str(price_obj.get("currency") or target_currency)
        leg_ids = tuple(str(faring.get("legId") or "") for faring in leg_farings)
        option_identity = (price, currency, booking_url, leg_ids)
        if option_identity in seen_options:
            continue
        seen_options.add(option_identity)
        options.append(option)
    return options


def _build_booking_holdings_result_conditions(result: dict) -> dict[str, str]:
    conditions: dict[str, str] = {}
    fare_bucket = _select_booking_holdings_fare_bucket(result)
    if not fare_bucket:
        return conditions

    fare_name = str(fare_bucket.get("localizedDisplayName") or "").strip()
    if fare_name:
        conditions["fare_family"] = fare_name

    for amenity in fare_bucket.get("fareAmenities") or []:
        if not isinstance(amenity, dict):
            continue
        amenity_type = str(amenity.get("type") or "").upper()
        restriction = str(amenity.get("restriction") or "").upper()
        if amenity_type == "CHANGE":
            mapped = _map_booking_holdings_restriction(restriction)
            if mapped:
                conditions["change_before_departure"] = mapped
        elif amenity_type == "REFUNDABLE":
            mapped = _map_booking_holdings_restriction(restriction)
            if mapped:
                conditions["refund_before_departure"] = mapped

    return conditions


def _select_booking_holdings_fare_bucket(result: dict) -> dict | None:
    fare_buckets = [
        bucket
        for bucket in result.get("bookingOptionsBuckets") or []
        if isinstance(bucket, dict) and str(bucket.get("type") or "").upper() == "FARE"
    ]
    if len(fare_buckets) == 1:
        return fare_buckets[0]
    if len(fare_buckets) > 1:
        return None
    total_distinct_fares = result.get("totalDistinctFares")
    if total_distinct_fares in (None, 0, 1):
        return None
    return None


def _map_booking_holdings_restriction(restriction: str) -> str:
    if restriction in {"AVAILABLE", "ALLOWED", "INCLUDED", "FREE"}:
        return "allowed"
    if restriction in {"FEE", "PARTIAL", "PAID"}:
        return "allowed_with_fee"
    if restriction in {"UNAVAILABLE", "NOT_AVAILABLE", "NOTALLOWED", "NONE"}:
        return "not_allowed"
    return ""


def _build_booking_holdings_option_metadata(
    option: dict,
    *,
    provider: dict | None,
    currency: str,
) -> tuple[dict[str, str], dict[str, float]]:
    conditions: dict[str, str] = {}
    bags_price: dict[str, float] = {}

    provider_code = str(option.get("providerCode") or "").strip()
    provider_name = str((provider or {}).get("displayName") or "").strip()
    if provider_name:
        conditions["booking_provider"] = provider_name
    elif provider_code:
        conditions["booking_provider"] = provider_code

    flags = _booking_holdings_truthy_flags(option.get("flags"))
    if "isDirectAirlineInstantBook" in flags:
        conditions["booking_channel"] = "airline_direct"
        conditions["instant_booking"] = "available"
    elif "isInstantBook" in flags:
        conditions["instant_booking"] = "available"

    if "hasVirtualInterline" in flags:
        conditions["self_transfer"] = (
            "protected" if "isSelfTransferProtection" in flags else "unprotected"
        )

    fees = option.get("fees") if isinstance(option.get("fees"), dict) else {}
    baggage_policy = option.get("baggagePolicyInfo") if isinstance(option.get("baggagePolicyInfo"), dict) else {}
    bag_restrictions = _booking_holdings_bag_restrictions(baggage_policy)

    carry_on_note, carry_on_price = _booking_holdings_bag_note(
        "carry-on",
        fees.get("carryOnBagData") if isinstance(fees, dict) else None,
        fees.get("carryOnDisplay") if isinstance(fees, dict) else None,
        bag_restrictions.get("CARRYON"),
        currency,
    )
    if carry_on_note:
        conditions["carry_on"] = carry_on_note
    if carry_on_price is not None:
        bags_price["carry_on"] = carry_on_price

    checked_note, checked_price = _booking_holdings_bag_note(
        "checked bag",
        fees.get("checkedBagData") if isinstance(fees, dict) else None,
        fees.get("checkedBagDisplay") if isinstance(fees, dict) else None,
        bag_restrictions.get("CHECKED"),
        currency,
    )
    if checked_note:
        conditions["checked_bag"] = checked_note
    if checked_price is not None:
        bags_price["checked_bag"] = checked_price

    personal_item_note = bag_restrictions.get("PERSONAL")
    if personal_item_note:
        conditions["personal_item"] = f"personal item max {personal_item_note}"

    return conditions, bags_price


def _booking_holdings_truthy_flags(raw_flags: Any) -> set[str]:
    if isinstance(raw_flags, dict):
        return {
            str(key)
            for key, value in raw_flags.items()
            if value is True or (isinstance(value, (int, float)) and value != 0)
        }
    if isinstance(raw_flags, list):
        return {str(value) for value in raw_flags if value}
    return set()


def _booking_holdings_bag_restrictions(baggage_policy: dict[str, Any]) -> dict[str, str]:
    restrictions: dict[str, str] = {}
    for airline_bags in baggage_policy.values():
        if not isinstance(airline_bags, list):
            continue
        for bag in airline_bags:
            if not isinstance(bag, dict):
                continue
            bag_type = str(bag.get("bagType") or "").upper()
            if not bag_type or bag_type in restrictions:
                continue
            restriction = _booking_holdings_bag_restriction_text(bag.get("bagRestriction"))
            if restriction:
                restrictions[bag_type] = restriction
    return restrictions


def _booking_holdings_bag_restriction_text(raw_restriction: Any) -> str:
    if not isinstance(raw_restriction, dict):
        return ""
    for key, value in raw_restriction.items():
        text = str(value or "").strip()
        if not text:
            continue
        if key == "DIMENSIONS":
            return text
        return text
    return ""


def _booking_holdings_bag_note(
    bag_label: str,
    bag_data: Any,
    display_text: Any,
    restriction_text: str,
    currency: str,
) -> tuple[str, float | None]:
    normalized_display = _normalize_booking_holdings_text(display_text)
    status = ""
    price_value: float | None = None
    price_currency = currency

    if isinstance(bag_data, dict):
        status = str(bag_data.get("status") or "").upper()
        price_obj = bag_data.get("displayPrice")
        if isinstance(price_obj, dict):
            try:
                price_value = float(price_obj.get("price"))
            except (TypeError, ValueError):
                price_value = None
            price_currency = str(price_obj.get("currency") or currency)

    note = ""
    if status in {"INCLUDED", "FREE"}:
        note = f"{bag_label} included"
        price_value = 0.0
    elif status == "FEE" and price_value is not None:
        note = f"{bag_label} add-on from +{price_currency} {price_value:.0f}"
    elif normalized_display:
        note = f"{bag_label}: {normalized_display.lower()}"
    elif status == "UNKNOWN":
        note = f"{bag_label} policy depends on provider"

    if restriction_text:
        restriction_suffix = f" ({restriction_text})"
        if note:
            note += restriction_suffix
        else:
            note = f"{bag_label} max {restriction_text}"

    if price_value is not None and price_currency != currency and price_value != 0.0:
        price_value = None

    return note, price_value


def _normalize_booking_holdings_text(raw_text: Any) -> str:
    text = html.unescape(str(raw_text or ""))
    text = text.replace("<br>", " ").replace("<br/>", " ").replace("<br />", " ")
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _resolve_booking_holdings_booking_url(best_option: dict, *, booking_base_url: str, fallback_url: str) -> str:
    candidate_keys = ("bookingUrl", "bookingURL", "url", "deepLink", "deeplink")
    for key in candidate_keys:
        normalized = _normalize_booking_holdings_booking_url(best_option.get(key), booking_base_url)
        if normalized:
            return normalized
    return fallback_url


def _normalize_booking_holdings_booking_url(raw_value: Any, booking_base_url: str) -> str:
    if isinstance(raw_value, dict):
        for key in ("url", "href", "bookingUrl", "deepLink", "deeplink"):
            normalized = _normalize_booking_holdings_booking_url(raw_value.get(key), booking_base_url)
            if normalized:
                return normalized
        return ""

    url = str(raw_value or "").strip()
    if not url:
        return ""
    if url.startswith("//"):
        return f"https:{url}"
    if url.startswith("http://") or url.startswith("https://"):
        return url
    return urljoin(booking_base_url, url)


def _build_route(
    leg_faring: dict,
    legs_map: dict[str, dict],
    segs_map: dict[str, dict],
    airlines_map: dict[str, dict],
    req: FlightSearchRequest,
) -> FlightRoute | None:
    """Build a FlightRoute from a legFaring by looking up legs and segments."""
    leg_id = leg_faring.get("legId", "")
    leg = legs_map.get(leg_id)
    if not leg:
        return None

    flight_segments: list[FlightSegment] = []
    for seg_ref in leg.get("segments", []):
        seg_id = seg_ref.get("id", "") if isinstance(seg_ref, dict) else str(seg_ref)
        seg = segs_map.get(seg_id, {})
        if not seg:
            continue

        airline_code = seg.get("airline", "")
        airline_info = airlines_map.get(airline_code, {})
        airline_name = airline_info.get("name", airline_code)

        flight_segments.append(FlightSegment(
            airline=airline_code,
            airline_name=airline_name,
            flight_no=f"{airline_code}{seg.get('flightNumber', '')}",
            origin=seg.get("origin", req.origin),
            destination=seg.get("destination", req.destination),
            departure=_parse_dt(seg.get("departure")),
            arrival=_parse_dt(seg.get("arrival")),
        ))

    if not flight_segments:
        return None

    duration_min = leg.get("duration", 0)
    return FlightRoute(
        segments=flight_segments,
        total_duration_seconds=int(duration_min) * 60,
        stopovers=max(0, len(flight_segments) - 1),
    )
