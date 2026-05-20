# Critical-path test suite (Tier 1)

These suites guard the **6-link value chain** that delivers "highest value to every user, every time." They are **deterministic** (no network) and **must be green before anything ships**.

```bash
cd website && npm run test:critical
```

This is the merge gate (enforced in CI — see `.github/workflows/test.yml`). The machine-readable list lives in [`critical-manifest.json`](./critical-manifest.json).

## Why these, mapped to the value chain

| Link | What it protects | Suites |
|------|------------------|--------|
| 1 · Requirement capture | NL/query → structured search (cities, dates, round-trip) | `test:locations`, `test:city-pair-matrix`, `test:round-trip-detection`, `test:flight-datetime` |
| 2 · Connector orchestration | parsing offers correctly (deterministic) | connector parsing tests in `sdk/python` (`pytest -m "not live"`); live = Tier-2 connector-smoke |
| 3 · Offer analysis & recommendation | currency normalization, value vs Google, Q1 quality, PFP quality/distribution | `test:user-currency`, `test:google-comparison`, `test:recommendation-quality`, `test:pfp-quality-gate`, `test:pfp-normalizer`, `test:pfp-distribution-service` |
| 4 · Results / refine / decide | results state recovery + no-result fallback | `test:results-rerun-state`, `test:results-query-fallback` |
| 5 · Unlock + payment | booking-link integrity, unlock experiment, **unlock-token integrity** | `test:booking-url-repair`, `test:checkout-unlock-experiment`, `test:unlock-token` |
| 6 · Measure & improve | ingest pipeline + end-to-end PFP integration | `test:pfp-ingest`, `test:pfp-integration` |

## Rules (per CLAUDE.md TDD / Definition of Done)

- **Adding a critical feature or bug-fix?** Write the test first (Red → Green → Refactor), then add its suite to `critical-manifest.json` **and** the `test:critical` script in `package.json`.
- `test:critical` is a curated subset of the full `npm test`; keep both passing.
- Metrics/scoring tests map to the growth-model variables (see `growth-ops/src/models/growth-model.ts`).

## Pending additions

- On PFP PR merge: add `test:pfp-acquisition`, `test:pfp-neon-adapter`, `test:pfp-llm-rationale`, `test:pfp-offer-highlights`, `test:pfp-trigger`.
- Backlog (see manifest): checkout create-session/verify guard tests; requirement-capture follow-up/disambiguation test.
