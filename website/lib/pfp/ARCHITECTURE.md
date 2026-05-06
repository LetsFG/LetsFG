# Programmatic Flight Pages — Architecture

> Session 1 design document. Describes the data flow, privacy model, and
> content richness model for the PFP feature.

---

## What We Are Building

LetsFG agents search 180+ airlines in parallel on behalf of users. Each search
produces 15–400+ deduplicated offers across every connector — direct airlines,
OTAs, and meta-search aggregators.

Programmatic Flight Pages (PFP) captures this richness automatically and
publishes an SEO page for each route. The page shows:

- **Price distribution** — full histogram of what the market charges today
- **Carrier comparison** — cheapest per airline, with direct vs. OTA price delta
- **Fare class breakdown** — Y/M/L/Q distribution for the route
- **Bimodal insight** — when LCCs and FSCs form two distinct price clusters
- **Connector comparison** — direct airline price vs. OTA vs. meta-search

---

## Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Agent search completes (user-triggered or automated)                        │
│  Engine fires 180+ connectors in parallel via engine.py                      │
│  Returns FlightSearchResponse with 15–400+ deduplicated offers               │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │ FlightSearchResponse (Python)
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  INGEST PIPELINE  (website/lib/pfp/ingest/)                                 │
│                                                                              │
│  1. PII strip + anonymization                                                │
│     • Drop: user_id, email, IP, session cookie, device fingerprint           │
│     • Generate: opaque session_id (UUID v4 or SHA-256 hash of ephemeral data)│
│     • Keep: pax_count, trip_type, cabin_preference, advance_booking_days     │
│                                                                              │
│  2. Normalize to AgentSearchSession (agent-session.types.ts)                │
│     • Map FlightOffer → NormalizedOffer (camelCase, typed, no nulls)         │
│     • Compute SessionPriceStats (min/max/percentiles, hidden fees)           │
│     • Determine or create route in flight_routes                             │
│                                                                              │
│  3. ContentQualityGate  (website/lib/pfp/quality/)  ← Session 2             │
│     • Minimum offer count, carrier diversity, connector count checks         │
│     • Quality score computed → stored in flight_routes.quality_score         │
│     • Gate decision: PASS → continue; FAIL → write audit log, stop          │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │ PASS
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  DISTRIBUTION SERVICE  (website/lib/pfp/distribution/)  ← Session 3         │
│                                                                              │
│  1. Write flight_search_sessions row (anonymized params + price stats)       │
│  2. Write flight_offers_aggregated rows (per carrier × cabin × fare bucket)  │
│  3. Recompute route_distribution_snapshots                                   │
│     • Price histogram (equal-width buckets)                                  │
│     • Carrier summary (cheapest + offer count per airline)                   │
│     • Connector comparison (direct vs. OTA vs. meta price delta)             │
│     • Fare class distribution                                                │
│     • Outlier analysis                                                       │
│     • Bimodal detection (two-peak test on histogram)                         │
│  4. Update flight_routes counters (session_count, total_offers_indexed,      │
│     last_updated_at)                                                         │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PAGE PUBLISHER                                                               │
│                                                                              │
│  First session for route:                                                    │
│    • Set page_status = 'draft'                                               │
│    • Write page_audit_log (action='first_ingest', triggered_by='ingest')    │
│                                                                              │
│  Subsequent sessions:                                                        │
│    • Snapshot refreshed → if quality_score ≥ threshold AND sufficient data: │
│      - Set page_status = 'published'                                         │
│      - Write page_audit_log (action='publish')                               │
│    • If quality degrades below threshold:                                    │
│      - Set page_status = 'noindex'                                           │
│      - Write page_audit_log (action='noindex', reason='quality_score < 0.6')│
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  NEXT.JS PAGE TEMPLATE  (website/app/[locale]/flights/)  ← Session 4        │
│                                                                              │
│  • Reads route_distribution_snapshots at build/ISR time (no JOIN needed)    │
│  • Renders BOFU content: price distribution, carrier table, CTA              │
│  • JSON-LD structured data (FlightOffer schema)  ← Session 5                │
│  • SEO head + sitemap  ← Session 5                                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Privacy Model

### Principle: Aggregate, Not Individual

PFP pages represent **market-level data** about a route, not the search history
of any individual user. The ingest pipeline enforces this at the code level.

### What Is Stripped Before Writing to DB

| Data point | Action |
|------------|--------|
| User account ID | Never written — pipeline receives anonymized batch only |
| Email address | Never written |
| IP address | Never written |
| Browser fingerprint | Never written (`_get_client_fingerprint()` in engine.py is for connector health telemetry, not user tracking) |
| Session cookie / auth token | Never written |
| Search result click-through | Not captured by PFP pipeline |

### What Is Written

| Field | Why it's safe |
|-------|---------------|
| `session_id` | Opaque UUID4, no link to user account or device |
| `search_params.pax_count` | Count only (1–9), no names or identifiers |
| `search_params.trip_type` | 'oneway' or 'return' — aggregate intent signal |
| `search_params.cabin_preference` | 'M'/'W'/'C'/'F'/null — aggregate preference |
| `search_params.advance_booking_days` | Integer, no date that identifies a user |
| `search_params.currency_code` | ISO currency code — locale signal only |

