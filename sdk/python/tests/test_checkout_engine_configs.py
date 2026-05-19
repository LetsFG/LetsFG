import json
import sys
import unittest
from pathlib import Path

from playwright.async_api import async_playwright

PROJECT_ROOT = Path(__file__).resolve().parents[3]
SDK_PYTHON_ROOT = PROJECT_ROOT / "sdk" / "python"
if str(SDK_PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(SDK_PYTHON_ROOT))

from letsfg.client import _get_bookable_connector
from letsfg.connectors.checkout_engine import AIRLINE_CONFIGS, GenericCheckoutEngine


TARGET_SOURCE_HANDLERS = {
    "itaairways_direct": "_extract_generic_visible_checkout_details",
    "mea_direct": "_extract_generic_visible_checkout_details",
    "aircairo_direct": "_extract_aircairo_checkout_details",
    "aireuropa_direct": "_extract_generic_visible_checkout_details",
    "spicejet_direct": "_extract_generic_visible_checkout_details",
    "serpapi_google": "_extract_google_checkout_details",
    "skyscanner_meta": "_extract_generic_visible_checkout_details",
    "momondo_meta": "_extract_generic_visible_checkout_details",
    "kayak_meta": "_extract_generic_visible_checkout_details",
    "cheapflights_meta": "_extract_generic_visible_checkout_details",
    "wego_meta": "_extract_generic_visible_checkout_details",
}

DEFAULT_GENERIC_SOURCES = (
    "ryanair_direct",
    "britishairways_direct",
    "traveloka_ota",
)

AIRASIA_EXTRAS_HTML = """
<html>
    <head><title>Choose extras | AirAsia</title></head>
    <body>
        <div class="Panel__MainWrapper">
            <div>Fare summary</div>
            <div>Base fare</div>
            <div>MYR</div>
            <div>200.00</div>
            <div>Total amount</div>
            <div>MYR</div>
            <div>412.82</div>
        </div>
        <div>
            <div>Baggage</div>
            <div>1 x 7 kg Carry-on baggage (Included)</div>
            <div>Checked baggage</div>
            <div>15 kg</div>
            <div>77.82</div>
        </div>
        <div role="radio">Premium Coverage MYR 12.00</div>
        <button>Meal Combo MYR 18.00</button>
        <button>Fast Pass MYR 30.00</button>
        <button>Value Pack MYR 110.00</button>
        <button>Airport Lounge MYR 55.00</button>
    </body>
</html>
"""

AIRASIA_SEATS_HTML = """
<html>
    <head><title>Seat map | AirAsia</title></head>
    <body>
        <div class="Panel__MainWrapper">
            <div>Fare summary</div>
            <div>Base fare</div>
            <div>MYR</div>
            <div>200.00</div>
            <div>Total amount</div>
            <div>MYR</div>
            <div>245.00</div>
        </div>
        <button>Standard seat MYR 20.00</button>
        <button>Hot seat MYR 45.00</button>
    </body>
</html>
"""

AIRASIA_GUEST_DETAILS_HTML = """
<html>
    <head><title>Guest details | AirAsia</title></head>
    <body>
        <div>Guest details</div>
        <div>Contact details</div>
        <div class="Panel__MainWrapper">
            <div>Fare summary</div>
            <div>Base fare</div>
            <div>EUR</div>
            <div>101.43</div>
            <div>Total amount</div>
            <div>EUR</div>
            <div>119.00</div>
        </div>
    </body>
</html>
"""

