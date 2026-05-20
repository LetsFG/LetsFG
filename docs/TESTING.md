# Testing Guide

LetsFG uses a three-tier test strategy to balance correctness, speed, and cost.

## Three-tier taxonomy

| Tier | What it is | Network? | CI behavior | Location |
|------|-----------|----------|-------------|----------|
| **1 — Deterministic** | Offline unit + parsing tests; `tsc`; `next build` | No | **Hard block** — must be green to merge | `website/tests/`, `sdk/python/tests/` |
| **2 — Targeted live smoke** | Real connector search for changed connectors only | Yes (real airline APIs) | Report-only, non-blocking | `connectors/tests/smoke_harness.py` |
| **3 — Production synthetic** | Full-funnel probe users against prod, tagged `is_test_search=true` | Yes (prod) | Continuous; alert on failure | `growth-ops/` (private) |

## Definition of Done

Every PR that adds or modifies behavior **must include tests reviewed alongside the code**. No exceptions.

- **New connector** → add a Tier-1 parsing test + fixture (see below) and register a Tier-2 test route.
- **Bug fix in connector** → add or extend an existing Tier-1 test that would have caught the bug.
- **Website feature** → add Tier-1 deterministic tests; update the critical-path manifest if the feature is critical-path.
- **No green Tier-1 = no merge.** The CI gate (`npm run test:critical`, `pytest -m "not live"`, `tsc --noEmit`) is a required status check.

### Red-Green-Refactor

1. **Red** — write a failing test that describes the expected behavior.
2. **Green** — write the minimum code to make it pass.
3. **Refactor** — clean up without breaking green.

Never submit "code + tests added after" — reviewers check test commits precede or are atomic with implementation.

## Tier-1: Connector parsing tests

These tests are fully offline — no network, no browser. They load a captured JSON
fixture and call the connector's parse method directly.

### Adding a parsing test for a new connector

**Step 1 — Create a fixture file** capturing a real (or realistic) API response:

```
sdk/python/tests/fixtures/<connector_name>/response.json
```

Keep the fixture minimal: one or two offers is enough to exercise the parse path.

**Step 2 — Add a test class** in `sdk/python/tests/test_connector_parsing.py`:

```python
class MyAirlineConnectorParsingTest(unittest.TestCase):
    def setUp(self) -> None:
        self.connector = MyAirlineConnectorClient()
        with open(FIXTURES / "myairline" / "response.json") as f:
            self.data = json.load(f)
        self.req = _req("XXX", "YYY")

    def test_parse_returns_offers(self) -> None:
        offers = self.connector._parse(self.data, self.req)
        self.assertGreater(len(offers), 0)

    def test_parse_price_positive(self) -> None:
        for offer in self.connector._parse(self.data, self.req):
            self.assertGreater(offer.price, 0)

    def test_parse_source_tag(self) -> None:
        for offer in self.connector._parse(self.data, self.req):
            self.assertEqual(offer.source, "myairline_direct")
```

Minimum assertions for every connector:
- Parse returns a list (never throws on valid input)
- Every offer has `price > 0`, `currency` set, `source` tag matching `_FAST_MODE_SOURCES`
- `outbound` segment present with `origin` / `destination` IATA codes
- Zero-price / empty-data guard returns empty list

**Step 3 — Run Tier-1:**

```bash
cd sdk/python
pytest tests/ -m "not live" -q
```

### Connectors with inline parse logic

Some connectors (e.g. `turkish_direct`, `norwegian_direct`, `easyjet_direct`) mix HTTP calls and parsing in a single `async` method. These cannot be unit-tested without a mock. They are covered by Tier-2 live smoke only. If you refactor a connector to extract a pure `_parse(data, req)` method, add a Tier-1 test for it.

## Tier-2: Change-targeted live smoke

The smoke harness (`connectors/tests/smoke_harness.py`) invokes a connector in isolation against a real airline route and asserts: offers returned, prices > 0, latency within threshold.

CI automatically smokes **only the changed connectors** on every PR. Nightly cron covers the full fast-mode set.

### Registering a test route for a new connector

Add an entry to `connectors/test_routes.py`:

```python
"myairline_direct": TestRoute(
    "myairline_direct",
    origin="XXX",
    destination="YYY",
    latency_s=15.0,
    note="Short-haul route that exercises the connector year-round",
),
```

Choose a route that:
- Has reliable year-round scheduled flights
- Is a short-haul path (faster to fetch)
- Exercises the connector's primary search path (not an edge case)

Add the connector class to the `_REGISTRY` in `smoke_harness.py`.

### Running smoke manually

```bash
# One connector
python connectors/tests/smoke_harness.py ryanair_direct

# Multiple
python connectors/tests/smoke_harness.py ryanair_direct kiwi_connector skyscanner_meta

# All fast-mode connectors (takes several minutes)
python connectors/tests/smoke_harness.py --all-fast-mode
```

Smoke results include latency, offer count, and cheapest price. Network errors are marked SKIP (not FAIL) — scraper flakiness is expected.

## Tier-1 critical-path manifest

`website/tests/critical-manifest.json` lists the website test suites that must pass before any merge. Add your suite here if it covers a critical-path feature (location parse, search, results, unlock, checkout).

```bash
# Run critical-path only (fast, used by CI gate)
cd website && npm run test:critical

# Run all website tests
cd website && npm test
```

## Test file locations

| What | Where |
|------|-------|
| Website Tier-1 tests | `website/tests/` |
| Critical-path manifest | `website/tests/critical-manifest.json` |
| Python connector parsing tests | `sdk/python/tests/test_connector_parsing.py` |
| Parsing fixture files | `sdk/python/tests/fixtures/<connector>/` |
| Live smoke harness | `connectors/tests/smoke_harness.py` |
| Smoke test-route registry | `connectors/test_routes.py` |
| CI gate workflow | `.github/workflows/test.yml` |
| Smoke workflow | `.github/workflows/connector-smoke.yml` |
