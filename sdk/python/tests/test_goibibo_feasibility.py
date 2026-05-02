from __future__ import annotations

from pathlib import Path

from letsfg.connectors import engine
from letsfg.connectors.airline_routes import AIRLINE_COUNTRIES
from letsfg.connectors.engine import source_selection_snapshot_for_validation
from letsfg.models.flights import FlightSearchRequest


REPO_ROOT = Path(__file__).resolve().parents[3]
CONNECTORS_DIR = REPO_ROOT / "sdk" / "python" / "letsfg" / "connectors"

GOIBIBO_SKIP_DECISION = {
    "decision": "skip",
    "source_key": "goibibo_ota",
    "reason": (
        "Goibibo is intentionally not wired as an active connector: public probes "
        "show the usable flight-search surface is a Goibibo-branded MakeMyTrip "
        "SSR/asset stack rather than a distinct credential-free API, while the "
        "historical developer API requires app_id/app_key credentials and the "
        "internal MMT endpoints exposed in page templates are not public DNS names."
    ),
    "evidence": [
        "Public route page https://www.goibibo.com/flights/delhi-to-mumbai-flights/ returned SSR content with isGoibibo=true, MakeMyTrip Limited legal text, and mmtcdn/flights-cms-seo assets.",
        "The same route page exposed template URLs on flights-ui-seo.ecs.mmt and flights-cbackend.ecs.mmt, which failed DNS resolution when probed directly.",
        "https://developer.goibibo.com/docs and https://developer.goibibo.com/api/search/ failed public DNS resolution from the validator environment.",
        "The public API directory documents the legacy Goibibo flight search API as requiring app_id and app_key credentials.",
        "https://www.goibibo.com/flights/ was Akamai-blocked/timed out during direct public probes, so no stable browser-free listing path was confirmed.",
    ],
}


def _request(origin: str = "DEL", destination: str = "BOM") -> FlightSearchRequest:
    return FlightSearchRequest(
        origin=origin,
        destination=destination,
        date_from="2026-06-15",
        currency="INR",
    )


def _registered_sources() -> set[str]:
    return {source for source, _client, _timeout in engine._DIRECT_AIRLINE_connectorS}


def test_goibibo_skip_decision_is_explicit_and_credential_safe() -> None:
    assert GOIBIBO_SKIP_DECISION["decision"] == "skip"
    assert GOIBIBO_SKIP_DECISION["source_key"] == "goibibo_ota"
    assert "credential-free API" in GOIBIBO_SKIP_DECISION["reason"]
    assert "app_id/app_key credentials" in GOIBIBO_SKIP_DECISION["reason"]
    assert len(GOIBIBO_SKIP_DECISION["evidence"]) >= 4
    assert any("mmtcdn" in item and "MakeMyTrip" in item for item in GOIBIBO_SKIP_DECISION["evidence"])
    assert any("app_id" in item and "app_key" in item for item in GOIBIBO_SKIP_DECISION["evidence"])


def test_goibibo_is_not_partially_registered_or_route_selected() -> None:
    registered = _registered_sources()
    assert "goibibo_ota" not in registered
    assert "goibibo" not in AIRLINE_COUNTRIES
    assert "goibibo_ota" not in engine._BROWSER_SOURCES
    assert "goibibo_ota" not in engine._FAST_MODE_SOURCES

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

    assert "goibibo_ota" not in india.route_relevant_sources
    assert "goibibo_ota" not in india.selected_sources
    assert "goibibo_ota" not in non_india.route_relevant_sources
    assert "goibibo_ota" not in non_india.selected_sources


def test_no_goibibo_connector_file_or_engine_wiring_exists_without_full_tests() -> None:
    assert not (CONNECTORS_DIR / "goibibo.py").exists()

    for relative_path in [
        "sdk/python/letsfg/connectors/engine.py",
        "sdk/python/letsfg/connectors/airline_routes.py",
    ]:
        text = (REPO_ROOT / relative_path).read_text()
        assert "goibibo_ota" not in text
        assert "GoibiboConnector" not in text
