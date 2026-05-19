import sys
import unittest
from datetime import date, timedelta
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
SDK_PYTHON_ROOT = PROJECT_ROOT / "sdk" / "python"
if str(SDK_PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(SDK_PYTHON_ROOT))

from letsfg.connectors.momondo import _booking_holdings_search_code, _parse_booking_holdings_poll
from letsfg.models.flights import FlightSearchRequest


def _build_request() -> FlightSearchRequest:
    return FlightSearchRequest(
        origin="LTN",
        destination="BCN",
        date_from=date.today() + timedelta(days=30),
        currency="EUR",
    )


def _build_poll_response(booking_url: object | None, *, result_id: str = "result-1", price: float = 62.0) -> dict:
    option = {
        "displayPrice": {"price": price, "currency": "EUR"},
        "legFarings": [{"legId": "leg_out"}],
    }
    if booking_url is not None:
        option["bookingUrl"] = booking_url

    return {
        "results": [
            {
                "type": "core",
                "resultId": result_id,
                "bookingOptionsBuckets": [],
                "bookingOptions": [option],
            }
        ],
        "legs": {
            "leg_out": {
                "segments": [{"id": "seg_out"}],
            }
        },
        "segments": {
            "seg_out": {
                "airline": "W9",
                "flightNumber": "5361",
                "origin": "LTN",
                "destination": "BCN",
                "departure": "2026-05-03T05:40:00",
                "arrival": "2026-05-03T08:50:00",
            }
        },
        "airlines": {
            "W9": {"name": "Wizz Air UK"},
        },
        "providers": {},
    }


