"""Tests for public offer masking — PublicFlightOffer hides booking URLs and airline identity."""
from __future__ import annotations

import unittest
from datetime import datetime, timedelta

from letsfg.models.flights import (
    FlightOffer,
    FlightRoute,
    FlightSegment,
    PublicFlightOffer,
    get_airline_category,
    to_public_offer,
)

_NOW = datetime(2026, 7, 1, 8, 0)
_ARR = _NOW + timedelta(hours=2, minutes=30)


def _seg(airline: str = "FR") -> FlightSegment:
    return FlightSegment(
        airline=airline,
        airline_name="Test Airline",
        flight_no=f"{airline}1234",
        origin="KRK",
        destination="BCN",
        departure=_NOW,
        arrival=_ARR,
        duration_seconds=9000,
    )


def _offer(**kwargs) -> FlightOffer:
    airline = kwargs.pop("airline", "FR")
    route = FlightRoute(segments=[_seg(airline)])
    defaults: dict = dict(
        id="offer_123",
        price=89.99,
        currency="EUR",
        price_formatted="EUR 89.99",
        outbound=route,
        airlines=["FR"],
        owner_airline="FR",
        source="ryanair",
        source_tier="protocol",
        booking_url="https://www.ryanair.com/book?token=abc",
        conditions={
            "fare_family": "BASIC",
            "change_allowed": "false",
            "outbound_booking_url": "https://www.ryanair.com/book/out",
        },
        is_locked=False,
    )
    defaults.update(kwargs)
    return FlightOffer(**defaults)


class AirlineCategoryTest(unittest.TestCase):
    def test_lcc_returns_low_cost_carrier(self):
        self.assertEqual(get_airline_category("FR"), "Low-cost carrier")
        self.assertEqual(get_airline_category("W6"), "Low-cost carrier")
        self.assertEqual(get_airline_category("U2"), "Low-cost carrier")

    def test_fsc_returns_full_service_carrier(self):
        self.assertEqual(get_airline_category("BA"), "Full-service carrier")
        self.assertEqual(get_airline_category("LH"), "Full-service carrier")
        self.assertEqual(get_airline_category("EK"), "Full-service carrier")

    def test_unknown_code_returns_airline(self):
        self.assertEqual(get_airline_category("XX"), "Airline")
        self.assertEqual(get_airline_category("ZZ"), "Airline")

    def test_case_insensitive(self):
        self.assertEqual(get_airline_category("fr"), "Low-cost carrier")
        self.assertEqual(get_airline_category("ba"), "Full-service carrier")


class PublicOfferMaskingTest(unittest.TestCase):
    def test_booking_url_absent(self):
        pub = to_public_offer(_offer())
        self.assertFalse(hasattr(pub, "booking_url"))

    def test_source_absent(self):
        pub = to_public_offer(_offer())
        self.assertFalse(hasattr(pub, "source"))

    def test_source_tier_absent(self):
        pub = to_public_offer(_offer())
        self.assertFalse(hasattr(pub, "source_tier"))

    def test_is_locked_forced_true(self):
        pub = to_public_offer(_offer(is_locked=False))
        self.assertTrue(pub.is_locked)

    def test_owner_airline_is_category(self):
        pub = to_public_offer(_offer(owner_airline="FR"))
        self.assertEqual(pub.owner_airline, "Low-cost carrier")

    def test_owner_airline_fsc(self):
        pub = to_public_offer(_offer(owner_airline="BA"))
        self.assertEqual(pub.owner_airline, "Full-service carrier")

    def test_owner_airline_unknown(self):
        pub = to_public_offer(_offer(owner_airline="ZZ"))
        self.assertEqual(pub.owner_airline, "Airline")

    def test_airlines_list_has_categories_not_codes(self):
        pub = to_public_offer(_offer(airlines=["FR", "LH"]))
        self.assertIn("Low-cost carrier", pub.airlines)
        self.assertIn("Full-service carrier", pub.airlines)
        self.assertNotIn("FR", pub.airlines)
        self.assertNotIn("LH", pub.airlines)

    def test_airlines_list_deduplicates_categories(self):
        pub = to_public_offer(_offer(airlines=["FR", "W6", "W9"]))
        self.assertEqual(pub.airlines, ["Low-cost carrier"])

    def test_conditions_url_keys_stripped(self):
        pub = to_public_offer(_offer())
        self.assertNotIn("outbound_booking_url", pub.conditions)
        self.assertIn("fare_family", pub.conditions)
        self.assertIn("change_allowed", pub.conditions)

    def test_conditions_inbound_url_stripped(self):
        offer = _offer(conditions={
            "fare_family": "FLEX",
            "inbound_booking_url": "https://example.com/in",
        })
        pub = to_public_offer(offer)
        self.assertNotIn("inbound_booking_url", pub.conditions)
        self.assertIn("fare_family", pub.conditions)

    def test_price_preserved(self):
        pub = to_public_offer(_offer())
        self.assertAlmostEqual(pub.price, 89.99)
        self.assertEqual(pub.currency, "EUR")
        self.assertEqual(pub.price_formatted, "EUR 89.99")

    def test_offer_id_preserved(self):
        pub = to_public_offer(_offer())
        self.assertEqual(pub.id, "offer_123")

    def test_route_airports_preserved(self):
        pub = to_public_offer(_offer())
        segs = pub.outbound.segments
        self.assertEqual(len(segs), 1)
        self.assertEqual(segs[0].origin, "KRK")
        self.assertEqual(segs[0].destination, "BCN")

    def test_segment_airline_name_is_category_lcc(self):
        pub = to_public_offer(_offer(airline="FR"))
        seg = pub.outbound.segments[0]
        self.assertEqual(seg.airline_name, "Low-cost carrier")

    def test_segment_airline_name_is_category_fsc(self):
        pub = to_public_offer(_offer(airline="BA"))
        seg = pub.outbound.segments[0]
        self.assertEqual(seg.airline_name, "Full-service carrier")

    def test_segment_flight_number_redacted(self):
        pub = to_public_offer(_offer())
        self.assertEqual(pub.outbound.segments[0].flight_no, "")

    def test_return_type_is_public_flight_offer(self):
        pub = to_public_offer(_offer())
        self.assertIsInstance(pub, PublicFlightOffer)


