from __future__ import annotations

import asyncio
import re
from datetime import date, datetime

from letsfg.connectors import engine
from letsfg.connectors.airindia import AirIndiaConnectorClient
from letsfg.connectors.easemytrip import _parse_response as _parse_easemytrip
from letsfg.connectors.engine import source_selection_snapshot_for_validation
from letsfg.models.flights import (
    FlightOffer,
    FlightRoute,
    FlightSearchRequest,
    FlightSearchResponse,
    FlightSegment,
)


def _request(
    origin: str = "DEL",
    destination: str = "BOM",
) -> FlightSearchRequest:
    return FlightSearchRequest(
        origin=origin,
        destination=destination,
        date_from=date(2026, 6, 15),
        currency="INR",
    )


def _registered_sources() -> set[str]:
    return {source for source, _client, _timeout in engine._DIRECT_AIRLINE_connectorS}


def _normalized_airindia_name(name: str) -> str:
    """Normalize source/file names so air_india, air-india, and airindia match."""
    return re.sub(r"[^a-z0-9]", "", name.lower())


def test_airindia_direct_is_registered_but_excluded_from_all_active_source_sets() -> None:
    """airindia_direct must be in the connector registry (for import integrity)
    but must NOT appear in fast-mode, browser, or economy-only source sets.

    Being in those sets would make it act as an active producing connector.
    """
    registered = _registered_sources()

    assert "airindia_direct" in registered, (
        "airindia_direct should remain in the registry as a non-producing stub "
        "to preserve import/checkout-engine integrity."
    )
    airindia_like_registry_sources = sorted(
        source
        for source in registered
        if _normalized_airindia_name(source).startswith("airindia")
        and source != "airindiaexpress_direct"
    )
    assert airindia_like_registry_sources == ["airindia_direct"], (
        f"Unexpected Air India-like registry sources found: {airindia_like_registry_sources}. "
        "Only the non-producing airindia_direct stub is permitted; "
        "Air India Express remains the separate active IX connector."
    )
    assert "airindia_direct" not in engine._FAST_MODE_SOURCES, (
        "airindia_direct must not be in _FAST_MODE_SOURCES — it is a non-producing stub."
    )
    assert "airindia_direct" not in engine._BROWSER_SOURCES, (
        "airindia_direct must not be in _BROWSER_SOURCES — it makes no HTTP or browser calls."
    )
    assert "airindia_direct" not in engine._ECONOMY_ONLY_SOURCES, (
        "airindia_direct must not be in _ECONOMY_ONLY_SOURCES — it is non-producing."
    )


def test_airindia_direct_is_excluded_from_fast_mode_and_skipped_for_india_routes() -> None:
    """airindia_direct must not appear in fast-mode selected sources.

    Fast mode is the primary user-facing search path. airindia_direct is a
    non-producing stub and must remain excluded from fast mode so users never
    experience a wasted connector slot for Air India.

    For India routes, airindia_direct may appear as route-relevant (since Air
    India serves India) but must be in fast_skipped_sources — excluded because
    it is not in _FAST_MODE_SOURCES.
    """
    for origin, destination in [
        ("DEL", "BOM"),
        ("BLR", "DEL"),
        ("DEL", "DXB"),
        ("LHR", "JFK"),
    ]:
        snapshot_fast = source_selection_snapshot_for_validation(
            _request(origin, destination),
            mode="fast",
            browsers_available=True,
        )
        assert "airindia_direct" not in snapshot_fast.selected_sources, (
            f"airindia_direct must not be selected for {origin}->{destination} "
            "(fast mode, browsers available) — stub must remain fast-mode excluded."
        )

    # For India routes: route-relevant but must be in fast_skipped_sources
    india_snap = source_selection_snapshot_for_validation(
        _request("DEL", "BOM"),
        mode="fast",
        browsers_available=True,
    )
    if "airindia_direct" in india_snap.route_relevant_sources:
        assert "airindia_direct" in india_snap.fast_skipped_sources, (
            "airindia_direct is route-relevant for DEL->BOM in fast mode, "
            "so it must appear in fast_skipped_sources (i.e. excluded from fast mode)."
        )

    # For any route where airindia_direct is route-relevant: it must always be
    # in fast_skipped_sources (never selected in fast mode).
    for origin, destination in [("LHR", "JFK"), ("DEL", "DXB"), ("BOM", "SIN")]:
        snap = source_selection_snapshot_for_validation(
            _request(origin, destination),
            mode="fast",
            browsers_available=True,
        )
        assert "airindia_direct" not in snap.selected_sources, (
            f"airindia_direct must never be selected in fast mode for {origin}->{destination}."
        )
        if "airindia_direct" in snap.route_relevant_sources:
            assert "airindia_direct" in snap.fast_skipped_sources, (
                f"airindia_direct is route-relevant for {origin}->{destination} in fast mode "
                "but must be in fast_skipped_sources (not in _FAST_MODE_SOURCES)."
            )


