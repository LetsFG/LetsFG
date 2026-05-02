import json
import sys
import unittest
from datetime import date, timedelta
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[3]
SDK_PYTHON_ROOT = PROJECT_ROOT / "sdk" / "python"
WORKSPACE_ROOT = PROJECT_ROOT.parent
if str(SDK_PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(SDK_PYTHON_ROOT))

from letsfg.connectors.aircairo import AirCairoConnectorClient
from letsfg.connectors.airasia import AirAsiaConnectorClient
from letsfg.connectors.airasiax import AirAsiaXConnectorClient
from letsfg.connectors.aireuropa import AirEuropaConnectorClient
from letsfg.connectors.itaairways import ITAAirwaysConnectorClient
from letsfg.connectors.mea import MEAConnectorClient
from letsfg.connectors.volaris import VolarisConnectorClient
from letsfg.models.flights import FlightSearchRequest


def _future_date(days: int = 30) -> date:
    return date.today() + timedelta(days=days)


def _airasia_truth_flight(*, bundle_code: str | None = None, fare_type_category: str | None = None) -> dict:
    return {
        "bundleCode": bundle_code,
        "fareTypeCategory": fare_type_category,
        "flightDetails": {
            "baggage": {
                "complimentaryBaggage": [
                    {
                        "type": "cabin_bag",
                        "height": 36,
                        "width": 23,
                        "length": 56,
                        "weight": 7,
                        "count": 1,
                    }
                ],
                "checkedBaggageAllowed": True,
            }
        },
    }


