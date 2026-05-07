"""
Airport timezone utility — converts local airport datetimes to UTC.

Uses the `airportsdata` package (already a project dependency) which ships
an IANA tz identifier for every IATA airport code.

Usage
-----
from .airport_tz import local_to_utc, duration_seconds_from_local_times

dep_utc = local_to_utc(dep_naive_local, "LGW")
arr_utc = local_to_utc(arr_naive_local, "AYT")
dur_s   = int((arr_utc - dep_utc).total_seconds())
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from functools import lru_cache
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

logger = logging.getLogger(__name__)

# Lazy-loaded airport data to avoid import cost if module is never used
_AIRPORT_DB: dict | None = None


def _get_airport_db() -> dict:
    global _AIRPORT_DB
    if _AIRPORT_DB is None:
        try:
            import airportsdata
            _AIRPORT_DB = airportsdata.load("IATA")
        except Exception:
            _AIRPORT_DB = {}
    return _AIRPORT_DB


@lru_cache(maxsize=512)
def get_airport_tz(iata: str) -> ZoneInfo | None:
    """Return the ZoneInfo for an IATA airport code, or None if unknown."""
    db = _get_airport_db()
    entry = db.get(iata.upper(), {})
    tz_name = entry.get("tz", "")
    if not tz_name:
        return None
    try:
        return ZoneInfo(tz_name)
    except (ZoneInfoNotFoundError, Exception):
        logger.debug("airport_tz: unknown tz %r for %s", tz_name, iata)
        return None


def local_to_utc(local_dt: datetime, iata: str) -> datetime:
    """
    Convert a *naive* local airport datetime to UTC.

    If the airport's timezone is unknown the datetime is returned as-is
    (treated as UTC), which is the same behaviour as before this module existed.
    """
    if local_dt.tzinfo is not None:
        # Already tz-aware — just normalise to UTC
        return local_dt.astimezone(timezone.utc).replace(tzinfo=None)

    tz = get_airport_tz(iata)
    if tz is None:
        logger.debug("airport_tz: no tz for %s, treating as UTC", iata)
        return local_dt  # graceful degradation — same as old behaviour

    # fold=0 is standard (non-ambiguous) local time
    aware = local_dt.replace(tzinfo=tz)
    return aware.astimezone(timezone.utc).replace(tzinfo=None)


def duration_seconds_from_local_times(
    dep_local: datetime,
    arr_local: datetime,
    origin_iata: str,
    dest_iata: str,
) -> int:
    """
    Compute actual block-time duration in seconds from local airport times.

    Converts both times to UTC using their respective airport timezones before
    subtracting, so cross-timezone routes are correct.

    Returns 0 if the result would be negative (data error upstream).
    """
    dep_utc = local_to_utc(dep_local, origin_iata)
    arr_utc = local_to_utc(arr_local, dest_iata)
    dur = int((arr_utc - dep_utc).total_seconds())
    return max(dur, 0)
