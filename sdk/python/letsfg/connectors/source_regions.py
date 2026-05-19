"""Country and region filters for local flight-search sources."""

from __future__ import annotations

import re
from collections.abc import Iterable
from typing import Optional

from .airline_routes import AIRLINE_COUNTRIES, get_country


GLOBAL_AGGREGATORS = frozenset({
    "kiwi_connector",
    "skyscanner_meta",
    "kayak_meta",
    "momondo_meta",
    "skiplagged_meta",
    "aviasales_meta",
    "wego_meta",
    "cheapflights_meta",
    "agoda_meta",
    "ixigo_meta",
})

EXEMPT_SOURCES = frozenset({
    "aircairo_direct",
    "hkexpress_direct",
    "serpapi_google",
})

REGIONS = {
    "latin-america": frozenset({"AR", "BR", "CL", "CO", "PE", "MX", "UY", "EC", "BO", "PY", "VE", "DO", "PA", "CR", "GT", "HN", "NI", "SV", "JM", "CU"}),
    "eu": frozenset({"AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "GB", "CH", "NO", "IS"}),
    "mena": frozenset({"AE", "SA", "KW", "QA", "BH", "OM", "JO", "LB", "EG", "MA", "TN", "DZ", "IL", "TR"}),
    "asia": frozenset({"CN", "HK", "TW", "JP", "KR", "SG", "MY", "TH", "VN", "PH", "ID", "IN", "BD", "PK", "LK", "MM", "KH", "LA", "MO"}),
    "africa": frozenset({"ZA", "KE", "ET", "NG", "GH", "TZ", "UG", "RW", "MA", "EG", "TN", "DZ", "SN", "CI"}),
    "north-america": frozenset({"US", "CA", "MX"}),
    "oceania": frozenset({"AU", "NZ", "FJ", "PG", "VU", "SB", "WS", "TO"}),
}

_TIER2 = {
    "despegar_ota": {"AR", "BR", "MX", "CL", "CO", "PE", "UY", "EC", "BO", "PY", "VE", "US"},
    "tripcom_ota": {"CN", "HK", "TW", "SG", "MY", "ID", "TH", "VN", "PH", "JP", "KR", "AE", "AU", "GB", "US", "FR", "DE", "IT", "ES", "BR", "MX"},
    "easemytrip_ota": {"IN", "AE", "US", "GB", "SG", "AU"},
    "almosafer_ota": {"SA", "AE", "KW", "QA", "BH", "OM", "EG", "JO"},
    "yatra_ota": {"IN"},
    "cleartrip_ota": {"IN", "AE", "SA", "KW", "QA", "BH", "OM"},
    "akbartravels_ota": {"IN", "AE"},
    "musafir_ota": {"AE", "IN", "SA"},
    "rehlat_ota": {"AE", "SA", "KW", "QA"},
    "traveloka_ota": {"ID", "TH", "VN", "PH", "MY", "SG", "AU"},
    "tiket_ota": {"ID"},
    "webjet_ota": {"AU", "NZ"},
    "auntbetty_ota": {"AU", "NZ"},
    "byojet_ota": {"AU", "NZ"},
    "flightcatchers_ota": {"GB"},
    "traveltrolley_ota": {"GB"},
    "travelup_ota": {"GB"},
    "lastminute_ota": {"GB", "IT", "ES", "FR", "DE", "NL", "IE", "BE"},
    "opodo_ota": {"GB", "FR", "DE", "IT", "ES", "SE", "NL", "PL"},
    "edreams_ota": {"ES", "IT", "FR", "GB", "DE", "PT", "AT", "CH", "NL", "BE", "SE", "DK", "FI", "NO", "PL"},
    "etraveli_ota": {"SE", "NO", "DK", "FI", "DE", "GB", "FR"},
    "esky_ota": {"PL", "CZ", "HU", "SK", "RO"},
    "bookingcom_ota": {"NL", "GB", "US", "FR", "DE", "IT", "ES", "BR", "MX", "JP", "CN", "IN", "AU"},
    "airasiamove_ota": {"MY", "TH", "ID", "PH", "SG", "VN"},
    "his_ota": {"JP"},
}


def _build_connector_countries() -> dict[str, frozenset[str]]:
    countries: dict[str, frozenset[str]] = {
        f"{airline_key}_direct": frozenset(values)
        for airline_key, values in AIRLINE_COUNTRIES.items()
    }
    if "wizz" in AIRLINE_COUNTRIES:
        countries["wizzair_direct"] = frozenset(AIRLINE_COUNTRIES["wizz"])
    for airline_key, values in AIRLINE_COUNTRIES.items():
        for suffix in ("_api", "_calendar", "_scraper", "_ota", "_meta", "_connector"):
            countries.setdefault(f"{airline_key}{suffix}", frozenset(values))
    countries.update({source_id: frozenset(values) for source_id, values in _TIER2.items()})
    # Global aggregators are a disjoint category — opt-in via --include-global.
    # Strip them from the country map so the default filter excludes them.
    for source_id in GLOBAL_AGGREGATORS:
        countries.pop(source_id, None)
    return countries


CONNECTOR_COUNTRIES = _build_connector_countries()


def normalize_country_codes(values: Iterable[str]) -> frozenset[str]:
    """Normalize repeated or comma-separated ISO alpha-2 country values."""
    codes: set[str] = set()
    for value in values:
        for part in str(value).split(","):
            code = part.strip().upper()
            if not code:
                continue
            if not re.fullmatch(r"[A-Z]{2}", code):
                raise ValueError(f"Invalid country code '{part.strip()}'. Use ISO alpha-2 codes like BR or US.")
            codes.add(code)
    if not codes:
        raise ValueError("At least one country code is required.")
    return frozenset(codes)


def resolve_country_filter(
    country: Optional[Iterable[str]],
    region: Optional[str],
) -> Optional[frozenset[str]]:
    """Combine explicit country codes and a predefined region into one filter."""
    if country is None and region is None:
        return None

    selected: set[str] = set()
    if country is not None:
        selected.update(normalize_country_codes(country))

    if region is not None:
        region_key = region.strip().lower()
        if region_key not in REGIONS:
            valid = ", ".join(sorted(REGIONS))
            raise ValueError(f"Unknown region '{region}'. Valid regions: {valid}.")
        selected.update(REGIONS[region_key])

    return frozenset(selected)


def route_touches_country(origin: str, dest: str, country_filter: frozenset[str]) -> bool:
    """Return True when either endpoint country matches, failing open for unknown endpoints."""
    origin_country = get_country(origin)
    dest_country = get_country(dest)
    if origin_country is None or dest_country is None:
        return True
    return origin_country in country_filter or dest_country in country_filter


def connector_matches_market(
    source_id: str,
    country_filter: Optional[frozenset[str]],
    include_global: bool,
) -> bool:
    """Return True when the source market overlaps the active country filter."""
    if country_filter is None:
        return True
    if source_id in GLOBAL_AGGREGATORS:
        return include_global
    source_countries = CONNECTOR_COUNTRIES.get(source_id)
    if source_countries is None:
        return False
    return bool(source_countries & country_filter)


def passes_country_filter(
    source_id: str,
    origin: str,
    dest: str,
    country_filter: Optional[frozenset[str]],
    include_global: bool,
) -> bool:
    """Apply source-market and endpoint-country semantics together."""
    if country_filter is None:
        return True
    return (
        connector_matches_market(source_id, country_filter, include_global)
        and route_touches_country(origin, dest, country_filter)
    )