class AncillaryConnectorParsingTest(unittest.TestCase):
    def test_volaris_parser_filters_to_requested_market(self) -> None:
        payload = {
            "currencyCode": "MXN",
            "results": [
                {
                    "trips": [
                        {
                            "journeysAvailableByMarket": {
                                "MEX|CUN": [
                                    {
                                        "segments": [
                                            {
                                                "departureStation": "MEX",
                                                "arrivalStation": "CUN",
                                                "departureDateTime": "2026-06-16T10:00:00",
                                                "arrivalDateTime": "2026-06-16T12:30:00",
                                                "flightNumber": "123",
                                            }
                                        ],
                                        "fares": [
                                            {
                                                "fareAvailabilityKey": "mexcun-fare",
                                                "details": [{"serviceBundleSetCode": "BCBF"}],
                                            }
                                        ],
                                    }
                                ],
                                "MXL|CUN": [
                                    {
                                        "segments": [
                                            {
                                                "departureStation": "MXL",
                                                "arrivalStation": "CUN",
                                                "departureDateTime": "2026-06-16T07:00:00",
                                                "arrivalDateTime": "2026-06-16T11:45:00",
                                                "flightNumber": "999",
                                            }
                                        ],
                                        "fares": [
                                            {
                                                "fareAvailabilityKey": "mxlcun-fare",
                                                "details": [{"serviceBundleSetCode": "BCPF"}],
                                            }
                                        ],
                                    }
                                ],
                            }
                        }
                    ]
                }
            ],
            "faresAvailable": {
                "mexcun-fare": {"totals": {"fareTotal": 1500}},
                "mxlcun-fare": {"totals": {"fareTotal": 900}},
            },
        }
        req = FlightSearchRequest(origin="MEX", destination="CUN", date_from=_future_date(46), adults=1, currency="MXN")

        client = VolarisConnectorClient()
        offers = client._parse_response(payload, req)

        self.assertEqual(len(offers), 1)
        offer = offers[0]
        self.assertEqual(offer.price, 1500.0)
        self.assertEqual(offer.outbound.segments[0].origin, "MEX")
        self.assertEqual(offer.outbound.segments[0].destination, "CUN")
        self.assertEqual(offer.conditions.get("fare_family"), "BCBF")

    def test_airasia_parser_keeps_checkout_only_checked_bag_truth(self) -> None:
        conditions, bags_price = AirAsiaConnectorClient._extract_airasia_offer_truth(
            _airasia_truth_flight(bundle_code="VALUE PACK", fare_type_category="promo")
        )

        self.assertEqual(conditions.get("fare_bundle"), "VALUE PACK")
        self.assertEqual(conditions.get("fare_type_category"), "promo")
        self.assertEqual(conditions.get("cabin_bag"), "included - 1 piece 7kg cabin bag 56x23x36cm")
        self.assertEqual(
            conditions.get("checked_bag"),
            "not included - purchasable in checkout; no numeric search price",
        )
        self.assertEqual(bags_price, {})

    def test_airasia_round_trip_merge_preserves_leg_specific_truth(self) -> None:
        merged = AirAsiaConnectorClient._merge_round_trip_conditions(
            {
                "fare_bundle": "VALUE PACK",
                "checked_bag": "not included - purchasable in checkout; no numeric search price",
            },
            {
                "fare_bundle": "PREMIUM FLEX",
                "checked_bag": "included - 1 piece 20kg checked bag",
            },
        )

        self.assertNotIn("fare_bundle", merged)
        self.assertEqual(merged.get("outbound_fare_bundle"), "VALUE PACK")
        self.assertEqual(merged.get("inbound_fare_bundle"), "PREMIUM FLEX")
        self.assertNotIn("checked_bag", merged)
        self.assertEqual(
            merged.get("outbound_checked_bag"),
            "not included - purchasable in checkout; no numeric search price",
        )
        self.assertEqual(merged.get("inbound_checked_bag"), "included - 1 piece 20kg checked bag")

    def test_airasiax_parser_reads_saved_baggage_truth_from_response(self) -> None:
        payload = json.loads((WORKSPACE_ROOT / "_airasiax_KUL-NRT_profile=d.json").read_text(encoding="utf-8"))
        req = FlightSearchRequest(origin="KUL", destination="NRT", date_from=_future_date(34), adults=1, currency="USD")

        client = AirAsiaXConnectorClient()
        offers = client._parse_response(payload, req)

        self.assertTrue(offers)
        offer = offers[0]
        self.assertEqual(offer.source, "airasiax_direct")
        self.assertEqual(offer.owner_airline, "D7")
        self.assertEqual(offer.conditions.get("cabin_bag"), "included - 7kg cabin bag")
        self.assertEqual(
            offer.conditions.get("checked_bag"),
            "not included - purchasable in checkout; no numeric search price",
        )
        self.assertFalse((offer.bags_price or {}).get("seat_selection"))

    def test_ita_parser_exposes_fare_family_ancillaries(self) -> None:
        payload = json.loads((WORKSPACE_ROOT / "webcon-backup" / "_ita_api_51.json").read_text(encoding="utf-8"))
        req = FlightSearchRequest(origin="FCO", destination="LHR", date_from=_future_date(35), adults=1)

        client = ITAAirwaysConnectorClient()
        offers = client._parse_search(payload, req)

        fare_families = {offer.conditions.get("fare_family") for offer in offers if offer.conditions.get("fare_family")}
        self.assertGreaterEqual(len(fare_families), 2)
        self.assertTrue(any(offer.conditions.get("checked_bag") == "not included - FIRST CHECKED BAG" for offer in offers))
        self.assertTrue(any((offer.bags_price or {}).get("checked_bag") == 70.0 for offer in offers))
        self.assertTrue(any((offer.bags_price or {}).get("seat_selection") for offer in offers))

        outbound = next(offer for offer in offers if offer.conditions.get("checked_bag") == "not included - FIRST CHECKED BAG")
        inbound = next(offer for offer in offers if offer.conditions.get("checked_bag") == "included - 1 x 23kg checked bag")
        rt_offer = client._combine_rt([outbound], [inbound], req)[0]

        self.assertEqual(rt_offer.conditions.get("outbound_checked_bag"), "not included - FIRST CHECKED BAG")
        self.assertEqual(rt_offer.conditions.get("inbound_checked_bag"), "included - 1 x 23kg checked bag")
        self.assertEqual(rt_offer.bags_price.get("outbound_checked_bag"), 70.0)
        self.assertEqual(rt_offer.bags_price.get("inbound_checked_bag"), 0.0)

    def test_mea_parser_keeps_all_fare_families_and_bags(self) -> None:
        payload = json.loads((WORKSPACE_ROOT / "_mea_air_bounds.json").read_text(encoding="utf-8"))
        req = FlightSearchRequest(origin="BEY", destination="CDG", date_from=_future_date(45), adults=1)

        client = MEAConnectorClient()
        offers = client._parse_api_response(payload, req)

        fare_families = {offer.conditions.get("fare_family") for offer in offers}
        self.assertIn("ECOFLEX", fare_families)
        self.assertIn("BUSIFLEX", fare_families)
        self.assertTrue(any(offer.conditions.get("checked_bag") == "included - 1 x 23kg checked bag" for offer in offers))
        self.assertTrue(any(offer.conditions.get("checked_bag") == "included - 2 x 30kg checked bag" for offer in offers))

        outbound = next(offer for offer in offers if offer.conditions.get("fare_family") == "ECOFLEX")
        inbound = next(offer for offer in offers if offer.conditions.get("fare_family") == "BUSIFLEX")
        rt_offer = client._combine_rt([outbound], [inbound], req)[0]

        self.assertEqual(rt_offer.conditions.get("outbound_checked_bag"), "included - 1 x 23kg checked bag")
        self.assertEqual(rt_offer.conditions.get("inbound_checked_bag"), "included - 2 x 30kg checked bag")
        self.assertEqual(rt_offer.bags_price.get("checked_bag"), 0.0)

    def test_aircairo_parser_reads_airboundgroups_and_preserves_metadata(self) -> None:
        payload = json.loads((WORKSPACE_ROOT / "_tmp_aircairo_air_bounds.json").read_text(encoding="utf-8"))
        req = FlightSearchRequest.model_construct(
            origin="CAI",
            destination="JED",
            date_from="2026-04-21",
            adults=1,
            children=0,
            cabin_class="M",
            return_from=None,
            currency="USD",
            limit=20,
        )

        client = AirCairoConnectorClient()
        offers = client._parse_api_data(payload, req, "2026-04-21")

        fare_families = {offer.conditions.get("fare_family") for offer in offers}
        self.assertEqual(fare_families, {"PROMO", "SPECIAL", "ECONOMY", "ECO FLEX"})
        self.assertTrue(all(offer.conditions.get("checked_bag") == "included - checked bag up to 30kg" for offer in offers))
        self.assertTrue(any(offer.conditions.get("refund_before_departure") == "not_allowed" for offer in offers))
        self.assertTrue(any(offer.conditions.get("refund_before_departure") == "allowed_with_fee" for offer in offers))

        outbound = next(offer for offer in offers if offer.conditions.get("fare_family") == "PROMO")
        inbound = next(offer for offer in offers if offer.conditions.get("fare_family") == "ECO FLEX")
        rt_offer = client._combine_rt([outbound], [inbound], req)[0]

        self.assertEqual(rt_offer.conditions.get("outbound_fare_family"), "PROMO")
        self.assertEqual(rt_offer.conditions.get("inbound_fare_family"), "ECO FLEX")
        self.assertEqual(rt_offer.bags_price.get("checked_bag"), 0.0)

    def test_aireuropa_parser_only_flags_nobag(self) -> None:
        payload = json.loads((WORKSPACE_ROOT / "_aireuropa_flight_data.json").read_text(encoding="utf-8"))
        req = FlightSearchRequest(origin="MAD", destination="BCN", date_from=_future_date(60), adults=1)

        client = AirEuropaConnectorClient()
        offers = client._parse_api_response(payload, req)

        fare_families = {offer.conditions.get("fare_family") for offer in offers}
        self.assertTrue({"NOBAG", "ECONOMY", "FLEX", "BUSINESS", "BUSFLEX"}.issubset(fare_families))
        self.assertTrue(any(
            offer.conditions.get("fare_family") == "NOBAG" and offer.conditions.get("checked_bag") == "not included"
            for offer in offers
        ))
        self.assertTrue(all(
            offer.conditions.get("checked_bag") is None
            for offer in offers
            if offer.conditions.get("fare_family") != "NOBAG"
        ))

        outbound = next(offer for offer in offers if offer.conditions.get("fare_family") == "NOBAG")
        inbound = next(offer for offer in offers if offer.conditions.get("fare_family") == "FLEX")
        rt_offer = client._combine_rt([outbound], [inbound], req)[0]

        self.assertEqual(rt_offer.conditions.get("checked_bag"), "not included")
        self.assertEqual(rt_offer.conditions.get("inbound_fare_family"), "FLEX")


if __name__ == "__main__":
    unittest.main()