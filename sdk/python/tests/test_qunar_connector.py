import sys
import unittest
from datetime import date, timedelta
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
SDK_PYTHON_ROOT = PROJECT_ROOT / "sdk" / "python"
if str(SDK_PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(SDK_PYTHON_ROOT))

from letsfg.connectors.qunar import (
    _IATA_TO_CN,
    _parse_qunar_flight_list,
    _parse_flight_time,
)
from letsfg.models.flights import FlightSearchRequest


def _make_req(**kwargs) -> FlightSearchRequest:
    defaults = dict(
        origin="PEK",
        destination="CAN",
        date_from=date.today() + timedelta(days=14),
        adults=1,
        children=0,
        infants=0,
        cabin_class="M",
        currency="EUR",
    )
    defaults.update(kwargs)
    return FlightSearchRequest(**defaults)


def _make_flight(
    dep_date: str,
    dep_time: str,
    arr_date: str,
    arr_time: str,
    price: str = "500.00",
    carrier: str = "CA",
    flight_no: str = "CA1234",
    dep_code: str = "PEK",
    arr_code: str = "CAN",
    stops: int = 0,
) -> dict:
    binfo = {
        "shortName": "国航",
        "flightNo": flight_no,
        "carrier": carrier,
        "fullName": "中国国际航空",
        "depDate": dep_date,
        "depTime": dep_time,
        "arrDate": arr_date,
        "arrTime": arr_time,
        "depAirportCode": dep_code,
        "arrAirportCode": arr_code,
        "depAirport": "首都",
        "arrAirport": "白云",
        "minSellPrice": price,
        "stops": stops,
        "flightTime": "3小时0分钟",
    }
    return {
        "minPrice": price,
        "binfo": binfo,
        "binfo1": binfo,
        "transCity": "",
        "flightKey": flight_no,
        "prefix": "https://touch.qunar.com/lowFlight/flightList?dep=%E5%8C%97%E4%BA%AC&arr=%E5%B9%BF%E5%B7%9E",
        "totalFlightTime": "共3小时0分钟",
    }


class TestQunarIataMapping(unittest.TestCase):
    def test_beijing_codes_all_map(self):
        self.assertEqual(_IATA_TO_CN["PEK"], "北京")
        self.assertEqual(_IATA_TO_CN["PKX"], "北京")

    def test_shanghai_codes(self):
        self.assertEqual(_IATA_TO_CN["PVG"], "上海")
        self.assertEqual(_IATA_TO_CN["SHA"], "上海")

    def test_international_cities(self):
        self.assertIn("LHR", _IATA_TO_CN)
        self.assertIn("NRT", _IATA_TO_CN)
        self.assertIn("SIN", _IATA_TO_CN)
        self.assertEqual(_IATA_TO_CN["HKG"], "香港")


class TestQunarFlightTimeParsing(unittest.TestCase):
    def test_hours_and_minutes(self):
        self.assertEqual(_parse_flight_time("3小时10分钟"), 3 * 3600 + 10 * 60)

    def test_hours_only(self):
        self.assertEqual(_parse_flight_time("2小时"), 2 * 3600)

    def test_empty(self):
        self.assertEqual(_parse_flight_time(""), 0)

    def test_minutes_only(self):
        self.assertEqual(_parse_flight_time("45分钟"), 45 * 60)


