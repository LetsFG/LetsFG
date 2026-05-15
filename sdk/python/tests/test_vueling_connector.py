import sys
import unittest
from datetime import date
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[3]
SDK_PYTHON_ROOT = PROJECT_ROOT / "sdk" / "python"
if str(SDK_PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(SDK_PYTHON_ROOT))

from letsfg.connectors.vueling import VuelingConnectorClient
from letsfg.models.flights import FlightSearchRequest


def _make_req(**kwargs):
    defaults = dict(
        origin="LHR",
        destination="BCN",
        date_from=date(2026, 5, 22),
        return_from=date(2026, 5, 24),
        adults=2,
        children=0,
        infants=0,
        cabin_class="M",
        currency="GBP",
    )
    defaults.update(kwargs)
    return FlightSearchRequest(**defaults)


def _journey(origin: str, destination: str, local_departure: str, local_arrival: str, utc_departure: str, utc_arrival: str, segment_duration: int, fare_key: str, flight_no: str) -> dict:
    return {
        "designator": {
            "origin": origin,
            "destination": destination,
            "departure": local_departure,
            "arrival": local_arrival,
        },
        "duration": segment_duration,
        "connectionTime": 0,
        "fares": [{"fareAvailabilityKey": fare_key}],
        "segments": [
            {
                "identifier": {"carrierCode": "VY", "identifier": flight_no},
                "designator": {
                    "origin": origin,
                    "destination": destination,
                    "departure": local_departure,
                    "arrival": local_arrival,
                },
                "segmentDuration": segment_duration,
                "legs": [
                    {
                        "legInfo": {
                            "departureTimeUtc": utc_departure,
                            "arrivalTimeUtc": utc_arrival,
                        }
                    }
                ],
            }
        ],
    }


def _graphql_payload() -> dict:
    fare_key = "vy-fare"
    outbound = _journey(
        origin="LHR",
        destination="BCN",
        local_departure="2026-05-22T17:15:00Z",
        local_arrival="2026-05-22T20:35:00Z",
        utc_departure="2026-05-22T16:15:00Z",
        utc_arrival="2026-05-22T18:35:00Z",
        segment_duration=140,
        fare_key=fare_key,
        flight_no="7816",
    )
    inbound = _journey(
        origin="BCN",
        destination="LHR",
        local_departure="2026-05-24T10:45:00Z",
        local_arrival="2026-05-24T12:10:00Z",
        utc_departure="2026-05-24T08:45:00Z",
        utc_arrival="2026-05-24T11:10:00Z",
        segment_duration=145,
        fare_key=fare_key,
        flight_no="7817",
    )

    return {
        "data": {
            "amsAvy": {
                "currencyCode": "GBP",
                "faresAvailable": [
                    {
                        "value": {
                            "fareAvailabilityKey": fare_key,
                            "fares": [
                                {
                                    "productClass": "OPTIMA",
                                    "passengerFares": [{"amsFareAmount": 120.0}],
                                }
                            ],
                        }
                    }
                ],
                "trips": [
                    {
                        "trips": [
                            {
                                "journeysAvailableByMarket": [
                                    {"key": "LHR|BCN", "value": [outbound]},
                                ]
                            },
                            {
                                "journeysAvailableByMarket": [
                                    {"key": "BCN|LHR", "value": [inbound]},
                                ]
                            },
                        ]
                    }
                ],
            }
        }
    }


class VuelingTimezoneRegressionTest(unittest.TestCase):
    def setUp(self):
        self.client = VuelingConnectorClient.__new__(VuelingConnectorClient)

    def test_local_clock_times_stay_local_while_duration_uses_utc_metadata(self):
        req = _make_req()
        data = _graphql_payload()

        outbound = self.client._parse_graphql(data, req)
        inbound = self.client._parse_graphql_return(data, req)

        self.assertEqual(len(outbound), 1)
        self.assertEqual(len(inbound), 1)

        outbound_offer = outbound[0]
        outbound_segment = outbound_offer.outbound.segments[0]
        self.assertIsNone(outbound_segment.departure.tzinfo)
        self.assertEqual(outbound_segment.departure.isoformat(), "2026-05-22T17:15:00")
        self.assertEqual(outbound_segment.arrival.isoformat(), "2026-05-22T20:35:00")
        self.assertEqual(outbound_segment.duration_seconds, 8400)
        self.assertEqual(outbound_offer.outbound.total_duration_seconds, 8400)

        inbound_offer = inbound[0]
        inbound_segment = inbound_offer.outbound.segments[0]
        self.assertIsNone(inbound_segment.departure.tzinfo)
        self.assertEqual(inbound_segment.departure.isoformat(), "2026-05-24T10:45:00")
        self.assertEqual(inbound_segment.arrival.isoformat(), "2026-05-24T12:10:00")
        self.assertEqual(inbound_segment.duration_seconds, 8700)
        self.assertEqual(inbound_offer.outbound.total_duration_seconds, 8700)


if __name__ == "__main__":
    unittest.main()