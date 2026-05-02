from datetime import date

from letsfg.connectors.emirates import EmiratesConnectorClient
from letsfg.models.flights import FlightSearchRequest


def _request() -> FlightSearchRequest:
    return FlightSearchRequest(
        origin="DEL",
        destination="BOM",
        date_from=date(2026, 6, 15),
        currency="INR",
    )


def test_emirates_observed_price_fallback_without_flight_times_is_discarded() -> None:
    client = EmiratesConnectorClient()

    offer = client._build_offer(
        {
            "flightNo": "EK",
            "depTime": "00:00",
            "arrTime": "00:00",
            "duration": 0,
            "origin": "DEL",
            "destination": "BOM",
            "price": 420.341,
            "currency": "INR",
        },
        _request(),
    )

    assert offer is None


def test_emirates_offer_duration_is_computed_from_times_when_missing() -> None:
    client = EmiratesConnectorClient()

    offer = client._build_offer(
        {
            "flightNo": "EK500",
            "depTime": "10:00",
            "arrTime": "12:15",
            "duration": 0,
            "origin": "DEL",
            "destination": "BOM",
            "price": 12000.0,
            "currency": "INR",
        },
        _request(),
    )

    assert offer is not None
    assert offer.outbound.total_duration_seconds == 8100
    assert offer.outbound.segments[0].duration_seconds == 8100
