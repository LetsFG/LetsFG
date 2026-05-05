import asyncio
import json
import time
from datetime import date, timedelta

from playwright.async_api import async_playwright

from letsfg.connectors.booking_base import FAKE_PASSENGER
from letsfg.connectors.checkout_engine import AIRLINE_CONFIGS, GenericCheckoutEngine
from letsfg.connectors.jetstar import JetstarConnectorClient
from letsfg.models.flights import FlightSearchRequest


async def main() -> None:
    req = FlightSearchRequest(
        origin="SYD",
        destination="MEL",
        date_from=date.today() + timedelta(days=30),
        adults=1,
        children=0,
        infants=0,
        currency="AUD",
        max_stopovers=0,
    )

    client = JetstarConnectorClient(timeout=45.0)
    response = await client.search_flights(req)
    if not response.offers:
        print(json.dumps({"error": "no_offers"}))
        return

    offer = response.offers[0].model_dump()
    engine = GenericCheckoutEngine()
    config = AIRLINE_CONFIGS["jetstar_direct"]

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context()
        page = await context.new_page()
        result = await engine._jetstar_checkout(
            page,
            config,
            offer,
            offer["id"],
            offer.get("booking_url", ""),
            [FAKE_PASSENGER],
            time.monotonic(),
        )
        print(json.dumps(result.to_dict(), indent=2, default=str))
        await context.close()
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
