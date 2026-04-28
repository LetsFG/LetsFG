import sys
import unittest
from datetime import date, timedelta
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
SDK_PYTHON_ROOT = PROJECT_ROOT / "sdk" / "python"
if str(SDK_PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(SDK_PYTHON_ROOT))

from letsfg.connectors.skyscanner import _parse_radar
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
    def test_parse_radar_skips_base_fare_only_itinerary(self) -> None:
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


if __name__ == "__main__":
    unittest.main()