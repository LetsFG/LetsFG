from __future__ import annotations

import asyncio
from datetime import date, datetime
from pathlib import Path

from letsfg.connectors import engine
from letsfg.connectors.airline_routes import AIRLINE_COUNTRIES
from letsfg.connectors.engine import MultiProvider, source_selection_snapshot_for_validation
from letsfg.models.flights import (
    FlightOffer,
    FlightRoute,
    FlightSearchRequest,
    FlightSearchResponse,
    FlightSegment,
)


REPO_ROOT = Path(__file__).resolve().parents[3]
CONNECTORS_DIR = REPO_ROOT / "sdk" / "python" / "letsfg" / "connectors"


def _request(origin: str = "DEL", destination: str = "BOM") -> FlightSearchRequest:
    return FlightSearchRequest(
        origin=origin,
        destination=destination,
        date_from=date(2026, 6, 15),
        currency="INR",
    )


def _registered_sources() -> set[str]:
    return {source for source, _client, _timeout in engine._DIRECT_AIRLINE_connectorS}


def _offer(source: str, owner_airline: str = "Cleartrip") -> FlightOffer:
    return FlightOffer(
        id=f"off_{source}",
        price=5000.0,
        currency="INR",
        outbound=FlightRoute(
            segments=[
                FlightSegment(
                    airline=owner_airline,
                    flight_no="AI657",
                    origin="DEL",
                    destination="BOM",
                    departure=datetime(2026, 6, 15, 7, 0),
                    arrival=datetime(2026, 6, 15, 9, 10),
                    duration_seconds=7800,
                )
            ],
            total_duration_seconds=7800,
            stopovers=0,
        ),
        airlines=[owner_airline],
        owner_airline=owner_airline,
        source=source,
        source_tier="ota" if source.endswith(("_ota", "_meta")) else "free",
        booking_url="https://example.invalid/book",
    )


def test_defunct_and_merged_india_carriers_are_not_active_standalone_sources() -> None:
    forbidden_source_keys = {
        "vistara_direct",
        "vistara_ota",
        "vistara_meta",
        "airasiaindia_direct",
        "airasia_india_direct",
        "aixconnect_direct",
        "aix_connect_direct",
        "gofirst_direct",
        "goair_direct",
        "jetairways_direct",
        "jet_airways_direct",
        "jetair_direct",
    }
    forbidden_airline_route_keys = {
        "vistara",
        "airasiaindia",
        "airasia_india",
        "aixconnect",
        "aix_connect",
        "gofirst",
        "goair",
        "jetairways",
        "jet_airways",
        "jetair",
    }
    forbidden_connector_files = {
        "vistara.py",
        "airasiaindia.py",
        "airasia_india.py",
        "aixconnect.py",
        "aix_connect.py",
        "gofirst.py",
        "goair.py",
        "jetairways.py",
        "jet_airways.py",
        "jetair.py",
    }

    registered = _registered_sources()

    assert forbidden_source_keys.isdisjoint(registered)
    assert forbidden_source_keys.isdisjoint(engine._FAST_MODE_SOURCES)
    assert forbidden_source_keys.isdisjoint(engine._BROWSER_SOURCES)
    assert forbidden_airline_route_keys.isdisjoint(AIRLINE_COUNTRIES)
    assert not any((CONNECTORS_DIR / name).exists() for name in forbidden_connector_files)


def test_fast_india_domestic_source_mix_includes_direct_ota_meta_and_regional_sources() -> None:
    snapshot = source_selection_snapshot_for_validation(
        _request("DEL", "BOM"),
        mode="fast",
        browsers_available=True,
    )
    selected = set(snapshot.selected_sources)

    india_direct_sources = {
        "indigo_direct",
        "spicejet_direct",
        "akasa_direct",
        "airindiaexpress_direct",
    }
    india_ota_meta_sources = {
        "cleartrip_ota",
        "yatra_ota",
        "ixigo_meta",
        "easemytrip_ota",
    }
    regional_sources = {"allianceair_direct", "starair_direct"}

    assert snapshot.fast_mode is True
    assert india_direct_sources <= selected
    assert india_ota_meta_sources <= selected
    assert regional_sources <= selected
    assert all(source in engine._FAST_MODE_SOURCES for source in selected if source != "kiwi_connector")


def test_india_international_fast_routes_keep_india_and_broad_sources() -> None:
    for origin, destination in [("DEL", "DXB"), ("BOM", "SIN")]:
        snapshot = source_selection_snapshot_for_validation(
            _request(origin, destination),
            mode="fast",
            browsers_available=True,
        )
        selected = set(snapshot.selected_sources)

        assert "kiwi_connector" in selected
        assert {"cleartrip_ota", "yatra_ota", "easemytrip_ota"} <= selected
        assert {"spicejet_direct", "indigo_direct", "airindiaexpress_direct"} & selected
        assert "airindia_direct" not in selected


def test_regional_route_boundaries_preserve_broad_ota_meta_sources() -> None:
    regional_sources = {"allianceair_direct", "starair_direct"}

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

    assert regional_sources <= set(india.selected_sources)
    assert regional_sources.isdisjoint(non_india.selected_sources)
    assert {"kiwi_connector", "cleartrip_ota", "yatra_ota", "ixigo_meta"} <= set(
        india.selected_sources
    )


def test_regional_connector_failure_is_isolated_from_other_sources() -> None:
    class FailingRegionalConnector:
        async def search_flights(self, req: FlightSearchRequest) -> FlightSearchResponse:
            raise RuntimeError("regional test failure")

        async def close(self) -> None:
            return None

    class SuccessfulOtaConnector:
        async def search_flights(self, req: FlightSearchRequest) -> FlightSearchResponse:
            offer = _offer("cleartrip_ota")
            return FlightSearchResponse(
                search_id="fs_cleartrip_success",
                origin=req.origin,
                destination=req.destination,
                currency=req.currency,
                offers=[offer],
                total_results=1,
            )

        async def close(self) -> None:
            return None

    async def run_searches() -> tuple[FlightSearchResponse, FlightSearchResponse, MultiProvider]:
        provider = MultiProvider()
        failed, succeeded = await asyncio.gather(
            provider._search_connector_generic(
                FailingRegionalConnector(),
                _request("HYD", "TIR"),
                "allianceair_direct",
            ),
            provider._search_connector_generic(
                SuccessfulOtaConnector(),
                _request("HYD", "TIR"),
                "cleartrip_ota",
            ),
        )
        return failed, succeeded, provider

    failed_result, successful_result, provider = asyncio.run(run_searches())

    assert failed_result.offers == []
    assert failed_result.total_results == 0
    assert len(successful_result.offers) == 1
    assert successful_result.offers[0].source == "cleartrip_ota"
    assert provider._connector_telemetry["allianceair_direct"].ok is False
    assert provider._connector_telemetry["allianceair_direct"].error_category == "crash"
    assert provider._connector_telemetry["cleartrip_ota"].ok is True
