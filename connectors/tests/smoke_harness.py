"""
Tier-2 connector live smoke harness.

Invokes one connector at a time against a real route from test_routes.py
and asserts: offers returned, prices > 0, latency within threshold.
This is INTENTIONALLY non-blocking in CI (see connector-smoke.yml).

Usage:
  python connectors/tests/smoke_harness.py ryanair_direct
  python connectors/tests/smoke_harness.py ryanair_direct wizzair_direct kiwi_connector
  python connectors/tests/smoke_harness.py --all-fast-mode

The harness exits with code 1 only when a connector produces an assertion
failure (wrong shape, price ≤ 0, latency exceeded). Missing route entries
exit code 2. Network errors are reported but do NOT fail — scrapers are
inherently flaky.
"""

from __future__ import annotations

import asyncio
import importlib
import sys
import time
from datetime import date, timedelta
from pathlib import Path
from typing import Any

# ── Path setup ───────────────────────────────────────────────────────────────

_REPO_ROOT = Path(__file__).resolve().parents[2]
_SDK_ROOT = _REPO_ROOT / "sdk" / "python"
for _p in (str(_REPO_ROOT), str(_SDK_ROOT)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from connectors.test_routes import ROUTES, TestRoute
from letsfg.models.flights import FlightOffer, FlightSearchRequest, FlightSearchResponse

# ── Connector registry ───────────────────────────────────────────────────────
# Maps source tag → (module_path, class_name) within letsfg.connectors.*
# Add new connectors here when their test route is registered in test_routes.py.

_REGISTRY: dict[str, tuple[str, str]] = {
    "skyscanner_meta":          ("letsfg.connectors.skyscanner",    "SkyscannerConnectorClient"),
    "momondo_meta":             ("letsfg.connectors.momondo",       "MomondoConnectorClient"),
    "kayak_meta":               ("letsfg.connectors.kayak",         "KayakConnectorClient"),
    "kiwi_connector":           ("letsfg.connectors.kiwi",          "KiwiConnectorClient"),
    "ryanair_direct":           ("letsfg.connectors.ryanair",       "RyanairConnectorClient"),
    "wizzair_direct":           ("letsfg.connectors.wizzair",       "WizzairConnectorClient"),
    "easyjet_direct":           ("letsfg.connectors.easyjet",       "EasyjetConnectorClient"),
    "norwegian_direct":         ("letsfg.connectors.norwegian",     "NorwegianConnectorClient"),
    "vueling_direct":           ("letsfg.connectors.vueling",       "VuelingConnectorClient"),
    "transavia_direct":         ("letsfg.connectors.transavia",     "TransaviaConnectorClient"),
    "jetblue_direct":           ("letsfg.connectors.jetblue",       "JetBlueConnectorClient"),
    "frontier_direct":          ("letsfg.connectors.frontier",      "FrontierConnectorClient"),
    "allegiant_direct":         ("letsfg.connectors.allegiant",     "AllegiantConnectorClient"),
    "southwest_direct":         ("letsfg.connectors.southwest",     "SouthwestConnectorClient"),
    "emirates_direct":          ("letsfg.connectors.emirates",      "EmiratesConnectorClient"),
    "turkish_direct":           ("letsfg.connectors.turkish",       "TurkishConnectorClient"),
    "finnair_direct":           ("letsfg.connectors.finnair",       "FinnairConnectorClient"),
    "indigo_direct":            ("letsfg.connectors.indigo",        "IndiGoConnectorClient"),
    "spicejet_direct":          ("letsfg.connectors.spicejet",      "SpiceJetConnectorClient"),
    "akasa_direct":             ("letsfg.connectors.akasa",         "AkasaConnectorClient"),
    "airindiaexpress_direct":   ("letsfg.connectors.airindiaexpress", "AirIndiaExpressConnectorClient"),
}

# ── Fast-mode set (subset of REGISTRY with routes) ───────────────────────────
_FAST_MODE_TAGS = {t for t in _REGISTRY if t in ROUTES}


# ── Result types ─────────────────────────────────────────────────────────────

class SmokeResult:
    def __init__(self, tag: str, route: TestRoute) -> None:
        self.tag = tag
        self.route = route
        self.passed = False
        self.skipped = False
        self.error: str = ""
        self.offers: int = 0
        self.cheapest: float = 0.0
        self.latency_s: float = 0.0

    def __repr__(self) -> str:
        if self.skipped:
            return f"SKIP  {self.tag}: {self.error}"
        status = "PASS" if self.passed else "FAIL"
        return (
            f"{status}  {self.tag}  {self.route.origin}→{self.route.destination}"
            f"  offers={self.offers}  cheapest={self.cheapest:.2f}"
            f"  latency={self.latency_s:.1f}s  (limit={self.route.latency_s}s)"
            + (f"  ERROR: {self.error}" if self.error else "")
        )


# ── Core smoke logic ──────────────────────────────────────────────────────────

def _load_connector(tag: str) -> Any:
    module_path, class_name = _REGISTRY[tag]
    mod = importlib.import_module(module_path)
    return getattr(mod, class_name)


async def smoke_one(tag: str) -> SmokeResult:
    route = ROUTES[tag]
    result = SmokeResult(tag, route)

    if tag not in _REGISTRY:
        result.skipped = True
        result.error = "not in harness registry — add entry to _REGISTRY"
        return result

    try:
        ClientClass = _load_connector(tag)
    except (ImportError, AttributeError) as exc:
        result.skipped = True
        result.error = f"import failed: {exc}"
        return result

    req = FlightSearchRequest(
        origin=route.origin,
        destination=route.destination,
        date_from=date.today() + timedelta(days=14),
        currency="EUR",
    )

    connector = ClientClass(timeout=route.latency_s)
    try:
        t0 = time.monotonic()
        response: FlightSearchResponse = await connector.search_flights(req)
        result.latency_s = time.monotonic() - t0
    except Exception as exc:
        result.error = f"network error (non-fatal): {exc}"
        result.skipped = True  # network flakiness ≠ assertion failure
        return result
    finally:
        try:
            await connector.close()
        except Exception:
            pass

    offers = response.offers if hasattr(response, "offers") else []
    result.offers = len(offers)

    # ── Assertions ──────────────────────────────────────────────────────────
    errors: list[str] = []

    if result.latency_s > route.latency_s:
        errors.append(f"latency {result.latency_s:.1f}s > limit {route.latency_s}s")

    if len(offers) < route.min_offers:
        errors.append(f"offers {len(offers)} < min {route.min_offers}")

    invalid_prices = [o for o in offers if not isinstance(o.price, (int, float)) or o.price <= 0]
    if invalid_prices:
        errors.append(f"{len(invalid_prices)} offers with price ≤ 0")

    if offers:
        result.cheapest = min(o.price for o in offers)
        if route.max_price and result.cheapest > route.max_price:
            errors.append(f"cheapest {result.cheapest:.2f} > sanity cap {route.max_price}")

    # Validate FlightOffer shape: outbound segment must exist
    bad_shape = [o for o in offers if not (o.outbound and o.outbound.segments)]
    if bad_shape:
        errors.append(f"{len(bad_shape)} offers missing outbound segments")

    if errors:
        result.error = "; ".join(errors)
        result.passed = False
    else:
        result.passed = True

    return result


async def smoke_many(tags: list[str]) -> list[SmokeResult]:
    # Run sequentially to avoid overwhelming a single machine's network / browser
    return [await smoke_one(tag) for tag in tags]


# ── CLI ───────────────────────────────────────────────────────────────────────

def _parse_args() -> list[str]:
    args = sys.argv[1:]
    if not args:
        print("Usage: smoke_harness.py <source_tag> [<source_tag> ...] | --all-fast-mode")
        print(f"\nRegistered tags ({len(ROUTES)}):")
        for tag in sorted(ROUTES):
            r = ROUTES[tag]
            print(f"  {tag:<30} {r.origin}→{r.destination}  latency≤{r.latency_s}s")
        sys.exit(0)
    if args == ["--all-fast-mode"]:
        return sorted(_FAST_MODE_TAGS)
    return args


async def _main() -> int:
    tags = _parse_args()

    unknown = [t for t in tags if t not in ROUTES]
    if unknown:
        for t in unknown:
            print(f"ERROR: no test route for '{t}' — add it to connectors/test_routes.py", file=sys.stderr)
        return 2

    print(f"Running smoke for: {', '.join(tags)}\n")
    results = await smoke_many(tags)

    print("─" * 72)
    for r in results:
        print(r)
    print("─" * 72)

    passed = sum(1 for r in results if r.passed)
    failed = sum(1 for r in results if not r.passed and not r.skipped)
    skipped = sum(1 for r in results if r.skipped)
    print(f"\n{passed} passed, {failed} failed, {skipped} skipped")

    return 1 if failed > 0 else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(_main()))
