"""
Tests for India direct-airline connectors: Alliance Air & Star Air.

Validates that the new connectors parse realistic response payloads correctly
and produce well-formed FlightOffer objects.
"""

import hashlib
import sys
import unittest
from datetime import date, datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[3]
SDK_PYTHON_ROOT = PROJECT_ROOT / "sdk" / "python"
if str(SDK_PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(SDK_PYTHON_ROOT))

from letsfg.connectors.allianceair import (
    AllianceAirConnectorClient,
    _parse_paxlinks_datetime,
    _parse_response,
    _extract_schedule_payload,
)
from letsfg.connectors.starair import (
    StarAirConnectorClient,
    _parse_duration,
    _parse_fare,
    _parse_datetime as _starair_parse_datetime,
)
from letsfg.models.flights import FlightSearchRequest


def _make_req(**kwargs):
    defaults = dict(
        origin="BLR", destination="DEL",
        date_from=date(2026, 6, 15),
        adults=1, children=0, infants=0,
        cabin_class="M", currency="INR",
    )
    defaults.update(kwargs)
    return FlightSearchRequest(**defaults)


# ─── Alliance Air ──────────────────────────────────────────────────────────

ALLIANCEAIR_PAYLOAD = {
    "departure_schedule": [
        {
            "connecting_flight_routes": [
                {
                    "origin": {"code": "BLR", "city": "Bengaluru"},
                    "destination": {"code": "DEL", "city": "Delhi"},
                    "departure_date": {"year": 2026, "month": 6, "day": 15, "hour": 8, "minute": 0},
                    "arrival_date": {"year": 2026, "month": 6, "day": 15, "hour": 10, "minute": 30},
                    "flight_number": "9I501",
                    "aircraft": "ATR 72",
                    "availability": 9,
                },
            ],
            "fare_info": {
                "total_search_fare": {
                    "amount": 3850.0,
                    "ccy": "INR",
                },
            },
        }
    ]
}


class AllianceAirParserTest(unittest.TestCase):
    def test_parse_valid_payload(self):
        req = _make_req()
        offers = _parse_response(ALLIANCEAIR_PAYLOAD, req)
        self.assertEqual(len(offers), 1)
        offer = offers[0]
        self.assertEqual(offer.origin_code if hasattr(offer, "origin_code") else offer.outbound.segments[0].origin, "BLR")
        self.assertEqual(offer.price, 3850.0)
        self.assertEqual(offer.currency, "INR")
        self.assertGreater(offer.outbound.total_duration_seconds, 0)
        self.assertEqual(offer.outbound.stopovers, 0)

    def test_parse_filters_wrong_route(self):
        """Offers that don't match the requested O&D should be dropped."""
        req = _make_req(origin="MAA", destination="BOM")
        offers = _parse_response(ALLIANCEAIR_PAYLOAD, req)
        self.assertEqual(len(offers), 0)

    def test_parse_rejects_zero_price(self):
        payload = {
            "departure_schedule": [
                {
                    "connecting_flight_routes": [
                        {
                            "origin": {"code": "BLR", "city": "Bengaluru"},
                            "destination": {"code": "DEL", "city": "Delhi"},
                            "departure_date": {"year": 2026, "month": 6, "day": 15, "hour": 8, "minute": 0},
                            "arrival_date": {"year": 2026, "month": 6, "day": 15, "hour": 10, "minute": 30},
                            "flight_number": "9I501",
                        }
                    ],
                    "fare_info": {"total_search_fare": {"amount": 0, "ccy": "INR"}},
                }
            ]
        }
        req = _make_req()
        offers = _parse_response(payload, req)
        self.assertEqual(len(offers), 0)

    def test_extract_schedule_payload_from_dict(self):
        result = _extract_schedule_payload(ALLIANCEAIR_PAYLOAD)
        self.assertIn("departure_schedule", result)

    def test_parse_paxlinks_datetime_dict(self):
        dt = _parse_paxlinks_datetime({"year": 2026, "month": 6, "day": 15, "hour": 10, "minute": 30})
        self.assertEqual(dt, datetime(2026, 6, 15, 10, 30))

    def test_parse_paxlinks_datetime_str(self):
        dt = _parse_paxlinks_datetime("2026-06-15 10:30:00")
        self.assertEqual(dt, datetime(2026, 6, 15, 10, 30))

    def test_offer_id_is_unique_per_flight(self):
        payload_two = {
            "departure_schedule": [
                ALLIANCEAIR_PAYLOAD["departure_schedule"][0],
                {
                    "connecting_flight_routes": [
                        {
                            "origin": {"code": "BLR", "city": "Bengaluru"},
                            "destination": {"code": "DEL", "city": "Delhi"},
                            "departure_date": {"year": 2026, "month": 6, "day": 15, "hour": 14, "minute": 0},
                            "arrival_date": {"year": 2026, "month": 6, "day": 15, "hour": 16, "minute": 30},
                            "flight_number": "9I503",
                        }
                    ],
                    "fare_info": {"total_search_fare": {"amount": 4200.0, "ccy": "INR"}},
                },
            ]
        }
        req = _make_req()
        offers = _parse_response(payload_two, req)
        ids = [o.id for o in offers]
        self.assertEqual(len(ids), len(set(ids)))