AIRASIA_PERSISTED_CHECKOUT_STORAGE = {
    "persist:checkout_app": json.dumps(
        {
            "checkoutForm": json.dumps([]),
            "contactForm": json.dumps(
                {
                    "givenName": "Test",
                    "familyName": "Traveler",
                    "salutation": "MR",
                    "email": "test@example.com",
                    "countryCode": "PL",
                    "mobileNumber": "",
                }
            ),
            "addonSelected": json.dumps(
                {
                    "continueToAddons": False,
                    "baggage": {
                        "data": {"depart": [{"handCarry": [0]}]},
                        "paxTitles": [{"givenName": "Adult 1", "familyName": "", "paxId": "adult_1"}],
                        "departPaxBaggages": [[
                            {
                                "baggageList": [
                                    {
                                        "id": "hand_bag_ind_0.0",
                                        "amount": 0,
                                        "currency": "EUR",
                                        "title": [{"dimension": "56 x 23 x 36 cm", "weight": "7 kg"}],
                                        "isPreSelected": True,
                                        "isIncluded": True,
                                    }
                                ],
                                "baggageType": "handCarry",
                            },
                            {
                                "baggageList": [
                                    {
                                        "id": "hold_bag_ind_0.0",
                                        "amount": 16.57,
                                        "currency": "EUR",
                                        "title": [{"dimension": "78 x 28 x 52 cm", "weight": "15 kg"}],
                                        "isIncluded": False,
                                    }
                                ],
                                "baggageType": "checkedBaggage",
                            },
                        ]],
                        "returnPaxBaggages": [],
                    },
                    "tripId": "demo-trip-id",
                    "insurance": [],
                }
            ),
            "companyDetails": json.dumps({}),
            "ancillaryRecommendation": json.dumps({}),
            "_persist": json.dumps({"version": -1, "rehydrated": True}),
        }
    )
}

VUELING_SELECT_FLIGHT_HTML = """
<html>
    <head><title>Select your flight - Vueling</title></head>
    <body>
        <button class="btn--outline-secondary btn--price" onclick="document.getElementById('bundles').style.display='block'">
            SELECT FLIGHT FOR 68 EUR €68
        </button>
        <button class="btn--outline-secondary btn--price">SELECT FLIGHT FOR 100 EUR €100</button>
        <div id="bundles" style="display:none">
            <div class="vy-card-bundle vy-card-bundle--verticalpadding">
                <div class="vy-card-bundle_header-title">FLY LIGHT Travel with essentials</div>
                <section class="vy-card-bundle_body">
                    <ul>
                        <li>1 underseat cabin bag Max. 40x30x20 cm</li>
                        <li>Check-in available 24 hours in advance</li>
                        <li>You can add extras later on</li>
                    </ul>
                </section>
                <button>+ SELECT BUNDLE €0 per person</button>
            </div>
            <div class="vy-card-bundle vy-card-bundle--featured">
                <div class="vy-card-bundle_header-title">FLY GRANDE A more complete trip</div>
                <section class="vy-card-bundle_body">
                    <ul>
                        <li>1 underseat cabin bag Max. 40x30x20 cm</li>
                        <li>1 checked bag (25 kg)</li>
                        <li>Choose exclusive seats</li>
                        <li>Changes and cancellation</li>
                        <li>Priority at the airport</li>
                    </ul>
                </section>
                <button>+ SELECT BUNDLE BY +119,00 € PER PERSON €119.00 per person on top of the ticket price</button>
            </div>
        </div>
    </body>
</html>
"""

GENERIC_DISCOVERY_HTML = """
<html>
    <head><title>UnknownAir options</title></head>
    <body>
        <div>Customize your trip</div>
        <button id="services-tab" role="tab" aria-controls="services-panel" aria-selected="false"
            onclick="document.getElementById('services-panel').style.display='block'">
            Onboard services
        </button>
        <button id="protect-tab" role="tab" aria-controls="protect-panel" aria-selected="false"
            onclick="document.getElementById('protect-panel').style.display='block'">
            Travel protection
        </button>
        <div id="services-panel" style="display:none">
            <div>Fresh meal available on board</div>
            <div>Wi-Fi available during the flight</div>
        </div>
        <div id="protect-panel" style="display:none">
            <div>Travel insurance available during checkout</div>
        </div>
    </body>
</html>
"""

GENERIC_DISCOVERY_MULTIHOP_START_HTML = """
<html>
    <head><title>UnknownAir booking</title></head>
    <body>
        <div>Manage your booking</div>
        <a href="https://letsfg.test/service-options">Travel extras</a>
    </body>
</html>
"""

