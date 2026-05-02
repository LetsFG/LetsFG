from datetime import date
import json

import pytest
from typer.testing import CliRunner

from letsfg import cli as letsfg_cli
from letsfg.connectors import engine
from letsfg.connectors.engine import MultiProvider, source_selection_snapshot_for_validation
from letsfg.local import _resolve_location_local
from letsfg.models.flights import FlightOffer, FlightRoute, FlightSearchRequest, FlightSegment


def _request(
    origin: str = "DEL",
    destination: str = "BOM",
    *,
    cabin_class: str | None = None,
    return_from: date | None = None,
) -> FlightSearchRequest:
    return FlightSearchRequest(
        origin=origin,
        destination=destination,
        date_from=date(2026, 6, 15),
        return_from=return_from,
        cabin_class=cabin_class,
        currency="INR",
    )


def test_common_india_location_inputs_resolve_locally() -> None:
    expected = {
        "Delhi": "DEL",
        "DEL": "DEL",
        "Mumbai": "BOM",
        "BOM": "BOM",
        "Bengaluru": "BLR",
        "Bangalore": "BLR",
        "BLR": "BLR",
        "Chennai": "MAA",
        "Hyderabad": "HYD",
        "Kolkata": "CCU",
    }

    for query, code in expected.items():
        assert any(loc["iata_code"] == code for loc in _resolve_location_local(query))


@pytest.mark.parametrize(
    ("query", "code"),
    [
        ("Delhi", "DEL"),
        ("DEL", "DEL"),
        ("Mumbai", "BOM"),
        ("BOM", "BOM"),
        ("Bengaluru", "BLR"),
        ("Bangalore", "BLR"),
        ("BLR", "BLR"),
        ("Chennai", "MAA"),
        ("MAA", "MAA"),
        ("Hyderabad", "HYD"),
        ("HYD", "HYD"),
        ("Kolkata", "CCU"),
        ("CCU", "CCU"),
    ],
)
def test_cli_locations_json_falls_back_to_local_india_inputs(monkeypatch, query: str, code: str) -> None:
    class EmptyBackendClient:
        def resolve_location(self, query: str) -> list[dict]:
            return []

    monkeypatch.setattr(letsfg_cli, "_get_client", lambda api_key=None, base_url=None: EmptyBackendClient())

    result = CliRunner().invoke(letsfg_cli.app, ["locations", query, "--json"])

    assert result.exit_code == 0, result.output
    locations = json.loads(result.stdout)
    assert any(loc["iata_code"] == code for loc in locations)


def test_cli_locations_json_preserves_backend_results_when_present(monkeypatch) -> None:
    backend_locations = [
        {
            "iata_code": "XYZ",
            "name": "Backend Result",
            "type": "airport",
            "city": "Backend City",
            "country": "ZZ",
        }
    ]

    class BackendClient:
        def resolve_location(self, query: str) -> list[dict]:
            return backend_locations

    monkeypatch.setattr(letsfg_cli, "_get_client", lambda api_key=None, base_url=None: BackendClient())

    result = CliRunner().invoke(letsfg_cli.app, ["locations", "backend-only", "--json"])

    assert result.exit_code == 0, result.output
    assert json.loads(result.stdout) == backend_locations


def test_fast_india_international_source_selection_includes_india_and_global_sources() -> None:
    snapshot = source_selection_snapshot_for_validation(
        _request("DEL", "DXB"),
        mode="fast",
        browsers_available=True,
    )

    selected = set(snapshot.selected_sources)
    assert {
        "kiwi_connector",
        "spicejet_direct",
        "indigo_direct",
        "airindiaexpress_direct",
        "cleartrip_ota",
        "yatra_ota",
    } <= selected
    assert "akasa_direct" not in selected
    assert "easemytrip_ota" in snapshot.route_relevant_sources


def test_premium_cabin_india_search_skips_economy_only_direct_sources() -> None:
    snapshot = source_selection_snapshot_for_validation(
        _request("DEL", "BOM", cabin_class="C"),
        mode="fast",
        browsers_available=True,
    )

    economy_only_india_sources = {
        "indigo_direct",
        "spicejet_direct",
        "akasa_direct",
        "airindiaexpress_direct",
    }
    assert economy_only_india_sources <= engine._ECONOMY_ONLY_SOURCES
    assert economy_only_india_sources <= set(snapshot.cabin_skipped_sources)
    assert economy_only_india_sources.isdisjoint(snapshot.selected_sources)
    assert "cleartrip_ota" in snapshot.selected_sources


def test_round_trip_source_selection_preserves_india_ota_sources() -> None:
    snapshot = source_selection_snapshot_for_validation(
        _request("DEL", "BOM", return_from=date(2026, 6, 20)),
        mode="fast",
        browsers_available=True,
    )

    selected = set(snapshot.selected_sources)
    assert {"kiwi_connector", "cleartrip_ota", "yatra_ota", "easemytrip_ota"} <= selected


def test_requested_date_filter_rejects_wrong_one_way_and_round_trip_dates() -> None:
    req = _request("DEL", "BOM", return_from=date(2026, 6, 20))

    good = _offer("good", "2026-06-15T08:00:00", "2026-06-20T18:00:00")
    wrong_outbound = _offer("wrong_outbound", "2026-06-17T08:00:00", "2026-06-20T18:00:00")
    wrong_inbound = _offer("wrong_inbound", "2026-06-15T08:00:00", "2026-06-22T18:00:00")

    kept = MultiProvider._filter_offers_by_date(
        [good, wrong_outbound, wrong_inbound],
        req,
    )

    assert kept == [good]


def _offer(id_: str, outbound_departure: str, inbound_departure: str) -> FlightOffer:
    return FlightOffer(
        id=id_,
        price=1000.0,
        currency="INR",
        outbound=FlightRoute(
            segments=[
                FlightSegment(
                    airline="6E",
                    flight_no="6E100",
                    origin="DEL",
                    destination="BOM",
                    departure=outbound_departure,
                    arrival=outbound_departure.replace("08:00:00", "10:00:00"),
                    duration_seconds=7200,
                )
            ],
            total_duration_seconds=7200,
            stopovers=0,
        ),
        inbound=FlightRoute(
            segments=[
                FlightSegment(
                    airline="6E",
                    flight_no="6E101",
                    origin="BOM",
                    destination="DEL",
                    departure=inbound_departure,
                    arrival=inbound_departure.replace("18:00:00", "20:00:00"),
                    duration_seconds=7200,
                )
            ],
            total_duration_seconds=7200,
            stopovers=0,
        ),
        airlines=["6E"],
        owner_airline="6E",
        source="indigo_direct",
        source_tier="free",
        booking_url="https://example.test/book",
    )
