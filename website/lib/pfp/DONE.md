# Programmatic Flight Pages — DONE

This file marks the completion of the Programmatic Flight Pages (PFP) feature, built across 7 TDD sessions.

## Feature Summary

LetsFG PFP auto-generates SEO-optimized flight route pages from agent search session data.  
Each page shows real price distributions, carrier summaries, and connector comparisons — data no single source provides.

---

## Session Checklist

### Session 1 — Data Models & Quality Gate
- [x] `NormalizedOffer` and `AgentSearchSession` types defined
- [x] `ContentQualityGate` with scoring formula (offerCount, carrierCount, connectorCount, priceCV)
- [x] Hard floor: carrierCount < 2 → always FAIL
- [x] FAIL / CONDITIONAL_PASS (noindex) / PASS (published) outcomes
- [x] 16 tests GREEN

### Session 2 — Offer Normalizer
- [x] `normalizeOffer()` maps raw connector output → `NormalizedOffer`
- [x] Price normalization, currency handling, segment extraction
- [x] 25 tests GREEN

### Session 3 — Distribution Service
- [x] `getRouteDistributionData()` builds `RouteDistributionData` from sessions
- [x] Price histogram (10 equal-width buckets)
- [x] Bimodal detection (peak/valley algorithm, threshold: valleyMin/smallerPeak < 0.30)
- [x] Fee analysis, carrier summary, connector comparison
- [x] TLDR section generation
- [x] 35 tests GREEN

### Session 4 — Page Template
- [x] `FlightPage` React component with all sections
- [x] Hero, price distribution chart, carrier summary, connector comparison, FAQ, CTA
- [x] Bimodal banner (conditional on `is_bimodal`)
- [x] 41 tests GREEN

### Session 5 — SEO Infrastructure
- [x] `generateJsonLd()` — JSON-LD structured data (BreadcrumbList + FAQPage + Product)
- [x] `FlightPageSeoHead` — meta title, description, Open Graph, canonical
- [x] `generateFlightSitemap()` — XML sitemap with chunking at 10,000 routes
- [x] Sitemap priority by `session_count`; change frequency by staleness
- [x] 44 tests GREEN (13 + 13 + 18)

### Session 6 — Analytics & Experiments
- [x] `FlightPageEvents` typed event schema (8 events)
- [x] `createTracker()` factory with injectable `send` — no raw `gtag()` anywhere
- [x] `FlightPageFlags` feature flags (13 flags) with `DEFAULT_FLAGS`
- [x] `EXPERIMENT_HERO_CTA` and `EXPERIMENT_HERO_STAT` hypothesis definitions
- [x] `resolveExperimentContext()` + deterministic bucket hashing
- [x] 25 tests GREEN (11 + 14)

### Session 7 — Cron, Integration & E2E
- [x] `cleanupStaleRoutePages()` — daily cron: archives (90d + low traffic), revalidates (< 7d)
- [x] Idempotent cron (no duplicate audit entries on repeat runs)
- [x] Cron emits `growth_ops_cron_summary` aggregate event
- [x] 10 cron tests GREEN

- [x] Integration test suite: full pipeline (ingest → quality gate → distribution → page status)
- [x] Pipeline tests: thin session stays draft, rich session publishes, dedup, anonymization
- [x] Quality→Distribution tests: field names, bimodal, connector comparison
- [x] Cron→Sitemap tests: archived routes excluded, revalidated lastmod updated
- [x] 15 integration tests GREEN

- [x] `website/playwright.config.ts` — Playwright E2E config (chromium + mobile-safari)
- [x] `website/e2e/flight-pages.spec.ts` — 10 E2E scenarios (H1, distributions, CTAs, SEO, JSON-LD, locale)
- [x] `lighthouserc.js` — Lighthouse CI budgets (LCP < 2.0s, CLS < 0.1, FCP < 1.5s, JS < 150KB)

---

## Test Count Summary

| Session | Module | Tests |
|---------|--------|-------|
| 1 | ContentQualityGate | 16 |
| 2 | Normalizer | 25 |
| 3 | DistributionService | 35 |
| 4 | FlightPage template | 41 |
| 5 | JSON-LD + SEO head + Sitemap | 44 |
| 6 | Tracker + ExperimentContext | 25 |
| 7 (cron) | cleanupStaleRoutePages | 10 |
| 7 (integration) | End-to-end pipeline | 15 |
| **Total** | | **211 PFP** |

Plus 46 pre-existing website tests = **257 total** (all GREEN).

---

## How to Run

```bash
# Unit + integration tests (257 total)
cd website && npm test

# E2E tests (requires running server + Playwright installed)
cd website && npm install --save-dev @playwright/test && npx playwright install
npx playwright test

# Lighthouse CI (requires running server + @lhci/cli installed)
npm install -g @lhci/cli
npx lhci autorun
```

---

## Key Design Decisions

1. **Injectable dependencies everywhere** — DB, revalidation, emit, now() — enables pure in-memory testing with zero mocking framework.
2. **No API key required for search** — all 180+ airline connectors run locally via Python + Playwright.
3. **Zero price bias** — raw airline prices, no demand tracking or surge pricing.
4. **Quality gate before publish** — 3-tier outcome (FAIL/noindex/published) with score threshold 0.65.
5. **Idempotency by design** — session_id dedup, cron audit log dedup, idempotency keys for bookings.
6. **Bimodal detection** — editorial value: surfaces LCC vs FSC fare clusters automatically.
