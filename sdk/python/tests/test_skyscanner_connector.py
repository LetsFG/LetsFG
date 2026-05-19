import sys
import unittest
from datetime import date, timedelta
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
SDK_PYTHON_ROOT = PROJECT_ROOT / "sdk" / "python"
if str(SDK_PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(SDK_PYTHON_ROOT))

from letsfg.connectors.skyscanner import _parse_radar, _skyscanner_search_code
from letsfg.models.flights import FlightSearchRequest


def _build_request() -> FlightSearchRequest:
    return FlightSearchRequest(
        origin="LTN",
        destination="BCN",
        date_from=date.today() + timedelta(days=30),
        currency="EUR",
    )


def _build_segment() -> dict:
    return {
        "marketingCarrier": {"displayCode": "W9", "name": "Wizz Air UK"},
        "flightNumber": "5361",
        "origin": {
            "flightPlaceId": "LTN",
            "displayCode": "LTN",
            "parent": {"name": "London"},
        },
        "destination": {
            "flightPlaceId": "BCN",
            "displayCode": "BCN",
            "parent": {"name": "Barcelona"},
        },
        "departure": "2026-05-03T05:40:00",
        "arrival": "2026-05-03T08:50:00",
        "durationInMinutes": 190,
    }


def _build_result(*, price: dict, pricing_options: list[dict] | None = None) -> dict:
    result = {
        "id": "13771-2605030540--30972-0-9772-2605030850",
        "price": price,
        "legs": [
            {
                "segments": [_build_segment()],
                "durationInMinutes": 190,
                "stopCount": 0,
            }
        ],
    }
    if pricing_options is not None:
        result["pricingOptions"] = pricing_options
    return result