class BookingHoldingsBookingUrlTest(unittest.TestCase):
    def test_booking_holdings_search_code_promotes_london_airports_to_city_code(self) -> None:
        self.assertEqual(_booking_holdings_search_code("LTN"), "LON")
        self.assertEqual(_booking_holdings_search_code("LGW"), "LON")
        self.assertEqual(_booking_holdings_search_code("BCN"), "BCN")

    def test_parse_booking_holdings_uses_relative_clickout_url(self) -> None:
        offers = _parse_booking_holdings_poll(
            [_build_poll_response({"url": "/booking?token=abc123"})],
            _build_request(),
            source="momondo_meta",
            id_prefix="mm",
            booking_base_url="https://www.momondo.com/flight-search",
        )

        self.assertEqual(len(offers), 1)
        self.assertEqual(offers[0].booking_url, "https://www.momondo.com/booking?token=abc123")

    def test_parse_booking_holdings_keeps_absolute_clickout_url(self) -> None:
        offers = _parse_booking_holdings_poll(
            [_build_poll_response({"url": "https://www.kayak.com/book/offer-123"})],
            _build_request(),
            source="kayak_meta",
            id_prefix="ky",
            booking_base_url="https://www.kayak.com/flights",
        )

        self.assertEqual(len(offers), 1)
        self.assertEqual(offers[0].booking_url, "https://www.kayak.com/book/offer-123")

    def test_parse_booking_holdings_falls_back_when_clickout_missing(self) -> None:
        req = _build_request()
        offers = _parse_booking_holdings_poll(
            [_build_poll_response(None)],
            req,
            source="cheapflights_meta",
            id_prefix="cf",
            booking_base_url="https://www.cheapflights.com/flight-search",
        )

        self.assertEqual(len(offers), 1)
        self.assertEqual(
            offers[0].booking_url,
            f"https://www.cheapflights.com/flight-search/LON-{req.destination}/{req.date_from.isoformat()}",
        )

    def test_parse_booking_holdings_expands_multiple_booking_options(self) -> None:
        response = _build_poll_response({"url": "/booking?token=first"})
        response["results"][0]["bookingOptions"].append(
            {
                "displayPrice": {"price": 71.0, "currency": "EUR"},
                "legFarings": [{"legId": "leg_out"}],
                "bookingUrl": {"url": "/booking?token=second"},
            }
        )

        offers = _parse_booking_holdings_poll(
            [response],
            _build_request(),
            source="momondo_meta",
            id_prefix="mm",
            booking_base_url="https://www.momondo.com/flight-search",
        )

        self.assertEqual(len(offers), 2)
        self.assertEqual([offer.price for offer in offers], [62.0, 71.0])
        self.assertEqual(
            [offer.booking_url for offer in offers],
            [
                "https://www.momondo.com/booking?token=first",
                "https://www.momondo.com/booking?token=second",
            ],
        )

    def test_parse_booking_holdings_maps_metadata_from_fare_bucket_and_option(self) -> None:
        response = _build_poll_response({"url": "/booking?token=abc123"})
        response["providers"] = {
            "SKYPICKERLCC": {
                "displayName": "Kiwi.com",
                "providerQualityScore": 0.91,
            }
        }
        response["results"][0]["bookingOptionsBuckets"] = [
            {
                "id": "BASIC",
                "type": "FARE",
                "localizedDisplayName": "Basic",
                "fareAmenities": [
                    {"type": "CHANGE", "restriction": "FEE"},
                    {"type": "REFUNDABLE", "restriction": "UNAVAILABLE"},
                ],
            }
        ]
        response["results"][0]["bookingOptions"][0].update(
            {
                "providerCode": "SKYPICKERLCC",
                "flags": {
                    "hasVirtualInterline": True,
                    "isSelfTransferProtection": True,
                    "isInstantBook": True,
                },
                "fees": {
                    "carryOnBagData": {
                        "status": "FEE",
                        "displayPrice": {"price": 19.0, "currency": "EUR"},
                    },
                    "carryOnDisplay": "Not Included<br>(+EUR 19)",
                    "checkedBagData": {
                        "status": "INCLUDED",
                        "displayPrice": {"price": 0.0, "currency": "EUR"},
                    },
                    "checkedBagDisplay": "Included",
                },
                "baggagePolicyInfo": {
                    "FR": [
                        {
                            "bagType": "PERSONAL",
                            "bagRestriction": {"DIMENSIONS": "Up to 15 x 9 x 7in"},
                        },
                        {
                            "bagType": "CARRYON",
                            "bagRestriction": {"DIMENSIONS": "Up to 21 x 15 x 7in"},
                        },
                        {
                            "bagType": "CHECKED",
                            "bagRestriction": {"DIMENSIONS": "23 kg"},
                        },
                    ]
                },
            }
        )

        offers = _parse_booking_holdings_poll(
            [response],
            _build_request(),
            source="momondo_meta",
            id_prefix="mm",
            booking_base_url="https://www.momondo.com/flight-search",
        )

        self.assertEqual(len(offers), 1)
        offer = offers[0]
        self.assertEqual(offer.conditions["fare_family"], "Basic")
        self.assertEqual(offer.conditions["change_before_departure"], "allowed_with_fee")
        self.assertEqual(offer.conditions["refund_before_departure"], "not_allowed")
        self.assertEqual(offer.conditions["booking_provider"], "Kiwi.com")
        self.assertEqual(offer.conditions["instant_booking"], "available")
        self.assertEqual(offer.conditions["self_transfer"], "protected")
        self.assertIn("19", offer.conditions["carry_on"])
        self.assertIn("21 x 15 x 7in", offer.conditions["carry_on"])
        self.assertEqual(offer.conditions["checked_bag"], "checked bag included (23 kg)")
        self.assertEqual(offer.conditions["personal_item"], "personal item max Up to 15 x 9 x 7in")
        self.assertEqual(offer.bags_price["carry_on"], 19.0)
        self.assertEqual(offer.bags_price["checked_bag"], 0.0)

    def test_parse_booking_holdings_skips_ambiguous_multi_fare_bucket_policies(self) -> None:
        response = _build_poll_response({"url": "/booking?token=abc123"})
        response["results"][0]["totalDistinctFares"] = 3
        response["results"][0]["bookingOptionsBuckets"] = [
            {
                "id": "BASIC",
                "type": "FARE",
                "localizedDisplayName": "Basic",
                "fareAmenities": [{"type": "CHANGE", "restriction": "FEE"}],
            },
            {
                "id": "FLEX",
                "type": "FARE",
                "localizedDisplayName": "Flex",
                "fareAmenities": [{"type": "CHANGE", "restriction": "AVAILABLE"}],
            },
        ]

        offers = _parse_booking_holdings_poll(
            [response],
            _build_request(),
            source="momondo_meta",
            id_prefix="mm",
            booking_base_url="https://www.momondo.com/flight-search",
        )

        self.assertEqual(len(offers), 1)
        self.assertNotIn("fare_family", offers[0].conditions)
        self.assertNotIn("change_before_departure", offers[0].conditions)

    def test_parse_booking_holdings_merges_results_across_poll_responses(self) -> None:
        offers = _parse_booking_holdings_poll(
            [
                _build_poll_response({"url": "/booking?token=first"}, result_id="result-1", price=62.0),
                _build_poll_response({"url": "/booking?token=second"}, result_id="result-2", price=74.0),
            ],
            _build_request(),
            source="momondo_meta",
            id_prefix="mm",
            booking_base_url="https://www.momondo.com/flight-search",
        )

        self.assertEqual(len(offers), 2)
        self.assertEqual([offer.price for offer in offers], [62.0, 74.0])
        self.assertEqual(
            [offer.booking_url for offer in offers],
            [
                "https://www.momondo.com/booking?token=first",
                "https://www.momondo.com/booking?token=second",
            ],
        )


if __name__ == "__main__":
    unittest.main()