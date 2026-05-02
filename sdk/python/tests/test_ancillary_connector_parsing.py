import sys
import unittest
from datetime import date, timedelta
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[3]
SDK_PYTHON_ROOT = PROJECT_ROOT / "sdk" / "python"
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


def _airasiax_baggage_truth_payload() -> dict:
    return {
        "searchResults": {
            "trips": [
                {
                    "flightsList": [
                        {
                            "tripId": "kul-nrt-d7",
                            "convertedPrice": 199.0,
                            "userCurrencyCode": "USD",
                            **_airasia_truth_flight(),
                            "flightDetails": {
                                "designator": {
                                    "departureStation": "KUL",
                                    "arrivalStation": "NRT",
                                    "departureTime": "2026-06-01T09:00:00",
                                    "arrivalTime": "2026-06-01T17:00:00",
                                },
                                "segments": [
                                    {
                                        "carrierCode": "D7",
                                        "marketingFlightNo": "D7522",
                                        "designator": {
                                            "departureStation": "KUL",
                                            "arrivalStation": "NRT",
                                            "departureTime": "2026-06-01T09:00:00",
                                            "arrivalTime": "2026-06-01T17:00:00",
                                        },
                                    }
                                ],
                                "baggage": {
                                    "complimentaryBaggage": [{"type": "cabin_bag", "weight": 7}],
                                    "checkedBaggageAllowed": True,
                                },
                            },
                        }
                    ]
                }
            ]
        }
    }


def _flight_dict(carrier: str, flight_number: str, origin: str, destination: str) -> dict:
    return {
        "departure": {"locationCode": origin, "dateTime": "2026-06-01T08:00:00"},
        "arrival": {"locationCode": destination, "dateTime": "2026-06-01T10:00:00"},
        "marketingAirlineCode": carrier,
        "marketingFlightNumber": flight_number,
    }


def _air_bound(
    fare_family: str,
    total: int,
    currency: str = "EUR",
    services: list | None = None,
    condition_codes: list | None = None,
) -> dict:
    return {
        "fareFamilyCode": fare_family,
        "prices": {"totalPrices": [{"total": total, "currencyCode": currency}]},
        "airOffer": {"totalPrice": {"value": total, "currencyCode": currency}},
        "services": services or [],
        "fareConditionsCodes": condition_codes or [],
    }


def _checked_bag_service(quantity: int, weight: int) -> dict:
    return {
        "serviceType": "freeCheckedBaggage",
        "baggagePolicyDescriptions": [
            {
                "quantity": quantity,
                "baggageCharacteristics": [
                    {"policyDetails": [{"type": "weight", "unit": "kilogram", "value": weight}]}
                ],
            }
        ],
    }


def _ita_air_bounds_payload() -> dict:
    return {
        "data": {
            "airBoundGroups": [
                {
                    "boundDetails": {
                        "originLocationCode": "FCO",
                        "destinationLocationCode": "LHR",
                        "duration": 7200,
                        "segments": [{"flightId": "az1"}],
                    },
                    "airBounds": [
                        _air_bound(
                            "LIGHT",
                            12000,
                            services=[
                                {"serviceCode": "C0CCC", "price": {"total": 7000, "currencyCode": "EUR"}},
                                {"serviceCode": "A0B5S", "price": {"total": 1200, "currencyCode": "EUR"}},
                            ],
                        ),
                        _air_bound("CLASSIC", 19000, services=[{"serviceCode": "FBA23"}]),
                    ],
                }
            ]
        },
        "dictionaries": {
            "flight": {"az1": _flight_dict("AZ", "201", "FCO", "LHR")},
            "airline": {"AZ": "ITA Airways"},
            "currency": {"EUR": {"decimalPlaces": 2}},
            "fareFamilyWithServices": {},
            "service": {
                "C0CCC": {"serviceDescriptions": [{"content": "FIRST CHECKED BAG"}]},
                "A0B5S": {"serviceDescriptions": [{"content": "Standard seat"}]},
                "FBA23": {
                    "serviceDescriptions": [{"content": "Checked bag"}],
                    "baggagePolicyDescriptions": [
                        {
                            "quantity": 1,
                            "baggageCharacteristics": [
                                {"policyDetails": [{"type": "weight", "unit": "kilogram", "value": 23}]}
                            ],
                        }
                    ],
                },
            },
            "fareConditions": {},
        },
    }