GENERIC_DISCOVERY_MULTIHOP_OPTIONS_HTML = """
<html>
    <head><title>UnknownAir service options</title></head>
    <body>
        <div>Customize your trip</div>
        <button id="meal-tab" role="tab" aria-controls="meal-panel" aria-selected="false"
            onclick="document.getElementById('meal-panel').style.display='block'">
            Meal options
        </button>
        <button id="wifi-tab" role="tab" aria-controls="wifi-panel" aria-selected="false"
            onclick="document.getElementById('wifi-panel').style.display='block'">
            Wi-Fi pass
        </button>
        <button id="insurance-tab" role="tab" aria-controls="insurance-panel" aria-selected="false"
            onclick="document.getElementById('insurance-panel').style.display='block'">
            Coverage options
        </button>
        <div id="meal-panel" style="display:none">Hot meal available on board</div>
        <div id="wifi-panel" style="display:none">Travel Wi-Fi available during the flight</div>
        <div id="insurance-panel" style="display:none">Travel insurance available during checkout</div>
    </body>
</html>
"""

BOOKING_HOLDINGS_DISCOVERY_START_HTML = """
<html>
    <head><title>Momondo booking</title></head>
    <body>
        <div>Review your flight</div>
        <a href="https://www.momondo.com/packages">Packages</a>
        <a href="https://www.momondo.com/book/extras">Travel extras</a>
    </body>
</html>
"""

BOOKING_HOLDINGS_DISCOVERY_PACKAGES_HTML = """
<html>
    <head><title>Momondo packages</title></head>
    <body>
        <a href="https://www.momondo.com/packages/search">Search for packages</a>
        <a href="https://play.google.com/store/apps/details?id=com.momondo.flightsearch">Get it on Google Play</a>
    </body>
</html>
"""

BOOKING_HOLDINGS_DISCOVERY_EXTRAS_HTML = """
<html>
    <head><title>Momondo extras</title></head>
    <body>
        <div>Customize your trip</div>
        <button id="meal-tab" role="tab" aria-controls="meal-panel" aria-selected="false"
            onclick="document.getElementById('meal-panel').style.display='block'">
            Meal options
        </button>
        <button id="wifi-tab" role="tab" aria-controls="wifi-panel" aria-selected="false"
            onclick="document.getElementById('wifi-panel').style.display='block'">
            Wi-Fi pass
        </button>
        <button id="insurance-tab" role="tab" aria-controls="insurance-panel" aria-selected="false"
            onclick="document.getElementById('insurance-panel').style.display='block'">
            Coverage options
        </button>
        <div id="meal-panel" style="display:none">Hot meal available on board</div>
        <div id="wifi-panel" style="display:none">Travel Wi-Fi available during the flight</div>
        <div id="insurance-panel" style="display:none">Travel insurance available during checkout</div>
    </body>
</html>
"""

BOOKING_HOLDINGS_INTERSTITIAL_HTML = """
<html>
    <head><title>Sending you to book</title></head>
    <body>
        <div>Sending you to book</div>
        <script>
            setTimeout(() => {
                window.location.href = 'https://partner.example.com/checkout';
            }, 300);
        </script>
    </body>
</html>
"""

BOOKING_HOLDINGS_PARTNER_HTML = """
<html>
    <head><title>Partner checkout</title></head>
    <body>
        <div>London LON Barcelona BCN Jun 18</div>
        <div>Cancellation protection</div>
        <div>Travel insurance available during checkout</div>
    </body>
</html>
"""

BOOKING_HOLDINGS_FORBIDDEN_HTML = """
<html>
    <head><title>Page not found (403) | momondo</title></head>
    <body>
        <div>Sorry, this page isn't available.</div>
        <div>403 forbidden</div>
    </body>
</html>
"""


