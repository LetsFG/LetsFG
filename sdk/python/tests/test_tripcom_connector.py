import sys
import unittest
from datetime import date
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
SDK_PYTHON_ROOT = PROJECT_ROOT / "sdk" / "python"
if str(SDK_PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(SDK_PYTHON_ROOT))

from letsfg.connectors.tripcom import _parse_ctrip
from letsfg.models.flights import FlightSearchRequest


def _make_req(**kwargs) -> FlightSearchRequest:
    defaults = dict(
        origin="DEL",
        destination="LHR",
        date_from=date(2026, 5, 30),
        adults=1,
        children=0,
        infants=0,
        cabin_class="M",
        currency="INR",
    )
    defaults.update(kwargs)
    return FlightSearchRequest(**defaults)


def _build_itinerary(price_list: list[dict]) -> list[dict]:
    return [
        {
            "itineraryId": "itin-1",
            "priceList": price_list,
            "flightSegments": [
                {
                    "duration": 475,
                    "transferCount": 0,
                    "flightList": [
                        {
                            "marketAirlineCode": "AI",
                            "marketAirlineName": "Air India",
                            "flightNo": "111",
                            "departureAirportCode": "DEL",
                            "arrivalAirportCode": "LHR",
                            "departureDateTime": "2026-05-30 10:50:00",
                            "arrivalDateTime": "2026-05-30 17:45:00",
                        }
                    ],
                }
            ],
        }
    ]


class TripcomConnectorCurrencyTest(unittest.TestCase):
    def test_parse_ctrip_preserves_reported_source_currency(self) -> None:
        req = _make_req(currency="INR")
        offers = _parse_ctrip(
            _build_itinerary(
                [
                    {
                        "adultPrice": 419.95,
                        "adultTax": 0,
                        "currency": "USD",
                    }
                ]
            ),
            req,
        )

        self.assertEqual(len(offers), 1)
        offer = offers[0]
        self.assertEqual(offer.price, 419.95)
        self.assertEqual(offer.currency, "USD")
        self.assertEqual(offer.price_formatted, "USD 419.95")
        self.assertIn("curr=USD", offer.booking_url)

    def test_parse_ctrip_defaults_missing_currency_to_cny(self) -> None:
        req = _make_req(currency="USD")
        offers = _parse_ctrip(
            _build_itinerary(
                [
                    {
                        "adultPrice": 3020,
                        "adultTax": 0,
                    }
                ]
            ),
            req,
        )

        self.assertEqual(len(offers), 1)
        offer = offers[0]
        self.assertEqual(offer.price, 3020.0)
        self.assertEqual(offer.currency, "CNY")
        self.assertEqual(offer.price_formatted, "CNY 3020.00")
        self.assertIn("curr=CNY", offer.booking_url)


if __name__ == "__main__":
    unittest.main()