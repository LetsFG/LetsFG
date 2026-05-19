from __future__ import annotations

import argparse
import asyncio
import json
from dataclasses import asdict, dataclass
from datetime import date
from typing import Any

from playwright.async_api import async_playwright

from letsfg.connectors.checkout_engine import AIRLINE_CONFIGS, GenericCheckoutEngine
from letsfg.connectors.serpapi_google import SerpApiGoogleConnectorClient
from letsfg.models.flights import FlightSearchRequest


@dataclass(frozen=True)
class RouteSpec:
    origin: str
    destination: str
    travel_date: date


DEFAULT_ROUTES: list[RouteSpec] = [
    RouteSpec("BCN", "ATH", date(2026, 6, 22)),
    RouteSpec("KUL", "NRT", date(2026, 6, 21)),
    RouteSpec("LHR", "JFK", date(2026, 6, 18)),
    RouteSpec("CGK", "DPS", date(2026, 6, 24)),
    RouteSpec("MEX", "CUN", date(2026, 6, 20)),
    RouteSpec("FCO", "LHR", date(2026, 6, 19)),
    RouteSpec("BEY", "CDG", date(2026, 6, 25)),
    RouteSpec("MAD", "BCN", date(2026, 6, 23)),
]


def _parse_route(value: str) -> RouteSpec:
    parts = [part.strip().upper() for part in value.split(":")]
    if len(parts) != 3:
        raise argparse.ArgumentTypeError("Route must look like ORG:DEST:YYYY-MM-DD")
    origin, destination, date_text = parts
    try:
        travel_date = date.fromisoformat(date_text)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"Invalid date '{date_text}': {exc}") from exc
    return RouteSpec(origin, destination, travel_date)


def _normalize_summary(details: dict[str, Any], route: RouteSpec) -> dict[str, Any]:
    add_ons = details.get("available_add_ons") if isinstance(details.get("available_add_ons"), dict) else {}
    bundles = details.get("fare_bundle_options") if isinstance(details.get("fare_bundle_options"), list) else []
    seller = details.get("google_selected_booking_option") if isinstance(details.get("google_selected_booking_option"), dict) else {}
    return {
        "route": f"{route.origin}->{route.destination}",
        "date": route.travel_date.isoformat(),
        "seller": seller.get("seller_label"),
        "seller_price": seller.get("amount"),
        "seller_currency": seller.get("currency"),
        "resolved_booking_url": details.get("resolved_booking_url"),
        "checkout_page": details.get("checkout_page"),
        "categories": sorted(add_ons.keys()),
        "fare_bundle_labels": [bundle.get("label") for bundle in bundles[:5] if isinstance(bundle, dict)],
        "conditions": details.get("conditions"),
        "meals": add_ons.get("meals"),
        "wifi": add_ons.get("wifi"),
        "insurance": add_ons.get("insurance"),
        "priority": add_ons.get("priority"),
        "lounge": add_ons.get("lounge"),
        "baggage": add_ons.get("baggage"),
        "packages": add_ons.get("packages"),
        "generic_discovery_observation": details.get("generic_discovery_observation"),
        "vueling_bundle_observation": details.get("vueling_bundle_observation"),
    }


async def _probe_route(route: RouteSpec, *, currency: str, headless: bool) -> dict[str, Any]:
    google_client = SerpApiGoogleConnectorClient()
    engine = GenericCheckoutEngine()
    google_config = AIRLINE_CONFIGS["serpapi_google_ota"]

    request = FlightSearchRequest(
        origin=route.origin,
        destination=route.destination,
        date_from=route.travel_date,
        adults=1,
        currency=currency,
        limit=1,
    )
    response = await google_client.search_flights(request)
    offers = list(response.offers or [])
    if not offers:
        return {
            "route": f"{route.origin}->{route.destination}",
            "date": route.travel_date.isoformat(),
            "status": "no_offers",
            "source": "serpapi_google_ota",
        }

    offer = offers[0].model_dump()
    playwright = await async_playwright().start()
    browser = await playwright.chromium.launch(
        headless=headless,
        args=["--disable-blink-features=AutomationControlled"],
    )
    context = await browser.new_context(
        viewport={"width": 1440, "height": 900},
        locale=google_config.locale,
        timezone_id=google_config.timezone,
    )
    page = await context.new_page()
    try:
        await page.goto(offer["booking_url"], wait_until="domcontentloaded", timeout=google_config.goto_timeout)
        await page.wait_for_timeout(2000)
        await engine._dismiss_cookies(page, google_config)
        details = await engine._extract_google_checkout_details(
            page,
            google_config,
            offer=offer,
            default_currency=currency,
        )
        summary = _normalize_summary(details, route)
        summary["status"] = details.get("status", "ok")
        summary["source"] = "serpapi_google_ota"
        return summary
    except Exception as exc:
        return {
            "route": f"{route.origin}->{route.destination}",
            "date": route.travel_date.isoformat(),
            "status": "error",
            "source": "serpapi_google_ota",
            "message": str(exc),
        }
    finally:
        await context.close()
        await browser.close()
        await playwright.stop()


async def _main(args: argparse.Namespace) -> int:
    routes = args.route or DEFAULT_ROUTES
    results: list[dict[str, Any]] = []
    for route in routes:
        result = await _probe_route(route, currency=args.currency, headless=not args.headful)
        results.append(result)
        if args.pretty:
            print(json.dumps(result, ensure_ascii=False, indent=2))
        else:
            print(json.dumps(result, ensure_ascii=False))
    if args.output:
        with open(args.output, "w", encoding="utf-8") as handle:
            json.dump(results, handle, ensure_ascii=False, indent=2)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Google-only live sweep for downstream seller checkout metadata. Does not run full LetsFG local search.",
    )
    parser.add_argument(
        "--route",
        action="append",
        type=_parse_route,
        help="Route in ORG:DEST:YYYY-MM-DD format. Repeat to override the default matrix.",
    )
    parser.add_argument("--currency", default="EUR", help="Currency to request from Google Flights. Default: EUR")
    parser.add_argument("--output", help="Optional path for a JSON results file.")
    parser.add_argument("--headful", action="store_true", help="Run Chromium headfully for debugging.")
    parser.add_argument("--pretty", action="store_true", help="Pretty-print each route result.")
    return parser


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_main(build_parser().parse_args())))