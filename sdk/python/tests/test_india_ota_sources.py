"""
Tests for India OTA connectors: EaseMyTrip.

Validates parsing of the AirBus_New JSON format and checks that the EaseMyTrip
connector is properly registered and configured.
"""

import sys
import unittest
from datetime import date
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[3]
SDK_PYTHON_ROOT = PROJECT_ROOT / "sdk" / "python"
if str(SDK_PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(SDK_PYTHON_ROOT))

from letsfg.connectors.easemytrip import (
    EasemytripConnectorClient,
    _parse_response,
    _parse_duration_to_seconds,
    _parse_segment_datetime,
    _build_payload,
    SOURCE_KEY,
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


# Minimal representative EaseMyTrip AirBus_New response shape
EASEMYTRIP_RESPONSE = {
    "CC": "INR",
    "C": {"6E": "IndiGo", "UK": "Vistara"},
    "dctFltDtl": {
        "FLT001": {
            "OG": "BLR", "DT": "DEL",
            "AC": "6E", "FN": "234",
            "DDT": "Mon-15Jun2026", "DTM": "08:00",
            "ADT": "Mon-15Jun2026", "ATM": "10:15",
            "DUR": "02h 15m",
            "CB": "economy",
            "ET": "A320",
        }
    },
    "j": [
        {
            "s": [
                {
                    "TF": 3200.0,
                    "SK": "EMT001",
                    "Refundable": False,
                    "b": [
                        {
                            "FL": ["FLT001"],
                            "JyTm": "02h 15m",
                            "stp": 0,
                        }
                    ],
                }
            ]
        }
    ],
}


class EasemytripParserTest(unittest.TestCase):
    def test_parse_valid_response(self):
        req = _make_req()
        offers = _parse_response(EASEMYTRIP_RESPONSE, req)
        self.assertEqual(len(offers), 1)
        offer = offers[0]
        self.assertEqual(offer.price, 3200.0)
        self.assertEqual(offer.currency, "INR")
        self.assertEqual(offer.outbound.stopovers, 0)
        self.assertGreater(offer.outbound.total_duration_seconds, 0)

    def test_parse_wrong_route_rejected(self):
        req = _make_req(origin="MAA", destination="BOM")
        offers = _parse_response(EASEMYTRIP_RESPONSE, req)
        self.assertEqual(len(offers), 0)

    def test_parse_zero_price_rejected(self):
        data = {
            "CC": "INR",
            "C": {},
            "dctFltDtl": {"FLT001": {"OG": "BLR", "DT": "DEL", "AC": "6E", "FN": "234",
                                      "DDT": "Mon-15Jun2026", "DTM": "08:00",
                                      "ADT": "Mon-15Jun2026", "ATM": "10:15", "DUR": "02h 15m"}},
            "j": [{"s": [{"TF": 0, "b": [{"FL": ["FLT001"], "JyTm": "02h 15m", "stp": 0}]}]}],
        }
        req = _make_req()
        offers = _parse_response(data, req)
        self.assertEqual(len(offers), 0)

    def test_parse_empty_response(self):
        req = _make_req()
        self.assertEqual(_parse_response({}, req), [])
        self.assertEqual(_parse_response(None, req), [])

    def test_duration_parsing_hm_format(self):
        self.assertEqual(_parse_duration_to_seconds("02h 05m"), (2 * 60 + 5) * 60)
        self.assertEqual(_parse_duration_to_seconds("1h 30m"), 5400)
        self.assertEqual(_parse_duration_to_seconds("0h 45m"), 2700)

    def test_duration_parsing_minutes_int(self):
        self.assertEqual(_parse_duration_to_seconds(90), 5400)
        self.assertEqual(_parse_duration_to_seconds(135), 8100)

    def test_duration_parsing_empty(self):
        self.assertEqual(_parse_duration_to_seconds(""), 0)
        self.assertEqual(_parse_duration_to_seconds(None), 0)

    def test_segment_datetime_easemytrip_format(self):
        dt = _parse_segment_datetime("Mon-15Jun2026", "17:35", date(2026, 6, 15))
        self.assertEqual(dt.hour, 17)
        self.assertEqual(dt.minute, 35)

    def test_segment_datetime_fallback(self):
        """When date parse fails, falls back to the fallback date with time."""
        dt = _parse_segment_datetime("", "10:00", date(2026, 6, 15))
        self.assertEqual(dt.date(), date(2026, 6, 15))

    def test_build_payload_domestic_flag(self):
        req_domestic = _make_req(origin="BLR", destination="DEL")
        payload = _build_payload(req_domestic)
        self.assertTrue(payload["isDomestic"])

    def test_build_payload_international_flag(self):
        req_intl = _make_req(origin="DEL", destination="DXB")
        payload = _build_payload(req_intl)
        self.assertFalse(payload["isDomestic"])

    def test_source_key_is_ota(self):
        self.assertEqual(SOURCE_KEY, "easemytrip_ota")

    def test_registered_in_engine(self):
        from letsfg.connectors.engine import _DIRECT_AIRLINE_connectorS as _DIRECT_AIRLINE_CONNECTORS
        sources = [s for s, _, _ in _DIRECT_AIRLINE_CONNECTORS]
        self.assertIn("easemytrip_ota", sources)

    def test_in_fast_mode(self):
        from letsfg.connectors.engine import _FAST_MODE_SOURCES
        self.assertIn("easemytrip_ota", _FAST_MODE_SOURCES)

    def test_client_is_importable(self):
        client = EasemytripConnectorClient()
        self.assertTrue(callable(client.search_flights))


if __name__ == "__main__":
    unittest.main()
