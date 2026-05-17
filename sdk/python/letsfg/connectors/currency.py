"""
Lightweight currency conversion for normalizing multi-provider flight prices.

Uses frankfurter.dev (ECB rates, free, no API key) with a simple in-memory cache.
Fallback to hardcoded rates if the API is unreachable.
"""

from __future__ import annotations

import logging
import os
import time

import httpx

logger = logging.getLogger(__name__)

# Cache: {base_currency: {target: rate, ...}, ...} + timestamp
_cache: dict[str, dict[str, float]] = {}
_cache_ts: float = 0.0
_CACHE_TTL = 3600  # 1 hour
_FX_API_BASE = os.getenv("LETSFG_FX_API_BASE", "https://api.frankfurter.dev/v2").rstrip("/")

# Hardcoded fallback rates (vs EUR) — updated April 2026
_FALLBACK_VS_EUR: dict[str, float] = {
    "EUR": 1.0,
    "USD": 1.18,
    "GBP": 0.87,
    "PLN": 4.23,
    "CZK": 24.3,
    "HUF": 363.0,
    "SEK": 10.8,
    "NOK": 11.0,
    "DKK": 7.47,
    "CHF": 0.92,
    "RON": 5.1,
    "BGN": 1.96,
    "TRY": 53.0,
    "CAD": 1.61,
    "AUD": 1.64,
    "JPY": 188.0,
    "CNY": 8.05,
    "INR": 109.5,
    "BRL": 5.87,
    "THB": 37.8,
    "ZAR": 19.3,
    "KWD": 0.36,
    "AED": 4.33,
    "SAR": 4.42,
    "KES": 153.0,
    "NGN": 1920.0,
    "EGP": 60.0,
    "MYR": 4.66,
    "SGD": 1.50,
    "HKD": 9.24,
    "NZD": 2.0,
    "MXN": 20.3,
    "ARS": 1350.0,
    "KRW": 1745.0,
    "IDR": 20270.0,
    "PHP": 70.9,
    "VND": 30500.0,
}


def _normalize_currency_code(value: str | None) -> str | None:
    if not value:
        return None
    normalized = value.strip().upper()
    if len(normalized) != 3 or not normalized.isalpha():
        return None
    return normalized


def _build_frankfurter_url(base: str) -> str:
    quotes = ",".join(sorted(code for code in _FALLBACK_VS_EUR if code != base))
    return f"{_FX_API_BASE}/rates?base={base}&quotes={quotes}"


def _parse_frankfurter_payload(payload: object, base: str) -> dict[str, float]:
    parsed: dict[str, float] = {}
    normalized_base = _normalize_currency_code(base) or "EUR"

    if not isinstance(payload, list):
        return parsed

    for row in payload:
        if not isinstance(row, dict):
            continue
        row_base = _normalize_currency_code(str(row.get("base")) if row.get("base") is not None else None)
        quote = _normalize_currency_code(str(row.get("quote")) if row.get("quote") is not None else None)
        try:
            rate = float(row.get("rate"))
        except (TypeError, ValueError):
            continue
        if row_base != normalized_base or quote is None or quote == normalized_base or rate <= 0:
            continue
        parsed[quote] = rate

    return parsed


async def fetch_rates(base: str = "EUR") -> dict[str, float]:
    """Fetch live exchange rates. Returns {currency: rate_vs_base}."""
    global _cache, _cache_ts

    base = _normalize_currency_code(base) or "EUR"

    now = time.monotonic()
    if base in _cache and (now - _cache_ts) < _CACHE_TTL:
        return _cache[base]

    # Try multiple free APIs in priority order
    apis = [
        _build_frankfurter_url(base),
        f"https://open.er-api.com/v6/latest/{base}",
    ]
    for api_url in apis:
        try:
            async with httpx.AsyncClient(timeout=5.0, follow_redirects=True) as client:
                resp = await client.get(api_url)
                resp.raise_for_status()
                data = resp.json()
                if api_url.startswith(_FX_API_BASE):
                    rates = _parse_frankfurter_payload(data, base)
                else:
                    raw_rates = data.get("rates", {}) if isinstance(data, dict) else {}
                    rates = {k: float(v) for k, v in raw_rates.items()}
                if rates:
                    _cache[base] = rates
                    _cache_ts = now
                    return _cache[base]
        except Exception as e:
            logger.debug("Exchange rate API %s unavailable: %s", api_url, e)
            continue

    return {}


def _fallback_convert(amount: float, from_cur: str, to_cur: str) -> float:
    """Convert using hardcoded fallback rates."""
    from_cur = from_cur.upper()
    to_cur = to_cur.upper()
    if from_cur == to_cur:
        return amount

    from_rate = _FALLBACK_VS_EUR.get(from_cur)
    to_rate = _FALLBACK_VS_EUR.get(to_cur)

    if from_rate is None or to_rate is None:
        return amount  # Can't convert — return as-is

    # from_cur → EUR → to_cur
    eur_amount = amount / from_rate
    return eur_amount * to_rate
