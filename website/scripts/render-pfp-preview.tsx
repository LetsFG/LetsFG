/**
 * render-pfp-preview.tsx — renders FlightPage to a full HTML file for visual preview.
 * Usage: npx tsx scripts/render-pfp-preview.tsx
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { FlightPage } from '../lib/pfp/page/FlightPage.tsx'
import { buildFlightPageHeadHtml } from '../lib/pfp/page/FlightPageHead.ts'
import type { RouteDistributionData } from '../lib/pfp/types/route-distribution.types.ts'

const __dir = dirname(fileURLToPath(import.meta.url))

const data: RouteDistributionData = {
  origin_iata: 'GDN',
  dest_iata: 'BCN',
  origin_city: 'Gdansk',
  dest_city: 'Barcelona',
  snapshot_computed_at: '2026-05-05T10:00:00Z',
  staleness: 'fresh',
  data_confidence: 'high',
  total_offers_analyzed: 180,
  session_count: 24,
  price_distribution: {
    p10: 153, p25: 234, p50: 368, p75: 503, p90: 583, p95: 610,
    min: 100, max: 637,
    histogram: [
      { from: 100, to: 153, count: 12, pct: 6.7 },
      { from: 153, to: 207, count: 28, pct: 15.6 },
      { from: 207, to: 261, count: 41, pct: 22.8 },
      { from: 261, to: 314, count: 35, pct: 19.4 },
      { from: 314, to: 368, count: 22, pct: 12.2 },
      { from: 368, to: 421, count: 16, pct: 8.9 },
      { from: 421, to: 475, count: 11, pct: 6.1 },
      { from: 475, to: 529, count: 8,  pct: 4.4 },
      { from: 529, to: 583, count: 5,  pct: 2.8 },
      { from: 583, to: 637, count: 2,  pct: 1.1 },
    ],
    currency: 'EUR',
    is_bimodal: false,
  },
  fee_analysis: {
    avg_hidden_fees_amount: 32,
    avg_hidden_fees_pct: 0.14,
    fee_variance: 'medium',
    fee_breakdown_available: true,
    breakdown: [
      { carrier: 'Ryanair',         avg_fee: 22, avg_fee_pct: 0.11 },
      { carrier: 'Wizz Air',        avg_fee: 38, avg_fee_pct: 0.17 },
      { carrier: 'easyJet',         avg_fee: 28, avg_fee_pct: 0.12 },
      { carrier: 'LOT Polish',      avg_fee: 15, avg_fee_pct: 0.04 },
      { carrier: 'Lufthansa',       avg_fee: 42, avg_fee_pct: 0.09 },
      { carrier: 'British Airways', avg_fee: 55, avg_fee_pct: 0.10 },
    ],
  },
  carrier_summary: [
    { carrier: 'Ryanair',         offer_count: 42, price_p50: 189, hidden_fees_avg: 22, hidden_fees_pct: 0.11 },
    { carrier: 'Wizz Air',        offer_count: 38, price_p50: 215, hidden_fees_avg: 38, hidden_fees_pct: 0.17 },
    { carrier: 'easyJet',         offer_count: 31, price_p50: 241, hidden_fees_avg: 28, hidden_fees_pct: 0.12 },
    { carrier: 'LOT Polish',      offer_count: 25, price_p50: 298, hidden_fees_avg: 15, hidden_fees_pct: 0.04 },
    { carrier: 'Lufthansa',       offer_count: 24, price_p50: 452, hidden_fees_avg: 42, hidden_fees_pct: 0.09 },
    { carrier: 'British Airways', offer_count: 20, price_p50: 531, hidden_fees_avg: 55, hidden_fees_pct: 0.10 },
  ],
  connector_comparison: [
    { connector_name: 'ryanair_direct',   display_name: 'Ryanair (direct)',  carrier_coverage_type: 'budget_only', offer_count: 42, price_p50: 189, delta_vs_avg_pct: -14.2 },
    { connector_name: 'kiwi_connector',   display_name: 'Kiwi.com',          carrier_coverage_type: 'mixed',       offer_count: 56, price_p50: 231, delta_vs_avg_pct:  -4.5 },
    { connector_name: 'wizzair_direct',   display_name: 'Wizz Air (direct)', carrier_coverage_type: 'budget_only', offer_count: 38, price_p50: 249, delta_vs_avg_pct:   2.1 },
    { connector_name: 'skyscanner_meta',  display_name: 'Skyscanner',        carrier_coverage_type: 'mixed',       offer_count: 61, price_p50: 271, delta_vs_avg_pct:   8.4 },
    { connector_name: 'easyjet_direct',   display_name: 'easyJet (direct)',  carrier_coverage_type: 'budget_only', offer_count: 31, price_p50: 285, delta_vs_avg_pct:  14.1 },
  ],
  tldr: {
    summary: 'GDN → BCN: from EUR 100, median EUR 368, 180 offers analyzed',
    key_facts: [
      'Gdansk–Barcelona is served by 6 airlines with Ryanair offering the lowest median fares.',
      'Budget carriers account for 67% of all offers on this route.',
      'Hidden fees average EUR 32 (14% of base fare) — compare totals before booking.',
    ],
  },
  page_status: 'published',
  is_preview: false,
  session_history: [
    { session_id: 'sess-1', captured_at: '2026-02-10T09:00:00Z', total_offers: 143, median_price: 391, currency: 'EUR', airline_count: 5, connector_count: 11 },
    { session_id: 'sess-2', captured_at: '2026-03-01T10:00:00Z', total_offers: 159, median_price: 378, currency: 'EUR', airline_count: 6, connector_count: 13 },
    { session_id: 'sess-3', captured_at: '2026-03-22T08:00:00Z', total_offers: 167, median_price: 372, currency: 'EUR', airline_count: 6, connector_count: 14 },
    { session_id: 'sess-4', captured_at: '2026-04-15T11:00:00Z', total_offers: 174, median_price: 369, currency: 'EUR', airline_count: 6, connector_count: 15 },
    { session_id: 'sess-5', captured_at: '2026-05-05T10:00:00Z', total_offers: 180, median_price: 368, currency: 'EUR', airline_count: 6, connector_count: 15 },
  ],
}

const body = renderToStaticMarkup(createElement(FlightPage, { data }))
const seoHead = buildFlightPageHeadHtml(data)

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  ${seoHead}
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 16px;
      line-height: 1.6;
      color: #1a1a2e;
      background: #f8f9fc;
    }

    article {
      max-width: 820px;
      margin: 0 auto;
      padding: 0 16px 64px;
    }

    /* ── Hero ── */
    [data-testid="hero"] {
      background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%);
      color: #fff;
      padding: 48px 32px 40px;
      border-radius: 0 0 16px 16px;
      margin: 0 -16px 40px;
    }

    [data-testid="page-h1"] {
      font-size: 2rem;
      font-weight: 800;
      letter-spacing: -0.02em;
      margin-bottom: 12px;
    }

    .tldr-summary {
      font-size: 0.95rem;
      opacity: 0.88;
      max-width: 640px;
      margin-bottom: 24px;
    }

    /* Stats row */
    [data-testid="stats-row"] {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-bottom: 28px;
    }

    [data-testid^="hero-stat-"] {
      background: rgba(255,255,255,0.12);
      border: 1px solid rgba(255,255,255,0.2);
      border-radius: 10px;
      padding: 12px 18px;
    }

    [data-testid^="hero-stat-"] strong {
      display: block;
      font-size: 1.35rem;
      font-weight: 700;
    }

    [data-testid^="hero-stat-"] span {
      font-size: 0.75rem;
      opacity: 0.7;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    /* Primary CTA */
    [data-testid="primary-cta"] {
      display: inline-block;
      background: #f97316;
      color: #fff;
      font-size: 1rem;
      font-weight: 700;
      padding: 14px 28px;
      border-radius: 10px;
      text-decoration: none;
      transition: background 0.15s;
    }
    [data-testid="primary-cta"]:hover { background: #ea6c0b; }

    [data-testid="data-confidence-banner"],
    [data-testid="staleness-banner"],
    [data-testid="preview-banner"] {
      display: inline-block;
      font-size: 0.78rem;
      padding: 4px 10px;
      border-radius: 6px;
      margin-top: 14px;
      margin-right: 8px;
    }
    [data-testid="data-confidence-banner"] { background: #dcfce7; color: #15803d; }
    [data-testid="staleness-banner"]       { background: #fef9c3; color: #854d0e; }
    [data-testid="preview-banner"]         { background: #ede9fe; color: #6d28d9; }

    /* ── Sections ── */
    section {
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      padding: 28px;
      margin-bottom: 24px;
    }

    article > details {
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      padding: 28px;
      margin-bottom: 24px;
    }

    h2 {
      font-size: 1.2rem;
      font-weight: 700;
      color: #0f172a;
      margin-bottom: 16px;
    }

    /* Intro paragraphs */
    [data-testid$="-intro"] {
      color: #64748b;
      font-size: 0.9rem;
      margin-bottom: 14px;
    }

    /* ── Histogram ── */
    [data-testid="histogram-chart"] {
      display: flex;
      align-items: flex-end;
      gap: 4px;
      height: 120px;
      margin: 4px 0 16px;
    }

    [data-testid^="histogram-bucket-"] {
      flex: 1;
      background: #3b82f6;
      border-radius: 4px 4px 0 0;
      position: relative;
      min-height: 8px;
      cursor: default;
    }

    [data-testid^="histogram-bucket-"] span {
      position: absolute;
      bottom: -18px;
      left: 50%;
      transform: translateX(-50%);
      font-size: 0.65rem;
      color: #94a3b8;
      white-space: nowrap;
    }

    [data-testid="histogram-chart"] { padding-bottom: 24px; }

    [data-testid="range-bar"] {
      background: linear-gradient(90deg, #3b82f6, #f97316);
      height: 14px;
      border-radius: 7px;
      margin: 12px 0;
    }

    /* ── Tables ── */
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.88rem;
      margin-top: 8px;
    }

    th {
      background: #f8f9fc;
      color: #64748b;
      font-weight: 600;
      text-align: left;
      padding: 8px 12px;
      border-bottom: 2px solid #e5e7eb;
    }

    td {
      padding: 8px 12px;
      border-bottom: 1px solid #f1f5f9;
      color: #334155;
    }

    tr:last-child td { border-bottom: none; }
    tr:hover td { background: #f8faff; }

    /* ── Key facts ── */
    [data-testid="key-facts-list"] {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    [data-testid^="key-fact-"] {
      padding: 12px 16px;
      background: #f0f9ff;
      border-left: 3px solid #3b82f6;
      border-radius: 0 8px 8px 0;
      font-size: 0.9rem;
      color: #0f172a;
    }

    /* ── FAQ ── */
    dl { display: flex; flex-direction: column; gap: 16px; }

    [data-testid^="faq-item-"] {
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      overflow: hidden;
    }

    dt {
      background: #f8f9fc;
      padding: 14px 16px;
      font-weight: 600;
      font-size: 0.95rem;
      color: #0f172a;
    }

    dd {
      padding: 14px 16px;
      font-size: 0.9rem;
      color: #475569;
      line-height: 1.65;
    }

    /* ── Secondary CTA ── */
    [data-testid="secondary-cta-section"] {
      background: linear-gradient(135deg, #fff7ed, #f0fdf4);
      border: 1px solid #fed7aa;
      text-align: center;
      padding: 36px 28px;
    }

    [data-testid="secondary-cta-section"] h2 {
      font-size: 1.3rem;
      margin-bottom: 20px;
    }

    [data-testid="search-cta-secondary"] {
      display: inline-block;
      background: #f97316;
      color: #fff;
      font-weight: 700;
      padding: 13px 28px;
      border-radius: 10px;
      text-decoration: none;
      margin-bottom: 12px;
    }

    [data-testid="share-button"] {
      display: inline-block;
      background: transparent;
      border: 1px solid #f97316;
      color: #ea6c0b;
      font-weight: 600;
      padding: 13px 24px;
      border-radius: 10px;
      cursor: pointer;
      margin-left: 10px;
      font-size: 0.95rem;
    }

    [data-testid="social-proof"] {
      margin-top: 14px;
      font-size: 0.82rem;
      color: #64748b;
    }

    /* ── Snapshot history ── */
    details summary {
      cursor: pointer;
      font-weight: 600;
      color: #475569;
      font-size: 0.9rem;
    }

    details p { margin-top: 10px; font-size: 0.85rem; color: #94a3b8; }

    /* ── n/a spans ── */
    span[title="Fee data not available"] {
      color: #94a3b8;
      font-style: italic;
    }

    /* ── Percentile markers ── */
    [data-testid="percentile-markers"] {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 8px;
    }

    [data-testid="percentile-markers"] [data-marker] {
      background: #f1f5f9;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 3px 8px;
      font-size: 0.78rem;
      color: #475569;
    }

    [data-marker="p50"] {
      background: #eff6ff !important;
      border-color: #3b82f6 !important;
      color: #1d4ed8 !important;
      font-weight: 600;
    }

    /* ── JSON-LD hidden ── */
    script { display: none; }

    /* ── Bimodal insight ── */
    [data-testid="bimodal-insight"] {
      background: #fef3c7;
      border-left: 3px solid #f59e0b;
      padding: 12px 16px;
      border-radius: 0 8px 8px 0;
      font-size: 0.88rem;
      color: #78350f;
      margin-top: 14px;
    }

    /* ── Connector insight ── */
    [data-testid="connector-insight"] {
      background: #f0fdf4;
      border-left: 3px solid #22c55e;
      padding: 12px 16px;
      border-radius: 0 8px 8px 0;
      font-size: 0.88rem;
      color: #14532d;
      margin-bottom: 14px;
    }
  </style>
</head>
<body>
${body}
<script>
  // Rehydrate histogram bar heights from data-height attribute
  document.querySelectorAll('[data-height]').forEach(el => {
    el.style.height = el.getAttribute('data-height') + '%';
    el.style.minHeight = '8px';
  });
</script>
</body>
</html>`

const outPath = resolve(__dir, '../public/pfp-preview.html')
writeFileSync(outPath, html, 'utf-8')
console.log('Written to', outPath)