class CheckoutEngineConfigTest(unittest.TestCase):
    def test_target_sources_are_registered_for_generic_checkout(self) -> None:
        for source, expected_handler in TARGET_SOURCE_HANDLERS.items():
            with self.subTest(source=source):
                config = AIRLINE_CONFIGS.get(source)
                self.assertIsNotNone(config, f"{source} not found in AIRLINE_CONFIGS")
                self.assertEqual(config.details_extractor_handler, expected_handler)
                self.assertIsNotNone(_get_bookable_connector(source))

    def test_spicejet_direct_api_not_registered(self) -> None:
        """The legacy spicejet_direct_api source key must be purged."""
        self.assertIsNone(AIRLINE_CONFIGS.get("spicejet_direct_api"),
                          "spicejet_direct_api must be removed from checkout engine configs")

    def test_base_configs_default_to_generic_checkout_details(self) -> None:
        for source in DEFAULT_GENERIC_SOURCES:
            with self.subTest(source=source):
                config = AIRLINE_CONFIGS.get(source)
                self.assertIsNotNone(config)
                self.assertEqual(config.details_extractor_handler, "_extract_generic_visible_checkout_details")

    def test_airasia_family_keeps_custom_details_extractor(self) -> None:
        for source in ("airasia_direct", "airasiax_direct"):
            with self.subTest(source=source):
                config = AIRLINE_CONFIGS.get(source)
                self.assertIsNotNone(config)
                self.assertEqual(config.details_extractor_handler, "_extract_airasia_checkout_details")

    def test_merge_checkout_details_preserves_structured_add_ons(self) -> None:
        engine = GenericCheckoutEngine()
        merged = engine._merge_checkout_details(
            {
                "checkout_page": "extras",
                "available_add_ons": {
                    "baggage": [
                        {
                            "label": "20kg checked bag",
                            "currency": "EUR",
                            "amount": 25.0,
                            "type": "baggage",
                        }
                    ]
                },
                "visible_price_options": [
                    {
                        "label": "20kg checked bag",
                        "currency": "EUR",
                        "amount": 25.0,
                    }
                ],
            },
            {
                "checkout_page": "seats",
                "available_add_ons": {
                    "baggage": [
                        {
                            "label": "20kg checked bag",
                            "currency": "EUR",
                            "amount": 25.0,
                            "type": "baggage",
                        },
                        {
                            "label": "32kg checked bag",
                            "currency": "EUR",
                            "amount": 40.0,
                            "type": "baggage",
                        },
                    ],
                    "seat_selection": [
                        {
                            "label": "Standard seat",
                            "currency": "EUR",
                            "amount": 9.0,
                            "type": "seat_selection",
                        }
                    ],
                },
                "visible_price_options": [
                    {
                        "label": "20kg checked bag",
                        "currency": "EUR",
                        "amount": 25.0,
                    },
                    {
                        "label": "Standard seat",
                        "currency": "EUR",
                        "amount": 9.0,
                    },
                ],
                "price_breakdown": [
                    {
                        "label": "Base fare",
                        "currency": "EUR",
                        "amount": 120.0,
                        "type": "breakdown",
                    },
                    {
                        "label": "Standard seat",
                        "currency": "EUR",
                        "amount": 9.0,
                        "type": "seat_selection",
                    },
                ],
            },
        )

        self.assertEqual(merged["checkout_page"], "seats")
        self.assertEqual(len(merged["available_add_ons"]["baggage"]), 2)
        self.assertEqual(merged["available_add_ons"]["seat_selection"][0]["amount"], 9.0)
        self.assertEqual(len(merged["visible_price_options"]), 2)
        self.assertEqual(len(merged["price_breakdown"]), 2)

    def test_infer_checkout_page_prefers_search_surface_over_extras_copy(self) -> None:
        engine = GenericCheckoutEngine()
        checkout_page = engine._infer_checkout_page(
            {"checkout_page": "extras"},
            {
                "current_url": "https://www.traveloka.com/en-id/flight/fullsearch?ap=CGK.DPS",
                "page_title": "One Way: CGK -> DPS, 15 Jun 2026",
                "body_snippet": "Baggage included on selected fares",
            },
        )

        self.assertEqual(checkout_page, "select_flight")
        self.assertEqual(engine._checkout_step_for_page(checkout_page), "page_loaded")

    def test_infer_checkout_page_detects_payment_surface(self) -> None:
        engine = GenericCheckoutEngine()
        checkout_page = engine._infer_checkout_page(
            {},
            {
                "current_url": "https://carrier.example.com/checkout/review-and-pay",
                "page_title": "Review and Pay | Example Air",
                "body_snippet": "Payment method Card number Billing address",
            },
        )

        self.assertEqual(checkout_page, "payment")
        self.assertEqual(engine._checkout_step_for_page(checkout_page), "payment_page_reached")