def test_airindia_connector_returns_zero_offers_for_one_way() -> None:
    """AirIndiaConnectorClient must return an empty result for any route."""
    result = asyncio.run(
        AirIndiaConnectorClient().search_flights(_request("DEL", "BOM"))
    )
    assert result.total_results == 0
    assert result.offers == []


def test_airindia_connector_returns_zero_offers_for_round_trip() -> None:
    """AirIndiaConnectorClient must return an empty result even for round-trip requests."""
    req = FlightSearchRequest(
        origin="DEL",
        destination="BOM",
        date_from=date(2026, 6, 15),
        return_from=date(2026, 6, 22),
        currency="INR",
    )
    result = asyncio.run(AirIndiaConnectorClient().search_flights(req))
    assert result.total_results == 0
    assert result.offers == []


def test_easemytrip_parser_can_surface_air_india_branded_offer_with_ota_source() -> None:
    """Air India-branded offers must appear with an OTA source key, not airindia_direct.

    This test uses a representative EaseMyTrip payload that includes Air India
    segments and verifies the resulting offer has source='easemytrip_ota'.
    """
    payload = {
        "CC": "INR",
        "C": {"AI": "Air India"},
        "dctFltDtl": {
            "0": {
                "OG": "DEL",
                "DT": "BOM",
                "DDT": "Mon-15Jun2026",
                "ADT": "Mon-15Jun2026",
                "DTM": "07:00",
                "ATM": "09:10",
                "FN": "657",
                "AC": "AI",
                "CB": "ECONOMY",
                "DUR": "02h 10m",
                "FlightName": "Air India",
            }
        },
        "j": [
            {
                "s": [
                    {
                        "id": 1,
                        "SK": "ai-del-bom-657",
                        "TF": 6200,
                        "b": [{"FL": [0], "JyTm": "02h 10m", "stp": "0"}],
                    }
                ]
            }
        ],
    }
    req = _request("DEL", "BOM")
    offers = _parse_easemytrip(payload, req)

    assert len(offers) == 1, "Expected one Air India offer parsed from EaseMyTrip payload."
    offer = offers[0]

    # Airline attribution is Air India (the carrier)
    assert "Air India" in offer.airlines, (
        "Expected 'Air India' in offer.airlines for an AI-operated segment."
    )
    # Source is the OTA, not the direct Air India connector
    assert offer.source == "easemytrip_ota", (
        f"Air India offer via EaseMyTrip must have source='easemytrip_ota', "
        f"got {offer.source!r}. Direct Air India source attribution is prohibited."
    )
    assert offer.source_tier == "ota", (
        "source_tier must be 'ota' for EaseMyTrip-attributed Air India offers."
    )
    assert "airindia_direct" not in offer.source