class ComboOwnerAirlineTest(unittest.TestCase):
    """Pipe-separated IATA codes (virtual-interlining combos) must be masked too."""

    def test_pipe_same_category(self):
        pub = to_public_offer(_offer(owner_airline="FR|W6"))
        self.assertNotIn("FR", pub.owner_airline)
        self.assertNotIn("W6", pub.owner_airline)
        self.assertNotIn("|", pub.owner_airline)
        self.assertEqual(pub.owner_airline, "Low-cost carrier")

    def test_pipe_mixed_categories(self):
        pub = to_public_offer(_offer(owner_airline="FR|BA"))
        self.assertNotIn("FR", pub.owner_airline)
        self.assertNotIn("BA", pub.owner_airline)
        self.assertIn("Low-cost carrier", pub.owner_airline)
        self.assertIn("Full-service carrier", pub.owner_airline)

    def test_single_code_unchanged(self):
        pub = to_public_offer(_offer(owner_airline="BA"))
        self.assertEqual(pub.owner_airline, "Full-service carrier")


class ConditionsSourceStripTest(unittest.TestCase):
    """Keys ending with _source reveal connector identity and must be stripped."""

    def test_outbound_source_stripped(self):
        offer = _offer(conditions={"fare_family": "BASIC", "outbound_source": "ryanair"})
        pub = to_public_offer(offer)
        self.assertNotIn("outbound_source", pub.conditions)
        self.assertIn("fare_family", pub.conditions)

    def test_inbound_source_stripped(self):
        offer = _offer(conditions={"inbound_source": "wizzair"})
        pub = to_public_offer(offer)
        self.assertNotIn("inbound_source", pub.conditions)

    def test_generic_source_key_stripped(self):
        offer = _offer(conditions={"some_source": "connector_x"})
        pub = to_public_offer(offer)
        self.assertNotIn("some_source", pub.conditions)

    def test_non_source_key_kept(self):
        offer = _offer(conditions={"discount_source_note": "promo"})
        # "discount_source_note" ends with "note", not "_source" suffix — kept
        pub = to_public_offer(offer)
        self.assertIn("discount_source_note", pub.conditions)


class UnlockUrlTest(unittest.TestCase):
    """PublicFlightOffer must expose a default unlock URL so users can pay."""

    def test_unlock_url_field_present(self):
        pub = to_public_offer(_offer())
        self.assertTrue(hasattr(pub, "unlock_url"))

    def test_unlock_url_contains_offer_id(self):
        pub = to_public_offer(_offer(id="offer_xyz"))
        self.assertIn("offer_xyz", pub.unlock_url)

    def test_unlock_url_is_letsfg_domain(self):
        pub = to_public_offer(_offer(id="offer_abc"))
        self.assertIn("letsfg.co/book/", pub.unlock_url)
        self.assertTrue(pub.unlock_url.startswith("https://"))


if __name__ == "__main__":
    unittest.main()
