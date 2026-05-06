# PFP — Programmatic Flight Pages

## Overview

PFP generates static SEO-optimised landing pages for flight routes (e.g. `/en/flights/gdn-bcn/`).

Each page is powered by a **snapshot** — a pre-computed statistical summary of flight offers captured by LetsFG's 180+ airline connectors. Pages render instantly via Next.js ISR (`revalidate = 86400`) and are designed to rank for long-tail queries like *"Gdansk to Barcelona cheap flights"*.

---

## Directory Structure

```
website/lib/pfp/
├── types/
│   └── route-distribution.types.ts    ← TypeScript interfaces for all page data
├── page/
│   ├── FlightPage.tsx                  ← Main React page template (all sections)
│   └── FlightPageHead.ts               ← String-based head builder for preview/tests
├── seo/
│   └── FlightPageSEOHead.tsx           ← React component for <head> SEO tags
├── quality/
│   └── quality-gate.ts                 ← Data quality checks before page is published
├── distribution/
│   └── route-distribution.ts           ← JSON snapshot load / cache / fallback
├── analytics/
│   └── pfp-analytics.ts               ← Typed event tracking (impression, CTA click)
└── experiments/
    └── pfp-experiments.ts             ← Experiment flag helpers
```

App Router page:
```
website/app/[locale]/flights/[route]/page.tsx   ← generateMetadata() + FlightRoutePage
website/app/[locale]/flights/methodology/page.tsx ← E-E-A-T methodology explanation
```

---

## Data Flow

```
[Agent search session]
        │
        ▼
1. Route snapshot written as JSON (RouteDistributionData)
        │
        ▼
2. Quality gate checks minimum requirements:
   • At least 1 price bucket  •  At least 3 offers captured
   • Has origin/dest metadata
        │
        ▼
3. Snapshot served via route-distribution.ts (ISR cache, 24h revalidate)
        │
        ▼
4. FlightRoutePage renders FlightPage.tsx + FlightPageHead.ts / FlightPageSEOHead.tsx
        │
        ▼
5. Next.js sends pre-rendered HTML + JSON-LD to browser
```

---

## Key Types (`route-distribution.types.ts`)

| Type | Purpose |
|------|---------|
| `RouteDistributionData` | Root snapshot object (origin, dest, price buckets, connectors, FAQ source data, related routes) |
| `PriceBucket` | One price histogram bar (`low`, `mid`, `high`, `label`, `count`) |
| `ConnectorComparison` | One row in the connector table (`display_name`, `type`, `offer_count`, `price_p50`, `delta_vs_avg_pct`) |
| `RelatedRoute` | Internal linking target (`origin_iata`, `dest_iata`, `origin_city`, `dest_city`, `median_price?`, `currency?`) |
| `FlightPageSeoHead` | SEO head data (title, description, route slug, locale) |

---

## Page Sections (FlightPage.tsx)

| # | Section | Data source | `data-testid` |
|---|---------|-------------|--------------|
| 1 | Hero | `origin_city`, `dest_city`, `median_price` | `flight-page-hero` |
| 2 | Price histogram | `price_buckets` | `price-histogram` |
| 3 | Fee analysis | `avg_fee_eur`, `fee_breakdown` | `fee-analysis-section` |
| 4 | Connector comparison | `connector_comparison` (≥2 connectors) | `connector-comparison-section` |
| 5 | Best booking day | `booking_day_analysis` | `best-day-section` |
| 6 | Seasonal trends | `seasonal_trend` | `seasonal-section` |
| 7 | Key facts | built from various fields | `key-facts-section` |
| 8 | Related routes | `related_routes` (optional) | `related-routes-section` |
| 9 | FAQ | `faqs` or auto-generated | `faq-section` |
| 10 | Secondary CTA | static | `secondary-cta-section` |
| 11 | Snapshot history | `snapshot_history` (≥3 sessions) | `snapshot-history-section` |

---

## SEO Architecture

### Structured Data (JSON-LD)

Three schemas injected in `<head>`:
- **`FlightRoute`** — Custom schema for the route itself (origin, destination, prices)
- **`FAQPage`** — 5 data-driven Q&A pairs targeting long-tail voice/featured snippet queries
- **`BreadcrumbList`** — Home › Flights › GDN–BCN path

### Tags

- `og:type = article`, `og:image` (1200×630 static `/og/flights.png`)
- `twitter:card = summary_large_image`
- `<meta name="author" content="LetsFG">`

### Hreflang

All 11 supported locales declared on every page:  
`en, pl, de, es, fr, it, pt, nl, sq, hr, sv` + `x-default → en`

**Note:** Only `en` has live content today. Other locale pages will 404 until translated content is published. The hreflang infrastructure is ready.

### Canonical

```
https://letsfg.co/{locale}/flights/{route}/
```

---

## E-E-A-T Strategy

- **Experience/Expertise:** Methodology page at `/flights/methodology/` explains how data is collected.
- **Authoritativeness:** `og:site_name`, `twitter:site`, `<meta name="author">` all signal `LetsFG`.
- **Trustworthiness:** Legal disclaimer on connector comparison table; E-E-A-T attribution paragraph in hero; data freshness labels.
- **Article schema:** `itemScope itemType="https://schema.org/Article"` on the root `<article>` element.

---

## Testing

Tests live in `website/tests/pfp/`. Run:

```bash
cd website && npm test
```

Test files:
- `tests/pfp/flight-page.test.tsx` — Full page render, all section visibility, edge cases
- `tests/pfp/seo/seo-head.test.tsx` — SEO head component, JSON-LD validity
- `tests/pfp/quality/quality-gate.test.ts` — Quality gate logic
- `tests/pfp/distribution/route-distribution.test.ts` — Snapshot load/cache

All tests use Node.js native test runner (`tsx --test`). No Jest.

---

## How to Add a New Route

1. Run a LetsFG agent search for the route to generate a snapshot JSON.
2. Pass the snapshot through the quality gate (`runQualityGate(data)`).
3. If it passes, write the snapshot to the distribution layer (`saveSnapshot(routeSlug, data)`).
4. The Next.js ISR page will be generated on first request and cached for 24h.

To pre-generate:
```bash
cd website && npx tsx scripts/render-pfp-preview.tsx
```

---

## Feature Flags

All PFP features are gated via `website/lib/flags.ts` (see that file for the full list). To disable PFP globally set `PFP_ENABLED=false` in your environment.

---

## Configuration

| Env var | Default | Purpose |
|---------|---------|---------|
| `NEXT_PUBLIC_SITE_URL` | `https://letsfg.co` | Base URL for canonical, OG, hreflang |
| `PFP_ENABLED` | `true` | Feature flag — set to `false` to disable all PFP pages |
| `PFP_ISR_REVALIDATE` | `86400` | ISR revalidation window (seconds) |
