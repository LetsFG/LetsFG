# Testing Guide

LetsFG uses a three-tier test strategy across two repos to balance correctness, speed, and cost.

## Three-tier taxonomy

| Tier | What it is | Network? | CI behavior | Location |
|------|-----------|----------|-------------|----------|
| **1 — Deterministic** | Offline unit + parsing tests; `tsc`; `next build` | No | **Hard block** — blocks merge / deploy | `website/tests/` (private), `sdk/python/tests/`, `sdk/js/src/`, `sdk/mcp/src/`, `growth-ops/src/` (private) |
| **2 — Targeted live smoke** | Real connector search for changed connectors only | Yes (real airline APIs) | Report-only, non-blocking | `connectors/tests/smoke_harness.py` |
| **3 — Production synthetic** | Full-funnel probe users against prod, tagged `is_test_search=true` | Yes (prod) | Continuous, 4× daily; alert on failure | `growth-ops/src/crons/quality-probes.cron.ts` (private) |

## CI gate map

| Tier | Repo | Job | Blocks Merge? |
|------|------|-----|---------------|
| **1** | Public | `python-deterministic` (connector parsing) | **Yes** (required check) |
| **1** | Public | `typescript-packages` (JS SDK + MCP type-check + tests) | **Yes** (required check) |
| **1** | Private | `website-ci.yml` → critical-tests + next-build | Convention + auto-merge |
| **1** | Private | `ci.yml` → growth-ops-test | Convention + auto-merge |
| **1** | Private | Cloud Build pre-deploy-tests step | **Yes** (hard gate — blocks deploy) |
| **2** | Public | `connector-smoke` (changed connectors + nightly) | No (advisory) |
| **2** | Public | `sdk-tests` (masking, on SDK changes) | No (advisory) |
| **3** | Private | `quality-probes.yml` (4× daily journey probes) | No (Telegram alerts) |

**Note:** GitHub free plan cannot enforce required status checks on private repos. The Cloud Build `pre-deploy-tests` step is the hard production gate for the website. The growth-ops CI is enforced via PR convention and auto-merge settings.

## Definition of Done (TDD mandate)

Every PR that adds or modifies behavior **must include tests reviewed alongside the code**. No exceptions. CI enforces this structurally via the `test-coverage-gate` job.

- **New source file** → CI checks for a sibling `<file>.test.ts` or `__tests__/<file>.test.ts`. Fails if missing.
- **New connector** → add a Tier-1 parsing test + fixture (see below) and register a Tier-2 test route.
- **Bug fix in connector** → add or extend an existing Tier-1 test that would have caught the bug.
- **Website feature** → add Tier-1 deterministic tests; update the critical-path manifest if the feature is critical-path.
- **Growth-ops service** → add test in `src/services/__tests__/<service>.test.ts`.
- **No green Tier-1 = no merge.**

### Red-Green-Refactor

1. **Red** — write a failing test that describes the expected behavior.
2. **Green** — write the minimum code to make it pass.
3. **Refactor** — clean up without breaking green.

Never submit "code + tests added after" — reviewers check test commits precede or are atomic with implementation.

### Skipping the coverage gate

For rare exceptions (emergency hotfixes, config-only changes), label the PR `skip-test-gate`. This bypasses the automated check but is visible in the PR history.

## Experiments coexist via feature flags

When a feature is experimental (A/B test), write tests for both branches:
- The test for the **live behavior** documents the current default.
- The test for the **experiment** asserts behavior *under the feature flag* — it does not contradict the live tests.
- Both test suites run in CI.
- When an experiment graduates, the old live test is removed and the experiment test becomes canonical.

Never overwrite live behavior tests with experiment tests — use feature flags.

## Strategic Decision Registry

Tested strategic decisions are logged in the table below. Tests marked `@strategic` (in the test name prefix) can only be removed or changed with an explicit `decision-change:` PR label — CI flags PRs that modify these tests without it.

| Decision | Test file | Date |
|----------|-----------|------|
| Results show 3 ranked deals: best/cheapest/fastest | `website/tests/recommendation-quality.test.ts` | 2026-06-01 |
| Quality scoring formula weights: results 30 / price 40 / diversity 20 / speed 10 | `website/tests/recommendation-quality.test.ts` | 2026-06-01 |
| Google comparison shown on results page; zero/negative baselines are invalid | `website/tests/google-comparison.test.ts` | 2026-06-01 |
| Search is free; checkout unlock experiment routes traffic to payment-only path | `website/tests/checkout-unlock-experiment.test.ts` | 2026-06-01 |
| Growth funnel measured via L1–L7 (see `growth-ops/src/models/growth-model.ts`) | `growth-ops/src/services/__tests__/` | 2026-06-01 |
| Quality measured via Q1–Q3 composite score; Q1=recommendation quality, Q2=connector coverage, Q3=pricing accuracy | `website/tests/recommendation-quality.test.ts` | 2026-06-01 |
| All experiments run behind feature flags with tests for both branches; winning variant replaces default without backwards shim | `website/tests/checkout-unlock-experiment.test.ts` | 2026-06-01 |