def test_no_active_connector_emits_airindia_direct_as_source_key() -> None:
    """No registered connector should emit 'airindia_direct' as an offer source.

    The source key 'airindia_direct' is reserved for the non-producing stub.
    Any Air India offers from OTAs must use their OTA source key.
    """
    # The only connector registered for airindia_direct is AirIndiaConnectorClient
    # which always returns zero offers. Verify the stub itself emits no offers.
    result = asyncio.run(
        AirIndiaConnectorClient().search_flights(_request("DEL", "BOM"))
    )
    assert not any(o.source == "airindia_direct" for o in result.offers), (
        "airindia_direct must never appear as a source on any returned offer."
    )

    # Also verify the known India OTA sources do NOT emit airindia_direct
    from letsfg.connectors.easemytrip import _parse_response as _parse_emt

    # Empty payloads should return no offers
    assert _parse_emt({}, _request()) == []

    # A payload with AI segments via EaseMyTrip must NOT use airindia_direct
    ai_payload = {
        "CC": "INR",
        "C": {"AI": "Air India"},
        "dctFltDtl": {
            "0": {
                "OG": "DEL", "DT": "BOM", "DDT": "Mon-15Jun2026",
                "ADT": "Mon-15Jun2026", "DTM": "07:00", "ATM": "09:10",
                "FN": "657", "AC": "AI", "DUR": "02h 10m",
                "FlightName": "Air India",
            }
        },
        "j": [{"s": [{"id": 1, "TF": 6200, "b": [{"FL": [0], "JyTm": "02h 10m", "stp": "0"}]}]}],
    }
    ai_offers = _parse_emt(ai_payload, _request("DEL", "BOM"))
    for offer in ai_offers:
        assert offer.source != "airindia_direct", (
            f"EaseMyTrip offer has source={offer.source!r}; "
            "must not be 'airindia_direct'."
        )


def test_registry_wrapper_overrides_poisoned_airindia_direct_source_from_ota() -> None:
    """Registry execution must tag Air India-branded OTA offers with the OTA source.

    This guards the active engine path, not just individual parser functions:
    even if an OTA connector accidentally returns an Air India-branded offer
    with source='airindia_direct', the registry wrapper must emit the active
    registered source key instead.
    """

    class DummyAirIndiaOtaConnector:
        async def search_flights(self, req: FlightSearchRequest) -> FlightSearchResponse:
            segment = FlightSegment(
                airline="AI",
                airline_name="Air India",
                flight_no="AI657",
                origin=req.origin,
                destination=req.destination,
                departure=datetime(2026, 6, 15, 7, 0),
                arrival=datetime(2026, 6, 15, 9, 10),
                duration_seconds=7800,
            )
            route = FlightRoute(
                segments=[segment],
                total_duration_seconds=7800,
                stopovers=0,
            )
            poisoned_offer = FlightOffer(
                id="dummy_ai_ota_offer",
                price=6200,
                currency=req.currency,
                outbound=route,
                airlines=["Air India"],
                owner_airline="Air India",
                source="airindia_direct",
                source_tier="free",
                booking_url="https://example.invalid/airindia-ota",
            )
            return FlightSearchResponse(
                search_id="dummy_ai_ota_search",
                origin=req.origin,
                destination=req.destination,
                currency=req.currency,
                offers=[poisoned_offer],
                total_results=1,
            )

        async def close(self) -> None:
            return None

    provider = engine.MultiProvider()
    result = asyncio.run(
        provider._search_connector_generic(
            DummyAirIndiaOtaConnector(),
            _request("DEL", "BOM"),
            "easemytrip_ota",
        )
    )

    assert len(result.offers) == 1
    offer = result.offers[0]
    assert "Air India" in offer.airlines
    assert offer.source == "easemytrip_ota", (
        "Air India-branded offers returned through an OTA registry entry "
        "must be attributed to that OTA source key."
    )
    assert offer.source != "airindia_direct"
    assert set(provider._connector_telemetry) == {"easemytrip_ota"}
    assert provider._connector_telemetry["easemytrip_ota"].ok is True
