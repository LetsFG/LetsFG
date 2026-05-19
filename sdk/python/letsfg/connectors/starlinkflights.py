"""
Starlink Flights direct source helper.

The public site search flow does not expose a simple JSON search endpoint in the
initial page load we inspected. Instead, the search UI navigates to
``/search?q=...`` and the result set is embedded in the HTML response inside
Next.js App Router RSC chunks pushed via ``self.__next_f.push``.

This module fetches that page and extracts the embedded ``initialResults``
payload so we can use the source without browser automation.
"""

from __future__ import annotations

from dataclasses import dataclass
import json
from typing import Any
from urllib.parse import quote_plus
from urllib.request import Request, urlopen


_BASE_URL = "https://www.starlinkflights.com"
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


@dataclass(frozen=True)
class StarlinkFlightsSearchItem:
    result_type: str
    result_id: int | str | None
    title: str
    subtitle: str
    has_starlink: bool
    confidence: float | None
    data: dict[str, Any]


@dataclass(frozen=True)
class StarlinkFlightsSearchResponse:
    query: str
    total: int
    query_type: str
    results: list[StarlinkFlightsSearchItem]


@dataclass(frozen=True)
class StarlinkFlightsRouteSummary:
    flight_number: str
    origin_iata: str
    destination_iata: str
    has_starlink: bool
    confidence: float | None
    starlink_likelihood: float | None
    probability_source: str
    typical_aircraft: str | None
    airline_name: str | None
    airline_iata: str | None


def build_search_url(query: str) -> str:
    normalized = query.strip()
    if not normalized:
        raise ValueError("Search query cannot be empty")
    return f"{_BASE_URL}/search?q={quote_plus(normalized)}"


def fetch_search_html(query: str, timeout: float = 15.0) -> str:
    request = Request(build_search_url(query), headers=_HEADERS)
    with urlopen(request, timeout=timeout) as response:  # noqa: S310
        return response.read().decode("utf-8", errors="replace")


def search_starlink_flights(query: str, timeout: float = 15.0) -> StarlinkFlightsSearchResponse:
    return parse_search_html(fetch_search_html(query, timeout=timeout))


def parse_search_html(html: str) -> StarlinkFlightsSearchResponse:
    decoded_chunk = _find_rsc_chunk_containing(html, '"initialResults":')
    if decoded_chunk is None:
        raise ValueError("Starlink Flights search payload not found in HTML")

    raw_results = _extract_json_value(decoded_chunk, "initialResults")
    raw_total = _extract_json_value(decoded_chunk, "initialTotal")
    raw_query = _extract_json_value(decoded_chunk, "initialQuery")
    raw_type = _extract_json_value(decoded_chunk, "initialType")

    items = [
        StarlinkFlightsSearchItem(
            result_type=str(item.get("type") or ""),
            result_id=item.get("id"),
            title=str(item.get("title") or ""),
            subtitle=str(item.get("subtitle") or ""),
            has_starlink=bool(item.get("has_starlink")),
            confidence=_coerce_float(item.get("confidence")),
            data=item.get("data") if isinstance(item.get("data"), dict) else {},
        )
        for item in raw_results
        if isinstance(item, dict)
    ]

    return StarlinkFlightsSearchResponse(
        query=str(raw_query or ""),
        total=int(raw_total or 0),
        query_type=str(raw_type or ""),
        results=items,
    )


def select_route_result(
    response: StarlinkFlightsSearchResponse,
    flight_number: str,
) -> StarlinkFlightsSearchItem | None:
    normalized = _normalize_flight_number(flight_number)
    for item in response.results:
        if item.result_type != "route":
            continue
        candidate = _normalize_flight_number(str(item.data.get("flight_number") or item.title))
        if candidate == normalized:
            return item
    return None


def summarize_route_result(item: StarlinkFlightsSearchItem) -> StarlinkFlightsRouteSummary:
    if item.result_type != "route":
        raise ValueError("Expected a route result")

    airline = item.data.get("airline") if isinstance(item.data.get("airline"), dict) else {}
    return StarlinkFlightsRouteSummary(
        flight_number=str(item.data.get("flight_number") or item.title),
        origin_iata=str(item.data.get("origin_iata") or ""),
        destination_iata=str(item.data.get("destination_iata") or ""),
        has_starlink=item.has_starlink,
        confidence=item.confidence,
        starlink_likelihood=_coerce_float(
            item.data.get("starlink_likelihood") or item.data.get("probability")
        ),
        probability_source=str(item.data.get("probability_source") or ""),
        typical_aircraft=(
            str(
                item.data.get("typical_aircraft_type")
                or item.data.get("typical_aircraft")
                or item.data.get("dominant_aircraft")
            )
            if (
                item.data.get("typical_aircraft_type")
                or item.data.get("typical_aircraft")
                or item.data.get("dominant_aircraft")
            )
            else None
        ),
        airline_name=(str(airline.get("name")) if airline.get("name") else None),
        airline_iata=(
            str(airline.get("iata_code") or item.data.get("airline_iata"))
            if airline.get("iata_code") or item.data.get("airline_iata")
            else None
        ),
    )


def _find_rsc_chunk_containing(html: str, marker: str) -> str | None:
    for chunk in _iter_next_rsc_chunks(html):
        decoded = _decode_js_string_literal(chunk)
        if marker in decoded:
            return decoded
    return None


def _iter_next_rsc_chunks(html: str):
    marker = 'self.__next_f.push([1,"'
    terminator = '"])</script>'
    index = 0
    while True:
        start = html.find(marker, index)
        if start < 0:
            return

        cursor = start + len(marker)
        buffer: list[str] = []

        while cursor < len(html):
            char = html[cursor]
            if char == '"' and html.startswith(terminator, cursor):
                yield "".join(buffer)
                index = cursor + len(terminator)
                break
            buffer.append(char)
            cursor += 1
        else:
            return


def _decode_js_string_literal(value: str) -> str:
    return json.loads(f'"{value}"')


def _extract_json_value(chunk: str, key: str) -> Any:
    marker = f'"{key}":'
    start = chunk.find(marker)
    if start < 0:
        raise ValueError(f"Missing {key} in Starlink Flights payload")

    payload = chunk[start + len(marker):].lstrip()
    decoder = json.JSONDecoder()
    value, _ = decoder.raw_decode(payload)
    return value


def _coerce_float(value: Any) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def _normalize_flight_number(value: str) -> str:
    return "".join(char for char in value.upper() if char.isalnum())
