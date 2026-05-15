import sys
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo

PROJECT_ROOT = Path(__file__).resolve().parents[3]
SDK_PYTHON_ROOT = PROJECT_ROOT / "sdk" / "python"
if str(SDK_PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(SDK_PYTHON_ROOT))

from letsfg.models.flights import FlightRoute, FlightSegment


class FlightDurationBackfillTest(unittest.TestCase):
    @staticmethod
    def _airport_tz(iata: str):
        return {
            "LHR": ZoneInfo("Europe/London"),
            "BCN": ZoneInfo("Europe/Madrid"),
        }.get(iata)

    @patch("letsfg.connectors.airport_tz.get_airport_tz")
    def test_zero_durations_are_backfilled_from_airport_local_times(self, mock_get_airport_tz):
        mock_get_airport_tz.side_effect = self._airport_tz

        segment = FlightSegment(
            airline="VY",
            airline_name="Vueling",
            flight_no="VY7816",
            origin="LHR",
            destination="BCN",
            departure=datetime(2026, 5, 22, 17, 15),
            arrival=datetime(2026, 5, 22, 20, 35),
            duration_seconds=0,
            cabin_class="economy",
        )
        route = FlightRoute(segments=[segment], total_duration_seconds=0, stopovers=0)

        self.assertEqual(segment.duration_seconds, 8400)
        self.assertEqual(route.total_duration_seconds, 8400)

    @patch("letsfg.connectors.airport_tz.get_airport_tz")
    def test_raw_subtraction_durations_are_corrected_for_cross_timezone_routes(self, mock_get_airport_tz):
        mock_get_airport_tz.side_effect = self._airport_tz

        raw_diff_seconds = (20 - 17) * 3600 + (35 - 15) * 60
        segment = FlightSegment(
            airline="VY",
            airline_name="Vueling",
            flight_no="VY7816",
            origin="LHR",
            destination="BCN",
            departure=datetime(2026, 5, 22, 17, 15),
            arrival=datetime(2026, 5, 22, 20, 35),
            duration_seconds=raw_diff_seconds,
            cabin_class="economy",
        )
        route = FlightRoute(segments=[segment], total_duration_seconds=raw_diff_seconds, stopovers=0)

        self.assertEqual(segment.duration_seconds, 8400)
        self.assertEqual(route.total_duration_seconds, 8400)

    @patch("letsfg.connectors.airport_tz.get_airport_tz")
    def test_aware_timestamps_are_converted_to_airport_local_clocks(self, mock_get_airport_tz):
        mock_get_airport_tz.side_effect = self._airport_tz

        segment = FlightSegment(
            airline="VY",
            airline_name="Vueling",
            flight_no="VY7816",
            origin="LHR",
            destination="BCN",
            departure=datetime.fromisoformat("2026-05-22T16:15:00+00:00"),
            arrival=datetime.fromisoformat("2026-05-22T18:35:00+00:00"),
            duration_seconds=0,
            cabin_class="economy",
        )
        route = FlightRoute(segments=[segment], total_duration_seconds=0, stopovers=0)

        self.assertIsNone(segment.departure.tzinfo)
        self.assertIsNone(segment.arrival.tzinfo)
        self.assertEqual(segment.departure.isoformat(), "2026-05-22T17:15:00")
        self.assertEqual(segment.arrival.isoformat(), "2026-05-22T20:35:00")
        self.assertEqual(segment.duration_seconds, 8400)
        self.assertEqual(route.total_duration_seconds, 8400)


if __name__ == "__main__":
    unittest.main()