# ─── Star Air ─────────────────────────────────────────────────────────────

class StarAirParserTest(unittest.TestCase):
    def test_parse_duration(self):
        self.assertEqual(_parse_duration("2h 30m"), 9000)
        self.assertEqual(_parse_duration("1h 5m"), 3900)
        self.assertEqual(_parse_duration(""), 0)

    def test_parse_fare_economy(self):
        result = _parse_fare("INR 3,500 Economy Available Last 3 Seats")
        self.assertIsNotNone(result)
        cabin, price, currency, seats = result
        self.assertEqual(cabin, "economy")
        self.assertEqual(price, 3500.0)
        self.assertEqual(currency, "INR")
        self.assertEqual(seats, 3)

    def test_parse_fare_zero_price(self):
        result = _parse_fare("INR 0 Economy")
        self.assertIsNone(result)

    def test_parse_fare_business(self):
        result = _parse_fare("INR 12000 BUSINESS CLASS Available")
        self.assertIsNotNone(result)
        cabin, price, currency, seats = result
        self.assertEqual(cabin, "business")
        self.assertEqual(price, 12000.0)

    def test_parse_datetime_with_am_pm(self):
        dt = _starair_parse_datetime("15 Jun 2026", "08:00 AM")
        self.assertEqual(dt.hour, 8)

    def test_parse_datetime_pm(self):
        dt = _starair_parse_datetime("15 Jun 2026", "02:30 PM")
        self.assertEqual(dt.hour, 14)
        self.assertEqual(dt.minute, 30)

    def test_client_has_search_method(self):
        client = StarAirConnectorClient()
        self.assertTrue(callable(client.search_flights))


# ─── Source key consistency ───────────────────────────────────────────────

class IndiaDirectSourceKeyTest(unittest.TestCase):
    def test_allianceair_source_key(self):
        from letsfg.connectors.allianceair import SOURCE_KEY
        self.assertEqual(SOURCE_KEY, "allianceair_direct")

    def test_starair_source_key(self):
        from letsfg.connectors.starair import SOURCE_KEY
        self.assertEqual(SOURCE_KEY, "starair_direct")

    def test_allianceair_registered_in_engine(self):
        from letsfg.connectors.engine import _DIRECT_AIRLINE_connectorS
        sources = [s for s, _, _ in _DIRECT_AIRLINE_connectorS]
        self.assertIn("allianceair_direct", sources)

    def test_starair_registered_in_engine(self):
        from letsfg.connectors.engine import _DIRECT_AIRLINE_connectorS
        sources = [s for s, _, _ in _DIRECT_AIRLINE_connectorS]
        self.assertIn("starair_direct", sources)

    def test_allianceair_in_fast_mode(self):
        from letsfg.connectors.engine import _FAST_MODE_SOURCES
        self.assertIn("allianceair_direct", _FAST_MODE_SOURCES)

    def test_starair_in_fast_mode(self):
        from letsfg.connectors.engine import _FAST_MODE_SOURCES
        self.assertIn("starair_direct", _FAST_MODE_SOURCES)

    def test_allianceair_economy_only(self):
        from letsfg.connectors.engine import _ECONOMY_ONLY_SOURCES
        self.assertIn("allianceair_direct", _ECONOMY_ONLY_SOURCES)

    def test_starair_economy_only(self):
        from letsfg.connectors.engine import _ECONOMY_ONLY_SOURCES
        self.assertIn("starair_direct", _ECONOMY_ONLY_SOURCES)

    def test_spicejet_source_key_is_canonical(self):
        """SpiceJet source key must be spicejet_direct everywhere (not spicejet_direct_api)."""
        from letsfg.connectors.engine import _DIRECT_AIRLINE_connectorS
        for source, _, _ in _DIRECT_AIRLINE_connectorS:
            self.assertNotEqual(source, "spicejet_direct_api",
                                "spicejet_direct_api must be removed from engine registrations")


if __name__ == "__main__":
    unittest.main()
