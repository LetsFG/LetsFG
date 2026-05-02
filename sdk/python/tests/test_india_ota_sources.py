import asyncio
from datetime import date, datetime

from letsfg.connectors import engine
from letsfg.connectors.airline_routes import AIRLINE_COUNTRIES
from letsfg.connectors.easemytrip import _parse_response as _parse_easemytrip
from letsfg.connectors.engine import MultiProvider, source_selection_snapshot_for_validation
from letsfg.models.flights import (
    FlightOffer,
    FlightRoute,
    FlightSearchRequest,
    FlightSearchResponse,
    FlightSegment,
)


def _request(origin: str = "DEL", destination: str = "BOM") -> FlightSearchRequest:
    return FlightSearchRequest(
        origin=origin,
        destination=destination,
        date_from=date(2026, 6, 15),
        currency="INR",
    )


def _registered_sources() -> set[str]:
    return {source for source, _client, _timeout in engine._DIRECT_AIRLINE_connectorS}


def test_existing_india_ota_meta_sources_use_canonical_nondirect_keys() -> None:
    registered = _registered_sources()
    india_ota_meta_sources = {
        "cleartrip_ota",
        "yatra_ota",
        "ixigo_meta",
        "musafir_ota",
        "akbartravels_ota",
        "easemytrip_ota",
    }

    assert india_ota_meta_sources <= registered
    for source in india_ota_meta_sources:
        assert source.endswith(("_ota", "_meta"))
        assert not source.endswith("_direct")


def test_easemytrip_is_registered_classified_and_selected_for_india_routes() -> None:
    registered = _registered_sources()
    assert "easemytrip_ota" in registered
    assert "easemytrip" not in registered

    assert "easemytrip_ota".endswith("_ota")
    assert "easemytrip_ota" not in engine._BROWSER_SOURCES
    assert "easemytrip_ota" in engine._FAST_MODE_SOURCES
    assert "IN" in AIRLINE_COUNTRIES["easemytrip"]

    for origin, destination in [
        ("DEL", "BOM"),
        ("BLR", "DEL"),
        ("BOM", "MAA"),
        ("DEL", "DXB"),
        ("BOM", "SIN"),
    ]:
        snapshot = source_selection_snapshot_for_validation(
            _request(origin, destination),
            mode="fast",
            browsers_available=True,
        )
        assert "easemytrip_ota" in snapshot.route_relevant_sources
        assert "easemytrip_ota" in snapshot.selected_sources
        assert "easemytrip_ota" not in snapshot.browser_sources
        assert "easemytrip_ota" not in snapshot.fast_skipped_sources

    browser_disabled = source_selection_snapshot_for_validation(
        _request("DEL", "BOM"),
        mode="fast",
        browsers_available=False,
    )
    assert "easemytrip_ota" in browser_disabled.selected_sources
    assert "easemytrip_ota" not in browser_disabled.browser_skipped_sources

    for origin, destination in [("LHR", "JFK"), ("CDG", "MAD")]:
        snapshot = source_selection_snapshot_for_validation(
            _request(origin, destination),
            mode="fast",
            browsers_available=True,
        )
        assert "easemytrip_ota" not in snapshot.route_relevant_sources
        assert "easemytrip_ota" not in snapshot.selected_sources


