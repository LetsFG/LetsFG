"""
Tests for Emirates connector duration fix.

Verifies that the zero-duration inbound bug is fixed and that offers with
midnight/midnight times (genuinely unknown) are discarded, not emitted with
corrupt durations.
"""

import sys
import unittest
from datetime import date
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[3]
SDK_PYTHON_ROOT = PROJECT_ROOT / "sdk" / "python"
if str(SDK_PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(SDK_PYTHON_ROOT))

from letsfg.connectors.emirates import EmiratesConnectorClient
from letsfg.models.flights import FlightSearchRequest


def _make_req(**kwargs):
    defaults = dict(
        origin="DXB", destination="LHR",
        date_from=date(2026, 6, 15),
        adults=1, children=0, infants=0,
        cabin_class="M", currency="AED",
    )
    defaults.update(kwargs)
    return FlightSearchRequest(**defaults)


class EmiratesDurationFixTest(unittest.TestCase):
    def setUp(self):
        self.client = EmiratesConnectorClient.__new__(EmiratesConnectorClient)

    def _call_parse(self, flight_dict, req):
        return self.client._build_offer(flight_dict, req)

    def test_offer_with_valid_duration_is_kept(self):
        req = _make_req()
        flight = {
            "flightNo": "EK001",
            "origin": "DXB", "destination": "LHR",
            "depTime": "08:00", "arrTime": "12:30",
            "duration": 270,
            "price": 500, "currency": "AED",
            "cabin": "economy", "stops": 0,
        }
        offer = self._call_parse(flight, req)
        self.assertIsNotNone(offer)
        self.assertGreater(offer.outbound.total_duration_seconds, 0)

    def test_offer_with_midnight_midnight_times_is_discarded(self):
        """Both depTime and arrTime are 00:00 — genuinely missing data, discard."""
        req = _make_req()
        flight = {
            "flightNo": "EK999",
            "origin": "DXB", "destination": "LHR",
            "depTime": "00:00", "arrTime": "00:00",
            "duration": 0,
            "price": 450, "currency": "AED",
            "cabin": "economy", "stops": 0,
        }
        offer = self._call_parse(flight, req)
        self.assertIsNone(offer)

    def test_overnight_flight_gets_correct_duration(self):
        """A genuine overnight flight should add a day, not be discarded."""
        req = _make_req()
        flight = {
            "flightNo": "EK002",
            "origin": "DXB", "destination": "LHR",
            "depTime": "23:00", "arrTime": "06:30",
            "duration": 450,
            "price": 600, "currency": "AED",
            "cabin": "economy", "stops": 0,
        }
        offer = self._call_parse(flight, req)
        self.assertIsNotNone(offer)
        self.assertGreater(offer.outbound.total_duration_seconds, 0)
        # Arrival (06:30 next day) - departure (23:00) ≈ 7h30m = 27000s
        self.assertGreater(offer.outbound.segments[0].duration_seconds, 20000)

    def test_inbound_segment_gets_nonzero_duration(self):
        """Round-trip inbound segment must not have duration_seconds=0."""
        req = _make_req(return_from=date(2026, 6, 22))
        flight = {
            "flightNo": "EK003",
            "origin": "DXB", "destination": "LHR",
            "depTime": "08:00", "arrTime": "12:30",
            "duration": 270,
            "price": 800, "currency": "AED",
            "cabin": "economy", "stops": 0,
            "inbound_origin": "LHR", "inbound_destination": "DXB",
            "inbound_depTime": "14:00", "inbound_arrTime": "00:30",
            "inbound_flightNo": "EK004",
        }
        offer = self._call_parse(flight, req)
        self.assertIsNotNone(offer)
        self.assertIsNotNone(offer.inbound)
        self.assertGreater(offer.inbound.total_duration_seconds, 0)
        self.assertGreater(offer.inbound.segments[0].duration_seconds, 0)


if __name__ == "__main__":
    unittest.main()
