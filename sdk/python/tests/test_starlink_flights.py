import json

import pytest

from letsfg.connectors.starlinkflights import (
    build_search_url,
    parse_search_html,
    select_route_result,
    summarize_route_result,
)


def _build_rsc_chunk(payload: str) -> str:
    return f'<script>self.__next_f.push([1,{json.dumps(payload)}])</script>'


def _build_search_html() -> str:
    search_state = {
        "initialResults": [
            {
                "type": "airline",
                "id": 1,
                "title": "United Airlines Flight UA1234",
                "subtitle": "505/991 aircraft equipped (51%)",
                "has_starlink": True,
                "confidence": 0.755,
                "data": {
                    "iata_code": "UA",
                    "fleet_size": 991,
                    "equipped_count": 505,
                },
            },
            {
                "type": "route",
                "id": 764736,
                "title": "UA1234: GEG \u2192 DEN",
                "subtitle": "United Airlines route",
                "has_starlink": True,
                "confidence": 0.51,
                "data": {
                    "flight_number": "UA1234",
                    "origin_iata": "GEG",
                    "destination_iata": "DEN",
                    "typical_aircraft_type": "B39M",
                    "starlink_likelihood": 51,
                    "probability_source": "fleet_ratio",
                    "airline": {
                        "name": "United Airlines",
                        "iata_code": "UA",
                        "fleet_size": 991,
                        "equipped_count": 505,
                    },
                },
            },
        ],
        "initialTotal": 2,
        "initialQuery": "UA1234",
        "initialType": "all",
    }
    rsc_payload = '11:["$","$L1c",null,' + json.dumps(search_state, separators=(",", ":")) + ']\n'
    return "".join(
        [
            _build_rsc_chunk("0:{}\n"),
            _build_rsc_chunk(rsc_payload),
            _build_rsc_chunk("2:null\n"),
        ]
    )


def test_build_search_url_encodes_query():
    assert build_search_url("UA 1234") == "https://www.starlinkflights.com/search?q=UA+1234"


def test_build_search_url_rejects_empty_query():
    with pytest.raises(ValueError):
        build_search_url("   ")


def test_parse_search_html_extracts_embedded_results():
    parsed = parse_search_html(_build_search_html())

    assert parsed.query == "UA1234"
    assert parsed.total == 2
    assert parsed.query_type == "all"
    assert len(parsed.results) == 2

    route_result = parsed.results[1]
    assert route_result.result_type == "route"
    assert route_result.title == "UA1234: GEG \u2192 DEN"
    assert route_result.has_starlink is True
    assert route_result.confidence == 0.51
    assert route_result.data["flight_number"] == "UA1234"
    assert route_result.data["starlink_likelihood"] == 51
    assert route_result.data["airline"]["equipped_count"] == 505


def test_select_route_result_matches_normalized_flight_number():
    parsed = parse_search_html(_build_search_html())

    selected = select_route_result(parsed, "ua 1234")

    assert selected is not None
    assert selected.result_id == 764736
    assert selected.data["origin_iata"] == "GEG"
    assert select_route_result(parsed, "UA9999") is None


def test_summarize_route_result_normalizes_live_field_names():
    parsed = parse_search_html(_build_search_html())
    selected = select_route_result(parsed, "UA1234")

    assert selected is not None

    summary = summarize_route_result(selected)

    assert summary.flight_number == "UA1234"
    assert summary.origin_iata == "GEG"
    assert summary.destination_iata == "DEN"
    assert summary.starlink_likelihood == 51.0
    assert summary.probability_source == "fleet_ratio"
    assert summary.typical_aircraft == "B39M"
    assert summary.airline_name == "United Airlines"
    assert summary.airline_iata == "UA"


def test_parse_search_html_raises_when_payload_is_missing():
    with pytest.raises(ValueError):
        parse_search_html("<html><body>no search payload</body></html>")
