"""
Tier-1 connector parsing tests.

These tests are fully offline — no network, no browser.
Each test loads a captured JSON fixture, calls the connector's parse method
directly, and asserts FlightOffer / FlightRoute shape and invariants.

Fixture files live under tests/fixtures/<connector>/. Update them when the
upstream API response schema changes.

Fast-mode connectors covered here:
  ryanair_direct  → RyanairConnectorClient._parse_farfnd_leg
  kiwi_connector  → KiwiConnectorClient._parse_sector / _parse_itinerary
  finnair_direct  → FinnairConnectorClient._parse

Already covered elsewhere (not duplicated):
  skyscanner_meta  → tests/test_skyscanner_connector.py
  wizzair_direct   → tests/test_wizzair_connector.py
  emirates_direct  → tests/test_emirates_connector.py
  vueling_direct   → tests/test_vueling_connector.py
  momondo_meta     → tests/test_booking_holdings_booking_urls.py

Connectors with parse logic inlined in async network methods (no extractable
parse function) and therefore not unit-testable here:
  turkish_direct, norwegian_direct, easyjet_direct — covered by Tier-2 smoke.
"""

import json
import sys
import unittest
from datetime import date, timedelta
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
SDK_PYTHON_ROOT = PROJECT_ROOT / "sdk" / "python"
FIXTURES = Path(__file__).parent / "fixtures"
if str(SDK_PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(SDK_PYTHON_ROOT))

from letsfg.connectors.finnair import FinnairConnectorClient
from letsfg.connectors.kiwi import KiwiConnectorClient
from letsfg.connectors.ryanair import RyanairConnectorClient
from letsfg.models.flights import FlightOffer, FlightRoute, FlightSearchRequest


def _req(origin: str = "DUB", destination: str = "STN") -> FlightSearchRequest:
    return FlightSearchRequest(
        origin=origin,
        destination=destination,
        date_from=date.today() + timedelta(days=30),
        currency="EUR",
    )


# ── Ryanair ──────────────────────────────────────────────────────────────────

class RyanairConnectorParsingTest(unittest.TestCase):
    def setUp(self) -> None:
        self.connector = RyanairConnectorClient()
        with open(FIXTURES / "ryanair" / "ow_fares.json") as f:
            self.ow_fares: dict = json.load(f)

    def _first_leg(self) -> dict:
        return self.ow_fares["fares"][0]["outbound"]

    def test_parse_farfnd_leg_returns_flight_route(self) -> None:
        result = self.connector._parse_farfnd_leg(self._first_leg())
        self.assertIsInstance(result, FlightRoute)

    def test_parse_farfnd_leg_segment_iata_codes(self) -> None:
        route = self.connector._parse_farfnd_leg(self._first_leg())
        seg = route.segments[0]
        self.assertEqual(seg.origin, "DUB")
        self.assertEqual(seg.destination, "STN")
        self.assertEqual(seg.flight_no, "FR1234")
        self.assertEqual(seg.airline, "FR")

    def test_parse_farfnd_leg_duration_positive(self) -> None:
        route = self.connector._parse_farfnd_leg(self._first_leg())
        self.assertGreater(route.total_duration_seconds, 0)

    def test_parse_farfnd_leg_missing_dates_returns_none(self) -> None:
        leg = {
            "departureAirport": {"iataCode": "DUB"},
            "arrivalAirport": {"iataCode": "STN"},
            "departureDate": "",
            "arrivalDate": "",
            "flightNumber": "FR9999",
        }
        self.assertIsNone(self.connector._parse_farfnd_leg(leg))

    def test_all_fixture_legs_parse_to_valid_routes(self) -> None:
        for fare in self.ow_fares["fares"]:
            route = self.connector._parse_farfnd_leg(fare["outbound"])
            self.assertIsNotNone(route)
            self.assertGreater(len(route.segments), 0)


# ── Kiwi ─────────────────────────────────────────────────────────────────────

