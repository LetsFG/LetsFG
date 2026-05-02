import asyncio
import base64
from datetime import date
from pathlib import Path

from letsfg.connectors import engine
from letsfg.connectors.airindia import AirIndiaConnectorClient
from letsfg.connectors.airline_routes import AIRLINE_COUNTRIES
from letsfg.connectors.browser import configure_max_browsers
from letsfg.connectors.checkout_engine import AIRLINE_CONFIGS
from letsfg.connectors.engine import MultiProvider, source_selection_snapshot_for_validation
from letsfg.connectors.spicejet import SpiceJetConnectorClient
from letsfg.models.flights import FlightSearchRequest, FlightSearchResponse


SDK_PYTHON_ROOT = Path(__file__).resolve().parents[1]


def _request(
    origin: str = "DEL",
    destination: str = "BOM",
    *,
    return_from: date | None = None,
) -> FlightSearchRequest:
    return FlightSearchRequest(
        origin=origin,
        destination=destination,
        date_from=date(2026, 6, 15),
        return_from=return_from,
        currency="INR",
    )


def _registered_sources() -> set[str]:
    return {source for source, _client, _timeout in engine._DIRECT_AIRLINE_connectorS}


def _fare_key(base_fare: float) -> str:
    raw = f"ignored!0:{int(base_fare * 10)}:0:0"
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def _spicejet_journey(
    origin: str,
    destination: str,
    departure: str,
    arrival: str,
    *,
    flight_no: str,
    base_fare: float,
) -> dict:
    return {
        "journeyKey": f"{origin}-{destination}-{flight_no}-{departure}",
        "designator": {
            "origin": origin,
            "destination": destination,
            "departure": departure,
            "arrival": arrival,
        },
        "segments": [
            {
                "designator": {
                    "origin": origin,
                    "destination": destination,
                    "departure": departure,
                    "arrival": arrival,
                },
                "identifier": {"carrierCode": "SG", "identifier": flight_no},
                "legs": [{"legInfo": {"equipmentType": "737"}}],
            }
        ],
        "fares": {"0": {"fareAvailabilityKey": _fare_key(base_fare)}},
    }


def test_spicejet_uses_only_canonical_source_key_in_sdk_code_and_checkout_mapping() -> None:
    legacy_source = "spicejet_direct" + "_api"

    assert "spicejet_direct" in _registered_sources()
    assert legacy_source not in _registered_sources()
    assert "spicejet_direct" in AIRLINE_CONFIGS
    assert legacy_source not in AIRLINE_CONFIGS

    for relative_path in (
        "letsfg/connectors/spicejet.py",
        "letsfg/connectors/checkout_engine.py",
    ):
        assert legacy_source not in (SDK_PYTHON_ROOT / relative_path).read_text()


def test_spicejet_parser_emits_spicejet_direct_for_one_way_and_round_trip_paths() -> None:
    client = SpiceJetConnectorClient()
    req = _request(return_from=date(2026, 6, 20))
    booking_url = "https://www.spicejet.com/"

    outbound = _spicejet_journey(
        "DEL",
        "BOM",
        "2026-06-15T08:00:00",
        "2026-06-15T10:10:00",
        flight_no="123",
        base_fare=5000.0,
    )
    inbound = _spicejet_journey(
        "BOM",
        "DEL",
        "2026-06-20T16:00:00",
        "2026-06-20T18:05:00",
        flight_no="124",
        base_fare=4500.0,
    )

    one_way = client._parse_journey(outbound, req, booking_url)
    assert one_way is not None
    assert one_way.source == "spicejet_direct"

    round_trip_offers = client._parse_availability(
        {
            "data": {
                "trips": [
                    {"journeysAvailable": [outbound]},
                    {"journeysAvailable": [inbound]},
                ]
            }
        },
        req,
    )

    assert round_trip_offers
    assert {offer.source for offer in round_trip_offers} == {"spicejet_direct"}


def test_existing_india_direct_carriers_are_route_classified_and_fast_mode_eligible() -> None:
    india_direct_sources = {
        "indigo_direct",
        "spicejet_direct",
        "akasa_direct",
        "airindiaexpress_direct",
    }
    registered = _registered_sources()

    assert india_direct_sources <= registered
    for source in india_direct_sources:
        airline_key = source.removesuffix("_direct")
        assert "IN" in AIRLINE_COUNTRIES[airline_key]
        assert source in engine._FAST_MODE_SOURCES
        assert source in engine._ECONOMY_ONLY_SOURCES

    india = source_selection_snapshot_for_validation(
        _request("DEL", "BOM"),
        mode="fast",
        browsers_available=True,
    )
    non_india = source_selection_snapshot_for_validation(
        _request("LHR", "JFK"),
        mode="fast",
        browsers_available=True,
    )

    assert india_direct_sources <= set(india.route_relevant_sources)
    assert india_direct_sources <= set(india.selected_sources)
    assert india_direct_sources.isdisjoint(non_india.route_relevant_sources)
    assert india_direct_sources.isdisjoint(non_india.selected_sources)


def test_browser_disabled_fast_india_search_keeps_api_direct_sources_and_skips_browser_sources() -> None:
    disabled = source_selection_snapshot_for_validation(
        _request("DEL", "BOM"),
        mode="fast",
        browsers_available=False,
    )

    assert "indigo_direct" in engine._BROWSER_SOURCES
    assert "indigo_direct" in disabled.browser_skipped_sources
    assert "indigo_direct" not in disabled.selected_sources

    for api_source in ("spicejet_direct", "akasa_direct", "airindiaexpress_direct"):
        assert api_source not in engine._BROWSER_SOURCES
        assert api_source in disabled.selected_sources


def test_browser_semaphore_honors_single_concurrency_for_india_browser_sources(monkeypatch) -> None:
    monkeypatch.delenv("LETSFG_MAX_BROWSERS", raising=False)
    configure_max_browsers(1)

    state = {"active": 0, "max_active": 0}
    lock = asyncio.Lock()

    class DummyBrowserConnector:
        async def search_flights(self, req: FlightSearchRequest) -> FlightSearchResponse:
            async with lock:
                state["active"] += 1
                state["max_active"] = max(state["max_active"], state["active"])
            await asyncio.sleep(0.05)
            async with lock:
                state["active"] -= 1
            return FlightSearchResponse(
                search_id="fs_dummy_browser",
                origin=req.origin,
                destination=req.destination,
                currency=req.currency,
                offers=[],
                total_results=0,
            )

        async def close(self) -> None:
            return None

    async def run_two_browser_sources() -> None:
        provider = MultiProvider()
        await asyncio.gather(
            provider._search_connector_generic(DummyBrowserConnector(), _request(), "yatra_ota"),
            provider._search_connector_generic(DummyBrowserConnector(), _request(), "travix_ota"),
        )

    try:
        asyncio.run(run_two_browser_sources())
    finally:
        configure_max_browsers(4)

    assert state["max_active"] == 1


def test_airindia_direct_remains_registered_but_non_producing() -> None:
    assert "airindia_direct" in _registered_sources()
    assert "airindia_direct" not in engine._FAST_MODE_SOURCES

    result = asyncio.run(AirIndiaConnectorClient().search_flights(_request("DEL", "BOM")))

    assert result.total_results == 0
    assert result.offers == []