class AirAsiaCheckoutDetailsExtractionTest(unittest.IsolatedAsyncioTestCase):
    async def _extract(self, source: str, html: str, session_storage: dict[str, str] | None = None) -> dict:
        engine = GenericCheckoutEngine()
        config = AIRLINE_CONFIGS[source]
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=True)
            page = await browser.new_page()
            await page.route(
                "https://letsfg.test/**",
                lambda route: route.fulfill(status=200, content_type="text/html", body=html),
            )
            await page.goto("https://letsfg.test/checkout")
            if session_storage:
                await page.evaluate(
                    """(entries) => {
                        for (const [key, value] of Object.entries(entries || {})) {
                            sessionStorage.setItem(key, value);
                        }
                    }""",
                    session_storage,
                )
            details = await engine._extract_airasia_checkout_details(page, config, default_currency="MYR")
            await browser.close()
        return details

    async def test_airasia_family_checkout_extractor_captures_clean_add_on_truth(self) -> None:
        for source in ("airasia_direct", "airasiax_direct"):
            with self.subTest(source=source):
                extras = await self._extract(source, AIRASIA_EXTRAS_HTML)
                seats = await self._extract(source, AIRASIA_SEATS_HTML)

                baggage = {item["label"]: item for item in extras["available_add_ons"]["baggage"]}
                self.assertEqual(set(baggage), {"1 x 7 kg Carry-on baggage", "15 kg checked baggage"})
                self.assertEqual(baggage["1 x 7 kg Carry-on baggage"]["type"], "cabin_bag")
                self.assertEqual(baggage["15 kg checked baggage"]["type"], "checked_bag")
                self.assertEqual(baggage["15 kg checked baggage"]["amount"], 77.82)

                seat_selection = {item["label"]: item for item in seats["available_add_ons"]["seat_selection"]}
                self.assertEqual(set(seat_selection), {"Standard seat", "Hot seat"})
                self.assertEqual(seat_selection["Standard seat"]["amount"], 20.0)
                self.assertEqual(seat_selection["Hot seat"]["amount"], 45.0)

                self.assertTrue(any(item["label"] == "Premium Coverage" and item["amount"] == 12.0 for item in extras["available_add_ons"]["insurance"]))
                self.assertTrue(any(item["label"] == "Meal Combo" and item["amount"] == 18.0 for item in extras["available_add_ons"]["meals"]))
                self.assertTrue(any(item["label"] == "Fast Pass" and item["amount"] == 30.0 for item in extras["available_add_ons"]["priority"]))
                self.assertTrue(any(item["label"] == "Value Pack" and item["amount"] == 110.0 for item in extras["available_add_ons"]["packages"]))
                self.assertTrue(any(item["label"] == "Airport Lounge" and item["amount"] == 55.0 for item in extras["available_add_ons"]["extras"]))

                self.assertEqual(
                    extras["baggage_pricing_observation"],
                    "Numeric baggage pricing is visible when the AirAsia baggage selector is open.",
                )
                self.assertEqual(
                    seats["seat_selection_observation"],
                    "Numeric seat-selection pricing is visible on the AirAsia seat-selection surface.",
                )

    async def test_airasia_family_checkout_extractor_reads_baggage_from_persisted_checkout_store(self) -> None:
        for source in ("airasia_direct", "airasiax_direct"):
            with self.subTest(source=source):
                details = await self._extract(
                    source,
                    AIRASIA_GUEST_DETAILS_HTML,
                    session_storage=AIRASIA_PERSISTED_CHECKOUT_STORAGE,
                )

                self.assertEqual(details["checkout_page"], "guest_details")
                baggage = details["available_add_ons"]["baggage"]
                checked_bag = next(item for item in baggage if item["type"] == "checked_bag")
                cabin_bag = next(item for item in baggage if item["type"] == "cabin_bag")

                self.assertEqual(checked_bag["label"], "15 kg checked baggage")
                self.assertEqual(checked_bag["currency"], "EUR")
                self.assertEqual(checked_bag["amount"], 16.57)
                self.assertEqual(cabin_bag["label"], "1 x 7 kg Carry-on baggage")
                self.assertTrue(cabin_bag["included"])
                self.assertNotIn("amount", cabin_bag)
                self.assertEqual(
                    details["baggage_pricing_observation"],
                    "Numeric baggage pricing is visible on the reachable AirAsia checkout surface.",
                )
                self.assertEqual(
                    details["seat_selection_observation"],
                    "No visible seat-selection price surfaced on the reachable AirAsia guest-details/payment path.",
                )


