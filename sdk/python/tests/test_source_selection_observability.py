import json
import os
import subprocess
import sys
from datetime import date
from pathlib import Path

from letsfg.connectors.engine import source_selection_snapshot_for_validation
from letsfg.models.flights import FlightSearchRequest


PROJECT_ROOT = Path(__file__).resolve().parents[3]
SDK_PYTHON_ROOT = PROJECT_ROOT / "sdk" / "python"


def _request(
    origin: str,
    destination: str,
    *,
    cabin_class: str | None = None,
) -> FlightSearchRequest:
    return FlightSearchRequest(
        origin=origin,
        destination=destination,
        date_from=date(2026, 6, 15),
        cabin_class=cabin_class,
    )


def test_source_selection_helper_distinguishes_india_and_non_india_routes() -> None:
    india = source_selection_snapshot_for_validation(
        _request("DEL", "BOM"),
        browsers_available=True,
    )
    non_india = source_selection_snapshot_for_validation(
        _request("LHR", "JFK"),
        browsers_available=True,
    )

    india_sources = set(india.selected_sources)
    non_india_sources = set(non_india.selected_sources)

    assert india.attempted_sources == india.selected_sources
    assert "kiwi_connector" in india_sources
    assert "kiwi_connector" in non_india_sources

    india_direct_sources = {
        "indigo_direct",
        "spicejet_direct",
        "akasa_direct",
        "airindiaexpress_direct",
    }
    india_route_ota_sources = {
        "cleartrip_ota",
        "yatra_ota",
        "ixigo_meta",
        "musafir_ota",
        "akbartravels_ota",
    }
    assert india_direct_sources <= india_sources
    assert india_route_ota_sources <= india_sources
    assert india_direct_sources.isdisjoint(non_india_sources)


def test_fast_mode_source_selection_is_observable_without_running_connectors() -> None:
    snapshot = source_selection_snapshot_for_validation(
        _request("DEL", "BOM"),
        mode="fast",
        browsers_available=True,
    )

    assert snapshot.fast_mode is True
    assert "kiwi_connector" in snapshot.special_sources
    assert "cleartrip_ota" in snapshot.selected_sources
    assert "yatra_ota" in snapshot.selected_sources
    assert "ixigo_meta" in snapshot.selected_sources
    assert "musafir_ota" in snapshot.selected_sources
    assert "akbartravels_ota" in snapshot.selected_sources
    assert "indigo_direct" in snapshot.selected_sources
    assert "spicejet_direct" in snapshot.selected_sources
    assert "akasa_direct" in snapshot.selected_sources
    assert "airindiaexpress_direct" in snapshot.selected_sources


def test_browser_disabled_selection_skips_browser_sources_but_keeps_api_sources() -> None:
    enabled = source_selection_snapshot_for_validation(
        _request("DEL", "BOM"),
        mode="fast",
        browsers_available=True,
    )
    disabled = source_selection_snapshot_for_validation(
        _request("DEL", "BOM"),
        mode="fast",
        browsers_available=False,
    )

    assert "yatra_ota" in enabled.browser_sources
    assert "musafir_ota" in enabled.browser_sources
    assert "akbartravels_ota" in enabled.browser_sources

    assert "yatra_ota" in disabled.browser_skipped_sources
    assert "musafir_ota" in disabled.browser_skipped_sources
    assert "akbartravels_ota" in disabled.browser_skipped_sources
    assert "yatra_ota" not in disabled.selected_sources
    assert "musafir_ota" not in disabled.selected_sources
    assert "akbartravels_ota" not in disabled.selected_sources

    assert "kiwi_connector" in disabled.selected_sources
    assert "cleartrip_ota" in disabled.selected_sources
    assert set(disabled.browser_sources).isdisjoint(disabled.selected_sources)


def test_browser_env_transitions_are_validated_in_fresh_subprocesses() -> None:
    enabled = _run_browser_env_snapshot("1")
    disabled = _run_browser_env_snapshot("0")

    assert enabled["browsers_available"] is True
    assert disabled["browsers_available"] is False

    assert "yatra_ota" in enabled["browser_sources"]
    assert "yatra_ota" in enabled["selected_sources"]
    assert "yatra_ota" in disabled["browser_skipped_sources"]
    assert "yatra_ota" not in disabled["selected_sources"]

    assert "kiwi_connector" in enabled["selected_sources"]
    assert "kiwi_connector" in disabled["selected_sources"]
    assert "cleartrip_ota" in enabled["selected_sources"]
    assert "cleartrip_ota" in disabled["selected_sources"]


def _run_browser_env_snapshot(letsfg_browsers: str) -> dict:
    script = """
import json
from datetime import date

from letsfg.connectors import engine
from letsfg.models.flights import FlightSearchRequest

req = FlightSearchRequest(origin="DEL", destination="BOM", date_from=date(2026, 6, 15))
snapshot = engine.source_selection_snapshot_for_validation(req, mode="fast")
print(json.dumps({
    "browsers_available": snapshot.browsers_available,
    "selected_sources": list(snapshot.selected_sources),
    "browser_sources": list(snapshot.browser_sources),
    "browser_skipped_sources": list(snapshot.browser_skipped_sources),
}))
"""
    env = os.environ.copy()
    env["LETSFG_BROWSERS"] = letsfg_browsers
    env.pop("LETSFG_BROWSER_WS", None)
    env["PYTHONPATH"] = (
        f"{SDK_PYTHON_ROOT}{os.pathsep}{env['PYTHONPATH']}"
        if env.get("PYTHONPATH")
        else str(SDK_PYTHON_ROOT)
    )
    result = subprocess.run(
        [sys.executable, "-c", script],
        check=True,
        capture_output=True,
        text=True,
        cwd=SDK_PYTHON_ROOT,
        env=env,
    )
    return json.loads(result.stdout)