class TestQunarFlightListParsing(unittest.TestCase):
    def test_parse_single_flight(self):
        req = _make_req(origin="PEK", destination="CAN", currency="EUR")
        target_date = (date.today() + timedelta(days=14)).isoformat()
        flight = _make_flight(
            dep_date=target_date,
            dep_time="08:00",
            arr_date=target_date,
            arr_time="11:00",
            price="450.00",
        )
        offers = _parse_qunar_flight_list([flight], req, target_date)
        self.assertEqual(len(offers), 1)
        offer = offers[0]
        self.assertGreater(offer.price, 0)
        self.assertEqual(offer.currency, "EUR")
        self.assertEqual(offer.source, "qunar_ota")
        self.assertIsNotNone(offer.outbound)
        self.assertEqual(len(offer.outbound.segments), 1)
        seg = offer.outbound.segments[0]
        self.assertEqual(seg.origin, "PEK")
        self.assertEqual(seg.destination, "CAN")
        self.assertEqual(seg.airline, "CA")
        self.assertEqual(seg.flight_no, "CA1234")

    def test_date_filter_excludes_wrong_date(self):
        req = _make_req(origin="PEK", destination="CAN", currency="EUR")
        target_date = "2026-08-01"
        wrong_date = "2026-07-15"
        flight = _make_flight(
            dep_date=wrong_date, dep_time="08:00",
            arr_date=wrong_date, arr_time="11:00",
        )
        offers = _parse_qunar_flight_list([flight], req, target_date)
        self.assertEqual(len(offers), 0)

    def test_date_filter_includes_matching(self):
        req = _make_req(origin="PEK", destination="CAN", currency="EUR")
        target_date = "2026-08-01"
        flight = _make_flight(
            dep_date=target_date, dep_time="08:00",
            arr_date=target_date, arr_time="11:00",
        )
        offers = _parse_qunar_flight_list([flight], req, target_date)
        self.assertEqual(len(offers), 1)

    def test_no_date_filter_returns_all(self):
        req = _make_req()
        flights = [
            _make_flight("2026-08-01", "08:00", "2026-08-01", "11:00"),
            _make_flight("2026-08-02", "10:00", "2026-08-02", "13:00"),
        ]
        offers = _parse_qunar_flight_list(flights, req, "")
        self.assertEqual(len(offers), 2)

    def test_price_conversion_to_usd(self):
        req = _make_req(currency="USD")
        target_date = "2026-08-01"
        flight = _make_flight(dep_date=target_date, dep_time="08:00",
                               arr_date=target_date, arr_time="11:00",
                               price="500.00")
        offers = _parse_qunar_flight_list([flight], req, target_date)
        self.assertEqual(len(offers), 1)
        # 500 CNY * 0.138 USD/CNY ≈ 69 USD
        self.assertAlmostEqual(offers[0].price, 69.0, delta=5.0)
        self.assertEqual(offers[0].currency, "USD")

    def test_zero_price_excluded(self):
        req = _make_req()
        target_date = "2026-08-01"
        flight = _make_flight(dep_date=target_date, dep_time="08:00",
                               arr_date=target_date, arr_time="11:00",
                               price="0.00")
        offers = _parse_qunar_flight_list([flight], req, target_date)
        self.assertEqual(len(offers), 0)

    def test_booking_url_from_prefix(self):
        req = _make_req()
        target_date = "2026-08-01"
        flight = _make_flight(dep_date=target_date, dep_time="08:00",
                               arr_date=target_date, arr_time="11:00")
        offers = _parse_qunar_flight_list([flight], req, target_date)
        self.assertIn("qunar.com", offers[0].booking_url)

    def test_connecting_flight_parsed(self):
        req = _make_req()
        target_date = "2026-08-01"
        connecting = {
            "minPrice": "563",
            "prefix": "https://touch.qunar.com/lowFlight/flightList?dep=%E5%8C%97%E4%BA%AC&arr=%E5%B9%BF%E5%B7%9E",
            "transCity": "武汉",
            "totalFlightTime": "共10小时45分钟",
            "flightKey": "MU2454/MU2542",
            "binfo": {},
            "binfo1": {
                "carrier": "MU", "fullName": "东方航空", "flightNo": "MU2454",
                "depDate": target_date, "depTime": "22:35",
                "arrDate": target_date, "arrTime": "00:35",
                "depAirportCode": "PKX", "arrAirportCode": "WUH",
                "minSellPrice": "563.00", "stops": 0, "flightTime": "2小时",
                "shortName": "东航",
            },
            "binfo2": {
                "carrier": "MU", "fullName": "东方航空", "flightNo": "MU2542",
                "depDate": target_date, "depTime": "07:00",
                "arrDate": target_date, "arrTime": "09:10",
                "depAirportCode": "WUH", "arrAirportCode": "CAN",
                "minSellPrice": "563.00", "stops": 0, "flightTime": "2小时10分钟",
                "shortName": "东航",
            },
        }
        offers = _parse_qunar_flight_list([connecting], req, target_date)
        self.assertEqual(len(offers), 1)
        offer = offers[0]
        self.assertEqual(offer.outbound.stopovers, 1)
        self.assertEqual(len(offer.outbound.segments), 2)
        self.assertEqual(offer.outbound.segments[0].origin, "PKX")
        self.assertEqual(offer.outbound.segments[0].destination, "WUH")
        self.assertEqual(offer.outbound.segments[1].origin, "WUH")
        self.assertEqual(offer.outbound.segments[1].destination, "CAN")

    def test_id_uniqueness(self):
        req = _make_req()
        target_date = "2026-08-01"
        flights = [
            _make_flight(target_date, "08:00", target_date, "11:00", "450", "CA", "CA1234"),
            _make_flight(target_date, "10:00", target_date, "13:00", "500", "MU", "MU5678"),
        ]
        offers = _parse_qunar_flight_list(flights, req, target_date)
        self.assertEqual(len(offers), 2)
        ids = [o.id for o in offers]
        self.assertEqual(len(set(ids)), 2)


if __name__ == "__main__":
    unittest.main()