class SkyscannerConnectorTest(unittest.TestCase):
    def test_skyscanner_search_code_promotes_london_airports_to_city_code(self) -> None:
        self.assertEqual(_skyscanner_search_code("LTN"), "LON")
        self.assertEqual(_skyscanner_search_code("LHR"), "LON")
        self.assertEqual(_skyscanner_search_code("BCN"), "BCN")

    def test_parse_radar_accepts_consistent_base_fare_only_itinerary(self) -> None:
        result = _build_result(
            price={"raw": 55.4, "formatted": "EUR 55.40", "pricingOptionId": "opt_base"},
            pricing_options=[
                {
                    "pricingOptionId": "opt_base",
                    "price": {"amount": 55.4},
                    "items": [
                        {
                            "price": {"amount": 55.4},
                            "bookingProposition": "PBOOK",
                            "url": "/transport_deeplink/4.0/UK/en-GB/EUR/eduk/1/test?ticket_price=55.40&fare_type=base_fare",
                        }
                    ],
                }
            ],
        )

        offers = _parse_radar({"itineraries": {"results": [result]}}, _build_request())

        self.assertEqual(len(offers), 1)
        self.assertEqual(offers[0].price, 55.4)
        self.assertEqual(
            offers[0].booking_url,
            "https://www.skyscanner.net/transport_deeplink/4.0/UK/en-GB/EUR/eduk/1/test?ticket_price=55.40&fare_type=base_fare",
        )

    def test_parse_radar_skips_inconsistent_base_fare_only_itinerary(self) -> None:
        result = _build_result(
            price={"raw": 55.4, "formatted": "EUR 55.40", "pricingOptionId": "opt_base"},
            pricing_options=[
                {
                    "pricingOptionId": "opt_base",
                    "price": {"amount": 60.0},
                    "items": [
                        {
                            "price": {"amount": 60.0},
                            "bookingProposition": "PBOOK",
                            "url": "/transport_deeplink/4.0/UK/en-GB/EUR/eduk/1/test?ticket_price=55.40&fare_type=base_fare",
                        }
                    ],
                }
            ],
        )

        offers = _parse_radar({"itineraries": {"results": [result]}}, _build_request())

        self.assertEqual(offers, [])

    def test_parse_radar_prefers_non_base_fare_pricing_option(self) -> None:
        result = _build_result(
            price={"raw": 55.4, "formatted": "EUR 55.40", "pricingOptionId": "opt_safe"},
            pricing_options=[
                {
                    "pricingOptionId": "opt_base",
                    "price": {"amount": 55.4},
                    "items": [
                        {
                            "price": {"amount": 55.4},
                            "bookingProposition": "PBOOK",
                            "url": "/transport_deeplink/4.0/UK/en-GB/EUR/eduk/1/test?ticket_price=55.40&fare_type=base_fare",
                        }
                    ],
                },
                {
                    "pricingOptionId": "opt_safe",
                    "price": {"amount": 60.0},
                    "items": [
                        {
                            "price": {"amount": 60.0},
                            "bookingProposition": "PBOOK",
                            "url": "/transport_deeplink/4.0/UK/en-GB/EUR/eduk/1/test?ticket_price=60.00&fare_type=total",
                        }
                    ],
                },
            ],
        )

        offers = _parse_radar({"itineraries": {"results": [result]}}, _build_request())

        self.assertEqual(len(offers), 1)
        self.assertEqual(offers[0].price, 60.0)
        self.assertEqual(
            offers[0].booking_url,
            "https://www.skyscanner.net/transport_deeplink/4.0/UK/en-GB/EUR/eduk/1/test?ticket_price=60.00&fare_type=total",
        )

    def test_parse_radar_uses_agent_deeplink_when_item_url_missing(self) -> None:
        result = _build_result(
            price={"raw": 55.4, "formatted": "EUR 55.40", "pricingOptionId": "opt_safe"},
            pricing_options=[
                {
                    "pricingOptionId": "opt_safe",
                    "price": {"amount": 60.0},
                    "agents": [
                        {
                            "name": "Trip.com",
                            "url": "https://agent.example.com/checkout/offer-123",
                        }
                    ],
                }
            ],
        )

        offers = _parse_radar({"itineraries": {"results": [result]}}, _build_request())

        self.assertEqual(len(offers), 1)
        self.assertEqual(offers[0].booking_url, "https://agent.example.com/checkout/offer-123")

    def test_parse_radar_expands_multiple_safe_pricing_options(self) -> None:
        result = _build_result(
            price={"raw": 55.4, "formatted": "EUR 55.40", "pricingOptionId": "opt_safe_a"},
            pricing_options=[
                {
                    "pricingOptionId": "opt_safe_a",
                    "price": {"amount": 55.4},
                    "agents": [
                        {
                            "name": "Trip.com",
                            "url": "https://agent.example.com/checkout/offer-123",
                        }
                    ],
                },
                {
                    "pricingOptionId": "opt_safe_b",
                    "price": {"amount": 57.9},
                    "agents": [
                        {
                            "name": "Kiwi",
                            "url": "https://agent.example.com/checkout/offer-456",
                        }
                    ],
                },
            ],
        )

        offers = _parse_radar({"itineraries": {"results": [result]}}, _build_request())

        self.assertEqual(len(offers), 2)
        self.assertEqual([offer.price for offer in offers], [55.4, 57.9])
        self.assertEqual(
            [offer.booking_url for offer in offers],
            [
                "https://agent.example.com/checkout/offer-123",
                "https://agent.example.com/checkout/offer-456",
            ],
        )
        self.assertNotEqual(offers[0].id, offers[1].id)

    def test_parse_radar_expands_consistent_base_fare_seller_options(self) -> None:
        result = _build_result(
            price={"raw": 55.4, "formatted": "EUR 55.40", "pricingOptionId": "opt_base_a"},
            pricing_options=[
                {
                    "pricingOptionId": "opt_base_a",
                    "price": {"amount": 55.4},
                    "items": [
                        {
                            "price": {"amount": 55.4},
                            "bookingProposition": "PBOOK",
                            "url": "/transport_deeplink/4.0/UK/en-GB/EUR/eduk/1/test?ticket_price=55.40&fare_type=base_fare",
                        }
                    ],
                },
                {
                    "pricingOptionId": "opt_base_b",
                    "price": {"amount": 60.0},
                    "items": [
                        {
                            "price": {"amount": 60.0},
                            "bookingProposition": "PBOOK",
                            "url": "/transport_deeplink/4.0/UK/en-GB/EUR/eduk/1/test?ticket_price=60.00&fare_type=base_fare",
                        }
                    ],
                },
            ],
        )

        offers = _parse_radar({"itineraries": {"results": [result]}}, _build_request())

        self.assertEqual(len(offers), 2)
        self.assertEqual([offer.price for offer in offers], [55.4, 60.0])
        self.assertEqual(
            [offer.booking_url for offer in offers],
            [
                "https://www.skyscanner.net/transport_deeplink/4.0/UK/en-GB/EUR/eduk/1/test?ticket_price=55.40&fare_type=base_fare",
                "https://www.skyscanner.net/transport_deeplink/4.0/UK/en-GB/EUR/eduk/1/test?ticket_price=60.00&fare_type=base_fare",
            ],
        )

    def test_parse_radar_populates_conditions_from_fare_policy(self) -> None:
        result = _build_result(
            price={"raw": 55.4, "formatted": "EUR 55.40", "pricingOptionId": "opt_base_a"},
            pricing_options=[
                {
                    "pricingOptionId": "opt_base_a",
                    "price": {"amount": 55.4},
                    "items": [
                        {
                            "price": {"amount": 55.4},
                            "bookingProposition": "PBOOK",
                            "url": "/transport_deeplink/4.0/UK/en-GB/EUR/eduk/1/test?ticket_price=55.40&fare_type=base_fare&transfer_protection=protected",
                        }
                    ],
                }
            ],
        )
        result["farePolicy"] = {
            "isChangeAllowed": False,
            "isPartiallyChangeable": True,
            "isCancellationAllowed": False,
            "isPartiallyRefundable": False,
        }
        result["hasFlexibleOptions"] = True
        result["isSelfTransfer"] = True
        result["isProtectedSelfTransfer"] = True

        offers = _parse_radar({"itineraries": {"results": [result]}}, _build_request())

        self.assertEqual(len(offers), 1)
        self.assertEqual(
            offers[0].conditions,
            {
                "change_before_departure": "allowed_with_fee",
                "refund_before_departure": "not_allowed",
                "flexible_ticket_options": "available",
                "self_transfer": "protected",
                "fare_type": "base_fare",
                "self_transfer_protection": "protected",
            },
        )


if __name__ == "__main__":
    unittest.main()