To add an entry: add `@strategic` to the test name, add a row here, and open a PR with a `decision-change:` label.

---

## Tier-1: Connector parsing tests (Python)

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

Some connectors mix HTTP calls and parsing in a single `async` method. These cannot be unit-tested without a mock. They are covered by Tier-2 live smoke only. If you refactor a connector to extract a pure `_parse(data, req)` method, add a Tier-1 test for it.

---

## Tier-1: JS SDK tests

JS SDK tests live in `sdk/js/src/index.test.ts`. Run with:

```bash
cd sdk/js && npm test
```

Covers: class instantiation, method existence, auth guard (throws `AuthenticationError` when no key), error class hierarchy, `offerSummary`, `cheapestOffer`.

## Tier-1: MCP server tests

MCP server tests live in `sdk/mcp/src/index.test.ts`. They spawn the MCP server as a subprocess and exercise the JSON-RPC protocol:

```bash
cd sdk/mcp && npm test
```

Covers: `initialize` response, `tools/list` with all required tools, `resources/list` with the guide resource, unknown-method error handling.

---

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

---

## Tier-3: Quality probes (4× daily)

Journey probes run 4× daily against production. They exercise the full critical path and alert via Slack/Telegram if something breaks.

The workflow lives in `LetsFG-private/.github/workflows/quality-probes.yml`. The probe logic is in `growth-ops/src/crons/quality-probes.cron.ts` and `growth-ops/src/services/journey-probe.ts`.

Required secrets (in LetsFG-private GitHub repo settings):
- `LETSFG_API_KEY` — Developer API key for probe searches
- `GROWTH_OPS_TELEGRAM_BOT_TOKEN` — Telegram bot token
- `GROWTH_OPS_TELEGRAM_CHAT_ID` — Telegram target chat

---

## Tier-1 critical-path manifest (website)

`website/tests/critical-manifest.json` in the private repo lists the website test suites that must pass before any deploy. Add your suite here if it covers a critical-path feature.

```bash
# Run critical-path only (fast, ~60s — used by CI and Cloud Build pre-deploy gate)
cd website && npm run test:critical

# Run all website tests
cd website && npm test
```

---

## Test file locations

| What | Repo | Where |
|------|------|-------|
| Website Tier-1 tests | Private | `website/tests/` |
| Critical-path manifest | Private | `website/tests/critical-manifest.json` |
| Growth-ops Tier-1 tests | Private | `growth-ops/src/services/__tests__/` |
| Python connector parsing tests | Public | `sdk/python/tests/test_connector_parsing.py` |
| Parsing fixture files | Public | `sdk/python/tests/fixtures/<connector>/` |
| JS SDK tests | Public | `sdk/js/src/index.test.ts` |
| MCP server tests | Public | `sdk/mcp/src/index.test.ts` |
| Live smoke harness | Public | `connectors/tests/smoke_harness.py` |
| Smoke test-route registry | Public | `connectors/test_routes.py` |
| Public CI gate workflow | Public | `.github/workflows/test.yml` |
| Website CI workflow | Private | `.github/workflows/website-ci.yml` |
| Growth-ops CI workflow | Private | `.github/workflows/ci.yml` |
| Quality probes workflow | Private | `.github/workflows/quality-probes.yml` |
| Cloud Build deploy gate | Private | `website/cloudbuild.yaml` |

## Adding tests for a growth-ops service (Adam's guide)

Each growth-ops service in `growth-ops/src/services/` should have a corresponding test file in `growth-ops/src/services/__tests__/<service-name>.test.ts`.

The test runner is `tsx --test`. Add a test:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { myPureFunction } from '../my-service.js';

describe('myPureFunction', () => {
  it('returns expected result for valid input', () => {
    assert.deepEqual(myPureFunction({ foo: 'bar' }), { result: 'baz' });
  });
});
```

Run: `cd growth-ops && npm test`

Keep tests focused on **pure functions** (no I/O). For functions that call the database or external APIs, mock the dependency at the service boundary — or better, extract the pure logic and test that.