class VuelingBundleExtractionTest(unittest.IsolatedAsyncioTestCase):
    async def test_generic_checkout_extractor_opens_vueling_bundle_cards(self) -> None:
        engine = GenericCheckoutEngine()
        config = AIRLINE_CONFIGS["vueling_direct"]

        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=True)
            page = await browser.new_page()
            await page.route(
                "https://tickets.vueling.com/booking/selectFlight",
                lambda route: route.fulfill(status=200, content_type="text/html", body=VUELING_SELECT_FLIGHT_HTML),
            )
            await page.goto("https://tickets.vueling.com/booking/selectFlight")

            details = await engine._extract_generic_visible_checkout_details(
                page,
                config,
                offer={"price": 67.99, "currency": "EUR"},
                default_currency="EUR",
            )
            await browser.close()

        self.assertEqual(details["checkout_page"], "extras")
        self.assertEqual(details["conditions"]["fare_family"], "FLY LIGHT")
        self.assertEqual(
            details["conditions"]["cabin_bag"],
            "included - 1 underseat cabin bag Max. 40x30x20 cm",
        )
        self.assertNotIn("seat", details["conditions"])
        self.assertIn("Changes and cancellation", details["conditions"]["fare_bundle_upgrades"])

        packages = details["available_add_ons"]["packages"]
        self.assertEqual(packages[0]["label"], "FLY LIGHT")
        self.assertTrue(packages[0]["included"])
        self.assertEqual(packages[0]["amount"], 0.0)
        self.assertEqual(packages[1]["label"], "FLY GRANDE")
        self.assertEqual(packages[1]["amount"], 119.0)
        self.assertTrue(any(bundle["selected"] and bundle["label"] == "FLY LIGHT" for bundle in details["fare_bundle_options"]))


