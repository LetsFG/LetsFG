from __future__ import annotations

from datetime import date, datetime

from letsfg.connectors import engine
from letsfg.connectors.airline_routes import AIRLINE_COUNTRIES
from letsfg.connectors.allianceair import _parse_response as _parse_allianceair
from letsfg.connectors.engine import source_selection_snapshot_for_validation
from letsfg.connectors.starair import _parse_response as _parse_starair
from letsfg.models.flights import FlightSearchRequest


def _request(origin: str = "HYD", destination: str = "TIR") -> FlightSearchRequest:
    return FlightSearchRequest(
        origin=origin,
        destination=destination,
        date_from=date(2026, 6, 15),
        currency="INR",
    )


def _registered_sources() -> set[str]:
    return {source for source, _client, _timeout in engine._DIRECT_AIRLINE_connectorS}


def test_allianceair_and_starair_are_registered_and_selected_for_india_routes() -> None:
    registered = _registered_sources()
    regional_sources = {"allianceair_direct", "starair_direct"}

    assert regional_sources <= registered
    for source in regional_sources:
        airline_key = source.removesuffix("_direct")
        assert "IN" in AIRLINE_COUNTRIES[airline_key]
        assert source in engine._FAST_MODE_SOURCES
        assert source not in engine._BROWSER_SOURCES

    india = source_selection_snapshot_for_validation(
        _request("HYD", "TIR"),
        mode="fast",
        browsers_available=True,
    )
    non_india = source_selection_snapshot_for_validation(
        _request("LHR", "JFK"),
        mode="fast",
        browsers_available=True,
    )

    assert regional_sources <= set(india.route_relevant_sources)
    assert regional_sources <= set(india.selected_sources)
    assert regional_sources.isdisjoint(non_india.route_relevant_sources)
    assert regional_sources.isdisjoint(non_india.selected_sources)


def test_allianceair_parser_normalizes_public_schedule_payload() -> None:
    html = """
    <script>
    this.dataSchedule = ["","",{"success":true,"origin":"HYD","destination":"TIR",
      "departure_date":"15/06/2026","adult_quantity":1,"child_quantity":0,"infant_quantity":0,
      "departure_schedule":[{
        "connecting_flight_routes":[{
          "origin":{"city":"HYDERABAD","name":"RAJIV GANDHI AIRPORT","code":"HYD"},
          "destination":{"city":"TIRUPATI","name":"TIRUPATI AIRPORT","code":"TIR"},
          "flight_number":"9I877","aircraft":"ATR-72","transit":"0","route":"HYD-TIR",
          "availability":"9",
          "departure_date":{"day":"15","month":"06","year":"2026","hour":"07","minute":"05"},
          "arrival_date":{"day":"15","month":"06","year":"2026","hour":"08","minute":"30"}
        }],
        "fare_info":{"total_search_fare":{"amount":9175,"ccy":"INR"}}
      }]
    }];
    </script>
    """

    offers = _parse_allianceair(html, _request("HYD", "TIR"))

    assert len(offers) == 1
    offer = offers[0]
    assert offer.id
    assert offer.source == "allianceair_direct"
    assert offer.source_tier == "protocol"
    assert offer.price == 9175
    assert offer.currency == "INR"
    assert offer.airlines == ["Alliance Air"]
    assert offer.owner_airline == "Alliance Air"
    assert offer.booking_url.startswith("https://bookme.allianceair.in/search-schedule")
    assert offer.availability_seats == 9
    assert offer.outbound.stopovers == 0
    assert offer.outbound.segments[0].flight_no == "9I877"
    assert offer.outbound.segments[0].origin == "HYD"
    assert offer.outbound.segments[-1].destination == "TIR"
    assert offer.outbound.segments[0].departure == datetime(2026, 6, 15, 7, 5)
    assert offer.outbound.total_duration_seconds == 5100


def test_starair_parser_normalizes_public_crane_availability_html() -> None:
    html = """
    <div class="js-scheduled-flight">
      <span>07:20 AM</span> Belgaum (IXG) <span>15 Jun 2026</span>
      <span class="flight-no">S5-111</span>
      <span class="flight-duration">1h 05m</span>
      <span>Non stop</span>
      <span>08:25</span> Mumbai (BOM) <span>15 Jun 2026</span>
      <div class="fare-item collapsed col-6 js-fare-item-selector">
        BEST OFFER availability.flightList.cabin.type.STAR REGULAR? INR 5,250
      </div>
      <div class="fare-item collapsed col-6 js-fare-item-selector">
        BUSINESS INR 6,499 Last 4 Seats
      </div>
    </div>
    """

    offers = _parse_starair(html, _request("IXG", "BOM"))

    assert len(offers) == 2
    economy, business = offers
    assert economy.source == "starair_direct"
    assert economy.price == 5250
    assert economy.currency == "INR"
    assert economy.outbound.segments[0].cabin_class == "economy"
    assert economy.outbound.segments[0].flight_no == "S5-111"
    assert economy.outbound.segments[0].departure == datetime(2026, 6, 15, 7, 20)
    assert economy.outbound.segments[0].arrival == datetime(2026, 6, 15, 8, 25)
    assert economy.outbound.total_duration_seconds == 3900
    assert economy.booking_url.startswith("https://book-sdg.crane.aero/ibe/availability/create")

    assert business.price == 6499
    assert business.outbound.segments[0].cabin_class == "business"
    assert business.availability_seats == 4


def test_regional_parsers_handle_empty_blocked_and_wrong_route_safely() -> None:
    assert _parse_allianceair("", _request()) == []
    assert _parse_allianceair("<html>Access Denied</html>", _request()) == []
    assert _parse_allianceair('this.dataSchedule = ["","",{"departure_schedule":[]}];', _request()) == []
    assert _parse_starair("", _request("IXG", "BOM")) == []
    assert _parse_starair("<html>403 Permission Denied</html>", _request("IXG", "BOM")) == []
    wrong_route = """
    <div class="js-scheduled-flight">
      07:20 AM Belgaum (IXG) 15 Jun 2026 S5-111 1h 05m Non stop
      08:25 Mumbai (BOM) 15 Jun 2026
      <div class="fare-item js-fare-item-selector">INR 5,250</div>
    </div>
    """
    assert _parse_starair(wrong_route, _request("HYD", "TIR")) == []