def test_easemytrip_parser_normalizes_nonstop_and_connecting_offers() -> None:
    payload = {
        "CC": "INR",
        "C": {"6E": "IndiGo", "AI": "Air India"},
        "dctFltDtl": {
            "0": {
                "OG": "DEL", "DT": "BOM", "DDT": "Mon-15Jun2026",
                "ADT": "Mon-15Jun2026", "DTM": "08:00", "ATM": "10:10",
                "FN": "5318", "AC": "6E", "CB": "ECONOMY",
                "DUR": "02h 10m", "FlightName": "IndiGo",
                "ET": "Airbus A320",
            },
            "1": {
                "OG": "DEL", "DT": "JAI", "DDT": "Mon-15Jun2026",
                "ADT": "Mon-15Jun2026", "DTM": "11:55", "ATM": "13:00",
                "FN": "1719", "AC": "AI", "CB": "ECONOMY",
                "DUR": "01h 05m", "FlightName": "Air India",
            },
            "2": {
                "OG": "JAI", "DT": "BOM", "DDT": "Mon-15Jun2026",
                "ADT": "Mon-15Jun2026", "DTM": "19:40", "ATM": "21:35",
                "FN": "622", "AC": "AI", "CB": "ECONOMY",
                "DUR": "01h 55m", "FlightName": "Air India",
            },
        },
        "j": [
            {
                "s": [
                    {"id": 1, "SK": "1", "TF": 4825, "b": [{"FL": [0], "JyTm": "02h 10m", "stp": "0"}]},
                    {"id": 2, "SK": "2", "TF": 7006, "b": [{"FL": [1, 2], "JyTm": "09h 40m", "stp": "1"}]},
                ]
            }
        ],
    }

    offers = _parse_easemytrip(payload, _request())

    assert len(offers) == 2
    nonstop, connecting = offers
    assert nonstop.id
    assert nonstop.source == "easemytrip_ota"
    assert nonstop.source_tier == "ota"
    assert nonstop.price == 4825
    assert nonstop.currency == "INR"
    assert nonstop.airlines == ["IndiGo"]
    assert nonstop.owner_airline == "IndiGo"
    assert nonstop.booking_url.startswith("https://www.easemytrip.com/flight-search/listing")
    assert nonstop.outbound.stopovers == 0
    assert nonstop.outbound.total_duration_seconds == 7800
    assert nonstop.outbound.segments[0].origin == "DEL"
    assert nonstop.outbound.segments[-1].destination == "BOM"
    assert nonstop.outbound.segments[0].departure == datetime(2026, 6, 15, 8, 0)

    assert connecting.source == "easemytrip_ota"
    assert connecting.price == 7006
    assert connecting.airlines == ["Air India"]
    assert connecting.outbound.stopovers == 1
    assert connecting.outbound.total_duration_seconds == 34800
    assert len(connecting.outbound.segments) == 2
    assert connecting.outbound.segments[0].destination == "JAI"
    assert connecting.outbound.segments[-1].destination == "BOM"


def test_easemytrip_parser_handles_empty_blocked_malformed_and_wrong_route_safely() -> None:
    assert _parse_easemytrip({}, _request()) == []
    assert _parse_easemytrip("Access Denied", _request()) == []
    assert _parse_easemytrip({"err": {"code": "02", "desp": "Flight not Available"}, "j": []}, _request()) == []
    assert _parse_easemytrip({"j": [{"s": [{"TF": "bad", "b": [{"FL": [0]}]}]}], "dctFltDtl": {}}, _request()) == []

    wrong_route = {
        "CC": "INR",
        "C": {"IX": "Air India Express"},
        "dctFltDtl": {
            "0": {
                "OG": "DEL", "DT": "NMI", "DDT": "Mon-15Jun2026",
                "ADT": "Mon-15Jun2026", "DTM": "17:35", "ATM": "19:40",
                "FN": "1038", "AC": "IX", "DUR": "02h 05m",
                "FlightName": "Air India Express",
            }
        },
        "j": [{"s": [{"id": 3, "TF": 6999, "b": [{"FL": [0], "JyTm": "02h 05m", "stp": "0"}]}]}],
    }
    assert _parse_easemytrip(wrong_route, _request("DEL", "BOM")) == []


def test_connector_telemetry_and_offer_source_are_canonicalized_by_registry_key() -> None:
    class DummyConnector:
        async def search_flights(self, req: FlightSearchRequest) -> FlightSearchResponse:
            offer = FlightOffer(
                id="off_dummy_yatra",
                price=1000.0,
                currency="INR",
                outbound=FlightRoute(
                    segments=[
                        FlightSegment(
                            airline="6E",
                            flight_no="6E5318",
                            origin=req.origin,
                            destination=req.destination,
                            departure=datetime(2026, 6, 15, 8, 0),
                            arrival=datetime(2026, 6, 15, 10, 10),
                        )
                    ],
                    total_duration_seconds=7800,
                    stopovers=0,
                ),
                airlines=["6E"],
                owner_airline="6E",
                source="yatra",
                source_tier="ota",
                booking_url="https://www.yatra.com/",
            )
            return FlightSearchResponse(
                search_id="fs_dummy_yatra",
                origin=req.origin,
                destination=req.destination,
                currency=req.currency,
                offers=[offer],
                total_results=1,
            )

        async def close(self) -> None:
            return None

    provider = MultiProvider()
    result = asyncio.run(
        provider._search_connector_generic(
            DummyConnector(),
            _request(),
            "yatra_ota",
        )
    )

    assert result.offers[0].source == "yatra_ota"
    assert set(provider._connector_telemetry) == {"yatra_ota"}
    assert provider._connector_telemetry["yatra_ota"].ok is True
    assert provider._connector_telemetry["yatra_ota"].offers == 1