class GenericDiscoveryExtractionTest(unittest.IsolatedAsyncioTestCase):
    async def test_generic_checkout_discovery_opens_unknown_service_panels(self) -> None:
        engine = GenericCheckoutEngine()
        config = AIRLINE_CONFIGS["ryanair_direct"]

        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=True)
            page = await browser.new_page()
            await page.route(
                "https://letsfg.test/unknown-options",
                lambda route: route.fulfill(status=200, content_type="text/html", body=GENERIC_DISCOVERY_HTML),
            )
            await page.goto("https://letsfg.test/unknown-options")

            details = await engine._extract_generic_visible_checkout_details(
                page,
                config,
                offer={"price": 55.0, "currency": "EUR"},
                default_currency="EUR",
            )
            await browser.close()

        self.assertEqual(details["checkout_page"], "extras")
        self.assertIn("generic_discovery_observation", details)
        self.assertTrue(any("meal" in item["label"].lower() for item in details["available_add_ons"]["meals"]))
        self.assertTrue(any("wi-fi" in item["label"].lower() or "wifi" in item["label"].lower() for item in details["available_add_ons"]["wifi"]))
        self.assertTrue(any("insurance" in item["label"].lower() for item in details["available_add_ons"]["insurance"]))

    async def test_generic_checkout_discovery_handles_cross_page_unknown_services(self) -> None:
        engine = GenericCheckoutEngine()
        config = AIRLINE_CONFIGS["ryanair_direct"]

        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=True)
            page = await browser.new_page()

            await page.route(
                "https://letsfg.test/**",
                lambda route: route.fulfill(
                    status=200,
                    content_type="text/html",
                    body=(
                        GENERIC_DISCOVERY_MULTIHOP_OPTIONS_HTML
                        if route.request.url.endswith("/service-options")
                        else GENERIC_DISCOVERY_MULTIHOP_START_HTML
                    ),
                ),
            )
            await page.goto("https://letsfg.test/start")

            details = await engine._extract_generic_visible_checkout_details(
                page,
                config,
                offer={"price": 55.0, "currency": "EUR"},
                default_currency="EUR",
            )
            await browser.close()

        self.assertEqual(details["resolved_booking_url"], "https://letsfg.test/service-options")
        self.assertIn("generic_discovery_observation", details)
        self.assertTrue(any("meal" in item["label"].lower() for item in details["available_add_ons"]["meals"]))
        self.assertTrue(any("wi-fi" in item["label"].lower() or "wifi" in item["label"].lower() for item in details["available_add_ons"]["wifi"]))
        self.assertTrue(any("insurance" in item["label"].lower() for item in details["available_add_ons"]["insurance"]))
        self.assertGreaterEqual(len(details.get("generic_discovery_trace") or []), 2)

    async def test_generic_checkout_discovery_skips_booking_holdings_package_detours(self) -> None:
        engine = GenericCheckoutEngine()
        config = AIRLINE_CONFIGS["momondo_meta"]

        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=True)
            page = await browser.new_page()

            await page.route(
                "https://www.momondo.com/**",
                lambda route: route.fulfill(
                    status=200,
                    content_type="text/html",
                    body=(
                        BOOKING_HOLDINGS_DISCOVERY_PACKAGES_HTML
                        if route.request.url.endswith("/packages") or route.request.url.endswith("/packages/search")
                        else BOOKING_HOLDINGS_DISCOVERY_EXTRAS_HTML
                        if route.request.url.endswith("/book/extras")
                        else BOOKING_HOLDINGS_DISCOVERY_START_HTML
                    ),
                ),
            )
            await page.goto("https://www.momondo.com/book/flight?demo=1")

            details = await engine._extract_generic_visible_checkout_details(
                page,
                config,
                offer={"price": 55.0, "currency": "EUR"},
                default_currency="EUR",
            )
            await browser.close()

        self.assertEqual(details["resolved_booking_url"], "https://www.momondo.com/book/extras")
        self.assertTrue(any("travel extras" in str(item.get("action") or "").lower() for item in details.get("generic_discovery_trace") or []))
        self.assertFalse(any("package" in str(item.get("action") or "").lower() for item in details.get("generic_discovery_trace") or []))
        self.assertTrue(any("meal" in item["label"].lower() for item in details["available_add_ons"]["meals"]))
        self.assertTrue(any("wi-fi" in item["label"].lower() or "wifi" in item["label"].lower() for item in details["available_add_ons"]["wifi"]))
        self.assertTrue(any("insurance" in item["label"].lower() for item in details["available_add_ons"]["insurance"]))


class BookingHoldingsHandoffSettleTest(unittest.IsolatedAsyncioTestCase):
    async def test_probe_waits_through_booking_holdings_interstitial(self) -> None:
        engine = GenericCheckoutEngine()
        config = AIRLINE_CONFIGS["momondo_meta"]

        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=True)
            page = await browser.new_page()
            await page.route(
                "https://www.momondo.com/**",
                lambda route: route.fulfill(status=200, content_type="text/html", body=BOOKING_HOLDINGS_INTERSTITIAL_HTML),
            )
            await page.route(
                "https://partner.example.com/**",
                lambda route: route.fulfill(status=200, content_type="text/html", body=BOOKING_HOLDINGS_PARTNER_HTML),
            )
            await page.goto("https://www.momondo.com/book/flight?demo=1")

            await engine._settle_meta_booking_handoff(page, config)
            snapshot = await engine._snapshot_checkout_page(page)
            final_url = page.url
            await browser.close()

        self.assertEqual(final_url, "https://partner.example.com/checkout")
        self.assertIn("cancellation protection", str(snapshot.get("body_snippet") or "").lower())

    async def test_booking_holdings_forbidden_page_requests_headed_retry(self) -> None:
        engine = GenericCheckoutEngine()
        config = AIRLINE_CONFIGS["momondo_meta"]

        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=True)
            page = await browser.new_page()
            await page.route(
                "https://www.momondo.com/**",
                lambda route: route.fulfill(status=200, content_type="text/html", body=BOOKING_HOLDINGS_FORBIDDEN_HTML),
            )
            await page.goto("https://www.momondo.com/book/flight?demo=403")

            should_retry = await engine._should_retry_meta_probe_headed(page, config)
            await browser.close()

        self.assertTrue(should_retry)


if __name__ == "__main__":
    unittest.main()