### Audit Log Privacy Note

`page_audit_log.triggered_by` may contain an admin user reference
(`'admin:<user_id>'`) for manual overrides. These are **ops/admin users only**,
never end-users. End-user searches do not appear in the audit log.

---

## The "Single Session Richness" Model

### Why One Session Is Enough to Publish

Traditional programmatic content requires aggregating data from thousands of
searches over days or weeks to have meaningful content. We do not.

A single LetsFG agent search fires **180+ connectors in parallel**:

| Connector type | Example connectors | Typical offers per session |
|----------------|--------------------|---------------------------|
| Direct LCC airline | Ryanair, Wizz Air, EasyJet, Southwest | 2–15 per airline |
| Direct FSC airline | Emirates, Turkish, Finnair, Delta | 1–10 per airline |
| OTAs | Traveloka, eDreams, Booking.com, Despegar | 10–50 each |
| Meta-search | Skyscanner, Kayak, Momondo, Wego | 20–100+ each |
| Virtual interlining | combo_engine.py (cross-airline RT combos) | 5–50 |

**Result: 15–400+ deduplicated offers from a single session.**

This is enough to compute:
- A statistically meaningful price distribution histogram
- Per-carrier cheapest price and availability signal
- Direct vs. OTA vs. meta price delta (the "connector comparison")
- Fare class distribution (Y/M/L/Q bucketed)
- Bimodal detection (LCC cluster vs. FSC cluster)

### Content Advantage vs. Competitors

| Source | Offers per search | Coverage | Price bias |
|--------|-------------------|----------|------------|
| Google Flights | 10–30 | GDS airlines only | Demand-based inflation |
| Kayak/Momondo | 20–80 | OTA + GDS | Markup + cookie tracking |
| LetsFG (single session) | 15–400+ | 180+ airlines direct + OTA + meta | Raw airline price |

The PFP content advantage is: **we show the full market, not a curated subset.**

### Quality Gate Thresholds (Session 2)

These thresholds determine when a session is "rich enough" to update a page:

| Metric | Minimum for `low` confidence | Minimum for `medium` | Minimum for `high` |
|--------|------------------------------|----------------------|--------------------|
| `offer_count` | 5 | 30 | 100 |
| `carrier_count` | 2 | 4 | 8 |
| `connector_count` | 1 | 3 | 5 |
| `session_count` | 1 | 3 | 10 |

A `data_confidence = 'low'` session can still publish a page — it just gets
`page_status = 'draft'` until confidence improves, and the JSON-LD structured
data omits price claims that require `medium` or `high` confidence.

---

## Database Schema Summary

```
flight_routes          ←── root entity, one per directional route
  └── flight_search_sessions   ←── one per anonymized agent search
        └── flight_offers_aggregated  ←── per-carrier/cabin/bucket aggregates
  └── route_distribution_snapshots    ←── pre-computed for page rendering
  └── page_experiments               ←── A/B tests per route
  └── page_audit_log                 ←── immutable audit trail
```

### Key Design Decisions

**`route_distribution_snapshots` is a table, not a PostgreSQL materialized view.**
We need full control over when the snapshot refreshes (after quality gate,
under feature flags, manually by ops). PostgreSQL `REFRESH MATERIALIZED VIEW`
doesn't give us that control.

**`flight_offers_aggregated` stores aggregates, not raw offers.**
Raw offers (15–400 per session) would bloat the DB to millions of rows quickly.
We store only the statistical summary per (carrier × cabin × fare_bucket),
which is all the page template needs for content.

**`page_audit_log` is append-only.**
Every page status transition is logged. This gives ops a full history of why
a page was published, unpublished, or noindexed — essential for debugging SEO
issues and complying with content moderation requirements.

**`session_id` in `flight_search_sessions` is UNIQUE.**
Idempotent ingest — if the same session is submitted twice (retry on failure),
the second write fails gracefully with a duplicate key error. No double-counting.

---

## Directory Structure

```
website/lib/pfp/
├── types/
│   └── agent-session.types.ts      ← This session: normalized TypeScript types
├── db/
│   └── migrations/
│       ├── 001_flight_pages.sql          ← This session: forward migration
│       └── 001_flight_pages_rollback.sql ← This session: rollback
├── ingest/                          ← Session 2: PII strip + AgentSearchSession builder
├── quality/                         ← Session 2: ContentQualityGate
├── distribution/                    ← Session 3: DistributionService + aggregation
└── ARCHITECTURE.md                  ← This file

website/app/[locale]/flights/        ← Session 4: page templates
website/tests/pfp/                   ← Sessions 2–7: test files
```

---

## Sessions Roadmap

| Session | Deliverable | Status |
|---------|-------------|--------|
| 1 (this) | CLAUDE.md, types, migrations, ARCHITECTURE.md | ✅ Done |
| 2 | ContentQualityGate + ingest pipeline (TDD) | Pending |
| 3 | DistributionService + aggregation logic (TDD) | Pending |
| 4 | Page template (Next.js, BOFU-first) | Pending |
| 5 | JSON-LD structured data + SEO head + sitemap | Pending |
| 6 | Analytics taxonomy + GrowthOps + feature flags | Pending |
| 7 | Cron jobs + E2E tests + integration test suite | Pending |
