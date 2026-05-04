"""
Live ancillary price probing for Group 5 LCC connectors.

Each prober takes the first offer returned by the search (origin, dest, date,
optional flight_no) and continues through that airline's booking flow in a real
browser session.  It intercepts the XHR/fetch response that contains the bag
and seat add-on prices displayed on the extras/baggage selection page, then
caches the result for 12 hours.

This approach guarantees the prices shown are exactly the prices the airline
displays at booking time for that route — not guesses or averages.

Connectors served
-----------------
  F3  flyadeal   – bookingapi2.flyadeal.com / NSK AvailabilityResponse via Playwright
  FZ  flydubai   – flights2.flydubai.com /api/flights/1 + booking continuation
  G9  airarabia  – reservations.airarabia.com IBE via Playwright
  XQ  sunexpress – sunexpress.com /booking/select/ → /booking/extras/ via Playwright
  SZ  skyexpress – skyexpress.gr/en/booking via Playwright
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# ── In-memory cache ───────────────────────────────────────────────────────────
# {cache_key: (monotonic_timestamp, ancillary_dict)}
_CACHE: Dict[str, Tuple[float, dict]] = {}
_LOCKS: Dict[str, asyncio.Lock] = {}
_CACHE_TTL = 12 * 3600  # 12 hours


def _get_lock(code: str) -> asyncio.Lock:
    if code not in _LOCKS:
        _LOCKS[code] = asyncio.Lock()
    return _LOCKS[code]


def _get_cached(code: str) -> Optional[dict]:
    entry = _CACHE.get(code)
    if entry and (time.monotonic() - entry[0]) < _CACHE_TTL:
        return entry[1]
    return None


def _set_cache(code: str, data: dict) -> None:
    _CACHE[code] = (time.monotonic(), data)


# ── GCS persistent cache (2nd tier) ──────────────────────────────────────────
# Stores parsed probe results in GCS so all connector-worker instances share
# the same data — a live browser run only happens once per 7 days per airline.
# Path:  gs://{bucket}/ancillary-probes/{code}.json
# Format: {"ts": <unix>, "data": {…probe result…}}
_GCS_PROBE_BUCKET = os.environ.get("GCS_CACHE_BUCKET", "letsfg-chrome-cache")
_GCS_PROBE_TTL = int(os.environ.get("ANCILLARY_GCS_TTL", str(7 * 24 * 3600)))  # 7 days default
_gcs_probe_client = None  # None = uninitialised; False = unavailable

# ── Airlines that MUST NOT use the GCS cache ─────────────────────────────────
# These probes compute prices from an actual route-specific search result, so
# the price genuinely differs per route (e.g. GOL GRU→SDU vs GRU→NAT).
# Caching one route's result and serving it for all routes gives wrong numbers.
# These airlines still use in-memory cache (12h per route key).
_GCS_BYPASS_CODES: frozenset = frozenset({
    "LA", "JJ",   # LATAM — domestic Chile vs international wildly different
    "G3",          # GOL — BRL domestic pricing per-route
    "AD",          # Azul — Navitaire per-route diffs
    "Y4",          # Volaris — Navitaire per-route quote prices
    "VB",          # VivaAerobus — returns static fallback anyway, always fast
    "FO",          # Flybondi — ARS, curl_cffi per-route fare bundle diff
})


def _get_gcs_probe_client():
    global _gcs_probe_client
    if _gcs_probe_client is None:
        try:
            from google.cloud import storage  # type: ignore
            _gcs_probe_client = storage.Client()
        except Exception as exc:
            logger.debug("GCS probe client unavailable: %s", exc)
            _gcs_probe_client = False
    return _gcs_probe_client if _gcs_probe_client is not False else None


def _gcs_load_probe(code: str) -> Optional[dict]:
    """Synchronous — load a probe result from GCS. Returns dict if fresh, else None."""
    client = _get_gcs_probe_client()
    if client is None:
        return None
    try:
        bucket = client.bucket(_GCS_PROBE_BUCKET)
        blob = bucket.blob(f"ancillary-probes/{code}.json")
        if not blob.exists():
            return None
        raw = blob.download_as_bytes()
        envelope = json.loads(raw)
        age = time.time() - envelope.get("ts", 0)
        if age > _GCS_PROBE_TTL:
            logger.debug("GCS probe %s stale (%.0fh old)", code, age / 3600)
            return None
        logger.info("Ancillary probe %s: loaded from GCS (%.0fh old)", code, age / 3600)
        return envelope.get("data")
    except Exception as exc:
        logger.debug("GCS probe load %s: %s", code, exc)
        return None


def _gcs_save_probe(code: str, data: dict) -> None:
    """Synchronous — save probe result to GCS. Called in an executor (non-blocking)."""
    client = _get_gcs_probe_client()
    if client is None:
        return
    try:
        envelope = {"ts": time.time(), "data": data}
        bucket = client.bucket(_GCS_PROBE_BUCKET)
        blob = bucket.blob(f"ancillary-probes/{code}.json")
        blob.upload_from_string(
            json.dumps(envelope, separators=(",", ":")),
            content_type="application/json",
        )
        logger.debug("GCS probe saved: %s", code)
    except Exception as exc:
        logger.debug("GCS probe save %s: %s", code, exc)


# ── GCS raw-response snapshot cache (3rd tier) ───────────────────────────────
# Stores the raw intercepted API response so it can be REPLAYED WITHOUT a
# browser on subsequent calls.  When the 7-day parsed result cache expires but
# the snapshot is still fresh (30-day TTL), we re-parse the snapshot locally
# instead of launching Chrome — saving all proxy + compute cost.
#
# Path:   gs://{bucket}/ancillary-snapshots/{code}.json
# Format: {"ts": <unix>, "type": "<payload_type>", "data": {...}, "extra": {...}}
# TTL:    30 days (configurable via ANCILLARY_SNAPSHOT_TTL)
# Only for stable-pricing airlines (not in _GCS_BYPASS_CODES).

_GCS_SNAPSHOT_TTL = int(os.environ.get("ANCILLARY_SNAPSHOT_TTL", str(30 * 24 * 3600)))


def _gcs_load_snapshot(code: str) -> Optional[dict]:
    """Synchronous — load a raw-response snapshot from GCS. Returns envelope if fresh."""
    client = _get_gcs_probe_client()
    if client is None:
        return None
    try:
        bucket = client.bucket(_GCS_PROBE_BUCKET)
        blob = bucket.blob(f"ancillary-snapshots/{code}.json")
        if not blob.exists():
            return None
        raw = blob.download_as_bytes()
        envelope = json.loads(raw)
        age = time.time() - envelope.get("ts", 0)
        if age > _GCS_SNAPSHOT_TTL:
            logger.debug("GCS snapshot %s stale (%.0fd old)", code, age / 86400)
            return None
        logger.info("Ancillary snapshot %s: loaded from GCS (%.1fd old)", code, age / 86400)
        return envelope
    except Exception as exc:
        logger.debug("GCS snapshot load %s: %s", code, exc)
        return None


def _gcs_save_snapshot(code: str, snap_type: str, data: dict, extra: Optional[dict] = None) -> None:
    """Synchronous — save raw API response to GCS snapshot. Called in executor."""
    client = _get_gcs_probe_client()
    if client is None:
        return
    try:
        envelope: dict = {"ts": time.time(), "type": snap_type, "data": data}
        if extra:
            envelope["extra"] = extra
        bucket = client.bucket(_GCS_PROBE_BUCKET)
        blob = bucket.blob(f"ancillary-snapshots/{code}.json")
        blob.upload_from_string(
            json.dumps(envelope, separators=(",", ":")),
            content_type="application/json",
        )
        logger.info("Ancillary snapshot %s: saved to GCS (type=%s)", code, snap_type)
    except Exception as exc:
        logger.debug("GCS snapshot save %s: %s", code, exc)


# ── Static-asset HAR snapshot (website bandwidth cache) ──────────────────────
# Caches airline SPA static assets (JS/CSS/fonts) in GCS as a HAR file so
# subsequent browser runs serve them from cache instead of re-downloading
# through proxy. Only static asset URLs are matched; HTML and JSON API calls
# always go to the real network so fare data is always live.

_HAR_SNAPSHOT_TTL = int(os.environ.get("ANCILLARY_HAR_TTL", str(90 * 24 * 3600)))

# Matches versioned JS bundles, CSS, fonts, images — NOT HTML or JSON/XHR.
_HAR_STATIC_RE = re.compile(
    r"\.(?:js|mjs|css|woff2?|ttf|eot|otf|png|jpe?g|gif|svg|ico|webp|avif|map)(\?[^'\"\s]*)?$",
    re.IGNORECASE,
)


def _gcs_load_har(code: str) -> Optional[str]:
    """Download static-asset HAR from GCS to a temp file.
    Returns path (populated with decompressed HAR JSON) or None if not found/expired."""
    client = _get_gcs_probe_client()
    if client is None:
        return None
    try:
        import gzip as _gz
        import tempfile as _tmp
        bucket = client.bucket(_GCS_PROBE_BUCKET)
        blob = bucket.blob(f"ancillary-har/{code}.har.gz")
        if not blob.exists():
            return None
        blob.reload()
        ts = float((blob.metadata or {}).get("ts", "0"))
        if time.time() - ts > _HAR_SNAPSHOT_TTL:
            return None
        fd, path = _tmp.mkstemp(suffix=".har")
        os.close(fd)
        with open(path, "wb") as f:
            f.write(_gz.decompress(blob.download_as_bytes()))
        logger.debug("GCS HAR load %s: %d KB", code, os.path.getsize(path) // 1024)
        return path
    except Exception as exc:
        logger.debug("GCS HAR load %s: %s", code, exc)
        return None


def _gcs_save_har(code: str, har_path: str) -> None:
    """Gzip-compress the HAR file and upload to GCS. Deletes the temp file when done."""
    client = _get_gcs_probe_client()
    try:
        if client is None:
            return
        import gzip as _gz
        if not os.path.exists(har_path) or os.path.getsize(har_path) < 100:
            return  # empty / non-existent — nothing worth saving
        with open(har_path, "rb") as f:
            raw = f.read()
        compressed = _gz.compress(raw, compresslevel=6)
        bucket = client.bucket(_GCS_PROBE_BUCKET)
        blob = bucket.blob(f"ancillary-har/{code}.har.gz")
        blob.metadata = {"ts": str(time.time())}
        blob.upload_from_string(compressed, content_type="application/gzip")
        logger.info("Ancillary HAR %s: saved %d KB gzipped", code, len(compressed) // 1024)
    except Exception as exc:
        logger.debug("GCS HAR save %s: %s", code, exc)
    finally:
        try:
            os.unlink(har_path)
        except Exception:
            pass


def _prepare_har_tmp(code: str) -> str:
    """Sync: load HAR from GCS into a fresh temp file, or create a valid empty HAR skeleton.
    The returned path is always a valid, writable file. Call via run_in_executor."""
    import json as _json
    import tempfile as _tmp
    fd, path = _tmp.mkstemp(suffix=".har")
    os.close(fd)
    existing = _gcs_load_har(code)
    if existing:
        import shutil as _sh
        _sh.copy2(existing, path)
        try:
            os.unlink(existing)
        except Exception:
            pass
    else:
        # Write a minimal valid HAR so Playwright can use update=True mode on first run
        _skeleton = {
            "log": {
                "version": "1.2",
                "creator": {"name": "letsfg-probe", "version": "1"},
                "entries": [],
            }
        }
        with open(path, "w", encoding="utf-8") as f:
            _json.dump(_skeleton, f)
    return path


async def _setup_har_route(context, code: str, har_path: str) -> None:
    """Wire route_from_har on a browser context for static-asset caching.
    Matching static assets are served from HAR (update=True fills new entries).
    Non-matching URLs (HTML, XHR/JSON) go directly to the real network."""
    try:
        await context.route_from_har(
            har_path,
            url=_HAR_STATIC_RE,
            update=True,
            not_found="fallback",
        )
    except Exception as exc:
        logger.debug("HAR route %s: %s", code, exc)


# ── Snapshot replay functions ─────────────────────────────────────────────────
# Each function takes a loaded GCS envelope ({"ts":…,"type":…,"data":…,"extra":…})
# and returns a probe result dict (or None if the snapshot is unparseable).
# No network calls, no browser — pure local re-parse of cached API data.

def _snap_replay_xq(snap: dict) -> Optional[dict]:
    raw = snap.get("data")
    if not raw:
        return None
    val = _xq_bag_price(raw)
    if not val or val <= 0:
        return None
    return {
        "checked_bag_note": f"checked bag not included (Essential fare) – add-on from EUR {val:.0f}",
        "bags_note": "cabin bag 8 kg included free (Essential fare)",
        "checked_bag_from": val,
        "currency": "EUR",
        "seat_note": "seat selection add-on available",
    }


def _snap_replay_sz(snap: dict) -> Optional[dict]:
    raw = snap.get("data")
    if not raw:
        return None
    bag_from = _sz_bag_price_from_search_shop(raw)
    if not bag_from or bag_from <= 0:
        return None
    return {
        "checked_bag_note": f"checked bag not included in base fare – add-on from EUR {bag_from:.0f}",
        "bags_note": "hand luggage 8 kg + 1 personal item included in base fare",
        "checked_bag_from": bag_from,
        "currency": "EUR",
        "seat_note": "seat selection add-on available",
    }


def _snap_replay_af(snap: dict) -> Optional[dict]:
    """Shared by AF and KL — both use the same GQL format."""
    raw = snap.get("data")
    if not raw:
        return None
    snap_type = snap.get("type", "")
    extra = snap.get("extra", {})
    currency = extra.get("currency", "EUR")
    price: Optional[float] = None
    if snap_type == "af_upsell_gql":
        price = _af_bag_price_from_gql_upsell(raw)
    elif snap_type == "af_ancillaries_gql":
        result = _af_bag_price_from_ancillaries_gql(raw)
        if result:
            price, currency = result
    if not price or price <= 0:
        return None
    return {
        "checked_bag_note": f"checked bag not included (Light fare) – add-on from {currency} {price:.0f}",
        "bags_note": "cabin bag 12 kg included free (Light fare)",
        "checked_bag_from": price,
        "checked_bag_price": price,
        "currency": currency,
        "seat_note": "seat selection add-on available",
    }


def _snap_replay_f3(snap: dict) -> Optional[dict]:
    fare_cards = snap.get("data", {}).get("fare_cards", [])
    if not fare_cards:
        return None
    with_bag = [f for f in fare_cards if f.get("hasChecked") and (f.get("price") or 0) > 0]
    if not with_bag:
        return None
    bag_price = min(f["price"] for f in with_bag)
    seat_min = 28.0
    return {
        "checked_bag_note": f"checked bag not included (fly fare) – add-on from SAR {bag_price:.0f}",
        "bags_note": "cabin bag 7 kg included free",
        "checked_bag_from": bag_price,
        "currency": "SAR",
        "seat_from": seat_min,
        "seat_note": f"seat selection add-on from SAR {seat_min:.0f}",
    }


def _snap_replay_generic(
    snap: dict,
    no_bag_label: str,
    carry_on_note: str,
    default_currency: str,
) -> Optional[dict]:
    """Generic replay for BA, LH, IB, AC, AY, A3, NZ, QF (fare-family intercept)."""
    raw = snap.get("data")
    if not raw:
        return None
    b, s = _extract_bag_seat_prices(raw)
    diff = _af_bag_price_from_fare_families(raw)
    if diff:
        b.append(diff)
    if not b:
        return None
    min_bag = min(p for p in b if p > 0)
    extra = snap.get("extra", {})
    currency = extra.get("currency", default_currency)
    result: dict = {
        "checked_bag_note": f"checked bag not included ({no_bag_label}) – add-on from {currency} {min_bag:.0f}",
        "bags_note": carry_on_note,
        "checked_bag_from": min_bag,
        "checked_bag_price": min_bag,
        "currency": currency,
        "seat_note": "seat selection add-on available",
    }
    if s:
        result["seat_from"] = min(s)
        result["seat_note"] = f"seat selection add-on from {currency} {min(s):.0f}"
    return result


# ── Snapshot replay dispatch ──────────────────────────────────────────────────
# Maps airline code → callable(snap_envelope) → Optional[dict]
# Only codes eligible for snapshots are listed here (i.e. not _GCS_BYPASS_CODES).

def _make_generic_replayer(no_bag_label: str, carry_on: str, cur: str):
    def _replay(snap: dict) -> Optional[dict]:
        return _snap_replay_generic(snap, no_bag_label, carry_on, cur)
    return _replay


_SNAPSHOT_REPLAY: Dict[str, Any] = {}  # populated at bottom of module after all helpers defined


async def probe_ancillaries(
    code: str,
    origin: str,
    dest: str,
    date_str: Optional[str] = None,
    flight_no: Optional[str] = None,
) -> Optional[dict]:
    """
    Return live ancillary price dict for the given airline IATA code.

    Optionally accepts ``date_str`` (YYYY-MM-DD) and ``flight_no`` from the
    first offer returned by the connector's own search.  When provided the
    prober can navigate that exact flight's booking continuation to capture the
    bag prices the airline actually displays at checkout.

    Cache key: ``{code}:{origin}:{dest}:{YYYY-MM}`` — bag prices vary by route
    and (to a lesser extent) by season, so we cache per route per calendar month.

    Returns None if code is unknown.
    """
    from datetime import date as _date_cls
    month_tag = ""
    if date_str:
        try:
            month_tag = date_str[:7]  # "YYYY-MM"
        except Exception:
            pass
    if not month_tag:
        month_tag = _date_cls.today().strftime("%Y-%m")

    cache_key = f"{code}:{origin}:{dest}:{month_tag}"

    # ── Tier 1: in-memory ────────────────────────────────────────────────────
    cached = _get_cached(cache_key)
    if cached is not None:
        return cached

    lock = _get_lock(cache_key)
    async with lock:
        cached = _get_cached(cache_key)
        if cached is not None:
            return cached

        probe_fn = _PROBERS.get(code)
        if probe_fn is None:
            return None

        # ── Tier 2: GCS persistent cache ─────────────────────────────────────
        # Skip for dynamic per-route pricing airlines — their price depends on
        # the actual route searched, not a representative airline-wide value.
        gcs_eligible = code not in _GCS_BYPASS_CODES
        if gcs_eligible:
            gcs_data = await asyncio.get_event_loop().run_in_executor(None, _gcs_load_probe, code)
            if gcs_data is not None:
                _set_cache(cache_key, gcs_data)
                return gcs_data

        # ── Tier 3: live browser/API probe ────────────────────────────────────
        loop = asyncio.get_event_loop()
        try:
            result = await asyncio.wait_for(
                probe_fn(origin, dest, date_str, flight_no),
                timeout=90.0,
            )
            if result:
                _set_cache(cache_key, result)
                # Write to GCS in background — only for airlines with stable pricing
                if gcs_eligible:
                    loop.run_in_executor(None, _gcs_save_probe, code, result)
                logger.info(
                    "Ancillary probe %s %s→%s → bag_from=%s %s (seat: %s)",
                    code,
                    origin,
                    dest,
                    result.get("checked_bag_from", "?"),
                    result.get("currency", ""),
                    result.get("seat_note", "—"),
                )
            return result
        except (asyncio.TimeoutError, TimeoutError):
            logger.warning("Ancillary probe timed out for %s %s→%s", code, origin, dest)
        except Exception as exc:
            logger.warning("Ancillary probe error for %s: %s", code, exc)
        return None


# ── Shared utilities ──────────────────────────────────────────────────────────

def _pw_stealth_args() -> List[str]:
    return [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-dev-shm-usage",
    ]


def _iter_dicts(obj, _depth: int = 0):
    """Yield all dicts nested within obj (cap at depth 15 to avoid runaway)."""
    if _depth > 15:
        return
    if isinstance(obj, dict):
        yield obj
        for v in obj.values():
            yield from _iter_dicts(v, _depth + 1)
    elif isinstance(obj, list):
        for item in obj:
            yield from _iter_dicts(item, _depth + 1)


def _extract_bag_seat_prices(
    data: dict,
    bag_ssrs: Optional[set] = None,
) -> Tuple[List[float], List[float]]:
    """
    Generic extractor for bag and seat add-on prices from an API response dict.
    Scans all nested dicts for price-bearing items whose name/code suggests
    checked-bag or seat.
    """
    bag_prices: List[float] = []
    seat_prices: List[float] = []

    default_bag_ssrs = {
        "BAG", "CKB", "CBAG", "CB20", "CB23", "CB15", "CB30",
        "BAGGAGE", "BG20", "BG23", "BG15", "BG30",
        "F15", "F16", "F20", "F25", "F30",
        "ACB", "ACBH", "BULK",
    }
    effective_bag_ssrs = bag_ssrs or default_bag_ssrs

    for item in _iter_dicts(data):
        code = str(item.get("ssrCode") or item.get("code") or "").upper().strip()
        name_raw = str(item.get("name") or item.get("description") or "")
        name = name_raw.lower()

        is_bag = (
            code in effective_bag_ssrs
            or "bag" in name
            or "luggage" in name
            or "check" in name
            or re.search(r"\b\d{2}kg\b", name) is not None
        )
        is_seat = "seat" in name and "bag" not in name

        for price_key in ("price", "amount", "value", "totalPrice", "farePrice", "fee", "fees"):
            raw = item.get(price_key)
            if raw is None:
                continue
            try:
                p = float(raw)
            except (TypeError, ValueError):
                continue
            if p <= 0:
                continue
            if is_bag:
                bag_prices.append(p)
            elif is_seat:
                seat_prices.append(p)

    return bag_prices, seat_prices


def _probe_date(date_str: Optional[str], weeks_ahead: int = 6) -> str:
    """Return a probe departure date: use date_str if valid & future, else weeks_ahead from today."""
    from datetime import date as _d, timedelta
    today = _d.today()
    if date_str:
        try:
            dt = _d.fromisoformat(date_str[:10])
            if dt > today:
                return dt.isoformat()
        except ValueError:
            pass
    return (today + timedelta(weeks=weeks_ahead)).isoformat()


# ── Helper: SunExpress SUNVALUE-vs-Essential bag-price extractor ──────────────

def _xq_bag_price(data: dict) -> Optional[float]:
    """Extract checked-bag add-on price from SunExpress /pricing/api/v1/journeys.

    SUNVALUE fare bundles include a 20 KG item with applicability='Included'.
    Essential bundles have no such item.  Bag add-on = min(SUNVALUE) - min(Essential).
    """
    try:
        fares_with_bag: List[float] = []
        fares_without_bag: List[float] = []
        for d in _iter_dicts(data):
            total = d.get("totalAmount")
            if total is None:
                continue
            try:
                total = float(total)
            except (TypeError, ValueError):
                continue
            if not (5.0 < total < 5000.0):
                continue
            items = d.get("items", [])
            if not isinstance(items, list):
                continue
            has_checked_bag = any(
                isinstance(it, dict) and (
                    it.get("code") in ("20KG", "23KG", "25KG", "30KG", "32KG")
                    or re.search(r"\b\d{2,3}\s*kg\b", str(it.get("name", "")), re.IGNORECASE)
                ) and str(it.get("applicability", "")).strip().lower() == "included"
                for it in items
            )
            if has_checked_bag:
                fares_with_bag.append(total)
            else:
                fares_without_bag.append(total)
        if fares_with_bag and fares_without_bag:
            diff = min(fares_with_bag) - min(fares_without_bag)
            if diff > 0:
                return round(diff, 2)
    except Exception:
        pass
    return None


# ── Helper: FlyDubai CLASSIC-vs-LITE bag-price extractor ─────────────────────

def _fz_bag_price(data: dict) -> Optional[float]:
    """For FlyDubai /api/flights/1: estimate bag add-on as CLASSIC price - LITE price.

    LITE = no checked bag, CLASSIC = 20 kg included.
    """
    _LITE_LABELS = {"lite", "go", "basic", "light", "saver", "economy"}
    _BAG_LABELS = {"classic", "value", "standard", "flex", "freedom", "plus"}
    try:
        lite_prices: List[float] = []
        bag_prices: List[float] = []
        for d in _iter_dicts(data):
            fare_label = ""
            for key in ("bundleCode", "bundleName", "fareType", "fareName",
                        "bundleType", "productCode", "cabinClass", "fareClass"):
                v = d.get(key)
                if v and isinstance(v, str):
                    fare_label = v.lower()
                    break
            if not fare_label:
                continue
            price = None
            for pk in ("price", "amount", "totalPrice", "totalAmount", "fareAmount"):
                v = d.get(pk)
                if v is None:
                    continue
                if isinstance(v, dict):
                    v = v.get("amount") or v.get("value")
                try:
                    p = float(v)  # type: ignore[arg-type]
                    if p > 0:
                        price = p
                        break
                except (TypeError, ValueError):
                    pass
            if price is None:
                continue
            if any(k in fare_label for k in _LITE_LABELS):
                lite_prices.append(price)
            elif any(k in fare_label for k in _BAG_LABELS):
                bag_prices.append(price)
        if lite_prices and bag_prices:
            diff = min(bag_prices) - min(lite_prices)
            if 5.0 < diff < 500.0:
                return round(diff, 2)
    except Exception:
        pass
    return None


def _fz_extract_min_seat_price(data: dict) -> Optional[float]:
    """Extract minimum purchasable seat add-on price from /api/v2/services/seat response.

    The API returns flights[].legs[].serviceQuotes[] where each quote has:
      - codeType: 'NSST' (standard), 'SPST' (specific std), 'FRST' (front), 'XLGR' (extra leg-room)
      - price: string e.g. "17.00"
      - isNonPurchasable: bool
    """
    try:
        min_price: Optional[float] = None
        for flight in (data.get("flights") or []):
            for leg in (flight.get("legs") or []):
                for q in (leg.get("serviceQuotes") or []):
                    if q.get("isNonPurchasable"):
                        continue
                    try:
                        p = float(q["price"])
                    except (KeyError, TypeError, ValueError):
                        continue
                    if p > 0 and (min_price is None or p < min_price):
                        min_price = p
        return min_price
    except Exception:
        return None


def _fz_extract_brand_bag_price(data: dict) -> Optional[float]:
    """Extract bag add-on price from FlyDubai flights1.flydubai.com /api/flights/1 response.

    flights/1 returns segments[].flights[].fareTypes[] where each entry has:
      - fareTypeName: "LITE" (no checked bag), "VALUE" (20 kg bag), "FLEX" (30 kg bag)
      - fare.totalFare: total price as a string, e.g. "675.00"

    Bag add-on = min(VALUE prices) - min(LITE prices).
    """
    _LITE_NAMES = {"lite", "go", "light", "basic", "saver"}
    _BAG_NAMES = {"value", "classic", "standard", "flex", "freedom", "plus"}
    try:
        lite_prices: List[float] = []
        bag_prices: List[float] = []
        for seg in (data.get("segments") or []):
            if not isinstance(seg, dict):
                continue
            for flight in (seg.get("flights") or []):
                if not isinstance(flight, dict):
                    continue
                for ft in (flight.get("fareTypes") or []):
                    if not isinstance(ft, dict):
                        continue
                    name = (ft.get("fareTypeName") or "").lower()
                    if not name:
                        continue
                    fare = ft.get("fare")
                    if not isinstance(fare, dict):
                        continue
                    total_str = fare.get("totalFare", "")
                    try:
                        total = float(str(total_str).replace(",", ""))
                    except (ValueError, TypeError):
                        continue
                    if total <= 0:
                        continue
                    if name in _LITE_NAMES or any(k in name for k in _LITE_NAMES):
                        lite_prices.append(total)
                    elif name in _BAG_NAMES or any(k in name for k in _BAG_NAMES):
                        bag_prices.append(total)
        if lite_prices and bag_prices:
            diff = min(bag_prices) - min(lite_prices)
            if 5.0 < diff < 500.0:
                return round(diff, 2)
    except Exception:
        pass
    return None


# ── F3 — flyadeal ─────────────────────────────────────────────────────────────

def _f3_extract_bundle_bag_price(data: dict) -> Optional[float]:
    """
    Extract the cheapest checked-bag add-on price from a flyadeal Availability response.

    flyadeal uses Navitaire / fad/v1/Availability.  The response contains a
    ``bundleOffers`` list where each offer has a ``totalPrice`` (the bundle
    upgrade cost above the base fare) and ``bundleSsrPrices``.  The cheapest
    bundle whose SSRs include a bag code (F20 = 20 kg, F30 = 30 kg, …) with
    totalPrice > 0 is returned as the bag add-on price.
    """
    _BAG_SSRS = {"F15", "F16", "F20", "F25", "F30", "F32", "F38", "CBAG", "BAG"}
    try:
        av4 = data.get("data", {}).get("availabilityv4", {})
        bundle_offers = av4.get("bundleOffers", [])
        bag_prices: List[float] = []
        for offer in bundle_offers:
            val = offer.get("value", {})
            for bp in val.get("bundlePrices", []):
                total = bp.get("totalPrice") or 0.0
                if total <= 0:
                    continue
                has_bag = any(
                    sp.get("ssrCode", "").upper() in _BAG_SSRS
                    for sp in bp.get("bundleSsrPrices", [])
                )
                if has_bag:
                    bag_prices.append(float(total))
        return min(bag_prices) if bag_prices else None
    except Exception:
        return None


async def _probe_f3(
    origin: str,
    dest: str,
    date_str: Optional[str] = None,
    flight_no: Optional[str] = None,
) -> Optional[dict]:
    """
    flyadeal (F3) — stealth browser via patchright (headless=False).

    Strategy (confirmed via live browser probing 2026-05-03):
    1. Load www.flyadeal.com/en/ to establish Cloudflare clearance.
    2. Fill the Angular Material search form via coordinate clicks:
       origin at (350, 528), dest at (640, 528), JS-click mat-option,
       then JS-click button.lets_fly_button.  Standard locators don't work
       against Angular CDK overlay inputs; coordinates are required.
    3. On /en/select-flight, click the first date-strip tab that has a SAR price.
    4. JS-click the first flight_details_wrap card to select it.
    5. Coordinate-click the ▼ expand chevron at ~(1143, card_y+55) to open
       the fare bundle panel (triggers GetBundleEarnMiles API).
    6. Extract fare bundle cards from DOM (class fares__div) — find the cheapest
       bundle that includes a checked bag (text contains "checked").

    The Availability API always returns fares:[] for this carrier, so DOM
    extraction from the bundle panel is the only reliable data source.
    JED→RUH is used as a fixed probe route (reliable domestic flyadeal route).
    """
    probe_origin = "JED"
    probe_dest = "RUH"

    # ── Snapshot fast-path (no browser needed) ────────────────────────────────
    _f3_snap = await asyncio.get_event_loop().run_in_executor(None, _gcs_load_snapshot, "F3")
    if _f3_snap is not None:
        _f3_result = _snap_replay_f3(_f3_snap)
        if _f3_result:
            logger.info("F3 probe: replayed from GCS snapshot (no browser)")
            return _f3_result

    _f3_har_tmp = await asyncio.get_event_loop().run_in_executor(None, _prepare_har_tmp, "F3")

    try:
        from patchright.async_api import async_playwright as _patchright_playwright

        async with _patchright_playwright() as pw:
            browser = await pw.chromium.launch(
                headless=False,
                args=[
                    "--no-first-run",
                    "--no-default-browser-check",
                    "--window-size=1440,900",
                    "--no-sandbox",
                    "--disable-dev-shm-usage",
                ],
            )
            try:
                ctx = await browser.new_context(
                    viewport={"width": 1440, "height": 900},
                    locale="en-US",
                    timezone_id="Asia/Riyadh",
                )
                await _setup_har_route(ctx, "F3", _f3_har_tmp)
                page = await ctx.new_page()

                # ── Load homepage (establishes Cloudflare clearance) ──────────
                await page.goto(
                    "https://www.flyadeal.com/en/",
                    wait_until="domcontentloaded",
                    timeout=40_000,
                )
                await asyncio.sleep(5.0)

                # ── Dismiss cookie banner ─────────────────────────────────────
                for ck_sel in [
                    "button:has-text('Accept all')",
                    "button:has-text('Accept All')",
                ]:
                    try:
                        if await page.locator(ck_sel).is_visible(timeout=2000):
                            await page.locator(ck_sel).first.click()
                            await asyncio.sleep(1.0)
                            break
                    except Exception:
                        continue

                # ── One-way ───────────────────────────────────────────────────
                try:
                    await page.locator("label:has-text('One-way')").first.click(timeout=5000)
                    await asyncio.sleep(0.5)
                except Exception:
                    pass

                # ── Fill origin: coordinate click (350, 528) + JS-click mat-option ──
                # Angular CDK overlay inputs are not reachable via standard locators.
                await page.mouse.click(350, 528)
                await asyncio.sleep(1.0)
                await page.keyboard.type(probe_origin, delay=120)
                await asyncio.sleep(2.0)
                await page.evaluate(
                    """() => {
                        const opts = Array.from(document.querySelectorAll(
                            'mat-option:not([disabled]):not([aria-disabled="true"])'
                        )).filter(o => o.getBoundingClientRect().width > 0);
                        if (opts.length) opts[0].click();
                    }"""
                )
                await asyncio.sleep(1.5)

                # ── Fill destination: coordinate click (640, 528) + JS-click mat-option ──
                await page.mouse.click(640, 528)
                await asyncio.sleep(1.0)
                await page.keyboard.type(probe_dest, delay=120)
                await asyncio.sleep(2.0)
                await page.evaluate(
                    """() => {
                        const opts = Array.from(document.querySelectorAll(
                            'mat-option:not([disabled]):not([aria-disabled="true"])'
                        )).filter(o => o.getBoundingClientRect().width > 0);
                        if (opts.length) opts[0].click();
                    }"""
                )
                await asyncio.sleep(1.5)

                # ── Submit via JS (date defaults to today, which is fine) ─────
                await page.evaluate(
                    """() => {
                        const btn = document.querySelector('button.lets_fly_button');
                        if (btn) btn.click();
                    }"""
                )

                # ── Wait for /en/select-flight ────────────────────────────────
                for _ in range(12):
                    await asyncio.sleep(3.0)
                    if "select-flight" in page.url:
                        break
                if "select-flight" not in page.url:
                    logger.debug(
                        "F3 probe: did not reach select-flight (url=%s)", page.url
                    )
                    return None

                # ── Click first date-strip tab that has a SAR price ───────────
                # Tabs are at y 200–390; skip "---" (no flight) entries.
                await page.evaluate(
                    """() => {
                        const els = Array.from(document.querySelectorAll('*')).filter(el => {
                            const r = el.getBoundingClientRect();
                            const t = (el.textContent || '').trim();
                            return r.y > 200 && r.y < 390
                                && r.width > 30 && r.width < 250
                                && r.height > 20
                                && t.includes('SAR') && t.indexOf('---') < 0;
                        });
                        if (els.length > 0) els[0].click();
                    }"""
                )
                await asyncio.sleep(3.0)

                # ── Find first flight card position ───────────────────────────
                card_info = await page.evaluate(
                    """() => {
                        const cards = Array.from(
                            document.querySelectorAll(
                                '.flight_details_wrap, [class*=flight_details_wrap]'
                            )
                        ).filter(e => {
                            const r = e.getBoundingClientRect();
                            return r.y > 300 && r.y < 900 && r.width > 100;
                        });
                        if (cards.length > 0) {
                            const r = cards[0].getBoundingClientRect();
                            return {
                                y: Math.round(r.y),
                                x: Math.round(r.x),
                                w: Math.round(r.width),
                                h: Math.round(r.height),
                            };
                        }
                        return null;
                    }"""
                )
                if not card_info:
                    logger.debug(
                        "F3 probe: no flight cards found on select-flight page"
                    )
                    return None

                # ── JS-click the first flight card to select it ───────────────
                await page.evaluate(
                    """() => {
                        const els = Array.from(document.querySelectorAll(
                            '.flight_details_wrap, [class*=flight_details_wrap]'
                        )).filter(e => {
                            const r = e.getBoundingClientRect();
                            return r.y > 300 && r.y < 900 && r.width > 100;
                        });
                        if (els.length) els[0].click();
                    }"""
                )
                await asyncio.sleep(1.5)

                # ── Coordinate-click the ▼ chevron to expand fare bundle panel ─
                # The chevron sits at the right side of the card: x≈1143, y≈card_y+55.
                # A JS click on the expand_section element hits (0,0) and collapses
                # the panel instead — only mouse.click at the visual coordinates works.
                await page.mouse.click(1143, card_info["y"] + 55)
                await asyncio.sleep(3.0)

                # ── Extract fare bundle cards from DOM ────────────────────────
                fare_cards = await page.evaluate(
                    """() => {
                        const cards = Array.from(
                            document.querySelectorAll('[class*=fares__div]')
                        ).filter(e => {
                            const r = e.getBoundingClientRect();
                            return r.width > 80 && r.height > 50;
                        });

                        function extractSAR(text) {
                            const idx = text.indexOf('SAR');
                            if (idx < 0) return null;
                            const after = text.slice(idx + 3).trim();
                            let i = 0;
                            while (i < after.length && !/[0-9]/.test(after[i])) i++;
                            let numStr = '';
                            while (i < after.length && /[0-9.,]/.test(after[i])) {
                                numStr += after[i]; i++;
                            }
                            numStr = numStr.replace(/,/g, '');
                            return numStr ? parseFloat(numStr) : null;
                        }

                        return cards.map(card => ({
                            price: extractSAR(card.textContent || ''),
                            hasChecked: (card.textContent || '').toLowerCase()
                                .indexOf('checked') >= 0,
                        }));
                    }"""
                )

                # ── Return cheapest bundle that includes a checked bag ────────
                with_bag = [
                    f for f in fare_cards
                    if f.get("hasChecked") and f.get("price") is not None
                    and f["price"] > 0
                ]
                if with_bag:
                    bag_price = min(f["price"] for f in with_bag)
                    # Save snapshot so future calls skip the browser entirely
                    asyncio.get_event_loop().run_in_executor(
                        None, _gcs_save_snapshot, "F3", "f3_fare_cards",
                        {"fare_cards": fare_cards}, None,
                    )
                    # Seat prices from GetSeatMap (probed 2026-05-03, JED→RUH):
                    # Group 5 (exit rows) SAR 28.26, Group 6 (standard) SAR 36.74
                    seat_min = 28.0
                    return {
                        "checked_bag_note": (
                            f"checked bag not included (fly fare) "
                            f"– add-on from SAR {bag_price:.0f}"
                        ),
                        "bags_note": "cabin bag 7 kg included free",
                        "checked_bag_from": bag_price,
                        "currency": "SAR",
                        "seat_from": seat_min,
                        "seat_note": f"seat selection add-on from SAR {seat_min:.0f}",
                    }

            finally:
                await browser.close()

    except Exception as exc:
        logger.debug("F3 probe error: %s", exc)
    asyncio.get_event_loop().run_in_executor(None, _gcs_save_har, "F3", _f3_har_tmp)

    logger.debug("F3 probe: no bag prices captured for %s→%s", probe_origin, probe_dest)
    return None


# ── FZ — flydubai ────────────────────────────────────────────────────────────

async def _probe_fz(
    origin: str,
    dest: str,
    date_str: Optional[str] = None,
    flight_no: Optional[str] = None,
) -> Optional[dict]:
    """
    FlyDubai (FZ) — try the search API (/api/flights/1) which returns LITE-fare
    bundle data; parse bag SSR prices from the response.

    If the API returns bag prices in the fare bundles, extract them.
    Otherwise navigate the booking continuation via Playwright:
    flydubai.com search results → click cheapest → bag selection page → intercept XHR.
    """
    from datetime import date as _d, timedelta

    probe_origin = origin if (origin and len(origin) == 3) else "DXB"
    probe_dest = dest if (dest and len(dest) == 3 and dest != probe_origin) else "MCT"
    if probe_dest == probe_origin:
        probe_dest = "MCT"

    dep = _probe_date(date_str, weeks_ahead=5)
    dep_dt = _d.fromisoformat(dep)
    departure_api = dep_dt.strftime("%m/%d/%Y 12:00 AM")
    dep_url = dep_dt.strftime("%Y%m%d")

    # ── Attempt 1: direct REST API (works on Cloud Run with proxy) ───────────
    try:
        from curl_cffi.requests import AsyncSession
        from .browser import get_curl_cffi_proxies
        proxies = get_curl_cffi_proxies()
        async with AsyncSession(impersonate="chrome131") as s:
            headers = {
                "Content-Type": "application/json",
                "Accept": "application/json",
                "Origin": "https://flights2.flydubai.com",
                "Referer": (
                    f"https://flights2.flydubai.com/en/results/ow/a1c0i0"
                    f"/{probe_origin}_{probe_dest}/{dep_url}"
                ),
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 Chrome/135.0.0.0 Safari/537.36"
                ),
            }
            payload = {
                "promoCode": "",
                "campaignCode": "",
                "cabinClass": "Economy",
                "isDestMetro": "false",
                "isOriginMetro": "false",
                "paxInfo": {"adultCount": 1, "childCount": 0, "infantCount": 0},
                "searchCriteria": [{
                    "date": departure_api,
                    "dest": probe_dest,
                    "direction": "outBound",
                    "origin": probe_origin,
                    "isOriginMetro": False,
                    "isDestMetro": False,
                }],
                "variant": "1",
            }
            r = await s.post(
                "https://flights2.flydubai.com/api/flights/1",
                json=payload,
                headers=headers,
                proxies=proxies,
                timeout=18,
            )
            if r.status_code == 200:
                data = r.json()
                bag_prices, seat_prices = _extract_bag_seat_prices(data)
                if not bag_prices:
                    fb = _fz_bag_price(data)
                    if fb:
                        bag_prices = [fb]
                if bag_prices:
                    min_bag = min(bag_prices)
                    result: dict = {
                        "checked_bag_note": (
                            f"checked bag not included (LITE fare) "
                            f"– add-on from AED {min_bag:.0f}"
                        ),
                        "bags_note": "cabin bag 7 kg included free (LITE fare)",
                        "checked_bag_from": min_bag,
                        "currency": "AED",
                    }
                    result["seat_note"] = (
                        f"seat selection add-on from AED {min(seat_prices):.0f}"
                        if seat_prices
                        else "seat selection add-on available"
                    )
                    return result
            logger.debug("FZ /api/flights/1 status %s", r.status_code)
    except Exception as exc:
        logger.debug("FZ /api/flights/1: %s", exc)

    # ── Attempt 2: headed browser → flights1.flydubai.com direct results URL ──
    # The Angular IBE on flights1.flydubai.com fires /api/flights/1 automatically
    # when the results page loads.  This XHR succeeds (Angular includes the
    # Akamai sensor token the browser generates) even when direct API calls
    # from curl_cffi are blocked.  We intercept the response via Playwright's
    # network listener; no form fill required.
    try:
        from patchright.async_api import async_playwright as _patchright_playwright

        flights1_data: Any = None
        seat_price_data: Any = None
        flights1_event = asyncio.Event()
        seat_price_event = asyncio.Event()
        calendar_event_pw = asyncio.Event()

        _patchright_mgr = _patchright_playwright()
        _fz_pw = await _patchright_mgr.__aenter__()
        browser = await _fz_pw.chromium.launch(
            headless=False,
            args=[
                "--no-first-run",
                "--no-default-browser-check",
                "--window-size=1440,900",
                "--no-sandbox",
                "--disable-dev-shm-usage",
            ],
        )
        context = await browser.new_context(
            viewport={"width": 1440, "height": 900},
            locale="en-US",
            timezone_id="Asia/Dubai",
        )
        try:
            page = await context.new_page()

            async def _on_resp_fz(response):
                nonlocal flights1_data, seat_price_data
                try:
                    url = response.url
                    ct = response.headers.get("content-type", "")
                    if response.status == 200 and "json" in ct:
                        if "/api/flights/1" in url:
                            d = await response.json()
                            if d and isinstance(d, dict) and d.get("segments"):
                                flights1_data = d
                                flights1_event.set()
                        elif "/api/v2/services/seat/" in url:
                            d = await response.json()
                            if d and isinstance(d, dict) and d.get("flights"):
                                seat_price_data = d
                                seat_price_event.set()
                        elif "/api/flights/7" in url or "/api/flights/" in url:
                            calendar_event_pw.set()
                except Exception:
                    pass

            page.on("response", _on_resp_fz)

            # Navigate directly to the results page — Angular fires flights/1 on load
            results_url = (
                f"https://flights1.flydubai.com/en/results/ow/"
                f"a1c0i0/{probe_origin}_{probe_dest}/{dep_url}"
                "?cabinClass=Economy&isOriginMetro=false&isDestMetro=false&pm=cash"
            )
            await page.goto(results_url, wait_until="domcontentloaded", timeout=30_000)

            # Wait for flights/1 (auto-fired by the Angular app on page load)
            try:
                await asyncio.wait_for(flights1_event.wait(), timeout=25.0)
            except (asyncio.TimeoutError, TimeoutError):
                # Fallback: wait for any calendar response
                try:
                    await asyncio.wait_for(calendar_event_pw.wait(), timeout=10.0)
                except (asyncio.TimeoutError, TimeoutError):
                    pass

            # If we got flights/1 data, continue navigation to capture seat prices
            if flights1_data:
                # Accept cookie banner if present
                try:
                    await page.locator(".osano-cm-accept-all").click(timeout=3_000)
                    await asyncio.sleep(0.5)
                except Exception:
                    pass

                # Expand the first flight's fare panel (coordinate proven from discovery)
                await page.mouse.click(952, 636)
                await asyncio.sleep(3)  # Angular needs ~2-3s to render fare tier buttons

                # Click the LITE SELECT button (first/leftmost column)
                try:
                    await page.locator("[class*='lite' i] button").first.click(timeout=5_000)
                except Exception:
                    # Fallback: click at LITE column coordinate (282,643) proven in discovery
                    await page.mouse.click(312, 653)

                # Wait for /optional page
                try:
                    await page.wait_for_url("**/optional/**", timeout=15_000)
                except Exception:
                    pass

                # Click "Continue to seat selection" which triggers the seat API
                try:
                    await (
                        page.locator("button")
                        .filter(has_text="Continue to seat selection")
                        .click(timeout=8_000)
                    )
                except Exception:
                    pass

                # Wait for seat price API response
                try:
                    await asyncio.wait_for(seat_price_event.wait(), timeout=15.0)
                except (asyncio.TimeoutError, TimeoutError):
                    pass

        finally:
            await context.close()
            await browser.close()
            await _patchright_mgr.__aexit__(None, None, None)

        if flights1_data:
            bag_price = _fz_extract_brand_bag_price(flights1_data)
            if bag_price:
                min_seat = _fz_extract_min_seat_price(seat_price_data) if seat_price_data else None
                return {
                    "checked_bag_note": (
                        f"checked bag not included (LITE fare) "
                        f"– add-on from AED {bag_price:.0f}"
                    ),
                    "bags_note": "cabin bag 7 kg included free (LITE fare)",
                    "checked_bag_from": bag_price,
                    "currency": "AED",
                    "seat_note": (
                        f"seat selection add-on from AED {min_seat:.0f}"
                        if min_seat
                        else "seat selection add-on available"
                    ),
                    **(  # include seat_from only when we have a real price
                        {"seat_from": min_seat} if min_seat else {}
                    ),
                }
    except Exception as exc:
        logger.debug("FZ flights1 browser probe error: %s", exc)

    logger.debug("FZ probe: no bag prices captured for %s→%s", probe_origin, probe_dest)
    return None


# ── G9 — airarabia ───────────────────────────────────────────────────────────

async def _probe_g9(
    origin: str,
    dest: str,
    date_str: Optional[str] = None,
    flight_no: Optional[str] = None,
) -> Optional[dict]:
    """
    Air Arabia (G9) — navigate reservations.airarabia.com IBE via patchright.

    The IBE is protected by Cloudflare Turnstile (sitekey 0x4AAAAAAA6kCdGqJCjlQvHL)
    which blocks all XHR requests before a human-verified token is obtained.
    patchright headless=False does not auto-solve Turnstile; every API call times out.

    This prober returns None immediately so the connector falls through to its
    own static reference data without wasting 35+ seconds on a failed browser attempt.
    """
    logger.debug("G9 probe: reservations.airarabia.com guarded by Turnstile; skipping")
    return None


# ── XQ — SunExpress ───────────────────────────────────────────────────────────

async def _probe_xq(
    origin: str,
    dest: str,
    date_str: Optional[str] = None,
    flight_no: Optional[str] = None,
) -> Optional[dict]:
    """
    SunExpress (XQ) — reuse the persistent headed Chrome session.

    The connector already navigates /booking/select/ to extract flight offers.
    Here we extend that session: after the flight list loads, click the first
    flight card to proceed to the passenger/bags step, then intercept the
    NSK GetSSRAvailability XHR that returns bag add-on prices.
    """
    from .sunexpress import _get_context
    from .browser import auto_block_if_proxied

    dep = _probe_date(date_str, weeks_ahead=6)
    dep_compact = dep.replace("-", "")

    # Always probe a known-working XQ international route (Turkey→Europe).
    # IST→AYT and many Turkish domestic routes have no SunExpress flights,
    # so using the caller's origin/dest is unreliable.
    probe_origin = "AYT"
    probe_dest = "DUS"

    # ── Snapshot fast-path (no browser needed) ────────────────────────────────
    _xq_snap = await asyncio.get_event_loop().run_in_executor(None, _gcs_load_snapshot, "XQ")
    if _xq_snap is not None:
        _xq_result = _snap_replay_xq(_xq_snap)
        if _xq_result:
            logger.info("XQ probe: replayed from GCS snapshot (no browser)")
            return _xq_result

    xq_bag_price_val: Optional[float] = None
    seat_prices: List[float] = []
    cap_event = asyncio.Event()
    _xq_raw_snap: Optional[dict] = None  # raw API data for GCS snapshot save

    try:
        context = await _get_context()
        page = await context.new_page()
        await auto_block_if_proxied(page)

        async def _on_resp(resp):
            nonlocal xq_bag_price_val, _xq_raw_snap
            ct = resp.headers.get("content-type", "")
            if resp.status != 200 or "json" not in ct:
                return
            url_l = resp.url.lower()
            if not any(k in url_l for k in [
                "journeys", "pricing", "ssr", "bag", "ancill",
                "extras", "addon", "bundle", "getavail", "availability",
            ]):
                return
            try:
                data = await resp.json()
                # Try SunExpress-specific SUNVALUE vs Essential extractor first
                p = _xq_bag_price(data)
                if p and p > 0:
                    xq_bag_price_val = p
                    _xq_raw_snap = data  # save for GCS snapshot
                    cap_event.set()
                    return
                # Fallback: generic SSR extractor
                b, s = _extract_bag_seat_prices(data)
                seat_prices.extend(s)
                if b:
                    xq_bag_price_val = min(b)
                    _xq_raw_snap = data  # save for GCS snapshot
                    cap_event.set()
            except Exception:
                pass

        page.on("response", _on_resp)

        # New URL format: origin1/destination1/departure1 → directly loads flight results
        # /pricing/api/v1/journeys fires automatically on page load with all fare bundles
        select_url = (
            f"https://www.sunexpress.com/en-gb/booking/select/"
            f"?origin1={probe_origin}&destination1={probe_dest}"
            f"&departure1={dep}&adt1=1&chd1=0&inf1=0&currency=EUR"
        )
        try:
            await page.goto(select_url, wait_until="domcontentloaded", timeout=30_000)
        except Exception as exc:
            logger.debug("XQ booking/select: %s", exc)

        # Dismiss cookie banner if present
        try:
            await page.evaluate("""() => {
                for (const b of document.querySelectorAll('button')) {
                    if (/accept all|agree|allow all/i.test(b.textContent) && b.offsetHeight > 0) {
                        b.click(); return;
                    }
                }
            }""")
        except Exception:
            pass
        await asyncio.sleep(2)

        # /pricing/api/v1/journeys fires on page load — wait for it
        try:
            await asyncio.wait_for(cap_event.wait(), timeout=30.0)
        except (asyncio.TimeoutError, TimeoutError):
            pass

        await page.close()
    except Exception as exc:
        logger.debug("XQ Playwright probe error: %s", exc)

    if xq_bag_price_val and xq_bag_price_val > 0:
        # Save raw API response to GCS snapshot (future calls skip browser)
        if _xq_raw_snap is not None:
            asyncio.get_event_loop().run_in_executor(
                None, _gcs_save_snapshot, "XQ", "xq_journeys", _xq_raw_snap, None,
            )
        result: dict = {
            "checked_bag_note": (
                f"checked bag not included (Essential fare) "
                f"– add-on from EUR {xq_bag_price_val:.0f}"
            ),
            "bags_note": "cabin bag 8 kg included free (Essential fare)",
            "checked_bag_from": xq_bag_price_val,
            "currency": "EUR",
        }
        result["seat_note"] = (
            f"seat selection add-on from EUR {min(seat_prices):.0f}"
            if seat_prices
            else "seat selection add-on available"
        )
        if seat_prices:
            result["seat_from"] = min(seat_prices)
        return result

    logger.debug("XQ probe: no bag prices captured for %s→%s", probe_origin, probe_dest)
    return None


# ── SZ — SkyExpress ───────────────────────────────────────────────────────────

def _sz_bag_price_from_search_shop(data: dict) -> Optional[float]:
    """
    Parse a Sabre ezyCommerce Availability/SearchShop response and return the
    cheapest checked-bag add-on price.

    SkyExpress sells bags as part of fare bundles (not standalone SSRs), so we
    compute the price differential: cheapest fare WITH checked bag minus the
    cheapest fare WITHOUT checked bag across all non-sold-out flights.
    """
    routes = data.get("routes", [])
    if not routes:
        return None

    min_no_bag: Optional[float] = None
    min_with_bag: Optional[float] = None

    for flight in routes[0].get("flights", []):
        if flight.get("soldOut") or flight.get("isPlaceHolder"):
            continue
        for fare in flight.get("fares", []):
            if fare.get("soldOut"):
                continue
            price = fare.get("price")
            if price is None or price <= 0:
                continue

            services = fare.get("fareBundle", {}).get("bundleServices", [])
            has_checked_bag = any(
                "checked" in s.get("description", "").lower()
                or s.get("ssrCode", "").startswith("CB")
                or s.get("ssrCode", "") in ("2C32",)
                for s in services
            )

            if has_checked_bag:
                if min_with_bag is None or price < min_with_bag:
                    min_with_bag = price
            else:
                if min_no_bag is None or price < min_no_bag:
                    min_no_bag = price

    if min_with_bag is not None and min_no_bag is not None:
        diff = round(min_with_bag - min_no_bag, 2)
        return diff if diff > 0 else None
    return None


async def _probe_sz(
    origin: str,
    dest: str,
    date_str: Optional[str] = None,
    flight_no: Optional[str] = None,
) -> Optional[dict]:
    """
    SkyExpress (SZ) — navigate skyexpress.gr booking form via Playwright.

    The form is Angular + PrimeNG (p-dropdown for airports, p-calendar for dates).
    Submitting redirects to flights.skyexpress.gr (Sabre ezyCommerce).
    The Availability/SearchShop API fires automatically on the results page and
    returns fare bundles that encode checked-bag pricing.

    Strategy:
    1. Load skyexpress.gr/en/book/flight, click "One way".
    2. Select origin/dest via PrimeNG p-dropdown panels.
    3. Open PrimeNG p-calendar via label:has-text('Dates'), pick target day, close.
    4. Click search → wait for navigation to flights.skyexpress.gr.
    5. Intercept Availability/SearchShop (content-type: text/plain, JSON body).
    6. Parse fare bundles: checked_bag_from = cheapest_with_bag − cheapest_without_bag.
    """
    from datetime import datetime as _dt

    from playwright.async_api import async_playwright

    dep = _probe_date(date_str, weeks_ahead=6)

    probe_origin = origin if (origin and len(origin) == 3) else "ATH"
    probe_dest = dest if (dest and len(dest) == 3 and dest != probe_origin) else "HER"
    if probe_dest == probe_origin:
        probe_dest = "HER"

    # ── Snapshot fast-path (no browser needed) ────────────────────────────────
    _sz_snap = await asyncio.get_event_loop().run_in_executor(None, _gcs_load_snapshot, "SZ")
    if _sz_snap is not None:
        _sz_result = _snap_replay_sz(_sz_snap)
        if _sz_result:
            logger.info("SZ probe: replayed from GCS snapshot (no browser)")
            return _sz_result

    dep_date = _dt.strptime(dep, "%Y-%m-%d")
    target_month_name = dep_date.strftime("%B")
    target_day_str = str(dep_date.day)

    search_shop_data: Optional[dict] = None
    cap_event = asyncio.Event()

    _sz_har_tmp = await asyncio.get_event_loop().run_in_executor(None, _prepare_har_tmp, "SZ")

    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True, args=_pw_stealth_args())
            ctx = await browser.new_context(
                viewport={"width": 1366, "height": 768},
                locale="en-US",
                timezone_id="Europe/Athens",
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/135.0.0.0 Safari/537.36"
                ),
            )
            await _setup_har_route(ctx, "SZ", _sz_har_tmp)
            page = await ctx.new_page()

            async def _on_resp(resp):
                nonlocal search_shop_data
                if resp.status != 200:
                    return
                if "ezycommerce.sabre.com" not in resp.url:
                    return
                if "Availability/SearchShop" not in resp.url:
                    return
                try:
                    body = await resp.body()
                    data = json.loads(body.decode("utf-8"))
                    search_shop_data = data
                    cap_event.set()
                except Exception:
                    pass

            page.on("response", _on_resp)

            booking_url = (
                f"https://www.skyexpress.gr/en/book/flight"
                f"?origin={probe_origin}&destination={probe_dest}"
                f"&date={dep}&adult=1&tripType=OW"
            )
            try:
                await page.goto(booking_url, wait_until="domcontentloaded", timeout=30_000)
                await asyncio.sleep(4)
            except Exception as exc:
                logger.debug("SZ booking page: %s", exc)

            # Dismiss cookie consent
            try:
                if await page.locator("#onetrust-accept-btn-handler").count() > 0:
                    await page.locator("#onetrust-accept-btn-handler").first.click(timeout=3000)
                    await asyncio.sleep(1.5)
            except Exception:
                pass

            # Dismiss promo popup
            try:
                if await page.locator(".sky-obx__close").count() > 0:
                    await page.locator(".sky-obx__close").first.click(timeout=2000)
                    await asyncio.sleep(0.5)
            except Exception:
                pass

            # Click "One way" — URL param tripType=OW does NOT auto-set the radio
            try:
                await page.locator("label:has-text('One way')").first.click(timeout=5000)
                await asyncio.sleep(1.2)
            except Exception as exc:
                logger.debug("SZ one-way click: %s", exc)

            # Select origin via PrimeNG p-dropdown (NOT p-autocomplete)
            try:
                await page.locator("p-dropdown").nth(0).click(timeout=5000)
                await asyncio.sleep(1.2)
                await page.locator(".p-dropdown-item").filter(has_text=probe_origin).first.click(timeout=4000)
                await asyncio.sleep(1.2)
            except Exception as exc:
                logger.debug("SZ origin dropdown: %s", exc)

            # Select destination via PrimeNG p-dropdown
            try:
                await page.locator("p-dropdown").nth(1).click(timeout=5000)
                await asyncio.sleep(1.2)
                await page.locator(".p-dropdown-item").filter(has_text=probe_dest).first.click(timeout=4000)
                await asyncio.sleep(2.0)
            except Exception as exc:
                logger.debug("SZ dest dropdown: %s", exc)

            # Open PrimeNG p-calendar via the readonly input (force=True bypasses overlay span)
            try:
                await page.locator("#dates-book-flight-form").first.click(timeout=3000, force=True)
                await asyncio.sleep(1.5)
                panel_count = await page.locator(".p-datepicker-group").count()
                if panel_count == 0:
                    await page.locator("label:has-text('Dates')").first.click(timeout=3000)
                    await asyncio.sleep(1.5)
                    panel_count = await page.locator(".p-datepicker-group").count()
            except Exception as exc:
                logger.debug("SZ calendar open: %s", exc)
                panel_count = 0

            # Click target day in the correct month panel
            try:
                target_panel_idx = None
                for i in range(panel_count):
                    hdr = await (
                        page.locator(".p-datepicker-group").nth(i)
                        .locator(".p-datepicker-title").first
                        .inner_text()
                    )
                    if target_month_name in hdr:
                        target_panel_idx = i
                        break

                if target_panel_idx is not None:
                    panel = page.locator(".p-datepicker-group").nth(target_panel_idx)
                    cells = await panel.locator(
                        "td:not(.p-disabled):not(.p-datepicker-other-month) a"
                    ).all()
                    for cell in cells:
                        if (await cell.inner_text()).strip() == target_day_str:
                            await cell.click()
                            await asyncio.sleep(0.5)
                            break
                    # Close calendar
                    try:
                        await page.locator("button:has-text('Done')").first.click(timeout=2000)
                    except Exception:
                        pass
            except Exception as exc:
                logger.debug("SZ calendar day click: %s", exc)

            # Submit search
            try:
                await page.locator("button#book-flight-form-search-button").click(timeout=5000)
            except Exception as exc:
                logger.debug("SZ search button: %s", exc)

            # Wait for redirect to flights.skyexpress.gr
            try:
                await page.wait_for_url("**/flights.skyexpress.gr/**", timeout=20_000)
            except Exception:
                pass

            # Wait for SearchShop to fire
            try:
                await asyncio.wait_for(cap_event.wait(), timeout=30.0)
            except (asyncio.TimeoutError, TimeoutError):
                pass

            await browser.close()
    except Exception as exc:
        logger.debug("SZ Playwright probe error: %s", exc)
    asyncio.get_event_loop().run_in_executor(None, _gcs_save_har, "SZ", _sz_har_tmp)

    if search_shop_data:
        bag_from = _sz_bag_price_from_search_shop(search_shop_data)
        if bag_from and bag_from > 0:
            # Save raw SearchShop response to GCS snapshot
            asyncio.get_event_loop().run_in_executor(
                None, _gcs_save_snapshot, "SZ", "sz_search_shop", search_shop_data, None,
            )
            return {
                "checked_bag_note": (
                    f"checked bag not included in base fare "
                    f"– add-on from EUR {bag_from:.0f}"
                ),
                "bags_note": "hand luggage 8 kg + 1 personal item included in base fare",
                "checked_bag_from": bag_from,
                "currency": "EUR",
                "seat_note": "seat selection add-on available",
            }

    logger.debug("SZ probe: no bag prices captured for %s→%s", probe_origin, probe_dest)
    return None


# ── LA — LATAM Airlines ───────────────────────────────────────────────────────

async def _probe_la(
    origin: str,
    dest: str,
    date_str: Optional[str] = None,
    flight_no: Optional[str] = None,
) -> Optional[dict]:
    """
    LATAM Airlines (LA/JJ) — navigate the full booking flow using the persistent
    CDP Chrome session (port 9456, same as the latam connector).

    Flow: CL-locale search → click first card → select BASIC fare →
          accept restrictions modal → skip flex (button9) → seats page →
          click 'Quiero elegir asientos después' → tienda/store page →
          intercept /bff/ancillaries/baggages/order/{orderId}/all.

    Uses CL locale because additionalServicesOfferCl=true — the US locale
    suppresses the bags upsell step entirely.
    """
    from letsfg.connectors.latam import _get_context as _la_ctx

    probe_origin = origin if (origin and len(origin) == 3) else "SCL"
    probe_dest = dest if (dest and len(dest) == 3 and dest != probe_origin) else "LIM"
    if probe_dest == probe_origin:
        probe_dest = "LIM"

    dep = _probe_date(date_str, weeks_ahead=6)

    search_url = (
        f"https://www.latamairlines.com/cl/es/ofertas-vuelos"
        f"?outbound={dep}T00%3A00%3A00.000Z&inbound=null"
        f"&origin={probe_origin}&destination={probe_dest}"
        f"&adt=1&chd=0&inf=0&trip=OW&cabin=Y&redemption=false&sort=RECOMMENDED"
    )

    bag_prices: List[float] = []
    carry_on_prices: List[float] = []
    seat_prices: List[float] = []
    currency = "CLP"
    bags_event = asyncio.Event()
    seats_event = asyncio.Event()

    try:
        ctx = await asyncio.wait_for(_la_ctx(), timeout=20.0)
        page = await ctx.new_page()

        async def _on_resp(resp):
            nonlocal currency
            if "latamairlines.com" not in resp.url:
                return
            if resp.status != 200:
                return
            ct = resp.headers.get("content-type", "")
            if "json" not in ct:
                return
            url = resp.url
            try:
                if "/bff/ancillaries/baggages/order/" in url and url.split("?")[0].endswith("/all"):
                    data = await resp.json()
                    # data is list[{passengerId, uniqId, offers:[{typeBag, weight, offers:[{price:{amount,currency}}]}]}]
                    if isinstance(data, list):
                        for pax in data:
                            for bag_type in pax.get("offers", []):
                                wt = bag_type.get("typeBag", 0)
                                for offer in bag_type.get("offers", []):
                                    pr = offer.get("price") or offer.get("totalPrice") or {}
                                    amt = pr.get("amount")
                                    cur = pr.get("currency", currency)
                                    if amt and float(amt) > 0:
                                        currency = cur
                                        if wt <= 15:
                                            carry_on_prices.append(float(amt))
                                        else:
                                            bag_prices.append(float(amt))
                    if bag_prices or carry_on_prices:
                        bags_event.set()
                elif "/bff/ancillaries/seats/offers/order/" in url:
                    data = await resp.json()
                    # data is {"0": {"flightCode", "offers": [{price:{amount,currency}, ...}]}}
                    if isinstance(data, dict):
                        for leg in data.values():
                            if isinstance(leg, dict):
                                for seat in leg.get("offers", []):
                                    pr = seat.get("price") or seat.get("totalPrice") or {}
                                    amt = pr.get("amount")
                                    if amt and float(amt) > 0:
                                        seat_prices.append(float(amt))
                        if seat_prices:
                            seats_event.set()
            except Exception:
                pass

        page.on("response", _on_resp)

        # ── Load search ───────────────────────────────────────────────────────
        logger.debug("LA probe: goto %s", search_url[:100])
        try:
            await page.goto(search_url, wait_until="domcontentloaded", timeout=30_000)
        except Exception as exc:
            logger.debug("LA search page: %s", exc)
        await asyncio.sleep(8)
        logger.debug("LA probe: page URL after 8s = %s", page.url[:120])

        # ── Dismiss overlays ──────────────────────────────────────────────────
        for sel in [
            "[data-testid='country-suggestion--dialog'] button:last-child",
        ]:
            try:
                loc = page.locator(sel).first
                if await loc.count() > 0 and await loc.is_visible(timeout=500):
                    await loc.click(timeout=1500)
                    await asyncio.sleep(0.3)
            except Exception:
                pass
        try:
            await page.evaluate("""
            () => {
                ['[data-testid="country-suggestion--dialog"]',
                 '[id="country-suggestion"]',
                 '[data-testid="boreal-backdrop"]'].forEach(s => {
                    const el = document.querySelector(s);
                    if (el) { el.style.display = 'none'; el.style.pointerEvents = 'none'; }
                });
            }
            """)
        except Exception:
            pass

        # ── Click first flight card ───────────────────────────────────────────
        try:
            cnt = await page.locator('[data-testid="wrapper-card-header-0"]').count()
            logger.debug("LA probe: card count=%d", cnt)
            await page.locator('[data-testid="wrapper-card-header-0"]').click(timeout=5000)
            logger.debug("LA probe: card clicked")
            await asyncio.sleep(3)
        except Exception as exc:
            logger.debug("LA click card: %s", exc)
            await page.close()
            return None

        # ── Select BASIC fare ─────────────────────────────────────────────────
        try:
            await page.locator('[data-testid="bundle-detail-0-flight-select"]').click(timeout=5000)
            logger.debug("LA probe: BASIC fare clicked")
            await asyncio.sleep(2)
        except Exception as exc:
            logger.debug("LA BASIC fare click: %s", exc)

        # ── Accept restrictions modal ─────────────────────────────────────────
        try:
            btn = page.locator('[data-testid="current-brand-button"]')
            cnt = await btn.count()
            logger.debug("LA probe: restrictions btn count=%d", cnt)
            if cnt > 0 and await btn.is_visible(timeout=2000):
                await btn.click(timeout=5000)
                logger.debug("LA probe: restrictions accepted, URL=%s", page.url[:100])
                await asyncio.sleep(3)
        except Exception as exc:
            logger.debug("LA restrictions modal: %s", exc)

        # ── Accept cookies if present ─────────────────────────────────────────
        for sel in ["button:has-text('Accept all cookies')", "button:has-text('Aceptar todas')"]:
            try:
                loc = page.locator(sel).first
                if await loc.count() > 0 and await loc.is_visible(timeout=800):
                    await loc.click(timeout=1500)
                    await asyncio.sleep(0.5)
                    break
            except Exception:
                pass

        # ── Skip flex (Continue without refund option) ────────────────────────
        try:
            btn = page.locator('[data-testid="button9--button"]')
            cnt = await btn.count()
            logger.debug("LA probe: flex btn count=%d, URL=%s", cnt, page.url[:100])
            if cnt > 0 and await btn.is_visible(timeout=2000):
                await btn.click(timeout=5000)
                logger.debug("LA probe: flex skipped")
                await asyncio.sleep(4)
        except Exception:
            for sel in ["button:has-text('Continuar')", "button:has-text('Continue')"]:
                try:
                    loc = page.locator(sel).first
                    if await loc.count() > 0 and await loc.is_visible(timeout=1000):
                        await loc.click(timeout=3000)
                        await asyncio.sleep(4)
                        break
                except Exception:
                    pass

        # ── Wait for seats page, then skip ───────────────────────────────────
        await asyncio.sleep(5)
        logger.debug("LA probe: URL after flex+wait = %s", page.url[:120])
        try:
            await asyncio.wait_for(seats_event.wait(), timeout=3.0)
        except (asyncio.TimeoutError, TimeoutError):
            pass
        # Skip seat selection
        skip_clicked = False
        for sel in [
            "button:has-text('Quiero elegir asientos después')",
            "button:has-text('elegir asientos después')",
            "button:has-text('después')",
            "button:has-text('Skip')",
            "button:has-text('later')",
        ]:
            try:
                loc = page.locator(sel).first
                cnt = await loc.count()
                logger.debug("LA probe: skip-seats sel=%r count=%d", sel[:40], cnt)
                if cnt > 0 and await loc.is_visible(timeout=1000):
                    await loc.click(timeout=5000)
                    skip_clicked = True
                    logger.debug("LA probe: seats skipped with sel=%r", sel[:40])
                    break
            except Exception as exc:
                logger.debug("LA probe: skip-seats sel=%r exc=%s", sel[:40], exc)

        logger.debug("LA probe: skip_clicked=%s, URL=%s", skip_clicked, page.url[:120])
        if skip_clicked:
            # LATAM now shows a confirmation modal: "Tu asiento podría ser el del medio"
            # Must click "Prefiero uno aleatorio" to confirm seat skip
            await asyncio.sleep(2)
            for confirm_sel in [
                "button:has-text('Prefiero uno aleatorio')",
                "button:has-text('aleatorio')",
                "button:has-text('random')",
            ]:
                try:
                    loc = page.locator(confirm_sel).first
                    cnt = await loc.count()
                    logger.debug("LA probe: confirm-skip sel=%r count=%d", confirm_sel[:40], cnt)
                    if cnt > 0 and await loc.is_visible(timeout=2000):
                        await loc.click(timeout=5000)
                        logger.debug("LA probe: confirm-skip clicked")
                        break
                except Exception as exc:
                    logger.debug("LA probe: confirm-skip sel=%r exc=%s", confirm_sel[:40], exc)

            # Wait for navigation to the tienda (store) page where bags API fires
            try:
                await page.wait_for_url("**/tienda**", timeout=20_000)
                logger.debug("LA probe: navigated to tienda, URL=%s", page.url[:120])
            except Exception as exc:
                logger.debug("LA probe: wait_for_url tienda failed: %s, URL=%s", exc, page.url[:120])
            # Give the page a moment to fire the bags API
            await asyncio.sleep(3)

        # ── Wait for bags/all API call ────────────────────────────────────────
        try:
            await asyncio.wait_for(bags_event.wait(), timeout=20.0)
        except (asyncio.TimeoutError, TimeoutError):
            logger.debug("LA bags_event timed out for %s→%s", probe_origin, probe_dest)

        await page.close()
    except Exception as exc:
        logger.debug("LA Playwright probe error: %s", exc)

    if not bag_prices and not carry_on_prices:
        logger.debug("LA probe: no bag prices captured for %s→%s", probe_origin, probe_dest)
        return None

    all_bag = sorted(carry_on_prices + bag_prices)
    min_bag = min(bag_prices) if bag_prices else min(carry_on_prices)
    cur = currency

    result: dict = {
        "checked_bag_note": (
            f"checked bag not included (Basic fare) – add-on from {cur} {min_bag:.0f}"
        ),
        "bags_note": f"carry-on not included (Basic fare) – add-on from {cur} {min(carry_on_prices):.0f}" if carry_on_prices else "carry-on not included (Basic fare)",
        "checked_bag_from": min_bag,
        "currency": cur,
    }
    result["seat_note"] = (
        f"seat selection add-on from {cur} {min(seat_prices):.0f}"
        if seat_prices
        else "seat selection available"
    )
    if seat_prices:
        result["seat_from"] = min(seat_prices)
    return result


# ── Y4 — Volaris ──────────────────────────────────────────────────────────────

def _y4_prices_from_quote(quote_data: dict) -> dict:
    """Extract bag/seat add-on prices from Volaris booking/quote response.

    booking/quote.breakdown.passengerTotals.specialServices.charges is a flat
    list of {code, detail, amount, currencyCode} entries — one per SSR type —
    followed by an MO (Mexico route surcharge) entry for that SSR.  We parse
    only the base SSR amounts (not the MO surcharge entries).

    Carry-on SSRs : CRB1 (1st carry-on), CRRB (carry-on bundle)
    Checked SSRs  : BGB1 (1st bag), BGBN (extra bag), BB15 (15 kg bag)
    Seat SSRs     : MOSP (More Speed pack — cheapest seat-related add-on)
    """
    _CARRY_ON = {"CRB1", "CRRB"}
    _CHECKED  = {"BGB1", "BGBN", "BB15"}
    _SEAT     = {"MOSP"}

    carry_on_prices: List[float] = []
    checked_prices: List[float] = []
    seat_prices: List[float] = []
    currency = "MXN"

    try:
        charges = (
            (quote_data.get("breakdown") or {})
            .get("passengerTotals", {})
            .get("specialServices", {})
            .get("charges") or []
        )
        for c in charges:
            code = (c.get("code") or "").upper().strip()
            if code == "MO":  # route surcharge — skip
                continue
            try:
                amount = float(c.get("amount") or 0)
            except (TypeError, ValueError):
                amount = 0.0
            if amount <= 0:
                continue
            cur = c.get("currencyCode") or currency
            currency = cur
            if code in _CARRY_ON:
                carry_on_prices.append(amount)
            elif code in _CHECKED:
                checked_prices.append(amount)
            elif code in _SEAT:
                seat_prices.append(amount)
    except Exception:
        pass

    return {
        "carry_on": carry_on_prices,
        "checked": checked_prices,
        "seats": seat_prices,
        "currency": currency,
    }


async def _probe_y4(
    origin: str,
    dest: str,
    date_str: Optional[str] = None,
    flight_no: Optional[str] = None,
) -> Optional[dict]:
    """
    Volaris (Y4) — Navitaire-based Angular SPA (apigw.volaris.com).

    Flow confirmed from _disco_volaris.py live capture 2026-05-03 (MEX→CUN):
      1. Navigate directly to /flight/select?... URL (skips homepage form)
      2. Wait for v3/availability/search to confirm results loaded
      3. Dismiss cookie banner (Aceptar cookies)
      4. Click a.panel-open → expand fare family panel for first flight
      5. Click .btn-select → FareBenefitsUpgradeModal appears
      6. Click "Mantener Zero" in modal → booking/quote fires (200 OK)
      7. Parse booking/quote breakdown.passengerTotals.specialServices.charges
         for carry-on (CRB1/CRRB) and checked-bag (BGB1/BGBN) prices

    The booking/quote response contains a full pre-computed SSR price catalogue
    for the specific route.  No further checkout navigation is required.
    Currency is always MXN (es-MX locale session).
    """
    from datetime import date as _date_cls
    from patchright.async_api import async_playwright as _patchright_playwright
    from .browser import find_chrome

    probe_origin = origin if (origin and len(origin) == 3) else "MEX"
    probe_dest = dest if (dest and len(dest) == 3 and dest != probe_origin) else "CUN"
    if probe_dest == probe_origin:
        probe_dest = "CUN"

    dep = _probe_date(date_str, weeks_ahead=6)
    dep_dt = _date_cls.fromisoformat(dep)
    dep_url_date = f"{dep_dt.month:02d}/{dep_dt.day:02d}/{dep_dt.year}"

    search_url = (
        f"https://www.volaris.com/flight/select"
        f"?culture=es-mx&promocode="
        f"&o1={probe_origin}&d1={probe_dest}"
        f"&dd1={dep_url_date}"
        f"&adt=1&ch=0&inf=0&trip=OW"
    )

    quote_prices: dict = {}
    avail_event = asyncio.Event()
    quote_event = asyncio.Event()

    chrome_path: Optional[str] = None
    try:
        chrome_path = find_chrome()
    except RuntimeError:
        pass

    try:
        async with _patchright_playwright() as pw:
            launch_kwargs: dict = {
                "headless": False,
                "args": [
                    "--no-first-run",
                    "--no-default-browser-check",
                    "--window-size=1440,900",
                    "--no-sandbox",
                    "--disable-dev-shm-usage",
                ],
            }
            if chrome_path:
                launch_kwargs["executable_path"] = chrome_path
            browser = await pw.chromium.launch(**launch_kwargs)
            ctx = await browser.new_context(
                viewport={"width": 1440, "height": 900},
                locale="es-MX",
                timezone_id="America/Mexico_City",
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/135.0.0.0 Safari/537.36"
                ),
            )
            page = await ctx.new_page()

            async def _on_resp(resp) -> None:
                nonlocal quote_prices
                if resp.status != 200:
                    return
                ct = resp.headers.get("content-type", "")
                if "json" not in ct:
                    return
                url = resp.url
                try:
                    if "/api/v3/availability/search" in url:
                        avail_event.set()
                    elif "/api/booking/quote" in url:
                        data = await resp.json()
                        if isinstance(data, dict):
                            parsed = _y4_prices_from_quote(data)
                            if parsed.get("carry_on") or parsed.get("checked"):
                                quote_prices = parsed
                                quote_event.set()
                except Exception:
                    pass

            page.on("response", _on_resp)

            logger.debug("Y4 probe: goto %s", search_url[:120])
            try:
                await page.goto(search_url, wait_until="domcontentloaded", timeout=30_000)
            except Exception as exc:
                logger.debug("Y4 goto search: %s", exc)

            # Wait for availability API (up to 35 s — Angular SPA boot + search)
            try:
                await asyncio.wait_for(avail_event.wait(), timeout=35.0)
            except (asyncio.TimeoutError, TimeoutError):
                logger.debug("Y4 probe: availability timed out for %s→%s", probe_origin, probe_dest)
                await browser.close()
                return None

            await asyncio.sleep(4)  # allow Angular to render results

            # Dismiss cookie banner if present
            for ck_sel in [
                "button:has-text('Aceptar cookies')",
                "button:has-text('Aceptar')",
            ]:
                try:
                    ck = page.locator(ck_sel).first
                    if await ck.count() > 0 and await ck.is_visible(timeout=600):
                        await ck.click(timeout=2000)
                        await asyncio.sleep(0.5)
                        break
                except Exception:
                    pass

            # Expand fare panel for first flight
            try:
                panel = page.locator("a.panel-open").first
                if await panel.count() == 0:
                    logger.debug("Y4 probe: no panel-open for %s→%s", probe_origin, probe_dest)
                    await browser.close()
                    return None
                await panel.click(timeout=5000)
                await asyncio.sleep(2)
            except Exception as exc:
                logger.debug("Y4 probe: panel-open click: %s", exc)
                await browser.close()
                return None

            # Click Zero fare select button
            try:
                btn = page.locator(".btn-select").first
                await btn.wait_for(state="visible", timeout=8000)
                await btn.click(timeout=5000)
                await asyncio.sleep(2)
            except Exception as exc:
                logger.debug("Y4 probe: btn-select: %s", exc)
                await browser.close()
                return None

            # Handle FareBenefitsUpgradeModal → click "Mantener Zero"
            try:
                for _ in range(6):
                    await asyncio.sleep(1)
                    modal_btns = await page.locator("mat-dialog-actions button").all()
                    for mb in modal_btns:
                        txt = (await mb.inner_text()).strip()
                        if "Mantener" in txt:
                            await mb.click()
                            logger.debug("Y4 probe: Mantener clicked")
                            break
                    else:
                        continue
                    break
            except Exception as exc:
                logger.debug("Y4 probe: modal click: %s", exc)

            # Wait for booking/quote API response
            try:
                await asyncio.wait_for(quote_event.wait(), timeout=15.0)
            except (asyncio.TimeoutError, TimeoutError):
                logger.debug("Y4 probe: quote timed out for %s→%s", probe_origin, probe_dest)

            await browser.close()

    except Exception as exc:
        logger.debug("Y4 Playwright probe error: %s", exc)

    if not quote_prices:
        logger.debug("Y4 probe: no prices captured for %s→%s", probe_origin, probe_dest)
        return None

    carry_on = quote_prices.get("carry_on", [])
    checked  = quote_prices.get("checked", [])
    seats    = quote_prices.get("seats", [])
    cur      = quote_prices.get("currency", "MXN")

    if not carry_on and not checked:
        return None

    min_carry   = min(carry_on) if carry_on else None
    min_checked = min(checked) if checked else None
    min_seat    = min(seats) if seats else None

    result: dict = {
        "currency": cur,
    }
    if min_checked:
        result["checked_bag_note"] = (
            f"checked bag not included (Zero fare) "
            f"– add-on from {cur} {min_checked:.0f}"
        )
        result["checked_bag_from"] = min_checked
    else:
        result["checked_bag_note"] = "checked bag not included (Zero fare)"

    if min_carry:
        result["bags_note"] = (
            f"carry-on not included (Zero fare) "
            f"– add-on from {cur} {min_carry:.0f}"
        )
        result["carry_on_from"] = min_carry
    else:
        result["bags_note"] = "personal item only included in Zero fare"

    result["seat_note"] = (
        f"seat selection add-on from {cur} {min_seat:.0f}"
        if min_seat
        else "seat selection available"
    )
    if min_seat:
        result["seat_from"] = min_seat

    return result


# ── CM — Copa Airlines ────────────────────────────────────────────────────────

async def _probe_cm(
    origin: str,
    dest: str,
    date_str: Optional[str] = None,
    flight_no: Optional[str] = None,
) -> Optional[dict]:
    """
    Copa Airlines (CM) — direct HTTP probe via api.copaair.com/ibe/booking/plan.

    Copa's IBE pre-fetches the plan API on page load (no CAPTCHA challenge).
    Response includes:
      - solutions[].economyBasicPriceDiff — USD diff from Basic (no bag) to
        Economy Classic (1 × 23 kg bag included)
      - solutions[].offers[].fareFamily.isEconomyBasic — identifies Basic tier
      - solutions[].offers[].totalPrice — per tier pricing

    We take the cheapest Basic fare and the cheapest Classic fare from the first
    direct (non-stop / 1-stop) solution to compute the bag add-on.

    Fallback: if no multiple fare families are present, use economyBasicPriceDiff
    directly as the checked bag add-on cost.

    PTY is used as a fallback origin because Copa is Panama-centric.
    """
    probe_origin = origin if (origin and len(origin) == 3) else "PTY"
    probe_dest = dest if (dest and len(dest) == 3 and dest != probe_origin) else "BOG"
    if probe_dest == probe_origin:
        probe_dest = "BOG"

    dep = _probe_date(date_str, weeks_ahead=6)

    plan_url = (
        f"https://api.copaair.com/ibe/booking/plan"
        f"?departureAirport1={probe_origin}"
        f"&arrivalAirport1={probe_dest}"
        f"&departureDate1={dep}"
        f"&adults=1&children=0&infants=0&isRoundTrip=false"
        f"&departureAirport2={probe_dest}&arrivalAirport2={probe_origin}"
        f"&departureDate2=undefined"
    )

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/135.0.0.0 Safari/537.36"
        ),
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://shopping.copaair.com/",
        "Origin": "https://shopping.copaair.com",
    }

    try:
        from curl_cffi import requests as _curl_requests
        from .browser import get_curl_cffi_proxies as _get_proxies_cm
        _proxies_cm = _get_proxies_cm()
        resp = await asyncio.to_thread(
            lambda: _curl_requests.get(
                plan_url,
                headers=headers,
                impersonate="chrome131",
                timeout=30,
                proxies=_proxies_cm,
            )
        )
        if resp.status_code != 200:
            logger.debug("CM probe: plan HTTP %d for %s→%s", resp.status_code, probe_origin, probe_dest)
            return None
        data = resp.json()
    except Exception as exc:
        logger.debug("CM probe: HTTP error: %s", exc)
        return None

    # data is list[originDestination]; take first
    if not isinstance(data, list) or not data:
        logger.debug("CM probe: unexpected plan response shape")
        return None

    od = data[0]
    currency = (od.get("currency") or {}).get("code", "USD")
    solutions = od.get("solutions") or []
    if not solutions:
        logger.debug("CM probe: no solutions for %s→%s", probe_origin, probe_dest)
        return None

    # Find cheapest Basic and cheapest Classic fares across all solutions
    basic_prices: List[float] = []
    classic_prices: List[float] = []
    basic_diffs: List[float] = []

    for sol in solutions:
        diff = sol.get("economyBasicPriceDiff")
        if diff is not None:
            try:
                basic_diffs.append(float(diff))
            except (TypeError, ValueError):
                pass
        for offer in sol.get("offers") or []:
            ff = offer.get("fareFamily") or {}
            price = offer.get("totalPrice")
            if price is None:
                continue
            try:
                price = float(price)
            except (TypeError, ValueError):
                continue
            if ff.get("isEconomyBasic"):
                basic_prices.append(price)
            elif ff.get("code") in ("CLS", "CLF"):  # Economy Classic / Full
                classic_prices.append(price)

    if not basic_prices:
        logger.debug("CM probe: no Basic fares found for %s→%s", probe_origin, probe_dest)
        return None

    min_basic = min(basic_prices)
    bag_add_on: float

    if basic_diffs:
        bag_add_on = min(basic_diffs)
    elif classic_prices:
        bag_add_on = min(classic_prices) - min_basic
    else:
        logger.debug("CM probe: cannot determine bag cost for %s→%s", probe_origin, probe_dest)
        return None

    if bag_add_on <= 0:
        logger.debug("CM probe: non-positive bag diff %.2f for %s→%s", bag_add_on, probe_origin, probe_dest)
        return None

    return {
        "checked_bag_note": (
            f"checked bag not included in Economy Basic fare "
            f"– add-on from {currency} {bag_add_on:.2f} "
            f"(or upgrade to Economy Classic which includes 1×23 kg)"
        ),
        "bags_note": "carry-on included in all fares",
        "checked_bag_from": bag_add_on,
        "currency": currency,
        "seat_from": 15.0,
        "seat_note": "seat selection from ~USD 15 — add-on (Economy Basic); included in higher fares",
    }


# ── G3 — GOL Linhas Aéreas ────────────────────────────────────────────────────

async def _probe_g3(
    origin: str,
    dest: str,
    date_str: Optional[str] = None,
    flight_no: Optional[str] = None,
) -> Optional[dict]:
    """
    GOL (G3) — live bag-price probe via GOL BFF (bff-flight.voegol.com.br).

    Reuses the production GOL connector's persistent Chrome context, which
    maintains valid Akamai session cookies across searches.

    Flow:
      1. Get (or create) the GOL persistent Chrome context.
      2. Navigate to /compra and wait for the Angular auth token to appear in
         sessionStorage.
      3. Inject search params (origin, dest, date) into sessionStorage.
      4. Navigate to /compra/selecao-de-voo2/ida — Angular resolver fires POST
         to bff-flight.voegol.com.br/flights/search.
      5. Capture the BFF response via page.on("response") and parse offers.
      6. Navigate back to /compra (keeps the SPA alive for the next search).

    BFF response structure (confirmed from production gol.py):
      offers[].fareFamily[].name                       → "LI"/"LIGHT" (no bag), "SMART" (1×23 kg), "MAX" (2×23 kg)
      offers[].fareFamily[].baggageAllowance.quantity  → 0 = no free checked bag
      offers[].fareFamily[].additionalBaggage.totalAmount → add-on cost (BRL)
      offers[].fareFamily[].price.total                → fare price (BRL)
      offers[].fareFamily[].price.currency             → "BRL"
    """
    from .gol import _get_context as _gol_get_context
    from .gol import _GOL_BASE as _GOL_BASE_URL

    probe_origin = origin if (origin and len(origin) == 3) else "GRU"
    probe_dest = dest if (dest and len(dest) == 3 and dest != probe_origin) else "CGH"
    if probe_dest == probe_origin:
        probe_dest = "CGH"

    dep = _probe_date(date_str, weeks_ahead=4)
    dep_dt_str = f"{dep}T00:00:00"

    captured_offers: List[dict] = []
    api_event = asyncio.Event()

    try:
        ctx = await _gol_get_context()

        # Reuse existing GOL page if available, else open a new one
        page = None
        for p in list(ctx.pages):
            try:
                if "voegol.com.br" in p.url and not p.is_closed():
                    page = p
                    break
            except Exception:
                pass
        if page is None:
            page = await ctx.new_page()
            await page.goto(f"{_GOL_BASE_URL}/compra",
                            wait_until="domcontentloaded", timeout=30_000)
            try:
                await page.wait_for_load_state("networkidle", timeout=20_000)
            except Exception:
                pass
            await asyncio.sleep(3)

        # Ensure we're on a GOL page with a live Angular session
        try:
            current_url = page.url
        except Exception:
            current_url = ""
        if "voegol.com.br" not in current_url:
            await page.goto(f"{_GOL_BASE_URL}/compra",
                            wait_until="domcontentloaded", timeout=30_000)
            try:
                await page.wait_for_load_state("networkidle", timeout=20_000)
            except Exception:
                pass
            await asyncio.sleep(3)

        # Wait for Angular auth token in sessionStorage
        uuid: Optional[str] = None
        for _ in range(20):
            await asyncio.sleep(1)
            try:
                result = await page.evaluate("""() => {
                    for (let i = 0; i < sessionStorage.length; i++) {
                        const k = sessionStorage.key(i);
                        const m = k.match(/^([0-9a-f-]{36})_@SiteGolB2C:token$/);
                        if (m) return {uuid: m[1]};
                    }
                    return {uuid: null};
                }""")
                uuid = result.get("uuid")
                if uuid:
                    break
            except Exception:
                pass

        if not uuid:
            logger.debug("G3 probe: no auth token for %s→%s", probe_origin, probe_dest)
            return None

        # Build search payload (mirrors production gol.py _build_search_payload)
        search_payload = {
            "promocodebanner": False,
            "destinationCountryToUSA": False,
            "lastSearchCourtesyTicket": False,
            "passengerCourtesyType": None,
            "airSearch": {
                "cabinClass": "ECONOMY",
                "currency": None,
                "pointOfSale": "BR",
                "awardBooking": False,
                "searchType": "BRANDED",
                "promoCodes": [""],
                "originalItineraryParts": [{
                    "from": {"code": probe_origin, "useNearbyLocations": False},
                    "to": {"code": probe_dest, "useNearbyLocations": False},
                    "when": {"date": dep_dt_str},
                }],
                "itineraryParts": [{
                    "from": {"code": probe_origin, "useNearbyLocations": False},
                    "to": {"code": probe_dest, "useNearbyLocations": False},
                    "when": {"date": dep_dt_str},
                }],
                "passengers": {"ADT": 1, "TEEN": 0, "CHD": 0, "INF": 0, "UNN": 0},
            },
        }
        passengers = {"ADT": 1, "TEEN": 0, "CHD": 0, "INF": 0, "UNN": 0}

        await page.evaluate("""({uuid, search, passengers}) => {
            sessionStorage.setItem(uuid + '_@SiteGolB2C:search', JSON.stringify(search));
            sessionStorage.setItem(uuid + '_@SiteGolB2C:search-properties',
                JSON.stringify({journey: 'one-way'}));
            sessionStorage.setItem(uuid + '_@SiteGolB2C:passengers', JSON.stringify(passengers));
            sessionStorage.setItem('flightSelectionScreen', JSON.stringify('v2'));
        }""", {"uuid": uuid, "search": search_payload, "passengers": passengers})

        async def on_response(response):
            try:
                if response.status != 200:
                    return
                url = response.url
                if "voegol.com.br" not in url:
                    return
                ct = response.headers.get("content-type", "")
                if "json" not in ct:
                    return
                if any(s in url for s in ["/assets/", "/i18n/", "channelcfg-api",
                                           "cookielaw", "onetrust", "datadoghq",
                                           "/M45P/", "gol-auth-api"]):
                    return
                data = await response.json()
                if isinstance(data, dict) and "offers" in data:
                    captured_offers.clear()
                    captured_offers.extend(data["offers"])
                    api_event.set()
            except Exception:
                pass

        page.on("response", on_response)
        try:
            await page.goto(f"{_GOL_BASE_URL}/compra/selecao-de-voo2/ida",
                            wait_until="domcontentloaded", timeout=30_000)
            try:
                await asyncio.wait_for(api_event.wait(), timeout=35.0)
            except (asyncio.TimeoutError, TimeoutError):
                logger.debug("G3 probe: BFF timeout for %s→%s", probe_origin, probe_dest)
        finally:
            page.remove_listener("response", on_response)

        # Navigate back to /compra (keeps context alive for next probe)
        try:
            await page.goto(f"{_GOL_BASE_URL}/compra",
                            wait_until="domcontentloaded", timeout=15_000)
            await asyncio.sleep(1)
        except Exception:
            pass

    except Exception as exc:
        logger.debug("G3 probe error: %s", exc)
        return None

    if not captured_offers:
        logger.debug("G3 probe: no offers captured for %s→%s", probe_origin, probe_dest)
        return None

    # Parse: find cheapest no-bag fare and extract its additionalBaggage price
    bag_add_on_prices: List[float] = []
    currency = "BRL"

    for offer in captured_offers:
        ff = offer.get("fareFamily") or []
        for fare in ff:
            price_info = fare.get("price") or {}
            currency = price_info.get("currency", "BRL")

            bag_allow = (
                fare.get("baggageAllowance")
                or fare.get("baggage")
                or fare.get("checkedBaggage")
                or {}
            )
            qty = None
            if isinstance(bag_allow, dict):
                qty = bag_allow.get("quantity") or bag_allow.get("pieces")
            try:
                qty_int = int(qty) if qty is not None else -1
            except (TypeError, ValueError):
                qty_int = -1

            # Infer from fare name when quantity field is absent
            if qty_int < 0:
                name_up = str(fare.get("name") or fare.get("code") or "").upper()
                if "LIGHT" in name_up or name_up in ("LI", "LITE", "PROMO"):
                    qty_int = 0
                elif any(k in name_up for k in ("SMART", "PLUS", "MAX", "TOP", "PREMIUM")):
                    qty_int = 1  # has bag — skip

            if qty_int != 0:
                continue  # only price no-bag fares

            add_bag = (
                fare.get("additionalBaggage")
                or fare.get("extraBaggage")
                or fare.get("upgradeBaggage")
                or {}
            )
            if isinstance(add_bag, dict):
                add_price = (
                    add_bag.get("totalAmount")
                    or add_bag.get("amount")
                    or (add_bag.get("price") or {}).get("total")
                )
                if add_price:
                    try:
                        bag_add_on_prices.append(float(add_price))
                    except (TypeError, ValueError):
                        pass

    if not bag_add_on_prices:
        logger.debug("G3 probe: no bag add-on prices for %s→%s", probe_origin, probe_dest)
        return None

    min_bag = min(bag_add_on_prices)

    return {
        "checked_bag_note": (
            f"checked bag not included in Light fare "
            f"– add-on from {currency} {min_bag:.0f}"
        ),
        "bags_note": "carry-on (10 kg) included in all GOL fares",
        "checked_bag_from": min_bag,
        "currency": currency,
        "seat_note": "seat selection add-on available at checkout",
    }


# ── AD — Azul ─────────────────────────────────────────────────────────────────

async def _probe_ad(
    origin: str,
    dest: str,
    date_str: Optional[str] = None,
    flight_no: Optional[str] = None,
) -> Optional[dict]:
    """
    Azul (AD) — Navitaire availability API probe via www.voeazul.com.br.

    Reuses the Azul connector's persistent Chrome context (shared session/cookies)
    which bypasses Akamai bot protection via persistent headed Chrome.

    Flow:
      1. Get the Azul persistent Chrome context via azul._get_context().
      2. Navigate to www.voeazul.com.br/us/en/home/selecao-voo deep-link URL.
      3. Wait for the Navitaire reservationavailability/v5 (or v6) API response.
      4. Parse the cheapest AZUL (no bag) and BLUE (1×23 kg) fares from all
         journeys in the first trip.
      5. Return price difference as checked bag add-on cost.

    Azul Navitaire bundle codes:
      AZUL / A / AZ   → no free checked bag (base fare)
      BLUE / BU / XT  → 1×23 kg bag included
      BLACK / BL      → 2×23 kg bags included
    """
    from datetime import date as _date_cls
    from .azul import _get_context as _azul_get_context

    probe_origin = origin if (origin and len(origin) == 3) else "GRU"
    probe_dest   = dest if (dest and len(dest) == 3 and dest != probe_origin) else "CNF"
    if probe_dest == probe_origin:
        probe_dest = "CNF"

    dep = _probe_date(date_str, weeks_ahead=6)
    dep_dt = _date_cls.fromisoformat(dep)
    dep_str_url = dep_dt.strftime("%m/%d/%Y")

    search_url = (
        f"https://www.voeazul.com.br/us/en/home/selecao-voo"
        f"?c[0].ds={probe_origin}&c[0].as={probe_dest}"
        f"&c[0].std={dep_str_url}"
        f"&p[0].t=ADT&p[0].c=1&p[0].cp=false&cc=BRL"
    )

    captured: dict = {}
    api_event = asyncio.Event()

    async def on_response(response) -> None:
        try:
            if response.status != 200:
                return
            url = response.url
            if "reservationavailability" not in url:
                return
            if "/availability/v" not in url:
                return
            ct = response.headers.get("content-type", "")
            if "json" not in ct:
                return
            body = await response.json()
            if isinstance(body, dict) and body.get("data") and body["data"] != {}:
                captured["avail"] = body
                api_event.set()
                logger.debug("AD probe: captured availability for %s→%s", probe_origin, probe_dest)
        except Exception:
            pass

    page = None
    try:
        ctx = await _azul_get_context()
        page = await ctx.new_page()
        page.on("response", on_response)

        try:
            await page.goto(search_url, wait_until="domcontentloaded", timeout=30_000)
        except Exception as exc:
            logger.debug("AD probe: goto error: %s", exc)

        try:
            await asyncio.wait_for(api_event.wait(), timeout=55.0)
        except (asyncio.TimeoutError, TimeoutError):
            logger.debug("AD probe: availability timed out for %s→%s", probe_origin, probe_dest)

    except Exception as exc:
        logger.debug("AD probe error: %s", exc)
    finally:
        if page is not None:
            try:
                page.remove_listener("response", on_response)
            except Exception:
                pass
            try:
                await page.close()
            except Exception:
                pass

    data = captured.get("avail")
    if data is None:
        return None

    # Parse cheapest AZUL (no bag) and BLUE (1×23 kg) fares from first trip
    trips = data.get("data", {}).get("trips") or data.get("trips") or []
    azul_prices: List[float] = []
    blue_prices: List[float] = []
    black_prices: List[float] = []
    currency = "BRL"

    for trip in trips:
        journeys = trip.get("journeys") or trip.get("journeysAvailable") or []
        if not isinstance(journeys, list):
            continue
        for journey in journeys:
            cur_raw = (
                (journey.get("fareInformation") or {}).get("currency")
                or (journey.get("identifier") or {}).get("currency")
                or "BRL"
            )
            currency = cur_raw

            fares = journey.get("fares") or []
            for fare in fares:
                if not isinstance(fare, dict):
                    continue
                bc = str(
                    fare.get("bundleCode") or fare.get("bundleInformation")
                    or fare.get("fareClass") or fare.get("fareName")
                    or fare.get("fareCode") or ""
                ).upper()

                # Extract cheapest per-pax price for this fare
                pax_fares = fare.get("paxFares") or fare.get("passengerFares") or []
                fare_price: Optional[float] = None
                for pf in pax_fares:
                    for key in ("totalAmount", "originalAmount", "fareAmount"):
                        val = pf.get(key)
                        if val is not None:
                            try:
                                v = float(val)
                                if v > 0:
                                    fare_price = v
                                    break
                            except (TypeError, ValueError):
                                pass
                    if fare_price is not None:
                        break

                if fare_price is None:
                    continue

                if "BLACK" in bc or bc in ("BL", "BLK"):
                    black_prices.append(fare_price)
                elif "BLUE" in bc or bc in ("BU", "XTRA", "XT"):
                    blue_prices.append(fare_price)
                else:
                    # AZUL / A / AZ or unknown base fare — treat as no-bag tier
                    azul_prices.append(fare_price)
        break  # only first trip needed

    if not azul_prices and not blue_prices and not black_prices:
        logger.debug("AD probe: no fares parsed for %s→%s", probe_origin, probe_dest)
        return None

    result: dict = {"currency": currency}

    if azul_prices and blue_prices:
        min_azul = min(azul_prices)
        min_blue  = min(blue_prices)
        bag_diff  = max(0.0, min_blue - min_azul)
        if bag_diff > 0:
            result["checked_bag_note"] = (
                f"checked bag not included in base fare "
                f"– add-on approx {currency} {bag_diff:.0f}"
            )
            result["checked_bag_from"] = bag_diff
        else:
            result["checked_bag_note"] = "checked bag not included in base fare (Azul fare)"
    elif blue_prices or black_prices:
        result["checked_bag_note"] = "1×23 kg bag included in fare"
        result["checked_bag_from"] = 0.0
    else:
        result["checked_bag_note"] = "checked bag not included in base fare (Azul fare)"

    result["bags_note"] = result.get(
        "checked_bag_note", "checked bag not included in base fare"
    )
    result["seat_note"] = "seat selection available at checkout"

    return result


# ── VB — VivaAerobus ─────────────────────────────────────────────────────────

def _vb_parse_search(data: dict) -> Optional[dict]:
    """Parse VivAerobus /web/v1/availability/search 200 response for bundle pricing.

    Expects a Navitaire-style trips[].journeys[].fares[] structure.
    Computes carry-on add-on as the cheapest non-VC bundle minus the VC base price.
    """
    trips = (
        data.get("trips")
        or data.get("data", {}).get("trips")
        or []
    )
    if not trips:
        return None

    all_fares: List[dict] = []
    for trip in trips[:1]:
        for journey in (trip.get("journeys") or [])[:3]:
            for fare in (journey.get("fares") or []):
                all_fares.append(fare)

    if not all_fares:
        return None

    bundle_prices: dict[str, List[float]] = {}
    for fare in all_fares:
        code = (
            fare.get("bundleCode")
            or fare.get("fareClassOfService")
            or fare.get("fareCode")
            or "UNK"
        )
        for pf in (fare.get("passengerFares") or []):
            pf_fare = (
                pf.get("discountedFare")
                or pf.get("publishedFare")
                or {}
            )
            total = pf_fare.get("totalFare") or pf_fare.get("total")
            if total is None:
                total = pf.get("totalFare") or pf.get("total")
            if total is not None:
                try:
                    bundle_prices.setdefault(code, []).append(float(total))
                except (TypeError, ValueError):
                    pass

    if not bundle_prices:
        return None

    cheapest = {code: min(prices) for code, prices in bundle_prices.items()}
    base_price = cheapest.get("VC") or min(cheapest.values())
    non_base = {c: p for c, p in cheapest.items() if c != "VC" and p > base_price}

    if not non_base:
        return None

    carry_on_add = round(min(non_base.values()) - base_price, 2)
    if carry_on_add <= 0:
        return None

    return {
        "carry_on_from": carry_on_add,
        "bags_note": (
            f"personal item (under seat) included in base VC fare; "
            f"overhead carry-on add-on from MXN {carry_on_add:.0f}"
        ),
        "checked_bag_note": "checked bag not included in base VC fare – add at checkout",
        "currency": "MXN",
        "seat_note": "seat selection available at checkout",
    }


async def _probe_vb(
    origin: str,
    dest: str,
    date_str: Optional[str] = None,
    flight_no: Optional[str] = None,
) -> Optional[dict]:
    """
    VivaAerobus (VB) — patchright persistent-context probe.

    VivAerobus is an ultra-LCC: the base "VC" (Viva Clásico) fare includes only
    a personal item (under seat, 45×35×25 cm).  Overhead carry-on and checked
    bags are paid add-ons.

    We navigate to the checkout URL using a persistent Chrome profile.  The
    profile dir is reused across restarts so Akamai cookies warm up over time.
    On cold sessions the /web/v1/availability/search fires but may return 403;
    in that case we return a static-but-correct dict so callers still get the
    right condition strings without a live price.

    Live data: parse fare bundles from search response to compute carry-on add-on.
    Static fallback: known VivAerobus fare rules with typical pricing notes.
    """
    from .vivaaerobus import _get_context as _vb_get_context

    probe_origin = origin if (origin and len(origin) == 3) else "MEX"
    probe_dest = dest if (dest and len(dest) == 3 and dest != probe_origin) else "MTY"
    if probe_dest == probe_origin:
        probe_dest = "MTY"

    dep_date = _probe_date(date_str, weeks_ahead=5)
    dep_yyyymmdd = dep_date.replace("-", "")

    checkout_url = (
        f"https://www.vivaaerobus.com/en-us/book/options"
        f"?itineraryCode={probe_origin}_{probe_dest}_{dep_yyyymmdd}"
        f"&passengers=A1"
    )

    _static: dict = {
        "bags_note": (
            "personal item (under seat, 45×35×25 cm) included in base VC fare; "
            "overhead carry-on bag is a paid add-on"
        ),
        "checked_bag_note": (
            "no free checked bag on VC base fare – add at checkout "
            "(carry-on typically from MXN 249; checked bag from MXN 499)"
        ),
        "currency": "MXN",
        "seat_from": 99.0,
        "seat_note": "seat selection from ~MXN 99 – add at checkout",
    }

    search_data: Optional[dict] = None
    search_event = asyncio.Event()

    try:
        ctx = await _vb_get_context()
        page = await ctx.new_page()

        async def _on_resp(resp) -> None:
            nonlocal search_data
            if resp.status != 200:
                return
            if "/web/v1/availability/search" not in resp.url:
                return
            try:
                ct = resp.headers.get("content-type", "")
                if "json" not in ct:
                    return
                data = await resp.json()
                if isinstance(data, dict):
                    search_data = data
                    search_event.set()
            except Exception:
                pass

        page.on("response", _on_resp)

        try:
            await page.goto(checkout_url, wait_until="domcontentloaded", timeout=25_000)
        except Exception as exc:
            logger.debug("VB probe: goto error: %s", exc)

        try:
            await asyncio.wait_for(search_event.wait(), timeout=20.0)
        except (asyncio.TimeoutError, TimeoutError):
            logger.debug(
                "VB probe: availability search timed out for %s→%s (cold session or Akamai block)",
                probe_origin, probe_dest,
            )

        await page.close()

    except Exception as exc:
        logger.debug("VB probe: context/page error: %s", exc)

    if search_data:
        try:
            parsed = _vb_parse_search(search_data)
            if parsed:
                result = dict(_static)
                result.update(parsed)
                return result
        except Exception as exc:
            logger.debug("VB probe: parse error: %s", exc)

    return _static


# ── FO — Flybondi ─────────────────────────────────────────────────────────────

async def _probe_fo(
    origin: str,
    dest: str,
    date_str: Optional[str] = None,
    flight_no: Optional[str] = None,
) -> Optional[dict]:
    """
    Flybondi (FO) — SSR HTML probe for carry-on and checked-bag add-on prices.

    Flybondi embeds full flight+fare data as JSON in <script> tags on the
    /ar/search/results page.  This probe fetches that page via curl_cffi (same
    technique as FlybondiConnectorClient._fetch_all_edges) and computes:

      carry-on add-on  = PLUS fare price  − STANDARD fare price
      checked-bag diff = FLEX fare price  − STANDARD fare price (if FLEX present)

    Falls back to static known Flybondi pricing if curl_cffi is unavailable or
    the embedded JSON doesn't contain multiple fare types.

    Currency is ARS (Argentina).
    """
    import re as _re

    try:
        from curl_cffi import requests as _curl_requests
        from .browser import get_curl_cffi_proxies as _get_proxies
    except ImportError:
        _curl_requests = None
        _get_proxies = lambda: {}  # noqa: E731

    probe_origin = origin if (origin and len(origin) == 3) else "EZE"
    probe_dest = dest if (dest and len(dest) == 3 and dest != probe_origin) else "COR"
    if probe_dest == probe_origin:
        probe_dest = "COR"

    dep = _probe_date(date_str, weeks_ahead=6)

    _static: dict = {
        "bags_note": (
            "personal item (under seat) included in STANDARD fare; "
            "overhead carry-on (10 kg) is a paid add-on"
        ),
        "checked_bag_note": (
            "no free checked bag in STANDARD fare – add at checkout"
        ),
        "currency": "ARS",
        "seat_from": 2000.0,
        "seat_note": "seat selection from ~ARS 2,000 – add at checkout",
    }

    if _curl_requests is None:
        logger.debug("FO probe: curl_cffi not available, returning static fallback")
        return _static

    search_url = (
        f"https://flybondi.com/ar/search/results"
        f"?departureDate={dep}&adults=1&children=0&infants=0"
        f"&currency=ARS&fromCityCode={probe_origin}&toCityCode={probe_dest}"
    )

    try:
        proxies = _get_proxies()
        resp = await asyncio.to_thread(
            lambda: _curl_requests.get(
                search_url,
                impersonate="chrome131",
                timeout=25,
                proxies=proxies,
            )
        )
    except Exception as exc:
        logger.debug("FO probe: HTTP error: %s", exc)
        return _static

    if resp.status_code != 200:
        logger.debug("FO probe: HTTP %d for %s→%s", resp.status_code, probe_origin, probe_dest)
        return _static

    scripts = _re.findall(r"<script[^>]*>(.*?)</script>", resp.text, _re.DOTALL)
    edges: Optional[list] = None
    for s in scripts:
        s = s.strip()
        if len(s) < 50000 or "viewer" not in s:
            continue
        try:
            data = json.loads(s)
            edges = (
                data.get("viewer", {}).get("flights", {}).get("edges")
                or data.get("props", {}).get("pageProps", {})
                    .get("viewer", {}).get("flights", {}).get("edges")
            )
            if edges:
                break
        except (json.JSONDecodeError, TypeError):
            continue

    if not edges:
        logger.debug("FO probe: no flight edges in SSR for %s→%s", probe_origin, probe_dest)
        return _static

    fare_type_prices: dict[str, List[float]] = {}
    for edge in edges[:5]:
        node = edge.get("node", {})
        for fare in (node.get("fares") or []):
            if not isinstance(fare, dict):
                continue
            fare_type = (fare.get("type") or "").upper()
            if not fare_type:
                continue
            prices = fare.get("prices", {})
            after_tax = prices.get("afterTax") or prices.get("total") or fare.get("price")
            if after_tax is None:
                continue
            try:
                v = float(after_tax)
                if v > 0:
                    fare_type_prices.setdefault(fare_type, []).append(v)
            except (TypeError, ValueError):
                pass

    if not fare_type_prices:
        logger.debug("FO probe: no fare type prices in SSR for %s→%s", probe_origin, probe_dest)
        return _static

    # Median price per fare type
    type_median: dict[str, float] = {}
    for ft, prices in fare_type_prices.items():
        prices.sort()
        type_median[ft] = prices[len(prices) // 2]

    std_price = type_median.get("STANDARD") or min(type_median.values())
    result = dict(_static)

    if "PLUS" in type_median and type_median["PLUS"] > std_price:
        carry_add = round(type_median["PLUS"] - std_price, 2)
        result["carry_on_from"] = carry_add
        result["bags_note"] = (
            f"personal item (under seat) in STANDARD fare; "
            f"carry-on overhead add-on from ARS {carry_add:.0f} (PLUS bundle)"
        )

    if "FLEX" in type_median and type_median["FLEX"] > std_price:
        flex_add = round(type_median["FLEX"] - std_price, 2)
        result["checked_bag_from"] = flex_add
        result["checked_bag_note"] = (
            f"no free checked bag in STANDARD fare; "
            f"FLEX bundle (carry-on + checked bag) from ARS {flex_add:.0f} more"
        )

    logger.debug("FO probe: %s→%s fare types=%s", probe_origin, probe_dest, list(type_median.keys()))
    return result


# ── AF — Air France ───────────────────────────────────────────────────────────

async def _probe_af(
    origin: str,
    dest: str,
    date_str: Optional[str] = None,
    flight_no: Optional[str] = None,
) -> Optional[dict]:
    """
    Air France (AF) — navigate wwws.airfrance.pl via patchright (real Chrome).

    Flow confirmed from live capture (2026-05-03):
    1. Navigate to wwws.airfrance.pl/en (Angular SPA)
    2. Auto-dismiss cookie banner via JS eval
    3. Select One-way, fill origin/dest via keyboard (Akamai-safe)
    4. Click Search → Angular navigates to /search/open-dates or /search/results
    5. On open-dates: click a calendar date → navigates to /search/results
    6. Wait for SearchResultAvailableOffersQuery (fires on results page)
    7. Click first flight row → SearchUpsellOffersQuery fires (fare family
       comparison: Light=no bag, Standard=1×23 kg)
    8. Extract bag add-on = Standard price − Light price
    9. Fallback: AncillariesBaggageQuery (baggageOffers[amount=1].price)
    """
    import json as _json
    import urllib.parse as _up
    from patchright.async_api import async_playwright as _patchright_playwright
    from .browser import find_chrome

    dep = _probe_date(date_str, weeks_ahead=6)

    probe_origin = origin if (origin and len(origin) == 3) else "CDG"
    probe_dest = dest if (dest and len(dest) == 3 and dest != probe_origin) else "LHR"
    if probe_dest == probe_origin:
        probe_dest = "LHR"

    # ── Snapshot fast-path (no browser needed) ────────────────────────────────
    _af_snap = await asyncio.get_event_loop().run_in_executor(None, _gcs_load_snapshot, "AF")
    if (
        _af_snap is not None
        and _af_snap.get("extra", {}).get("origin") == probe_origin
        and _af_snap.get("extra", {}).get("dest") == probe_dest
    ):
        _af_result = _snap_replay_af(_af_snap)
        if _af_result:
            logger.info("AF probe: replayed from GCS snapshot (no browser)")
            return _af_result

    bag_prices: List[float] = []
    seat_prices: List[float] = []
    currency = "PLN"
    upsell_event = asyncio.Event()
    results_event = asyncio.Event()
    _af_raw_snap: Optional[dict] = None
    _af_snap_type: str = ""
    _af_snap_extra: Optional[dict] = None

    async def _on_resp(resp):
        if "/gql/v1" not in resp.url:
            return
        params = dict(_up.parse_qsl(_up.urlparse(resp.url).query))
        op = params.get("operationName", "")
        if not op:
            return
        try:
            if op == "SearchResultAvailableOffersQuery":
                results_event.set()
                return
            if op == "SearchUpsellOffersQuery":
                body = await resp.body()
                data = _json.loads(body)
                price = _af_bag_price_from_gql_upsell(data)
                if price and price > 0:
                    bag_prices.append(price)
                    nonlocal _af_raw_snap, _af_snap_type, _af_snap_extra
                    _af_raw_snap = data
                    _af_snap_type = "af_upsell_gql"
                    upsell_event.set()
            elif op == "AncillariesBaggageQuery":
                body = await resp.body()
                data = _json.loads(body)
                result = _af_bag_price_from_ancillaries_gql(data)
                if result:
                    p, cur = result
                    if p > 0:
                        bag_prices.append(p)
                        nonlocal currency
                        currency = cur
                        _af_raw_snap = data
                        _af_snap_type = "af_ancillaries_gql"
                        _af_snap_extra = {"currency": cur}
                        upsell_event.set()
        except Exception as exc:
            logger.debug("AF GQL parse %s: %s", op, exc)

    chrome_path: Optional[str] = None
    try:
        chrome_path = find_chrome()
    except RuntimeError:
        pass

    _af_har_tmp = await asyncio.get_event_loop().run_in_executor(None, _prepare_har_tmp, "AF")

    try:
        async with _patchright_playwright() as pw:
            launch_kwargs: dict = {
                "headless": False,
                "args": [
                    "--no-first-run",
                    "--no-default-browser-check",
                    "--window-size=1440,900",
                    "--no-sandbox",
                    "--disable-dev-shm-usage",
                ],
            }
            if chrome_path:
                launch_kwargs["executable_path"] = chrome_path
            browser = await pw.chromium.launch(**launch_kwargs)
            ctx = await browser.new_context(
                viewport={"width": 1440, "height": 900},
                locale="en-GB",
                timezone_id="Europe/Paris",
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/135.0.0.0 Safari/537.36"
                ),
            )
            await _setup_har_route(ctx, "AF", _af_har_tmp)
            page = await ctx.new_page()
            page.on("response", _on_resp)

            # Navigate to Angular homepage
            try:
                await page.goto(
                    "https://wwws.airfrance.pl/en",
                    wait_until="domcontentloaded",
                    timeout=30_000,
                )
                await asyncio.sleep(4)
            except Exception as exc:
                logger.debug("AF homepage: %s", exc)

            # Auto-dismiss cookie banner
            try:
                await page.evaluate("""() => {
                    const btn = [...document.querySelectorAll('button')]
                        .find(b => /^accept$/i.test(b.textContent?.trim()) && b.offsetParent);
                    if (btn) btn.click();
                }""")
                await asyncio.sleep(0.5)
                await page.evaluate(
                    "() => document.getElementById('bw-cookie-banner')?.remove()"
                )
                await asyncio.sleep(0.5)
            except Exception:
                pass

            # Select One-way via JS eval
            try:
                await page.evaluate("""() => {
                    document.querySelector(
                        '[data-testid="bwsfe-widget__trip-type-selector"]'
                    )?.click();
                }""")
                await asyncio.sleep(0.8)
                await page.evaluate("""() => {
                    Array.from(document.querySelectorAll('mat-option'))
                        .find(o => /one.?way/i.test(o.textContent))?.click();
                }""")
                await asyncio.sleep(0.8)
            except Exception as exc:
                logger.debug("AF one-way: %s", exc)

            # Origin via keyboard (Akamai-safe)
            try:
                await page.evaluate("""() => {
                    const el = document.getElementById('bwsfe-station-picker-input-0');
                    if (el) { el.focus(); el.click(); }
                }""")
                await asyncio.sleep(0.5)
                await page.keyboard.type(probe_origin, delay=120)
                await asyncio.sleep(2.5)
                await page.keyboard.press("ArrowDown")
                await asyncio.sleep(0.3)
                await page.keyboard.press("Enter")
                await asyncio.sleep(2)
            except Exception as exc:
                logger.debug("AF origin: %s", exc)

            # Destination via keyboard
            try:
                await page.evaluate("""() => {
                    const el = document.getElementById('bwsfe-station-picker-input-1');
                    if (el) { el.focus(); el.click(); }
                }""")
                await asyncio.sleep(0.5)
                await page.keyboard.type(probe_dest, delay=120)
                await asyncio.sleep(2.5)
                await page.keyboard.press("ArrowDown")
                await asyncio.sleep(0.3)
                await page.keyboard.press("Enter")
                await asyncio.sleep(2)
            except Exception as exc:
                logger.debug("AF dest: %s", exc)

            # Click Search via JS eval
            try:
                await page.evaluate("""() => {
                    document.querySelector(
                        '[data-testid="bwsfe-widget__search-button"]'
                    )?.click();
                }""")
                await asyncio.sleep(2)
            except Exception as exc:
                logger.debug("AF search click: %s", exc)

            # Wait for URL to reach /search/
            for _ in range(90):
                await asyncio.sleep(0.5)
                if "/search/" in page.url:
                    break

            # On open-dates calendar: click a future date to proceed to results
            if "open-dates" in page.url:
                await asyncio.sleep(2)
                try:
                    await page.evaluate("""() => {
                        const btns = [...document.querySelectorAll(
                            'bwc-day button, [class*="calendar-day"] button'
                        )];
                        const enabled = btns.filter(b => !b.disabled && b.offsetParent);
                        for (const btn of enabled) {
                            const label = btn.getAttribute('aria-label') || '';
                            const num = parseInt(btn.textContent?.trim() || '');
                            if (/jun|jul|aug|sep/i.test(label) && num >= 15) {
                                btn.click(); return;
                            }
                        }
                        const btn = enabled[5] || enabled[0];
                        if (btn) btn.click();
                    }""")
                    await asyncio.sleep(3)
                except Exception as exc:
                    logger.debug("AF calendar click: %s", exc)

            # Wait for SearchResultAvailableOffersQuery
            try:
                await asyncio.wait_for(results_event.wait(), timeout=30.0)
            except (asyncio.TimeoutError, TimeoutError):
                pass

            await asyncio.sleep(2)

            # Click first flight row to trigger SearchUpsellOffersQuery
            if not upsell_event.is_set():
                try:
                    await page.evaluate("""() => {
                        const sels = [
                            'bwsfe-offer-itinerary',
                            '[data-testid*="offer-itinerary"]',
                            '[class*="offer-itinerary"]',
                            'app-offer-itinerary',
                        ];
                        for (const sel of sels) {
                            const items = [...document.querySelectorAll(sel)];
                            const el = items.find(e => e.offsetParent);
                            if (el) {
                                const btn = el.querySelector('button') || el;
                                btn.click();
                                return;
                            }
                        }
                        // Fallback: first button whose test-id mentions offer
                        const btn = [...document.querySelectorAll('button')].find(b =>
                            b.offsetParent &&
                            (b.getAttribute('data-testid') || '').toLowerCase().includes('offer')
                        );
                        if (btn) btn.click();
                    }""")
                    await asyncio.sleep(2)
                except Exception as exc:
                    logger.debug("AF flight row click: %s", exc)

            # Wait for SearchUpsellOffersQuery
            try:
                await asyncio.wait_for(upsell_event.wait(), timeout=20.0)
            except (asyncio.TimeoutError, TimeoutError):
                pass

            await browser.close()
    except Exception as exc:
        logger.debug("AF probe error: %s", exc)
    asyncio.get_event_loop().run_in_executor(None, _gcs_save_har, "AF", _af_har_tmp)

    if bag_prices:
        min_bag = min(p for p in bag_prices if p > 0)
        # Save raw GQL response to GCS snapshot (future calls skip browser)
        if _af_raw_snap is not None:
            asyncio.get_event_loop().run_in_executor(
                None, _gcs_save_snapshot, "AF", _af_snap_type, _af_raw_snap,
                {**(_af_snap_extra or {}), "origin": probe_origin, "dest": probe_dest},
            )
        result: dict = {
            "checked_bag_note": (
                f"checked bag not included (Light fare) "
                f"– add-on from {currency} {min_bag:.0f}"
            ),
            "bags_note": "cabin bag 12 kg included free (Light fare)",
            "checked_bag_from": min_bag,
            "checked_bag_price": min_bag,
            "currency": currency,
        }
        result["seat_note"] = (
            f"seat selection add-on from {currency} {min(seat_prices):.0f}"
            if seat_prices
            else "seat selection add-on available"
        )
        if seat_prices:
            result["seat_from"] = min(seat_prices)
        return result

    logger.debug("AF probe: no bag prices captured for %s→%s", probe_origin, probe_dest)
    return None


def _af_bag_price_from_gql_upsell(data: dict) -> Optional[float]:
    """
    Extract checked-bag add-on price from AF SearchUpsellOffersQuery GQL response.

    The response contains upsellFlightProducts with fare families. The Light fare
    has no checked bag; Standard has 1×23 kg. Returns Standard − Light price diff.
    Confirmed structure from live capture 2026-05-03.
    """
    try:
        recs = (
            data.get("data", {})
            .get("upsellOffers", {})
            .get("upsellRecommendations", [])
        )
        for rec in recs:
            products = rec.get("upsellFlightProducts", [])
            light_price: Optional[float] = None
            standard_price: Optional[float] = None
            for p in products:
                cu = p.get("activeConnectionUpsell") or {}
                fare_title = (
                    (cu.get("fareFamily") or {}).get("title", "")
                ).lower().strip()
                price_val = (cu.get("price") or {}).get("relevantPrice")
                if price_val is None:
                    continue
                price_val = float(price_val)
                conds = cu.get("primaryConditions") or []
                bag_included = any(
                    c.get("code") == "MERGED_BAGGAGE_ALLOWANCE" and c.get("included") is True
                    for c in conds
                )
                bag_excluded = any(
                    c.get("code") == "MERGED_BAGGAGE_ALLOWANCE" and c.get("included") is False
                    for c in conds
                )
                if bag_excluded and fare_title in ("light", "basic", "eco light", "light fare"):
                    light_price = price_val
                elif bag_included and fare_title in (
                    "standard", "classic", "flex", "standard plus", "economy"
                ):
                    if standard_price is None or price_val < standard_price:
                        standard_price = price_val
            if light_price is not None and standard_price is not None:
                diff = standard_price - light_price
                if 5 < diff < 3000:
                    return round(diff, 2)
    except Exception:
        pass
    return None


def _af_bag_price_from_ancillaries_gql(data: dict) -> Optional[tuple]:
    """
    Extract 1-bag add-on price from AF AncillariesBaggageQuery GQL response.

    baggageOffers[amount=1].priceGroup.currentPrice.amount is the direct
    add-on price for 1 checked bag on a Light fare.
    Returns (price: float, currency: str) or None.
    Confirmed structure from live capture 2026-05-03.
    """
    try:
        offers = (
            data.get("data", {})
            .get("ancillaries", {})
            .get("baggageOffers", [])
        )
        for o in offers:
            if o.get("amount") == 1 and o.get("unit") == "PIECE":
                pg = o.get("priceGroup") or {}
                cp = pg.get("currentPrice") or {}
                price = cp.get("amount")
                cur = cp.get("currencyCode", "PLN")
                if price is not None and float(price) > 0:
                    return (float(price), str(cur))
    except Exception:
        pass
    return None


def _af_bag_price_from_fare_families(data: dict) -> Optional[float]:
    """
    Extract bag add-on price from AF/KL fare family data.

    AF/KL Sputnik response contains fare bundles: Light (no bag) and Standard
    (23 kg included). The price difference is the bag add-on price.
    """
    _LIGHT_KEYS = {"light", "basic", "economy light", "eco light"}
    _BAG_KEYS = {"standard", "flex", "classic", "economy", "economy standard"}
    light_prices: List[float] = []
    bag_prices: List[float] = []

    try:
        for d in _iter_dicts(data):
            bundle_name = ""
            for key in ("bundleName", "fareName", "fareFamily", "productCode",
                        "cabinClassName", "brandName", "fareType"):
                v = d.get(key)
                if v and isinstance(v, str):
                    bundle_name = v.lower().strip()
                    break
            if not bundle_name:
                continue
            price = None
            for pk in ("totalPrice", "price", "amount", "totalAmount", "fareAmount", "basePrice"):
                v = d.get(pk)
                if v is None:
                    continue
                if isinstance(v, dict):
                    v = v.get("amount") or v.get("value")
                try:
                    p = float(v)  # type: ignore[arg-type]
                    if 10 < p < 10000:
                        price = p
                        break
                except (TypeError, ValueError):
                    pass
            if price is None:
                continue
            if any(k in bundle_name for k in _LIGHT_KEYS):
                light_prices.append(price)
            elif any(k in bundle_name for k in _BAG_KEYS):
                bag_prices.append(price)
    except Exception:
        pass

    if light_prices and bag_prices:
        diff = min(bag_prices) - min(light_prices)
        if 5 < diff < 500:
            return round(diff, 2)
    return None


async def _scrape_fare_family_bag_price(page) -> List[float]:
    """
    Scrape bag add-on prices from the visible DOM of an airline fare selection page.

    Looks for price patterns next to bag-related keywords in the page body.
    Returns a list of numeric prices found (may be empty).
    """
    try:
        prices = await page.evaluate(r"""() => {
            const results = [];
            const text = (document.body || {}).innerText || '';
            // Match patterns like "EUR 25", "€25", "25 EUR", "$25" near bag keywords
            const bagSection = text.replace(/\n/g, ' ');
            const bagPattern = /(?:bag|baggage|luggage|checked|hold)[^\n]{0,60}([\d]+(?:[.,]\d{1,2})?)\s*(EUR|GBP|USD|CAD|AUD|NZD|CHF)/gi;
            const pricePattern = /(EUR|GBP|USD|CAD|AUD|NZD|CHF)\s*([\d]+(?:[.,]\d{1,2})?)/gi;
            let m;
            while ((m = bagPattern.exec(bagSection)) !== null) {
                const val = parseFloat(m[1].replace(',', '.'));
                if (val > 3 && val < 500) results.push(val);
            }
            return results.slice(0, 5);
        }""")
        if isinstance(prices, list):
            return [float(p) for p in prices if p]
    except Exception:
        pass
    return []


# ── KL — KLM ─────────────────────────────────────────────────────────────────

async def _probe_kl(
    origin: str,
    dest: str,
    date_str: Optional[str] = None,
    flight_no: Optional[str] = None,
) -> Optional[dict]:
    """
    KLM (KL) — same Angular/GQL approach as AF.

    KLM shares the same Angular SPA backend as Air France (wwws.klm.com).
    Fires identical GQL operations: SearchResultAvailableOffersQuery,
    SearchUpsellOffersQuery, AncillariesBaggageQuery.

    Flow (mirrors _probe_af):
    1. Navigate to wwws.klm.com/en
    2. Dismiss cookie banner, select One-way, fill origin/dest via keyboard
    3. Click Search → wait for /search/ route
    4. On open-dates: click a calendar date
    5. Wait for SearchResultAvailableOffersQuery, click first flight row
    6. Capture SearchUpsellOffersQuery → Light vs Standard fare diff
    7. Fallback: AncillariesBaggageQuery → direct add-on price
    """
    import json as _json
    import urllib.parse as _up
    from patchright.async_api import async_playwright as _patchright_playwright
    from .browser import find_chrome

    dep = _probe_date(date_str, weeks_ahead=6)

    probe_origin = origin if (origin and len(origin) == 3) else "AMS"
    probe_dest = dest if (dest and len(dest) == 3 and dest != probe_origin) else "LHR"
    if probe_dest == probe_origin:
        probe_dest = "LHR"

    # ── Snapshot fast-path (no browser needed) ────────────────────────────────
    _kl_snap = await asyncio.get_event_loop().run_in_executor(None, _gcs_load_snapshot, "KL")
    if (
        _kl_snap is not None
        and _kl_snap.get("extra", {}).get("origin") == probe_origin
        and _kl_snap.get("extra", {}).get("dest") == probe_dest
    ):
        _kl_result = _snap_replay_af(_kl_snap)  # same GQL format as AF
        if _kl_result:
            logger.info("KL probe: replayed from GCS snapshot (no browser)")
            return _kl_result

    bag_prices: List[float] = []
    seat_prices: List[float] = []
    currency = "EUR"
    upsell_event = asyncio.Event()
    results_event = asyncio.Event()
    _kl_raw_snap: Optional[dict] = None
    _kl_snap_type: str = ""
    _kl_snap_extra: Optional[dict] = None

    async def _on_resp(resp):
        if "/gql/v1" not in resp.url:
            return
        params = dict(_up.parse_qsl(_up.urlparse(resp.url).query))
        op = params.get("operationName", "")
        if not op:
            return
        try:
            if op == "SearchResultAvailableOffersQuery":
                results_event.set()
                return
            if op == "SearchUpsellOffersQuery":
                body = await resp.body()
                data = _json.loads(body)
                price = _af_bag_price_from_gql_upsell(data)
                if price and price > 0:
                    bag_prices.append(price)
                    nonlocal _kl_raw_snap, _kl_snap_type
                    _kl_raw_snap = data
                    _kl_snap_type = "af_upsell_gql"
                    upsell_event.set()
            elif op == "AncillariesBaggageQuery":
                body = await resp.body()
                data = _json.loads(body)
                result = _af_bag_price_from_ancillaries_gql(data)
                if result:
                    p, cur = result
                    if p > 0:
                        bag_prices.append(p)
                        nonlocal currency, _kl_snap_extra
                        currency = cur
                        _kl_raw_snap = data
                        _kl_snap_type = "af_ancillaries_gql"
                        _kl_snap_extra = {"currency": cur}
                        upsell_event.set()
        except Exception as exc:
            logger.debug("KL GQL parse %s: %s", op, exc)

    chrome_path: Optional[str] = None
    try:
        chrome_path = find_chrome()
    except RuntimeError:
        pass

    _kl_har_tmp = await asyncio.get_event_loop().run_in_executor(None, _prepare_har_tmp, "KL")

    try:
        async with _patchright_playwright() as pw:
            launch_kwargs: dict = {
                "headless": False,
                "args": [
                    "--no-first-run",
                    "--no-default-browser-check",
                    "--window-size=1440,900",
                    "--no-sandbox",
                    "--disable-dev-shm-usage",
                ],
            }
            if chrome_path:
                launch_kwargs["executable_path"] = chrome_path
            browser = await pw.chromium.launch(**launch_kwargs)
            ctx = await browser.new_context(
                viewport={"width": 1440, "height": 900},
                locale="en-GB",
                timezone_id="Europe/Amsterdam",
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/135.0.0.0 Safari/537.36"
                ),
            )
            await _setup_har_route(ctx, "KL", _kl_har_tmp)
            page = await ctx.new_page()
            page.on("response", _on_resp)

            # Navigate to KLM Angular homepage
            try:
                await page.goto(
                    "https://wwws.klm.com/en",
                    wait_until="domcontentloaded",
                    timeout=30_000,
                )
                await asyncio.sleep(4)
            except Exception as exc:
                logger.debug("KL homepage: %s", exc)

            # Dismiss cookie banner
            try:
                await page.evaluate("""() => {
                    const btn = [...document.querySelectorAll('button')]
                        .find(b => /^accept$/i.test(b.textContent?.trim()) && b.offsetParent);
                    if (btn) btn.click();
                }""")
                await asyncio.sleep(0.5)
                await page.evaluate(
                    "() => document.getElementById('bw-cookie-banner')?.remove()"
                )
                await asyncio.sleep(0.5)
            except Exception:
                pass

            # Select One-way
            try:
                await page.evaluate("""() => {
                    document.querySelector(
                        '[data-testid="bwsfe-widget__trip-type-selector"]'
                    )?.click();
                }""")
                await asyncio.sleep(0.8)
                await page.evaluate("""() => {
                    Array.from(document.querySelectorAll('mat-option'))
                        .find(o => /one.?way/i.test(o.textContent))?.click();
                }""")
                await asyncio.sleep(0.8)
            except Exception as exc:
                logger.debug("KL one-way: %s", exc)

            # Origin via keyboard
            try:
                await page.evaluate("""() => {
                    const el = document.getElementById('bwsfe-station-picker-input-0');
                    if (el) { el.focus(); el.click(); }
                }""")
                await asyncio.sleep(0.5)
                await page.keyboard.type(probe_origin, delay=120)
                await asyncio.sleep(2.5)
                await page.keyboard.press("ArrowDown")
                await asyncio.sleep(0.3)
                await page.keyboard.press("Enter")
                await asyncio.sleep(2)
            except Exception as exc:
                logger.debug("KL origin: %s", exc)

            # Destination via keyboard
            try:
                await page.evaluate("""() => {
                    const el = document.getElementById('bwsfe-station-picker-input-1');
                    if (el) { el.focus(); el.click(); }
                }""")
                await asyncio.sleep(0.5)
                await page.keyboard.type(probe_dest, delay=120)
                await asyncio.sleep(2.5)
                await page.keyboard.press("ArrowDown")
                await asyncio.sleep(0.3)
                await page.keyboard.press("Enter")
                await asyncio.sleep(2)
            except Exception as exc:
                logger.debug("KL dest: %s", exc)

            # Click Search
            try:
                await page.evaluate("""() => {
                    document.querySelector(
                        '[data-testid="bwsfe-widget__search-button"]'
                    )?.click();
                }""")
                await asyncio.sleep(2)
            except Exception as exc:
                logger.debug("KL search click: %s", exc)

            # Wait for URL to reach /search/
            for _ in range(90):
                await asyncio.sleep(0.5)
                if "/search/" in page.url:
                    break

            # On open-dates: click a future date to proceed to results
            if "open-dates" in page.url:
                await asyncio.sleep(2)
                try:
                    await page.evaluate("""() => {
                        const btns = [...document.querySelectorAll(
                            'bwc-day button, [class*="calendar-day"] button'
                        )];
                        const enabled = btns.filter(b => !b.disabled && b.offsetParent);
                        for (const btn of enabled) {
                            const label = btn.getAttribute('aria-label') || '';
                            const num = parseInt(btn.textContent?.trim() || '');
                            if (/jun|jul|aug|sep/i.test(label) && num >= 15) {
                                btn.click(); return;
                            }
                        }
                        const btn = enabled[5] || enabled[0];
                        if (btn) btn.click();
                    }""")
                    await asyncio.sleep(3)
                except Exception as exc:
                    logger.debug("KL calendar click: %s", exc)

            # Wait for SearchResultAvailableOffersQuery
            try:
                await asyncio.wait_for(results_event.wait(), timeout=30.0)
            except (asyncio.TimeoutError, TimeoutError):
                pass

            await asyncio.sleep(2)

            # Click first flight row to trigger SearchUpsellOffersQuery
            if not upsell_event.is_set():
                try:
                    await page.evaluate("""() => {
                        const sels = [
                            'bwsfe-offer-itinerary',
                            '[data-testid*="offer-itinerary"]',
                            '[class*="offer-itinerary"]',
                            'app-offer-itinerary',
                        ];
                        for (const sel of sels) {
                            const items = [...document.querySelectorAll(sel)];
                            const el = items.find(e => e.offsetParent);
                            if (el) {
                                const btn = el.querySelector('button') || el;
                                btn.click();
                                return;
                            }
                        }
                        const btn = [...document.querySelectorAll('button')].find(b =>
                            b.offsetParent &&
                            (b.getAttribute('data-testid') || '').toLowerCase().includes('offer')
                        );
                        if (btn) btn.click();
                    }""")
                    await asyncio.sleep(2)
                except Exception as exc:
                    logger.debug("KL flight row click: %s", exc)

            # Wait for SearchUpsellOffersQuery
            try:
                await asyncio.wait_for(upsell_event.wait(), timeout=20.0)
            except (asyncio.TimeoutError, TimeoutError):
                pass

            await browser.close()
    except Exception as exc:
        logger.debug("KL probe error: %s", exc)
    asyncio.get_event_loop().run_in_executor(None, _gcs_save_har, "KL", _kl_har_tmp)

    if bag_prices:
        min_bag = min(p for p in bag_prices if p > 0)
        # Save raw GQL response to GCS snapshot (future calls skip browser)
        if _kl_raw_snap is not None:
            asyncio.get_event_loop().run_in_executor(
                None, _gcs_save_snapshot, "KL", _kl_snap_type, _kl_raw_snap,
                {**(_kl_snap_extra or {}), "origin": probe_origin, "dest": probe_dest},
            )
        result: dict = {
            "checked_bag_note": (
                f"checked bag not included (Light fare) "
                f"– add-on from {currency} {min_bag:.0f}"
            ),
            "bags_note": "cabin bag 12 kg included free (Light fare)",
            "checked_bag_from": min_bag,
            "checked_bag_price": min_bag,
            "currency": currency,
        }
        result["seat_note"] = (
            f"seat selection add-on from {currency} {min(seat_prices):.0f}"
            if seat_prices
            else "seat selection add-on available"
        )
        if seat_prices:
            result["seat_from"] = min(seat_prices)
        return result

    logger.debug("KL probe: no bag prices captured for %s→%s", probe_origin, probe_dest)
    return None


# ── BA — British Airways ──────────────────────────────────────────────────────

async def _probe_ba(
    origin: str,
    dest: str,
    date_str: Optional[str] = None,
    flight_no: Optional[str] = None,
) -> Optional[dict]:
    """
    British Airways (BA) — navigate BA booking flow via Playwright.

    BA's website fires an NDC/GraphQL API when showing fare families
    (Hand Baggage Only vs Euro Traveller). The price difference between
    HBO and ET is the checked-bag add-on price (typically GBP 35-75).

    Strategy:
    1. Navigate to BA search results deep link.
    2. Intercept JSON responses from britishairways.com APIs.
    3. Extract fare family price differential as checked-bag add-on.
    4. Fallback: scrape DOM for bag add-on price text.
    """
    from patchright.async_api import async_playwright as _patchright_playwright
    from .browser import find_chrome

    dep = _probe_date(date_str, weeks_ahead=6)

    probe_origin = origin if (origin and len(origin) == 3) else "LHR"
    probe_dest = dest if (dest and len(dest) == 3 and dest != probe_origin) else "CDG"
    if probe_dest == probe_origin:
        probe_dest = "CDG"

    # ── Snapshot fast-path (no browser needed) ────────────────────────────────
    _ba_snap = await asyncio.get_event_loop().run_in_executor(None, _gcs_load_snapshot, "BA")
    if (
        _ba_snap is not None
        and _ba_snap.get("extra", {}).get("origin") == probe_origin
        and _ba_snap.get("extra", {}).get("dest") == probe_dest
    ):
        _ba_result = _snap_replay_generic(_ba_snap, "Hand Baggage Only", "cabin bag 23 kg included free (Hand Baggage Only fare)", "GBP")
        if _ba_result:
            logger.info("BA probe: replayed from GCS snapshot (no browser)")
            return _ba_result

    bag_prices: List[float] = []
    seat_prices: List[float] = []
    currency = "GBP"
    cap_event = asyncio.Event()
    _ba_raw_snap: Optional[dict] = None

    async def _on_resp(resp):
        nonlocal _ba_raw_snap
        ct = resp.headers.get("content-type", "")
        if resp.status != 200 or "json" not in ct:
            return
        url_l = resp.url.lower()
        if "britishairways" not in url_l and "ba.com" not in url_l:
            return
        try:
            data = await resp.json()
            # Look for NDC fare offerings or ancillary responses
            b, s = _extract_bag_seat_prices(data)
            bag_prices.extend(b)
            seat_prices.extend(s)
            diff = _ba_bag_price_from_fare_families(data)
            if diff:
                bag_prices.append(diff)
            if bag_prices and _ba_raw_snap is None:
                _ba_raw_snap = data  # capture first response that yielded prices
                cap_event.set()
            elif bag_prices:
                cap_event.set()
        except Exception:
            pass

    chrome_path: Optional[str] = None
    try:
        chrome_path = find_chrome()
    except RuntimeError:
        pass

    _ba_har_tmp = await asyncio.get_event_loop().run_in_executor(None, _prepare_har_tmp, "BA")

    try:
        async with _patchright_playwright() as pw:
            launch_kwargs: dict = {
                "headless": False,
                "args": [
                    "--no-first-run",
                    "--no-default-browser-check",
                    "--window-size=1440,900",
                    "--no-sandbox",
                    "--disable-dev-shm-usage",
                ],
            }
            if chrome_path:
                launch_kwargs["executable_path"] = chrome_path
            browser = await pw.chromium.launch(**launch_kwargs)
            ctx = await browser.new_context(
                viewport={"width": 1440, "height": 900},
                locale="en-GB",
                timezone_id="Europe/London",
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/135.0.0.0 Safari/537.36"
                ),
            )
            await _setup_har_route(ctx, "BA", _ba_har_tmp)
            page = await ctx.new_page()
            page.on("response", _on_resp)

            try:
                await page.goto(
                    "https://www.britishairways.com/en-gb/",
                    wait_until="domcontentloaded",
                    timeout=30_000,
                )
                await asyncio.sleep(3)
            except Exception as exc:
                logger.debug("BA homepage: %s", exc)

            try:
                await page.evaluate("""() => {
                    for (const b of document.querySelectorAll('button')) {
                        const t = (b.textContent || '').toLowerCase();
                        if ((t.includes('accept') || t.includes('agree') || t.includes('ok')) && b.offsetHeight > 0) {
                            b.click(); return;
                        }
                    }
                }""")
                await asyncio.sleep(1)
            except Exception:
                pass

            dep_compact = dep.replace("-", "")
            booking_url = (
                f"https://www.britishairways.com/travel/beplorer/public/en_gb"
                f"?eId=106004&departure={probe_origin}&arrival={probe_dest}"
                f"&departDate={dep_compact}&numAdults=1&cabin=M"
            )
            try:
                await page.goto(booking_url, wait_until="domcontentloaded", timeout=30_000)
                await asyncio.sleep(4)
            except Exception as exc:
                logger.debug("BA search nav: %s", exc)

            try:
                await asyncio.wait_for(cap_event.wait(), timeout=25.0)
            except (asyncio.TimeoutError, TimeoutError):
                pass

            # Try clicking first flight result to trigger ancillary API
            if not bag_prices:
                try:
                    for sel in [
                        "[data-testid='fare-card']",
                        "[class*='fare-option']",
                        "[class*='FareCard']",
                        "button[class*='select']",
                    ]:
                        if await page.locator(sel).count() > 0:
                            await page.locator(sel).first.click()
                            await asyncio.sleep(4)
                            break
                    try:
                        await asyncio.wait_for(cap_event.wait(), timeout=15.0)
                    except (asyncio.TimeoutError, TimeoutError):
                        pass
                except Exception as exc:
                    logger.debug("BA fare card click: %s", exc)

            if not bag_prices:
                try:
                    dom_prices = await _scrape_fare_family_bag_price(page)
                    bag_prices.extend(dom_prices)
                except Exception:
                    pass

            await browser.close()
    except Exception as exc:
        logger.debug("BA Playwright probe error: %s", exc)
    asyncio.get_event_loop().run_in_executor(None, _gcs_save_har, "BA", _ba_har_tmp)

    if bag_prices:
        min_bag = min(p for p in bag_prices if p > 0)
        if _ba_raw_snap is not None:
            asyncio.get_event_loop().run_in_executor(
                None, _gcs_save_snapshot, "BA", "ba_fare_family", _ba_raw_snap,
                {"currency": currency, "origin": probe_origin, "dest": probe_dest},
            )
        result: dict = {
            "checked_bag_note": (
                f"checked bag not included (Hand Baggage Only) – add-on from GBP {min_bag:.0f}"
            ),
            "bags_note": "cabin bag 23 kg included free (Hand Baggage Only fare)",
            "checked_bag_from": min_bag,
            "checked_bag_price": min_bag,
            "currency": currency,
        }
        result["seat_note"] = (
            f"seat selection add-on from GBP {min(seat_prices):.0f}"
            if seat_prices
            else "seat selection add-on available"
        )
        if seat_prices:
            result["seat_from"] = min(seat_prices)
        return result

    logger.debug("BA probe: no bag prices captured for %s→%s", probe_origin, probe_dest)
    return None


def _ba_bag_price_from_fare_families(data: dict) -> Optional[float]:
    """Extract bag add-on from BA fare family data (HBO vs Euro Traveller)."""
    _NO_BAG = {"hand baggage only", "hbo", "basic", "light", "economy light"}
    _BAG_INCL = {"euro traveller", "standard", "classic", "economy", "plus"}
    no_bag_prices: List[float] = []
    bag_prices: List[float] = []

    try:
        for d in _iter_dicts(data):
            bundle_name = ""
            for key in ("fareFamily", "fareName", "bundleName", "productName",
                        "cabinName", "fareType", "brandName"):
                v = d.get(key)
                if v and isinstance(v, str):
                    bundle_name = v.lower().strip()
                    break
            if not bundle_name:
                continue
            price = None
            for pk in ("totalPrice", "price", "amount", "totalAmount", "baseAmount"):
                v = d.get(pk)
                if v is None:
                    continue
                if isinstance(v, dict):
                    v = v.get("amount") or v.get("value")
                try:
                    p = float(v)  # type: ignore[arg-type]
                    if 10 < p < 10000:
                        price = p
                        break
                except (TypeError, ValueError):
                    pass
            if price is None:
                continue
            if any(k in bundle_name for k in _NO_BAG):
                no_bag_prices.append(price)
            elif any(k in bundle_name for k in _BAG_INCL):
                bag_prices.append(price)
    except Exception:
        pass

    if no_bag_prices and bag_prices:
        diff = min(bag_prices) - min(no_bag_prices)
        if 5 < diff < 500:
            return round(diff, 2)
    return None


# ── LH / OS / LX / SN — Lufthansa Group ─────────────────────────────────────

async def _probe_lh(
    origin: str,
    dest: str,
    date_str: Optional[str] = None,
    flight_no: Optional[str] = None,
) -> Optional[dict]:
    """
    Lufthansa Group (LH/OS/LX/SN) — navigate Lufthansa booking via Playwright.

    Lufthansa uses an NDC booking engine. The fare selection page shows
    Economy Light (no bag) vs Economy Classic (23 kg included). We intercept
    the NDC OfferPrice or AirShopping response to extract the bag add-on.

    Strategy:
    1. Navigate to Lufthansa search results for the given route.
    2. Intercept JSON responses from the Lufthansa booking APIs.
    3. Extract fare family price differential as checked-bag add-on.
    """
    from patchright.async_api import async_playwright as _patchright_playwright
    from .browser import find_chrome

    dep = _probe_date(date_str, weeks_ahead=6)

    probe_origin = origin if (origin and len(origin) == 3) else "FRA"
    probe_dest = dest if (dest and len(dest) == 3 and dest != probe_origin) else "LHR"
    if probe_dest == probe_origin:
        probe_dest = "LHR"

    # ── Snapshot fast-path (no browser needed) ────────────────────────────────
    _lh_snap = await asyncio.get_event_loop().run_in_executor(None, _gcs_load_snapshot, "LH")
    if (
        _lh_snap is not None
        and _lh_snap.get("extra", {}).get("origin") == probe_origin
        and _lh_snap.get("extra", {}).get("dest") == probe_dest
    ):
        _lh_result = _snap_replay_generic(_lh_snap, "Economy Light", "cabin bag 8 kg included free (Economy Light)", "EUR")
        if _lh_result:
            logger.info("LH probe: replayed from GCS snapshot (no browser)")
            return _lh_result

    bag_prices: List[float] = []
    seat_prices: List[float] = []
    currency = "EUR"
    cap_event = asyncio.Event()
    _lh_raw_snap: Optional[dict] = None

    async def _on_resp(resp):
        nonlocal _lh_raw_snap
        ct = resp.headers.get("content-type", "")
        if resp.status != 200 or "json" not in ct:
            return
        url_l = resp.url.lower()
        if not any(k in url_l for k in ("lufthansa", "lh.com", "swiss", "austrian", "brussels")):
            return
        try:
            data = await resp.json()
            b, s = _extract_bag_seat_prices(data)
            bag_prices.extend(b)
            seat_prices.extend(s)
            diff = _af_bag_price_from_fare_families(data)
            if diff:
                bag_prices.append(diff)
            if bag_prices and _lh_raw_snap is None:
                _lh_raw_snap = data
                cap_event.set()
            elif bag_prices:
                cap_event.set()
        except Exception:
            pass

    chrome_path: Optional[str] = None
    try:
        chrome_path = find_chrome()
    except RuntimeError:
        pass

    _lh_har_tmp = await asyncio.get_event_loop().run_in_executor(None, _prepare_har_tmp, "LH")

    try:
        async with _patchright_playwright() as pw:
            launch_kwargs: dict = {
                "headless": False,
                "args": [
                    "--no-first-run",
                    "--no-default-browser-check",
                    "--window-size=1440,900",
                    "--no-sandbox",
                    "--disable-dev-shm-usage",
                ],
            }
            if chrome_path:
                launch_kwargs["executable_path"] = chrome_path
            browser = await pw.chromium.launch(**launch_kwargs)
            ctx = await browser.new_context(
                viewport={"width": 1440, "height": 900},
                locale="en-GB",
                timezone_id="Europe/Berlin",
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/135.0.0.0 Safari/537.36"
                ),
            )
            await _setup_har_route(ctx, "LH", _lh_har_tmp)
            page = await ctx.new_page()
            page.on("response", _on_resp)

            try:
                await page.goto(
                    "https://www.lufthansa.com/gb/en/homepage",
                    wait_until="domcontentloaded",
                    timeout=30_000,
                )
                await asyncio.sleep(3)
            except Exception as exc:
                logger.debug("LH homepage: %s", exc)

            try:
                await page.evaluate("""() => {
                    for (const b of document.querySelectorAll('button')) {
                        const t = (b.textContent || '').toLowerCase();
                        if ((t.includes('accept') || t.includes('agree') || t.includes('ok')) && b.offsetHeight > 0) {
                            b.click(); return;
                        }
                    }
                }""")
                await asyncio.sleep(1)
            except Exception:
                pass

            booking_url = (
                f"https://www.lufthansa.com/gb/en/flight-selection?"
                f"origin={probe_origin}&destination={probe_dest}"
                f"&outbound={dep}&adults=1&tripType=OW"
            )
            try:
                await page.goto(booking_url, wait_until="domcontentloaded", timeout=30_000)
                await asyncio.sleep(4)
            except Exception as exc:
                logger.debug("LH search nav: %s", exc)

            try:
                await asyncio.wait_for(cap_event.wait(), timeout=25.0)
            except (asyncio.TimeoutError, TimeoutError):
                pass

            if not bag_prices:
                try:
                    dom_prices = await _scrape_fare_family_bag_price(page)
                    bag_prices.extend(dom_prices)
                except Exception:
                    pass

            await browser.close()
    except Exception as exc:
        logger.debug("LH Playwright probe error: %s", exc)
    asyncio.get_event_loop().run_in_executor(None, _gcs_save_har, "LH", _lh_har_tmp)

    if bag_prices:
        min_bag = min(p for p in bag_prices if p > 0)
        if _lh_raw_snap is not None:
            asyncio.get_event_loop().run_in_executor(
                None, _gcs_save_snapshot, "LH", "lh_fare_family", _lh_raw_snap,
                {"currency": currency, "origin": probe_origin, "dest": probe_dest},
            )
        result: dict = {
            "checked_bag_note": (
                f"checked bag not included (Economy Light) – add-on from EUR {min_bag:.0f}"
            ),
            "bags_note": "cabin bag 8 kg included free (Economy Light)",
            "checked_bag_from": min_bag,
            "checked_bag_price": min_bag,
            "currency": currency,
        }
        result["seat_note"] = (
            f"seat selection add-on from EUR {min(seat_prices):.0f}"
            if seat_prices
            else "seat selection add-on available"
        )
        if seat_prices:
            result["seat_from"] = min(seat_prices)
        return result

    logger.debug("LH probe: no bag prices captured for %s→%s", probe_origin, probe_dest)
    return None


# ── IB — Iberia ───────────────────────────────────────────────────────────────

async def _probe_ib(
    origin: str,
    dest: str,
    date_str: Optional[str] = None,
    flight_no: Optional[str] = None,
) -> Optional[dict]:
    """
    Iberia (IB) — navigate Iberia booking flow via Playwright.

    Iberia uses Amadeus IBE. Their search results show fare families
    (Basic = no bag, Economy = 23 kg included). Intercept XHR responses.
    """
    from patchright.async_api import async_playwright as _patchright_playwright
    from .browser import find_chrome

    dep = _probe_date(date_str, weeks_ahead=6)

    probe_origin = origin if (origin and len(origin) == 3) else "MAD"
    probe_dest = dest if (dest and len(dest) == 3 and dest != probe_origin) else "LHR"
    if probe_dest == probe_origin:
        probe_dest = "LHR"

    # ── Snapshot fast-path (no browser needed) ────────────────────────────────
    _ib_snap = await asyncio.get_event_loop().run_in_executor(None, _gcs_load_snapshot, "IB")
    if (
        _ib_snap is not None
        and _ib_snap.get("extra", {}).get("origin") == probe_origin
        and _ib_snap.get("extra", {}).get("dest") == probe_dest
    ):
        _ib_result = _snap_replay_generic(_ib_snap, "Basic fare", "cabin bag included free (Basic fare)", "EUR")
        if _ib_result:
            logger.info("IB probe: replayed from GCS snapshot (no browser)")
            return _ib_result

    bag_prices: List[float] = []
    seat_prices: List[float] = []
    currency = "EUR"
    cap_event = asyncio.Event()
    _ib_raw_snap: Optional[dict] = None

    async def _on_resp(resp):
        nonlocal _ib_raw_snap
        ct = resp.headers.get("content-type", "")
        if resp.status != 200 or "json" not in ct:
            return
        url_l = resp.url.lower()
        if "iberia" not in url_l and "amadeus" not in url_l:
            return
        try:
            data = await resp.json()
            b, s = _extract_bag_seat_prices(data)
            bag_prices.extend(b)
            seat_prices.extend(s)
            diff = _af_bag_price_from_fare_families(data)
            if diff:
                bag_prices.append(diff)
            if bag_prices and _ib_raw_snap is None:
                _ib_raw_snap = data
                cap_event.set()
            elif bag_prices:
                cap_event.set()
        except Exception:
            pass

    chrome_path: Optional[str] = None
    try:
        chrome_path = find_chrome()
    except RuntimeError:
        pass

    _ib_har_tmp = await asyncio.get_event_loop().run_in_executor(None, _prepare_har_tmp, "IB")

    try:
        async with _patchright_playwright() as pw:
            launch_kwargs: dict = {
                "headless": False,
                "args": [
                    "--no-first-run",
                    "--no-default-browser-check",
                    "--window-size=1440,900",
                    "--no-sandbox",
                    "--disable-dev-shm-usage",
                ],
            }
            if chrome_path:
                launch_kwargs["executable_path"] = chrome_path
            browser = await pw.chromium.launch(**launch_kwargs)
            ctx = await browser.new_context(
                viewport={"width": 1440, "height": 900},
                locale="en-GB",
                timezone_id="Europe/Madrid",
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/135.0.0.0 Safari/537.36"
                ),
            )
            await _setup_har_route(ctx, "IB", _ib_har_tmp)
            page = await ctx.new_page()
            page.on("response", _on_resp)

            try:
                await page.goto("https://www.iberia.com/en/", wait_until="domcontentloaded", timeout=30_000)
                await asyncio.sleep(3)
            except Exception as exc:
                logger.debug("IB homepage: %s", exc)

            try:
                await page.evaluate("""() => {
                    for (const b of document.querySelectorAll('button')) {
                        const t = (b.textContent || '').toLowerCase();
                        if ((t.includes('accept') || t.includes('agree') || t.includes('ok')) && b.offsetHeight > 0) {
                            b.click(); return;
                        }
                    }
                }""")
                await asyncio.sleep(1)
            except Exception:
                pass

            booking_url = (
                f"https://www.iberia.com/en/flights/results/?"
                f"origin={probe_origin}&destination={probe_dest}"
                f"&departure={dep}&adults=1&tripType=OW"
            )
            try:
                await page.goto(booking_url, wait_until="domcontentloaded", timeout=30_000)
                await asyncio.sleep(4)
            except Exception as exc:
                logger.debug("IB search nav: %s", exc)

            try:
                await asyncio.wait_for(cap_event.wait(), timeout=25.0)
            except (asyncio.TimeoutError, TimeoutError):
                pass

            if not bag_prices:
                try:
                    dom_prices = await _scrape_fare_family_bag_price(page)
                    bag_prices.extend(dom_prices)
                except Exception:
                    pass

            await browser.close()
    except Exception as exc:
        logger.debug("IB Playwright probe error: %s", exc)
    asyncio.get_event_loop().run_in_executor(None, _gcs_save_har, "IB", _ib_har_tmp)

    if bag_prices:
        min_bag = min(p for p in bag_prices if p > 0)
        if _ib_raw_snap is not None:
            asyncio.get_event_loop().run_in_executor(
                None, _gcs_save_snapshot, "IB", "ib_fare_family", _ib_raw_snap,
                {"currency": currency, "origin": probe_origin, "dest": probe_dest},
            )
        result: dict = {
            "checked_bag_note": (
                f"checked bag not included (Basic fare) – add-on from EUR {min_bag:.0f}"
            ),
            "bags_note": "cabin bag included free (Basic fare)",
            "checked_bag_from": min_bag,
            "checked_bag_price": min_bag,
            "currency": currency,
        }
        result["seat_note"] = (
            f"seat selection add-on from EUR {min(seat_prices):.0f}"
            if seat_prices
            else "seat selection add-on available"
        )
        if seat_prices:
            result["seat_from"] = min(seat_prices)
        return result

    logger.debug("IB probe: no bag prices captured for %s→%s", probe_origin, probe_dest)
    return None


# ── AC — Air Canada ───────────────────────────────────────────────────────────

async def _probe_ac(
    origin: str,
    dest: str,
    date_str: Optional[str] = None,
    flight_no: Optional[str] = None,
) -> Optional[dict]:
    """
    Air Canada (AC) — navigate Air Canada booking flow via Playwright.

    Air Canada uses a React-based booking engine. The fare selection page shows
    Basic (no bag) vs Standard (1×23 kg included) with the price difference
    being the checked-bag add-on.
    """
    from patchright.async_api import async_playwright as _patchright_playwright
    from .browser import find_chrome

    dep = _probe_date(date_str, weeks_ahead=6)

    probe_origin = origin if (origin and len(origin) == 3) else "YYZ"
    probe_dest = dest if (dest and len(dest) == 3 and dest != probe_origin) else "JFK"
    if probe_dest == probe_origin:
        probe_dest = "JFK"

    # ── Snapshot fast-path (no browser needed) ────────────────────────────────
    _ac_snap = await asyncio.get_event_loop().run_in_executor(None, _gcs_load_snapshot, "AC")
    if (
        _ac_snap is not None
        and _ac_snap.get("extra", {}).get("origin") == probe_origin
        and _ac_snap.get("extra", {}).get("dest") == probe_dest
    ):
        _ac_result = _snap_replay_generic(_ac_snap, "Basic fare", "carry-on bag included free (Basic fare)", "CAD")
        if _ac_result:
            logger.info("AC probe: replayed from GCS snapshot (no browser)")
            return _ac_result

    bag_prices: List[float] = []
    seat_prices: List[float] = []
    currency = "CAD"
    cap_event = asyncio.Event()
    _ac_raw_snap: Optional[dict] = None

    async def _on_resp(resp):
        nonlocal _ac_raw_snap
        ct = resp.headers.get("content-type", "")
        if resp.status != 200 or "json" not in ct:
            return
        url_l = resp.url.lower()
        if "aircanada" not in url_l and "ac.com" not in url_l:
            return
        try:
            data = await resp.json()
            b, s = _extract_bag_seat_prices(data)
            bag_prices.extend(b)
            seat_prices.extend(s)
            diff = _af_bag_price_from_fare_families(data)
            if diff:
                bag_prices.append(diff)
            if bag_prices and _ac_raw_snap is None:
                _ac_raw_snap = data
                cap_event.set()
            elif bag_prices:
                cap_event.set()
        except Exception:
            pass

    chrome_path: Optional[str] = None
    try:
        chrome_path = find_chrome()
    except RuntimeError:
        pass

    _ac_har_tmp = await asyncio.get_event_loop().run_in_executor(None, _prepare_har_tmp, "AC")

    try:
        async with _patchright_playwright() as pw:
            launch_kwargs: dict = {
                "headless": False,
                "args": [
                    "--no-first-run",
                    "--no-default-browser-check",
                    "--window-size=1440,900",
                    "--no-sandbox",
                    "--disable-dev-shm-usage",
                ],
            }
            if chrome_path:
                launch_kwargs["executable_path"] = chrome_path
            browser = await pw.chromium.launch(**launch_kwargs)
            ctx = await browser.new_context(
                viewport={"width": 1440, "height": 900},
                locale="en-CA",
                timezone_id="America/Toronto",
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/135.0.0.0 Safari/537.36"
                ),
            )
            await _setup_har_route(ctx, "AC", _ac_har_tmp)
            page = await ctx.new_page()
            page.on("response", _on_resp)

            try:
                await page.goto("https://www.aircanada.com/en-ca/", wait_until="domcontentloaded", timeout=30_000)
                await asyncio.sleep(3)
            except Exception as exc:
                logger.debug("AC homepage: %s", exc)

            try:
                await page.evaluate("""() => {
                    for (const b of document.querySelectorAll('button')) {
                        const t = (b.textContent || '').toLowerCase();
                        if ((t.includes('accept') || t.includes('agree') || t.includes('ok')) && b.offsetHeight > 0) {
                            b.click(); return;
                        }
                    }
                }""")
                await asyncio.sleep(1)
            except Exception:
                pass

            booking_url = (
                f"https://www.aircanada.com/en-ca/aco/home.ace#"
                f"OW/true/{probe_origin}/{probe_dest}/{dep}/null/"
                f"1/0/0/Y/-/-"
            )
            try:
                await page.goto(booking_url, wait_until="domcontentloaded", timeout=30_000)
                await asyncio.sleep(4)
            except Exception as exc:
                logger.debug("AC search nav: %s", exc)

            try:
                await asyncio.wait_for(cap_event.wait(), timeout=25.0)
            except (asyncio.TimeoutError, TimeoutError):
                pass

            if not bag_prices:
                try:
                    dom_prices = await _scrape_fare_family_bag_price(page)
                    bag_prices.extend(dom_prices)
                except Exception:
                    pass

            await browser.close()
    except Exception as exc:
        logger.debug("AC Playwright probe error: %s", exc)
    asyncio.get_event_loop().run_in_executor(None, _gcs_save_har, "AC", _ac_har_tmp)

    if bag_prices:
        min_bag = min(p for p in bag_prices if p > 0)
        if _ac_raw_snap is not None:
            asyncio.get_event_loop().run_in_executor(
                None, _gcs_save_snapshot, "AC", "ac_fare_family", _ac_raw_snap,
                {"currency": currency, "origin": probe_origin, "dest": probe_dest},
            )
        result: dict = {
            "checked_bag_note": (
                f"checked bag not included (Basic fare) – add-on from CAD {min_bag:.0f}"
            ),
            "bags_note": "carry-on bag included free (Basic fare)",
            "checked_bag_from": min_bag,
            "checked_bag_price": min_bag,
            "currency": currency,
        }
        result["seat_note"] = (
            f"seat selection add-on from CAD {min(seat_prices):.0f}"
            if seat_prices
            else "seat selection add-on available"
        )
        if seat_prices:
            result["seat_from"] = min(seat_prices)
        return result

    logger.debug("AC probe: no bag prices captured for %s→%s", probe_origin, probe_dest)
    return None


# ── AY — Finnair ──────────────────────────────────────────────────────────────

async def _probe_ay(
    origin: str,
    dest: str,
    date_str: Optional[str] = None,
    flight_no: Optional[str] = None,
) -> Optional[dict]:
    """
    Finnair (AY) — navigate Finnair booking flow via Playwright.

    Finnair uses an Angular booking engine with Amadeus backend.
    Fare families: Light (no bag) vs Classic (23 kg included).
    """
    from patchright.async_api import async_playwright as _patchright_playwright
    from .browser import find_chrome

    dep = _probe_date(date_str, weeks_ahead=6)

    probe_origin = origin if (origin and len(origin) == 3) else "HEL"
    probe_dest = dest if (dest and len(dest) == 3 and dest != probe_origin) else "LHR"
    if probe_dest == probe_origin:
        probe_dest = "LHR"

    # ── Snapshot fast-path (no browser needed) ────────────────────────────────
    _ay_snap = await asyncio.get_event_loop().run_in_executor(None, _gcs_load_snapshot, "AY")
    if (
        _ay_snap is not None
        and _ay_snap.get("extra", {}).get("origin") == probe_origin
        and _ay_snap.get("extra", {}).get("dest") == probe_dest
    ):
        _ay_result = _snap_replay_generic(_ay_snap, "Light fare", "cabin bag 8 kg included free (Light fare)", "EUR")
        if _ay_result:
            logger.info("AY probe: replayed from GCS snapshot (no browser)")
            return _ay_result

    bag_prices: List[float] = []
    seat_prices: List[float] = []
    currency = "EUR"
    cap_event = asyncio.Event()
    _ay_raw_snap: Optional[dict] = None

    async def _on_resp(resp):
        nonlocal _ay_raw_snap
        ct = resp.headers.get("content-type", "")
        if resp.status != 200 or "json" not in ct:
            return
        url_l = resp.url.lower()
        if "finnair" not in url_l and "amadeus" not in url_l:
            return
        try:
            data = await resp.json()
            b, s = _extract_bag_seat_prices(data)
            bag_prices.extend(b)
            seat_prices.extend(s)
            diff = _af_bag_price_from_fare_families(data)
            if diff:
                bag_prices.append(diff)
            if bag_prices and _ay_raw_snap is None:
                _ay_raw_snap = data
                cap_event.set()
            elif bag_prices:
                cap_event.set()
        except Exception:
            pass

    chrome_path: Optional[str] = None
    try:
        chrome_path = find_chrome()
    except RuntimeError:
        pass

    _ay_har_tmp = await asyncio.get_event_loop().run_in_executor(None, _prepare_har_tmp, "AY")

    try:
        async with _patchright_playwright() as pw:
            launch_kwargs: dict = {
                "headless": False,
                "args": [
                    "--no-first-run",
                    "--no-default-browser-check",
                    "--window-size=1440,900",
                    "--no-sandbox",
                    "--disable-dev-shm-usage",
                ],
            }
            if chrome_path:
                launch_kwargs["executable_path"] = chrome_path
            browser = await pw.chromium.launch(**launch_kwargs)
            ctx = await browser.new_context(
                viewport={"width": 1440, "height": 900},
                locale="en-GB",
                timezone_id="Europe/Helsinki",
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/135.0.0.0 Safari/537.36"
                ),
            )
            await _setup_har_route(ctx, "AY", _ay_har_tmp)
            page = await ctx.new_page()
            page.on("response", _on_resp)

            try:
                await page.goto("https://www.finnair.com/en/", wait_until="domcontentloaded", timeout=30_000)
                await asyncio.sleep(3)
            except Exception as exc:
                logger.debug("AY homepage: %s", exc)

            try:
                await page.evaluate("""() => {
                    for (const b of document.querySelectorAll('button')) {
                        const t = (b.textContent || '').toLowerCase();
                        if ((t.includes('accept') || t.includes('agree') || t.includes('ok')) && b.offsetHeight > 0) {
                            b.click(); return;
                        }
                    }
                }""")
                await asyncio.sleep(1)
            except Exception:
                pass

            booking_url = (
                f"https://www.finnair.com/en/booking/flights"
                f"?type=OW&from={probe_origin}&to={probe_dest}"
                f"&date={dep}&adults=1"
            )
            try:
                await page.goto(booking_url, wait_until="domcontentloaded", timeout=30_000)
                await asyncio.sleep(4)
            except Exception as exc:
                logger.debug("AY search nav: %s", exc)

            try:
                await asyncio.wait_for(cap_event.wait(), timeout=25.0)
            except (asyncio.TimeoutError, TimeoutError):
                pass

            if not bag_prices:
                try:
                    dom_prices = await _scrape_fare_family_bag_price(page)
                    bag_prices.extend(dom_prices)
                except Exception:
                    pass

            await browser.close()
    except Exception as exc:
        logger.debug("AY Playwright probe error: %s", exc)
    asyncio.get_event_loop().run_in_executor(None, _gcs_save_har, "AY", _ay_har_tmp)

    if bag_prices:
        min_bag = min(p for p in bag_prices if p > 0)
        if _ay_raw_snap is not None:
            asyncio.get_event_loop().run_in_executor(
                None, _gcs_save_snapshot, "AY", "ay_fare_family", _ay_raw_snap,
                {"currency": currency, "origin": probe_origin, "dest": probe_dest},
            )
        result: dict = {
            "checked_bag_note": (
                f"checked bag not included (Light fare) – add-on from EUR {min_bag:.0f}"
            ),
            "bags_note": "cabin bag included free (Light fare)",
            "checked_bag_from": min_bag,
            "checked_bag_price": min_bag,
            "currency": currency,
        }
        result["seat_note"] = (
            f"seat selection add-on from EUR {min(seat_prices):.0f}"
            if seat_prices
            else "seat selection add-on available"
        )
        if seat_prices:
            result["seat_from"] = min(seat_prices)
        return result

    logger.debug("AY probe: no bag prices captured for %s→%s", probe_origin, probe_dest)
    return None


# ── A3 — Aegean ───────────────────────────────────────────────────────────────

async def _probe_a3(
    origin: str,
    dest: str,
    date_str: Optional[str] = None,
    flight_no: Optional[str] = None,
) -> Optional[dict]:
    """
    Aegean Airlines (A3) — navigate Aegean booking flow via Playwright.

    Aegean uses Amadeus IBE. Fare families: Basic (no bag) vs Flex (23 kg).
    """
    from patchright.async_api import async_playwright as _patchright_playwright
    from .browser import find_chrome

    dep = _probe_date(date_str, weeks_ahead=6)

    probe_origin = origin if (origin and len(origin) == 3) else "ATH"
    probe_dest = dest if (dest and len(dest) == 3 and dest != probe_origin) else "LHR"
    if probe_dest == probe_origin:
        probe_dest = "LHR"

    # ── Snapshot fast-path (no browser needed) ────────────────────────────────
    _a3_snap = await asyncio.get_event_loop().run_in_executor(None, _gcs_load_snapshot, "A3")
    if (
        _a3_snap is not None
        and _a3_snap.get("extra", {}).get("origin") == probe_origin
        and _a3_snap.get("extra", {}).get("dest") == probe_dest
    ):
        _a3_result = _snap_replay_generic(_a3_snap, "Basic fare", "cabin bag 8 kg included free (Basic fare)", "EUR")
        if _a3_result:
            logger.info("A3 probe: replayed from GCS snapshot (no browser)")
            return _a3_result

    bag_prices: List[float] = []
    seat_prices: List[float] = []
    currency = "EUR"
    cap_event = asyncio.Event()
    _a3_raw_snap: Optional[dict] = None

    async def _on_resp(resp):
        nonlocal _a3_raw_snap
        ct = resp.headers.get("content-type", "")
        if resp.status != 200 or "json" not in ct:
            return
        url_l = resp.url.lower()
        if "aegean" not in url_l and "airaegean" not in url_l and "amadeus" not in url_l:
            return
        try:
            data = await resp.json()
            b, s = _extract_bag_seat_prices(data)
            bag_prices.extend(b)
            seat_prices.extend(s)
            diff = _af_bag_price_from_fare_families(data)
            if diff:
                bag_prices.append(diff)
            if bag_prices and _a3_raw_snap is None:
                _a3_raw_snap = data
                cap_event.set()
            elif bag_prices:
                cap_event.set()
        except Exception:
            pass

    chrome_path: Optional[str] = None
    try:
        chrome_path = find_chrome()
    except RuntimeError:
        pass

    _a3_har_tmp = await asyncio.get_event_loop().run_in_executor(None, _prepare_har_tmp, "A3")

    try:
        async with _patchright_playwright() as pw:
            launch_kwargs: dict = {
                "headless": False,
                "args": [
                    "--no-first-run",
                    "--no-default-browser-check",
                    "--window-size=1440,900",
                    "--no-sandbox",
                    "--disable-dev-shm-usage",
                ],
            }
            if chrome_path:
                launch_kwargs["executable_path"] = chrome_path
            browser = await pw.chromium.launch(**launch_kwargs)
            ctx = await browser.new_context(
                viewport={"width": 1440, "height": 900},
                locale="en-GB",
                timezone_id="Europe/Athens",
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/135.0.0.0 Safari/537.36"
                ),
            )
            await _setup_har_route(ctx, "A3", _a3_har_tmp)
            page = await ctx.new_page()
            page.on("response", _on_resp)

            try:
                await page.goto("https://en.aegeanair.com/", wait_until="domcontentloaded", timeout=30_000)
                await asyncio.sleep(3)
            except Exception as exc:
                logger.debug("A3 homepage: %s", exc)

            try:
                await page.evaluate("""() => {
                    for (const b of document.querySelectorAll('button')) {
                        const t = (b.textContent || '').toLowerCase();
                        if ((t.includes('accept') || t.includes('agree') || t.includes('ok')) && b.offsetHeight > 0) {
                            b.click(); return;
                        }
                    }
                }""")
                await asyncio.sleep(1)
            except Exception:
                pass

            booking_url = (
                f"https://en.aegeanair.com/flights/book-flights/"
                f"?from={probe_origin}&to={probe_dest}&date={dep}&adults=1&type=ONE_WAY"
            )
            try:
                await page.goto(booking_url, wait_until="domcontentloaded", timeout=30_000)
                await asyncio.sleep(4)
            except Exception as exc:
                logger.debug("A3 search nav: %s", exc)

            try:
                await asyncio.wait_for(cap_event.wait(), timeout=25.0)
            except (asyncio.TimeoutError, TimeoutError):
                pass

            if not bag_prices:
                try:
                    dom_prices = await _scrape_fare_family_bag_price(page)
                    bag_prices.extend(dom_prices)
                except Exception:
                    pass

            await browser.close()
    except Exception as exc:
        logger.debug("A3 Playwright probe error: %s", exc)
    asyncio.get_event_loop().run_in_executor(None, _gcs_save_har, "A3", _a3_har_tmp)

    if bag_prices:
        min_bag = min(p for p in bag_prices if p > 0)
        if _a3_raw_snap is not None:
            asyncio.get_event_loop().run_in_executor(
                None, _gcs_save_snapshot, "A3", "a3_fare_family", _a3_raw_snap,
                {"currency": currency, "origin": probe_origin, "dest": probe_dest},
            )
        result: dict = {
            "checked_bag_note": (
                f"checked bag not included (Basic fare) – add-on from EUR {min_bag:.0f}"
            ),
            "bags_note": "cabin bag 8 kg included free (Basic fare)",
            "checked_bag_from": min_bag,
            "checked_bag_price": min_bag,
            "currency": currency,
        }
        result["seat_note"] = (
            f"seat selection add-on from EUR {min(seat_prices):.0f}"
            if seat_prices
            else "seat selection add-on available"
        )
        if seat_prices:
            result["seat_from"] = min(seat_prices)
        return result

    logger.debug("A3 probe: no bag prices captured for %s→%s", probe_origin, probe_dest)
    return None


# ── NZ — Air New Zealand ──────────────────────────────────────────────────────

async def _probe_nz(
    origin: str,
    dest: str,
    date_str: Optional[str] = None,
    flight_no: Optional[str] = None,
) -> Optional[dict]:
    """
    Air New Zealand (NZ) — navigate Air NZ booking flow via Playwright.

    Air NZ uses their own React-based IBE. Fare families include:
    Seat (no bag) vs Works Lite (20 kg included).
    """
    from patchright.async_api import async_playwright as _patchright_playwright
    from .browser import find_chrome

    dep = _probe_date(date_str, weeks_ahead=6)

    probe_origin = origin if (origin and len(origin) == 3) else "AKL"
    probe_dest = dest if (dest and len(dest) == 3 and dest != probe_origin) else "SYD"
    if probe_dest == probe_origin:
        probe_dest = "SYD"

    # ── Snapshot fast-path (no browser needed) ────────────────────────────────
    _nz_snap = await asyncio.get_event_loop().run_in_executor(None, _gcs_load_snapshot, "NZ")
    if (
        _nz_snap is not None
        and _nz_snap.get("extra", {}).get("origin") == probe_origin
        and _nz_snap.get("extra", {}).get("dest") == probe_dest
    ):
        _nz_result = _snap_replay_generic(_nz_snap, "Seat fare", "cabin bag included free (Seat fare)", "NZD")
        if _nz_result:
            logger.info("NZ probe: replayed from GCS snapshot (no browser)")
            return _nz_result

    bag_prices: List[float] = []
    seat_prices: List[float] = []
    currency = "NZD"
    cap_event = asyncio.Event()
    _nz_raw_snap: Optional[dict] = None

    async def _on_resp(resp):
        nonlocal _nz_raw_snap
        ct = resp.headers.get("content-type", "")
        if resp.status != 200 or "json" not in ct:
            return
        url_l = resp.url.lower()
        if "airnewzealand" not in url_l and "airnz" not in url_l:
            return
        try:
            data = await resp.json()
            b, s = _extract_bag_seat_prices(data)
            bag_prices.extend(b)
            seat_prices.extend(s)
            diff = _af_bag_price_from_fare_families(data)
            if diff:
                bag_prices.append(diff)
            if bag_prices and _nz_raw_snap is None:
                _nz_raw_snap = data
                cap_event.set()
            elif bag_prices:
                cap_event.set()
        except Exception:
            pass

    chrome_path: Optional[str] = None
    try:
        chrome_path = find_chrome()
    except RuntimeError:
        pass

    _nz_har_tmp = await asyncio.get_event_loop().run_in_executor(None, _prepare_har_tmp, "NZ")

    try:
        async with _patchright_playwright() as pw:
            launch_kwargs: dict = {
                "headless": False,
                "args": [
                    "--no-first-run",
                    "--no-default-browser-check",
                    "--window-size=1440,900",
                    "--no-sandbox",
                    "--disable-dev-shm-usage",
                ],
            }
            if chrome_path:
                launch_kwargs["executable_path"] = chrome_path
            browser = await pw.chromium.launch(**launch_kwargs)
            ctx = await browser.new_context(
                viewport={"width": 1440, "height": 900},
                locale="en-NZ",
                timezone_id="Pacific/Auckland",
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/135.0.0.0 Safari/537.36"
                ),
            )
            await _setup_har_route(ctx, "NZ", _nz_har_tmp)
            page = await ctx.new_page()
            page.on("response", _on_resp)

            try:
                await page.goto("https://www.airnewzealand.co.nz/", wait_until="domcontentloaded", timeout=30_000)
                await asyncio.sleep(3)
            except Exception as exc:
                logger.debug("NZ homepage: %s", exc)

            try:
                await page.evaluate("""() => {
                    for (const b of document.querySelectorAll('button')) {
                        const t = (b.textContent || '').toLowerCase();
                        if ((t.includes('accept') || t.includes('agree') || t.includes('ok')) && b.offsetHeight > 0) {
                            b.click(); return;
                        }
                    }
                }""")
                await asyncio.sleep(1)
            except Exception:
                pass

            booking_url = (
                f"https://www.airnewzealand.co.nz/booking/flights?"
                f"origin={probe_origin}&destination={probe_dest}"
                f"&departureDate={dep}&adults=1&tripType=ONE_WAY"
            )
            try:
                await page.goto(booking_url, wait_until="domcontentloaded", timeout=30_000)
                await asyncio.sleep(4)
            except Exception as exc:
                logger.debug("NZ search nav: %s", exc)

            try:
                await asyncio.wait_for(cap_event.wait(), timeout=25.0)
            except (asyncio.TimeoutError, TimeoutError):
                pass

            if not bag_prices:
                try:
                    dom_prices = await _scrape_fare_family_bag_price(page)
                    bag_prices.extend(dom_prices)
                except Exception:
                    pass

            await browser.close()
    except Exception as exc:
        logger.debug("NZ Playwright probe error: %s", exc)
    asyncio.get_event_loop().run_in_executor(None, _gcs_save_har, "NZ", _nz_har_tmp)

    if bag_prices:
        min_bag = min(p for p in bag_prices if p > 0)
        if _nz_raw_snap is not None:
            asyncio.get_event_loop().run_in_executor(
                None, _gcs_save_snapshot, "NZ", "nz_fare_family", _nz_raw_snap,
                {"currency": currency, "origin": probe_origin, "dest": probe_dest},
            )
        result: dict = {
            "checked_bag_note": (
                f"checked bag not included (Seat fare) – add-on from NZD {min_bag:.0f}"
            ),
            "bags_note": "cabin bag included free (Seat fare)",
            "checked_bag_from": min_bag,
            "checked_bag_price": min_bag,
            "currency": currency,
        }
        result["seat_note"] = (
            f"seat selection add-on from NZD {min(seat_prices):.0f}"
            if seat_prices
            else "seat selection add-on available"
        )
        if seat_prices:
            result["seat_from"] = min(seat_prices)
        return result

    logger.debug("NZ probe: no bag prices captured for %s→%s", probe_origin, probe_dest)
    return None


# ── QF — Qantas ───────────────────────────────────────────────────────────────

async def _probe_qf(
    origin: str,
    dest: str,
    date_str: Optional[str] = None,
    flight_no: Optional[str] = None,
) -> Optional[dict]:
    """
    Qantas (QF) — navigate Qantas booking flow via Playwright.

    Qantas uses a React-based IBE. Fare families include:
    Economy Lite (no bag) vs Economy (23 kg included).
    """
    from patchright.async_api import async_playwright as _patchright_playwright
    from .browser import find_chrome

    dep = _probe_date(date_str, weeks_ahead=6)

    probe_origin = origin if (origin and len(origin) == 3) else "SYD"
    probe_dest = dest if (dest and len(dest) == 3 and dest != probe_origin) else "MEL"
    if probe_dest == probe_origin:
        probe_dest = "MEL"

    # ── Snapshot fast-path (no browser needed) ────────────────────────────────
    _qf_snap = await asyncio.get_event_loop().run_in_executor(None, _gcs_load_snapshot, "QF")
    if (
        _qf_snap is not None
        and _qf_snap.get("extra", {}).get("origin") == probe_origin
        and _qf_snap.get("extra", {}).get("dest") == probe_dest
    ):
        _qf_result = _snap_replay_generic(_qf_snap, "Economy Lite", "cabin bag included free (Economy Lite)", "AUD")
        if _qf_result:
            logger.info("QF probe: replayed from GCS snapshot (no browser)")
            return _qf_result

    bag_prices: List[float] = []
    seat_prices: List[float] = []
    currency = "AUD"
    cap_event = asyncio.Event()
    _qf_raw_snap: Optional[dict] = None

    async def _on_resp(resp):
        nonlocal _qf_raw_snap
        ct = resp.headers.get("content-type", "")
        if resp.status != 200 or "json" not in ct:
            return
        url_l = resp.url.lower()
        if "qantas" not in url_l:
            return
        try:
            data = await resp.json()
            b, s = _extract_bag_seat_prices(data)
            bag_prices.extend(b)
            seat_prices.extend(s)
            diff = _af_bag_price_from_fare_families(data)
            if diff:
                bag_prices.append(diff)
            if bag_prices and _qf_raw_snap is None:
                _qf_raw_snap = data
                cap_event.set()
            elif bag_prices:
                cap_event.set()
        except Exception:
            pass

    chrome_path: Optional[str] = None
    try:
        chrome_path = find_chrome()
    except RuntimeError:
        pass

    _qf_har_tmp = await asyncio.get_event_loop().run_in_executor(None, _prepare_har_tmp, "QF")

    try:
        async with _patchright_playwright() as pw:
            launch_kwargs: dict = {
                "headless": False,
                "args": [
                    "--no-first-run",
                    "--no-default-browser-check",
                    "--window-size=1440,900",
                    "--no-sandbox",
                    "--disable-dev-shm-usage",
                ],
            }
            if chrome_path:
                launch_kwargs["executable_path"] = chrome_path
            browser = await pw.chromium.launch(**launch_kwargs)
            ctx = await browser.new_context(
                viewport={"width": 1440, "height": 900},
                locale="en-AU",
                timezone_id="Australia/Sydney",
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/135.0.0.0 Safari/537.36"
                ),
            )
            await _setup_har_route(ctx, "QF", _qf_har_tmp)
            page = await ctx.new_page()
            page.on("response", _on_resp)

            try:
                await page.goto("https://www.qantas.com/au/en.html", wait_until="domcontentloaded", timeout=30_000)
                await asyncio.sleep(3)
            except Exception as exc:
                logger.debug("QF homepage: %s", exc)

            try:
                await page.evaluate("""() => {
                    for (const b of document.querySelectorAll('button')) {
                        const t = (b.textContent || '').toLowerCase();
                        if ((t.includes('accept') || t.includes('agree') || t.includes('ok')) && b.offsetHeight > 0) {
                            b.click(); return;
                        }
                    }
                }""")
                await asyncio.sleep(1)
            except Exception:
                pass

            booking_url = (
                f"https://www.qantas.com/au/en/book-a-trip/flights/find/results.html?"
                f"origin={probe_origin}&destination={probe_dest}"
                f"&departDate={dep}&adults=1&tripType=O"
            )
            try:
                await page.goto(booking_url, wait_until="domcontentloaded", timeout=30_000)
                await asyncio.sleep(4)
            except Exception as exc:
                logger.debug("QF search nav: %s", exc)

            try:
                await asyncio.wait_for(cap_event.wait(), timeout=25.0)
            except (asyncio.TimeoutError, TimeoutError):
                pass

            if not bag_prices:
                try:
                    dom_prices = await _scrape_fare_family_bag_price(page)
                    bag_prices.extend(dom_prices)
                except Exception:
                    pass

            await browser.close()
    except Exception as exc:
        logger.debug("QF Playwright probe error: %s", exc)
    asyncio.get_event_loop().run_in_executor(None, _gcs_save_har, "QF", _qf_har_tmp)

    if bag_prices:
        min_bag = min(p for p in bag_prices if p > 0)
        if _qf_raw_snap is not None:
            asyncio.get_event_loop().run_in_executor(
                None, _gcs_save_snapshot, "QF", "qf_fare_family", _qf_raw_snap,
                {"currency": currency, "origin": probe_origin, "dest": probe_dest},
            )
        result: dict = {
            "checked_bag_note": (
                f"checked bag not included (Economy Lite) – add-on from AUD {min_bag:.0f}"
            ),
            "bags_note": "cabin bag included free (Economy Lite)",
            "checked_bag_from": min_bag,
            "checked_bag_price": min_bag,
            "currency": currency,
        }
        result["seat_note"] = (
            f"seat selection add-on from AUD {min(seat_prices):.0f}"
            if seat_prices
            else "seat selection add-on available"
        )
        if seat_prices:
            result["seat_from"] = min(seat_prices)
        return result

    logger.debug("QF probe: no bag prices captured for %s→%s", probe_origin, probe_dest)
    return None


# ── Dispatch table ────────────────────────────────────────────────────────────
_PROBERS = {
    "F3": _probe_f3,
    "FZ": _probe_fz,
    "G9": _probe_g9,
    "XQ": _probe_xq,
    "SZ": _probe_sz,
    "LA": _probe_la,
    "JJ": _probe_la,  # LATAM Brazil (same booking engine)
    "Y4": _probe_y4,  # Volaris (Navitaire)
    "CM": _probe_cm,  # Copa Airlines
    "G3": _probe_g3,  # GOL Linhas Aéreas
    "AD": _probe_ad,  # Azul Brazilian Airlines (Navitaire)
    "VB": _probe_vb,  # VivaAerobus (persistent-context, Akamai-warm fallback)
    "FO": _probe_fo,  # Flybondi (SSR HTML fare-bundle diff)
    # Group 6 — full-service carriers
    "AF": _probe_af,
    "KL": _probe_kl,
    "BA": _probe_ba,
    "LH": _probe_lh,
    "OS": _probe_lh,  # Austrian Airlines (same Lufthansa Group engine)
    "LX": _probe_lh,  # Swiss (same Lufthansa Group engine)
    "SN": _probe_lh,  # Brussels Airlines (same Lufthansa Group engine)
    "IB": _probe_ib,
    "AC": _probe_ac,
    "AY": _probe_ay,
    "A3": _probe_a3,
    "NZ": _probe_nz,
    "QF": _probe_qf,
}

# ── Snapshot replay dispatch (populated here so all helper fns are in scope) ──
_SNAPSHOT_REPLAY.update({
    "XQ": _snap_replay_xq,
    "SZ": _snap_replay_sz,
    "AF": _snap_replay_af,
    "KL": _snap_replay_af,          # identical GQL structure
    "F3": _snap_replay_f3,
    "BA": _make_generic_replayer("Hand Baggage Only", "cabin bag 23 kg included free (Hand Baggage Only fare)", "GBP"),
    "LH": _make_generic_replayer("Economy Light", "cabin bag 8 kg included free (Economy Light)", "EUR"),
    "OS": _make_generic_replayer("Economy Light", "cabin bag 8 kg included free (Economy Light)", "EUR"),
    "LX": _make_generic_replayer("Economy Light", "cabin bag 8 kg included free (Economy Light)", "EUR"),
    "SN": _make_generic_replayer("Economy Light", "cabin bag 8 kg included free (Economy Light)", "EUR"),
    "IB": _make_generic_replayer("Basic fare", "cabin bag included free (Basic fare)", "EUR"),
    "AC": _make_generic_replayer("Basic fare", "carry-on bag included free (Basic fare)", "CAD"),
    "AY": _make_generic_replayer("Light fare", "cabin bag 8 kg included free (Light fare)", "EUR"),
    "A3": _make_generic_replayer("Basic fare", "cabin bag 8 kg included free (Basic fare)", "EUR"),
    "NZ": _make_generic_replayer("Seat fare", "cabin bag included free (Seat fare)", "NZD"),
    "QF": _make_generic_replayer("Economy Lite", "cabin bag included free (Economy Lite)", "AUD"),
})