class KiwiConnectorParsingTest(unittest.TestCase):
    def setUp(self) -> None:
        self.connector = KiwiConnectorClient()
        with open(FIXTURES / "kiwi" / "ow_itinerary.json") as f:
            self.itin: dict = json.load(f)
        self.req = _req("DUB", "STN")

    def test_parse_sector_returns_flight_route(self) -> None:
        result = self.connector._parse_sector(self.itin["sector"], self.req)
        self.assertIsInstance(result, FlightRoute)

    def test_parse_sector_segment_iata_codes(self) -> None:
        route = self.connector._parse_sector(self.itin["sector"], self.req)
        seg = route.segments[0]
        self.assertEqual(seg.origin, "DUB")
        self.assertEqual(seg.destination, "STN")
        self.assertEqual(seg.airline, "FR")
        self.assertEqual(seg.flight_no, "FR1234")

    def test_parse_sector_duration_non_negative(self) -> None:
        route = self.connector._parse_sector(self.itin["sector"], self.req)
        self.assertGreaterEqual(route.total_duration_seconds, 0)

    def test_parse_sector_empty_returns_none(self) -> None:
        self.assertIsNone(self.connector._parse_sector({}, self.req))

    def test_parse_itinerary_returns_offer(self) -> None:
        result = self.connector._parse_itinerary(self.itin, self.req, is_return=False)
        self.assertIsInstance(result, FlightOffer)

    def test_parse_itinerary_price_positive(self) -> None:
        offer = self.connector._parse_itinerary(self.itin, self.req, is_return=False)
        self.assertGreater(offer.price, 0)
        self.assertEqual(offer.currency, "EUR")

    def test_parse_itinerary_source_tag(self) -> None:
        offer = self.connector._parse_itinerary(self.itin, self.req, is_return=False)
        self.assertEqual(offer.source, "kiwi_connector")

    def test_parse_itinerary_outbound_present(self) -> None:
        offer = self.connector._parse_itinerary(self.itin, self.req, is_return=False)
        self.assertIsNotNone(offer.outbound)
        self.assertGreater(len(offer.outbound.segments), 0)

    def test_parse_itinerary_zero_price_returns_none(self) -> None:
        bad = dict(self.itin, price={"amount": 0})
        self.assertIsNone(self.connector._parse_itinerary(bad, self.req, is_return=False))

    def test_parse_itinerary_negative_price_returns_none(self) -> None:
        bad = dict(self.itin, price={"amount": -5.0})
        self.assertIsNone(self.connector._parse_itinerary(bad, self.req, is_return=False))


# ── Finnair ───────────────────────────────────────────────────────────────────

class FinnairConnectorParsingTest(unittest.TestCase):
    def setUp(self) -> None:
        self.connector = FinnairConnectorClient()
        with open(FIXTURES / "finnair" / "instantsearch.json") as f:
            self.data: dict = json.load(f)
        self.req = _req("HEL", "LHR")

    def test_parse_returns_offers(self) -> None:
        offers = self.connector._parse(self.data, self.req)
        self.assertIsInstance(offers, list)
        self.assertGreater(len(offers), 0)

    def test_parse_prices_all_positive(self) -> None:
        for offer in self.connector._parse(self.data, self.req):
            self.assertGreater(offer.price, 0)

    def test_parse_currency_matches_fixture(self) -> None:
        for offer in self.connector._parse(self.data, self.req):
            self.assertEqual(offer.currency, "EUR")

    def test_parse_source_tag(self) -> None:
        for offer in self.connector._parse(self.data, self.req):
            self.assertEqual(offer.source, "finnair_direct")

    def test_parse_skips_zero_price_entries(self) -> None:
        offers = self.connector._parse(self.data, self.req)
        self.assertNotIn(0.0, [o.price for o in offers])

    def test_parse_offer_has_outbound_segment(self) -> None:
        for offer in self.connector._parse(self.data, self.req):
            self.assertIsNotNone(offer.outbound)
            self.assertGreater(len(offer.outbound.segments), 0)

    def test_parse_empty_data_returns_empty_list(self) -> None:
        self.assertEqual([], self.connector._parse({}, self.req))

    def test_parse_destination_mismatch_returns_empty_list(self) -> None:
        req_mismatch = _req("HEL", "JFK")
        self.assertEqual([], self.connector._parse(self.data, req_mismatch))


if __name__ == "__main__":
    unittest.main()
