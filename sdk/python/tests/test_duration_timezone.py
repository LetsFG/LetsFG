"""Durations must be timezone-aware, include layovers, and actually be reachable.

Origin: a user report on 2026-08-26 — "same flight west-to-east calculates 18h,
east-to-west is 7h". Flight timestamps are AIRPORT-LOCAL wall clocks, so
subtracting two of them yields the flight time plus the UTC offset eastbound and
minus it westbound.

The server-side fix shipped in flight-search-worker, whose repo carries a local
`letsfg/` overlay of this module. This package had two separate reasons the same
repair never worked here:

  1. `letsfg/connectors/airport_tz.py` was never committed. It existed in a
     published wheel but not in git, so `models/flights.py` imported a module
     that a clean checkout does not contain, the ImportError was swallowed, and
     every duration silently fell back to the connector's own value. The first
     test below is the one that catches that specific shape — it asserts the
     module IMPORTS, because a `try/except ImportError` around a missing file is
     indistinguishable from a working one at the call site.
  2. The repair, when it did run, applied only where the connector had said 0 or
     had itself subtracted the two local clocks, so any other wrong value
     survived.

Fixtures are real offer shapes from production searches on 2026-08-26.
"""

import unittest
from datetime import datetime

from letsfg.models.flights import FlightRoute, FlightSegment


class AirportTzReachableTest(unittest.TestCase):
    """The module must ship, not merely be referenced."""

    def test_airport_tz_module_is_importable_from_the_installed_package(self):
        from letsfg.connectors.airport_tz import (
            duration_seconds_from_local_times,
            get_airport_tz,
            local_to_utc,
        )

        self.assertIsNotNone(get_airport_tz("JFK"), "airportsdata must resolve JFK")
        self.assertIsNotNone(local_to_utc(datetime(2026, 9, 16, 18, 20), "JFK"))
        self.assertEqual(
            duration_seconds_from_local_times(
                datetime(2026, 9, 16, 18, 20), datetime(2026, 9, 17, 6, 25), "JFK", "LHR"
            ),
            425 * 60,
        )


class SegmentDurationTimezoneTest(unittest.TestCase):
    def test_segment_with_no_connector_duration_is_computed_across_timezones(self):
        # momondo_meta SOF (UTC+3) -> BCN (UTC+2): clocks differ by 2h05m,
        # the flight is 3h05m.
        segment = FlightSegment(
            airline="W6", origin="SOF", destination="BCN",
            departure=datetime(2027, 4, 26, 18, 45),
            arrival=datetime(2027, 4, 26, 20, 50),
        )
        self.assertEqual(segment.duration_seconds, 185 * 60)

    def test_a_connector_duration_that_is_the_naive_difference_is_replaced(self):
        segment = FlightSegment(
            airline="W6", origin="SOF", destination="BCN",
            departure=datetime(2027, 4, 26, 18, 45),
            arrival=datetime(2027, 4, 26, 20, 50),
            duration_seconds=125 * 60,
        )
        self.assertEqual(segment.duration_seconds, 185 * 60)

    def test_the_reported_asymmetry_is_gone(self):
        # JFK <-> LHR, a 5-hour offset. Subtracting local clocks reads 12h05m
        # eastbound and 3h35m westbound for the same aircraft.
        eastbound = FlightSegment(
            airline="BA", origin="JFK", destination="LHR",
            departure=datetime(2026, 9, 16, 18, 20), arrival=datetime(2026, 9, 17, 6, 25),
        )
        westbound = FlightSegment(
            airline="BA", origin="LHR", destination="JFK",
            departure=datetime(2026, 9, 16, 11, 0), arrival=datetime(2026, 9, 16, 14, 35),
        )
        self.assertEqual(eastbound.duration_seconds, 425 * 60)   # 7h05m, not 12h05m
        self.assertEqual(westbound.duration_seconds, 515 * 60)   # 8h35m, not 3h35m
        ratio = westbound.duration_seconds / eastbound.duration_seconds
        self.assertTrue(0.8 < ratio < 1.25, f"directions should be comparable, got {ratio}")

    def test_an_unresolvable_airport_keeps_the_connector_value_rather_than_guessing(self):
        segment = FlightSegment(
            airline="XX", origin="ZZZZ", destination="QQQQ",
            departure=datetime(2027, 4, 26, 18, 45),
            arrival=datetime(2027, 4, 26, 20, 50),
            duration_seconds=125 * 60,
        )
        self.assertEqual(segment.duration_seconds, 125 * 60)


class RouteDurationLayoverTest(unittest.TestCase):
    """serpapi_google publishes the sum of flight times, dropping the layover."""

    def _bcn_beg_sof(self, total_minutes):
        return FlightRoute(
            segments=[
                FlightSegment(
                    airline="JU", origin="BCN", destination="BEG",
                    departure=datetime(2027, 4, 30, 9, 55),
                    arrival=datetime(2027, 4, 30, 12, 30),
                    duration_seconds=155 * 60,
                ),
                FlightSegment(
                    airline="JU", origin="BEG", destination="SOF",
                    departure=datetime(2027, 4, 30, 13, 15),
                    arrival=datetime(2027, 4, 30, 15, 30),
                    duration_seconds=75 * 60,
                ),
            ],
            total_duration_seconds=total_minutes * 60,
            stopovers=1,
        )

    def test_a_total_that_dropped_the_layover_is_corrected(self):
        # Published as 155 + 75 = 230, losing the 45-minute connection.
        self.assertEqual(self._bcn_beg_sof(230).total_duration_seconds, 275 * 60)

    def test_the_corrected_total_is_flight_time_plus_time_on_the_ground(self):
        route = self._bcn_beg_sof(0)
        flight_time = sum(s.duration_seconds for s in route.segments)
        self.assertEqual(route.total_duration_seconds, flight_time + 45 * 60)

    def test_the_invariant_downstream_consumers_rely_on(self):
        # segments + layovers == leg total, exactly. Both sides telescope to
        # last arrival minus first departure, which is what lets a consumer tell
        # a repaired leg from an unrepaired one without any timezone data.
        route = self._bcn_beg_sof(230)
        segs = route.segments
        total = sum(s.duration_seconds for s in segs)
        for prev, nxt in zip(segs, segs[1:]):
            total += int((nxt.departure - prev.arrival).total_seconds())
        self.assertEqual(total, route.total_duration_seconds)


if __name__ == "__main__":
    unittest.main()