def _mea_air_bounds_payload() -> dict:
    return {
        "data": {
            "airBoundGroups": [
                {
                    "boundDetails": {"duration": 7200, "segments": [{"flightId": "me1"}]},
                    "airBounds": [
                        _air_bound("ECOFLEX", 22000, "USD", services=[{"serviceCode": "BAG23"}]),
                        _air_bound("BUSIFLEX", 52000, "USD", services=[{"serviceCode": "BAG30X2"}]),
                    ],
                }
            ]
        },
        "dictionaries": {
            "flight": {"me1": _flight_dict("ME", "211", "BEY", "CDG")},
            "currency": {"USD": {"decimalPlaces": 2}},
            "fareFamilyWithServices": {},
            "service": {
                "BAG23": _checked_bag_service(1, 23),
                "BAG30X2": _checked_bag_service(2, 30),
            },
        },
    }


def _aircairo_air_bounds_payload() -> dict:
    return {
        "data": {
            "airBoundGroups": [
                {
                    "boundDetails": {"duration": 7200, "segments": [{"flightId": "sm1"}]},
                    "airBounds": [
                        _air_bound(
                            "PROMO",
                            10000,
                            "USD",
                            services=[{"serviceCode": "BAG30"}],
                            condition_codes=["NOREF"],
                        ),
                        _air_bound(
                            "SPECIAL",
                            12000,
                            "USD",
                            services=[{"serviceCode": "BAG30"}],
                            condition_codes=["REFEE"],
                        ),
                        _air_bound("ECONOMY", 14000, "USD", services=[{"serviceCode": "BAG30"}]),
                        _air_bound(
                            "ECO FLEX",
                            18000,
                            "USD",
                            services=[{"serviceCode": "BAG30"}],
                            condition_codes=["REFEE"],
                        ),
                    ],
                }
            ]
        },
        "dictionaries": {
            "flight": {"sm1": _flight_dict("SM", "401", "CAI", "JED")},
            "currency": {"USD": {"decimalPlaces": 2}},
            "fareFamilyWithServices": {},
            "service": {
                "BAG30": {
                    "serviceType": "freeCheckedBaggage",
                    "baggagePolicyDescriptions": [{"type": "weight", "quantity": 30, "weightUnit": "kilogram"}],
                }
            },
            "fareConditions": {
                "NOREF": {"category": "refund", "details": [{"isAllowed": False}]},
                "REFEE": {
                    "category": "refund",
                    "details": [
                        {"isAllowed": True, "penalty": {"price": {"total": 5000, "currencyCode": "USD"}}}
                    ],
                },
            },
        },
    }


def _aireuropa_air_bounds_payload() -> dict:
    return {
        "data": {
            "airBoundGroups": [
                {
                    "boundDetails": {"duration": 3600, "segments": [{"flightId": "ux1"}]},
                    "airBounds": [
                        _air_bound("NOBAG", 5000),
                        _air_bound("ECONOMY", 7000),
                        _air_bound("FLEX", 9000),
                        _air_bound("BUSINESS", 15000),
                        _air_bound("BUSFLEX", 20000),
                    ],
                }
            ]
        },
        "dictionaries": {
            "flight": {"ux1": _flight_dict("UX", "7701", "MAD", "BCN")},
            "fareFamilyWithServices": {},
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
        payload = _airasiax_baggage_truth_payload()
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
        payload = _ita_air_bounds_payload()
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
        payload = _mea_air_bounds_payload()
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
        payload = _aircairo_air_bounds_payload()
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
        payload = _aireuropa_air_bounds_payload()
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