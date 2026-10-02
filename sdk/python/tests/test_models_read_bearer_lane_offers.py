"""
The SDK models read the offers the Bearer lane returns.

/api/results sends a FLAT offer: the offer itself is the outbound leg, the
return is `inbound`, and a segment carries `airline_code`, `flight_number`,
`departure_time`, `duration_minutes`, `cabin`. The models read only the nested
Developer API shape, so `LetsFG().search()` on a Bearer token returned offers
with an empty outbound route, no airline and no times (found 2026-10-02 driving
letsfg 2026.5.102 live). `limit` was also ignored there, because /api/search
does not read it.

The fixture is a trimmed real response (BUD-LIS round trip, business).
"""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

PROJECT_ROOT = Path(__file__).resolve().parents[3]
SDK_PYTHON_ROOT = PROJECT_ROOT / "sdk" / "python"
if str(SDK_PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(SDK_PYTHON_ROOT))

from letsfg import client as C
from letsfg import local as L
from letsfg.models import FlightOffer, FlightSearchResult


def _seg(code, no, origin, dest, dep, arr, minutes):
    return {"airline": "Lufthansa", "airline_code": code, "flight_number": no, "origin": origin,
            "destination": dest, "departure_time": dep, "arrival_time": arr,
            "duration_minutes": minutes, "aircraft": "Airbus A320neo", "cabin": "C"}


BEARER_OFFER = {
    "id": "wo_d0e7a987ff8c", "price": 589, "currency": "EUR",
    "airline": "Lufthansa", "airline_code": "LH",
    "origin": "BUD", "destination": "LIS",
    "departure_time": "2027-02-17T07:50:00", "arrival_time": "2027-02-17T13:25:00",
    "duration_minutes": 395, "stops": 1, "flight_number": "LH1683",
    "segments": [
        _seg("LH", "LH1683", "BUD", "MUC", "2027-02-17T07:50:00", "2027-02-17T09:05:00", 75),
        _seg("LH", "LH1792", "MUC", "LIS", "2027-02-17T10:55:00", "2027-02-17T13:25:00", 210),
    ],
    "inbound": {
        "origin": "LIS", "destination": "BUD",
        "departure_time": "2027-02-24T06:00:00", "arrival_time": "2027-02-24T12:40:00",
        "duration_minutes": 340, "stops": 1, "airline": "Lufthansa", "airline_code": "LH",
        "segments": [
            _seg("LH", "LH1781", "LIS", "MUC", "2027-02-24T06:00:00", "2027-02-24T10:10:00", 190),
            _seg("LH", "LH1678", "MUC", "BUD", "2027-02-24T11:25:00", "2027-02-24T12:40:00", 75),
        ],
    },
    "conditions": {"fare_family": "Business Comfort"},
}

DEVELOPER_OFFER = {
    "id": "off_1", "price": 120.0, "currency": "EUR",
    "outbound": {"segments": [{
        "airline": "FR", "airline_name": "Ryanair", "flight_no": "FR1234",
        "origin": "GDN", "destination": "BER",
        "departure": "2026-06-10T06:00:00", "arrival": "2026-06-10T07:30:00",
        "duration_seconds": 5400, "cabin_class": "M"}],
        "total_duration_seconds": 5400, "stopovers": 0},
    "inbound": None, "airlines": ["FR"], "owner_airline": "FR",
}


class BearerLaneOfferTest(unittest.TestCase):
    def test_flat_offer_fills_both_legs(self):
        o = FlightOffer.from_dict(BEARER_OFFER)
        self.assertEqual(o.outbound.route_str, "BUD → MUC → LIS")
        self.assertEqual(o.outbound.stopovers, 1)
        self.assertEqual(o.outbound.total_duration_seconds, 395 * 60)
        first = o.outbound.segments[0]
        self.assertEqual((first.airline, first.airline_name, first.flight_no), ("LH", "Lufthansa", "LH1683"))
        self.assertEqual(first.departure, "2027-02-17T07:50:00")
        self.assertEqual(first.duration_seconds, 75 * 60)
        self.assertEqual(first.cabin_class, "C")
        self.assertEqual(o.inbound.route_str, "LIS → MUC → BUD")
        self.assertEqual(o.inbound.segments[0].departure, "2027-02-24T06:00:00")
        self.assertEqual(o.inbound.stopovers, 1)
        self.assertEqual(o.airlines, ["LH"])
        self.assertEqual(o.owner_airline, "LH")
        self.assertIn("BUD → MUC → LIS", o.summary())

    def test_developer_api_offer_reads_as_before(self):
        o = FlightOffer.from_dict(DEVELOPER_OFFER)
        seg = o.outbound.segments[0]
        self.assertEqual((seg.airline, seg.airline_name, seg.flight_no), ("FR", "Ryanair", "FR1234"))
        self.assertEqual(seg.departure, "2026-06-10T06:00:00")
        self.assertEqual(seg.duration_seconds, 5400)
        self.assertEqual(o.outbound.total_duration_seconds, 5400)
        self.assertEqual(o.outbound.stopovers, 0)
        self.assertEqual(o.airlines, ["FR"])
        self.assertEqual(o.owner_airline, "FR")
        self.assertIsNone(o.inbound)


class BearerLaneLimitTest(unittest.TestCase):
    def test_search_local_enforces_limit_and_keeps_the_full_count(self):
        async def fake_search(**_kwargs):
            return {"search_id": "ws_1", "total_results": 7,
                    "offers": [dict(BEARER_OFFER, id=f"wo_{n}") for n in range(7)]}

        with patch.object(L, "search_local", fake_search):
            result = C.LetsFG().search_local("BUD", "LIS", "2027-02-17", limit=3)

        self.assertIsInstance(result, FlightSearchResult)
        self.assertEqual([o.id for o in result.offers], ["wo_0", "wo_1", "wo_2"])
        self.assertEqual(result.total_results, 7)


if __name__ == "__main__":
    unittest.main()
