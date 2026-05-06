/**
 * flight-page.test.tsx — component tests for FlightPage.
 *
 * Strategy: renderToStaticMarkup() produces a plain HTML string.
 * We assert structural invariants (tab order, section order, conditional
 * rendering) without a browser or DOM.  All tests are synchronous.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import { createElement } from 'react'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const __dir = dirname(fileURLToPath(import.meta.url))

import { FlightPage } from '../../../lib/pfp/page/FlightPage.tsx'
import { buildFlightPageHeadHtml } from '../../../lib/pfp/page/FlightPageHead.ts'
import type { RouteDistributionData } from '../../../lib/pfp/types/route-distribution.types.ts'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_DATA: RouteDistributionData = {
  origin_iata: 'GDN',
  dest_iata: 'BCN',
  origin_city: 'Gdansk',
  dest_city: 'Barcelona',
  snapshot_computed_at: '2026-05-05T10:00:00Z',
  staleness: 'fresh',
  data_confidence: 'high',
  total_offers_analyzed: 180,
  session_count: 3,
  price_distribution: {
    p10: 153, p25: 234, p50: 368, p75: 503, p90: 583, p95: 610,
    min: 100, max: 637,
    histogram: Array.from({ length: 10 }, (_, i) => ({
      from: Math.round(100 + i * 53.7),
      to: Math.round(100 + (i + 1) * 53.7),
      count: 18,
      pct: 10,
    })),
    currency: 'EUR',
    is_bimodal: false,
  },
  fee_analysis: {
    avg_hidden_fees_amount: null,
    avg_hidden_fees_pct: null,
    fee_variance: 'low',
    fee_breakdown_available: false,
  },
  carrier_summary: [
    { carrier: 'FR', offer_count: 30, price_p50: 200, hidden_fees_avg: null, hidden_fees_pct: null },
    { carrier: 'W6', offer_count: 30, price_p50: 220, hidden_fees_avg: null, hidden_fees_pct: null },
    { carrier: 'U2', offer_count: 30, price_p50: 240, hidden_fees_avg: null, hidden_fees_pct: null },
    { carrier: 'LO', offer_count: 30, price_p50: 350, hidden_fees_avg: null, hidden_fees_pct: null },
    { carrier: 'LH', offer_count: 30, price_p50: 450, hidden_fees_avg: null, hidden_fees_pct: null },
    { carrier: 'BA', offer_count: 30, price_p50: 550, hidden_fees_avg: null, hidden_fees_pct: null },
  ],
  connector_comparison: [
    { connector_name: 'ryanair_direct', display_name: 'Ryanair (direct)', carrier_coverage_type: 'budget_only', offer_count: 36, price_p50: 200, delta_vs_avg_pct: -12.3 },
    { connector_name: 'wizzair_direct', display_name: 'Wizz Air (direct)', carrier_coverage_type: 'budget_only', offer_count: 36, price_p50: 250, delta_vs_avg_pct: 3.2 },
    { connector_name: 'easyjet_direct', display_name: 'easyJet (direct)', carrier_coverage_type: 'budget_only', offer_count: 36, price_p50: 280, delta_vs_avg_pct: 8.5 },
    { connector_name: 'skyscanner_meta', display_name: 'Skyscanner', carrier_coverage_type: 'mixed', offer_count: 36, price_p50: 300, delta_vs_avg_pct: 12.1 },
    { connector_name: 'kiwi_connector', display_name: 'Kiwi.com', carrier_coverage_type: 'mixed', offer_count: 36, price_p50: 250, delta_vs_avg_pct: 3.2 },
  ],
  tldr: {
    summary: 'GDN → BCN: from EUR 100, median EUR 368, 180 offers analyzed',
    key_facts: [
      'Cheapest fare: EUR 100 on 2026-06-15',
      '180 offers analyzed as of 2026-05-05',
      'Median price: EUR 368 (updated 2026-05-05)',
    ],
  },
  page_status: 'published',
  is_preview: true,
}

const BIMODAL_DATA: RouteDistributionData = {
  ...BASE_DATA,
  price_distribution: {
    ...BASE_DATA.price_distribution,
    is_bimodal: true,
    bimodal_insight: 'Two fare clusters: budget fares around EUR 850 and premium fares around EUR 3100',
  },
}

const LOW_CONF_DATA: RouteDistributionData = {
  ...BASE_DATA,
  data_confidence: 'low',
  total_offers_analyzed: 12,
  price_distribution: {
    ...BASE_DATA.price_distribution,
    histogram: [{ from: 89, to: 199, count: 12, pct: 100 }],
  },
}

const STALE_NOINDEX_DATA: RouteDistributionData = {
  ...BASE_DATA,
  staleness: 'stale',
  page_status: 'noindex',
}

const WITH_FEES_DATA: RouteDistributionData = {
  ...BASE_DATA,
  fee_analysis: {
    avg_hidden_fees_amount: 35,
    avg_hidden_fees_pct: 0.15,
    fee_variance: 'medium',
    fee_breakdown_available: true,
    breakdown: [
      { carrier: 'FR', avg_fee: 25, avg_fee_pct: 0.12 },
      { carrier: 'W6', avg_fee: 45, avg_fee_pct: 0.19 },
    ],
  },
}

const SINGLE_CARRIER_DATA: RouteDistributionData = {
  ...BASE_DATA,
  carrier_summary: [
    { carrier: 'FR', offer_count: 30, price_p50: 200, hidden_fees_avg: null, hidden_fees_pct: null },
  ],
}

const SINGLE_CONN_DATA: RouteDistributionData = {
  ...BASE_DATA,
  connector_comparison: [
    { connector_name: 'ryanair_direct', display_name: 'Ryanair (direct)', carrier_coverage_type: 'budget_only', offer_count: 36, price_p50: 200, delta_vs_avg_pct: 0 },
  ],
}

// Named-carrier fee data matching the render-preview fixture (for key-facts + fee insight tests)
const WITH_FULL_FEES_DATA: RouteDistributionData = {
  ...BASE_DATA,
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
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function render(data: RouteDistributionData, variant: 'A' | 'B' | 'C' = 'A'): string {
  return renderToStaticMarkup(createElement(FlightPage, { data, experimentVariant: variant }))
}

/** Renders the complete HTML document (head + body) for full-page SEO tests. */
function renderFullHtml(data: RouteDistributionData): string {
  const bodyHtml = renderToStaticMarkup(createElement(FlightPage, { data }))
  const headHtml = buildFlightPageHeadHtml(data)
  return `<!DOCTYPE html><html lang="en"><head>${headHtml}</head><body>${bodyHtml}</body></html>`
}

/** Extracts <head> content string from full HTML. */
function extractHead(fullHtml: string): string {
  return fullHtml.match(/<head[^>]*>([\s\S]*?)<\/head>/)?.[1] ?? ''
}

/** Extracts <body> content string from full HTML. */
function extractBody(fullHtml: string): string {
  return fullHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1] ?? ''
}

/** Parses the JSON-LD @graph from full HTML head. */
function extractJsonLdGraph(fullHtml: string): Array<Record<string, unknown>> {
  const head = extractHead(fullHtml)
  const match = head.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)
  if (!match) return []
  const parsed = JSON.parse(match[1]!) as Record<string, unknown>
  return (parsed['@graph'] as Array<Record<string, unknown>>) ?? []
}

// ─── 1. CTA is first interactive element (DOM tab order) ─────────────────────

test('CTA is the first interactive element (link/button) in DOM tab order', () => {
  const html = render(BASE_DATA)
  const firstAIdx = html.indexOf('<a ')
  const ctaMarkerIdx = html.indexOf('data-testid="primary-cta"')
  // Find the opening <a tag that contains the CTA marker
  const ctaTagStart = html.lastIndexOf('<a ', ctaMarkerIdx)
  assert.ok(ctaMarkerIdx >= 0, 'primary-cta should be in the rendered output')
  assert.equal(
    firstAIdx,
    ctaTagStart,
    `primary-cta should be the first <a> in the DOM (firstA at ${firstAIdx}, ctaTag at ${ctaTagStart})`
  )
})

// ─── 2. CTA is above fold (structural proxy: before any other content section) ─

test('CTA appears in hero section before any content sections (above-fold proxy)', () => {
  const html = render(BASE_DATA)
  const ctaPos = html.indexOf('data-testid="primary-cta"')
  const priceDistPos = html.indexOf('data-testid="price-distribution-section"')
  assert.ok(ctaPos > 0, 'CTA should be in the rendered output')
  assert.ok(priceDistPos > 0, 'Price distribution section should be in the rendered output')
  assert.ok(ctaPos < priceDistPos, 'CTA should appear before price distribution section')
})

test('CTA is inside the hero section', () => {
  const html = render(BASE_DATA)
  const heroStart = html.indexOf('data-testid="hero"')
  const heroEnd = html.indexOf('data-testid="price-distribution-section"')
  const ctaPos = html.indexOf('data-testid="primary-cta"')
  assert.ok(ctaPos > heroStart, 'CTA should be inside hero section')
  assert.ok(ctaPos < heroEnd, 'CTA should be before price distribution section')
})

// ─── 3. TLDR summary is first text element after H1 ──────────────────────────

test('TLDR summary is the first element after H1', () => {
  const html = render(BASE_DATA)
  const h1EndPos = html.indexOf('</h1>') + '</h1>'.length
  assert.ok(h1EndPos > 5, 'H1 should be in the output')
  const afterH1 = html.slice(h1EndPos, h1EndPos + 60)
  assert.ok(
    afterH1.startsWith('<p ') && afterH1.includes('tldr-summary'),
    `First element after H1 should be TLDR summary p, got: "${afterH1}"`
  )
})

test('TLDR summary contains city names and offer count', () => {
  const html = render(BASE_DATA)
  const tldrPos = html.indexOf('data-testid="tldr-summary"')
  const tldrEnd = html.indexOf('</p>', tldrPos)
  const tldrContent = html.slice(tldrPos, tldrEnd)
  assert.ok(tldrContent.includes('Gdansk'), 'TLDR should contain origin city Gdansk')
  assert.ok(tldrContent.includes('Barcelona'), 'TLDR should contain dest city Barcelona')
  assert.ok(tldrContent.includes('180'), 'TLDR should contain offer count 180')
})

// ─── 4. Price histogram renders for high/medium confidence ───────────────────

test('price histogram renders when data_confidence is "high"', () => {
  const html = render(BASE_DATA) // data_confidence: 'high'
  assert.ok(
    html.includes('data-testid="price-histogram"'),
    'Histogram should render for high confidence'
  )
  assert.ok(
    !html.includes('data-testid="price-range-bar"'),
    'Range bar should NOT render for high confidence'
  )
})

test('price histogram renders when data_confidence is "medium"', () => {
  const medData: RouteDistributionData = { ...BASE_DATA, data_confidence: 'medium' }
  const html = render(medData)
  assert.ok(html.includes('data-testid="price-histogram"'), 'Histogram should render for medium confidence')
})

test('percentile markers are present in histogram section', () => {
  const html = render(BASE_DATA)
  assert.ok(html.includes('data-marker="p10"'), 'P10 marker should be present')
  assert.ok(html.includes('data-marker="p50"'), 'P50 marker should be present')
  assert.ok(html.includes('data-marker="p90"'), 'P90 marker should be present')
})

// ─── 5. Range bar renders for low confidence ─────────────────────────────────

test('range bar renders when data_confidence is "low"', () => {
  const html = render(LOW_CONF_DATA)
  assert.ok(
    html.includes('data-testid="price-range-bar"'),
    'Range bar should render for low confidence'
  )
  assert.ok(
    !html.includes('data-testid="price-histogram"'),
    'Histogram should NOT render for low confidence'
  )
})

test('low confidence warning banner renders when data_confidence is "low"', () => {
  const html = render(LOW_CONF_DATA)
  assert.ok(html.includes('data-testid="low-confidence-warning"'))
})

// ─── 6. Bimodal insight banner ────────────────────────────────────────────────

test('bimodal insight banner renders when is_bimodal is true', () => {
  const html = render(BIMODAL_DATA)
  assert.ok(
    html.includes('data-testid="bimodal-banner"'),
    'Bimodal banner should render when is_bimodal is true'
  )
  assert.ok(
    html.includes('EUR 850'),
    'Bimodal banner should contain the bimodal_insight text'
  )
})

test('bimodal banner does NOT render when is_bimodal is false', () => {
  const html = render(BASE_DATA)
  assert.ok(
    !html.includes('data-testid="bimodal-banner"'),
    'Bimodal banner should NOT render when is_bimodal is false'
  )
})

// ─── 7. Noindex meta tag ──────────────────────────────────────────────────────

test('noindex meta tag renders when page_status is "noindex"', () => {
  const html = render(STALE_NOINDEX_DATA)
  assert.ok(
    html.includes('data-testid="noindex-meta"'),
    'Noindex meta should be in rendered output for noindex status'
  )
  assert.ok(
    html.includes('content="noindex'),
    'Meta content should indicate noindex'
  )
})

test('noindex meta is absent for published pages', () => {
  const html = render(BASE_DATA) // page_status: 'published'
  assert.ok(
    !html.includes('data-testid="noindex-meta"'),
    'Noindex meta should NOT render for published pages'
  )
})

test('noindex meta renders when page_status is "archived"', () => {
  const archivedData: RouteDistributionData = { ...BASE_DATA, page_status: 'archived' }
  const html = render(archivedData)
  assert.ok(html.includes('data-testid="noindex-meta"'))
})

// ─── 8. Stale data warning ────────────────────────────────────────────────────

test('stale warning renders when staleness is "stale"', () => {
  const html = render(STALE_NOINDEX_DATA)
  assert.ok(
    html.includes('data-testid="stale-warning"'),
    'Stale warning should render when staleness is stale'
  )
})

test('stale warning does NOT render when staleness is "fresh"', () => {
  const html = render(BASE_DATA) // staleness: 'fresh'
  assert.ok(
    !html.includes('data-testid="stale-warning"'),
    'Stale warning should NOT render for fresh data'
  )
})

test('stale warning does NOT render when staleness is "recent"', () => {
  const recentData: RouteDistributionData = { ...BASE_DATA, staleness: 'recent' }
  const html = render(recentData)
  assert.ok(!html.includes('data-testid="stale-warning"'))
})

// ─── 9. Carrier table: conditional rendering ─────────────────────────────────

test('carrier table renders when carrier_summary.length >= 2', () => {
  const html = render(BASE_DATA) // 6 carriers
  assert.ok(
    html.includes('data-testid="carrier-comparison-section"'),
    'Carrier section should render with 6 carriers'
  )
  assert.ok(html.includes('data-testid="carrier-table"'))
})

test('carrier table does NOT render when carrier_summary.length < 2', () => {
  const html = render(SINGLE_CARRIER_DATA) // 1 carrier
  assert.ok(
    !html.includes('data-testid="carrier-comparison-section"'),
    'Carrier section should NOT render with only 1 carrier'
  )
})

// ─── 10. Connector comparison: conditional rendering ─────────────────────────

test('connector comparison renders when connector_comparison.length >= 2', () => {
  const html = render(BASE_DATA) // 5 connectors
  assert.ok(
    html.includes('data-testid="connector-comparison-section"'),
    'Connector section should render with 5 connectors'
  )
  assert.ok(html.includes('data-testid="connector-table"'))
})

test('connector comparison does NOT render when connector_comparison.length < 2', () => {
  const html = render(SINGLE_CONN_DATA) // 1 connector
  assert.ok(
    !html.includes('data-testid="connector-comparison-section"'),
    'Connector section should NOT render with only 1 connector'
  )
})

test('connector insight names the cheapest connector', () => {
  const html = render(BASE_DATA)
  const insightPos = html.indexOf('data-testid="connector-insight"')
  const insightEnd = html.indexOf('</p>', insightPos)
  const insight = html.slice(insightPos, insightEnd)
  assert.ok(
    insight.includes('Ryanair'),
    `Connector insight should name cheapest connector (display name), got: "${insight}"`
  )
})

// ─── 11. Fee breakdown table ──────────────────────────────────────────────────

test('fee breakdown table renders when fee_breakdown_available is true', () => {
  const html = render(WITH_FEES_DATA)
  assert.ok(
    html.includes('data-testid="fee-breakdown-table"'),
    'Fee breakdown table should render when available'
  )
})

test('fee breakdown table does NOT render when fee_breakdown_available is false', () => {
  const html = render(BASE_DATA) // fee_breakdown_available: false
  assert.ok(
    !html.includes('data-testid="fee-breakdown-table"'),
    'Fee breakdown table should NOT render when not available'
  )
})

test('fee-no-data message renders when fee_breakdown_available is false', () => {
  const html = render(BASE_DATA)
  assert.ok(html.includes('data-testid="fee-no-data"'))
})

// ─── 12. Share button UTM params ──────────────────────────────────────────────

test('share button has correct UTM params in data-share-url', () => {
  const html = render(BASE_DATA)
  const sharePos = html.indexOf('data-testid="share-button"')
  assert.ok(sharePos >= 0, 'Share button should be in rendered output')
  // Find the surrounding tag
  const tagStart = html.lastIndexOf('<', sharePos)
  const tagEnd = html.indexOf('>', tagStart)
  const shareTag = html.slice(tagStart, tagEnd + 1)
  assert.ok(
    shareTag.includes('utm_source=share'),
    `Share button should have utm_source=share, got tag: "${shareTag}"`
  )
  assert.ok(
    shareTag.includes('utm_medium=flightpage'),
    `Share button should have utm_medium=flightpage`
  )
})

test('share URL includes the route (origin and dest IATA)', () => {
  const html = render(BASE_DATA)
  const sharePos = html.indexOf('data-testid="share-button"')
  const tagStart = html.lastIndexOf('<', sharePos)
  const tagEnd = html.indexOf('>', tagStart)
  const shareTag = html.slice(tagStart, tagEnd + 1)
  assert.ok(
    shareTag.toLowerCase().includes('gdn') || shareTag.toLowerCase().includes('bcn'),
    `Share URL should include route IATA codes, got: "${shareTag}"`
  )
})

// ─── 13–15. Experiment variants ───────────────────────────────────────────────

test('experiment variant A: hero stat shows price range', () => {
  const html = render(BASE_DATA, 'A')
  assert.ok(
    html.includes('data-testid="hero-stat-price-range"'),
    'Variant A should show price range hero stat'
  )
  // CTA text contains "see your price"
  const ctaPos = html.indexOf('data-testid="primary-cta"')
  const ctaEnd = html.indexOf('</a>', ctaPos)
  const ctaHtml = html.slice(ctaPos, ctaEnd)
  assert.ok(ctaHtml.includes('see your price'), `Variant A CTA should contain 'see your price', got: "${ctaHtml}"`)
})

test('experiment variant B: hero stat shows hidden fees info', () => {
  const html = render(BASE_DATA, 'B')
  assert.ok(
    html.includes('data-testid="hero-stat-fees"'),
    'Variant B should show fees hero stat'
  )
  const ctaPos = html.indexOf('data-testid="primary-cta"')
  const ctaEnd = html.indexOf('</a>', ctaPos)
  const ctaHtml = html.slice(ctaPos, ctaEnd)
  assert.ok(ctaHtml.includes('hidden fees'), `Variant B CTA should mention 'hidden fees', got: "${ctaHtml}"`)
})

test('experiment variant C: hero stat shows carrier count', () => {
  const html = render(BASE_DATA, 'C')
  assert.ok(
    html.includes('data-testid="hero-stat-carrier-count"'),
    'Variant C should show carrier count hero stat'
  )
  const ctaPos = html.indexOf('data-testid="primary-cta"')
  const ctaEnd = html.indexOf('</a>', ctaPos)
  const ctaHtml = html.slice(ctaPos, ctaEnd)
  assert.ok(ctaHtml.includes('airlines'), `Variant C CTA should mention 'airlines', got: "${ctaHtml}"`)
  assert.ok(ctaHtml.includes('6'), `Variant C CTA should contain carrier count '6', got: "${ctaHtml}"`)
})

// ─── 16. Images have required attributes ─────────────────────────────────────

test('all images have alt, width, and height attributes', () => {
  const html = render(BASE_DATA)
  const imgRegex = /<img\s[^>]+>/gi
  const images = html.match(imgRegex) ?? []
  for (const img of images) {
    assert.ok(
      img.includes(' alt="') || img.includes(" alt='"),
      `img missing alt attribute: ${img}`
    )
    assert.ok(
      img.includes(' width='),
      `img missing width attribute: ${img}`
    )
    assert.ok(
      img.includes(' height='),
      `img missing height attribute: ${img}`
    )
  }
  // Carrier logos have been removed (Fix 16) — remaining images (if any) must have required attrs
  // No assertion on image count since carrier logos are now text-only
})

// ─── 17. FAQ answers contain actual data values ───────────────────────────────

test('FAQ section renders at least 5 questions', () => {
  const html = render(BASE_DATA)
  const faqSection = html.slice(html.indexOf('data-testid="faq-section"'))
  const questionCount = (faqSection.match(/data-testid="faq-q-\d+"/g) ?? []).length
  assert.ok(questionCount >= 5, `FAQ should have at least 5 questions, got ${questionCount}`)
})

test('FAQ answers contain actual data values (not placeholder strings)', () => {
  const html = render(BASE_DATA)
  const faqStart = html.indexOf('data-testid="faq-section"')
  const faqEnd = html.indexOf('</section>', faqStart)
  const faqContent = html.slice(faqStart, faqEnd)

  // Q1 answer should contain actual prices from BASE_DATA
  assert.ok(faqContent.includes('100'), 'FAQ should contain min price (100)')
  assert.ok(faqContent.includes('368'), 'FAQ should contain median price (368)')

  // Must contain city names (not IATA codes in answers)
  assert.ok(faqContent.includes('Gdansk'), 'FAQ should contain origin city Gdansk')
  assert.ok(faqContent.includes('Barcelona'), 'FAQ should contain dest city Barcelona')

  // Must NOT have unfilled placeholders
  assert.ok(!faqContent.includes('[Origin]'), 'FAQ should not contain [Origin] placeholder')
  assert.ok(!faqContent.includes('[Dest]'), 'FAQ should not contain [Dest] placeholder')
  assert.ok(!faqContent.includes('{origin}'), 'FAQ should not contain {origin} placeholder')
})

test('FAQ Q4 (connector) names the cheapest connector', () => {
  const html = render(BASE_DATA)
  const q3Pos = html.indexOf('data-testid="faq-a-3"')
  const q3End = html.indexOf('</dd>', q3Pos)
  const q3Content = html.slice(q3Pos, q3End)
  assert.ok(
    q3Content.includes('Ryanair'),
    `FAQ Q4 answer should name cheapest connector (display name), got: "${q3Content}"`
  )
})

// ─── 18. Section structure ────────────────────────────────────────────────────

test('key facts list renders exactly 3 items', () => {
  const html = render(BASE_DATA)
  const factsSection = html.slice(
    html.indexOf('data-testid="key-facts-section"'),
    html.indexOf('data-testid="faq-section"')
  )
  const itemCount = (factsSection.match(/data-testid="key-fact-\d+"/g) ?? []).length
  assert.equal(itemCount, 3, `Expected exactly 3 key facts, got ${itemCount}`)
})

test('disclaimer text is present in hero section', () => {
  const html = render(BASE_DATA)
  assert.ok(html.includes('data-testid="disclaimer"'))
  assert.ok(
    html.includes('Preview snapshot'),
    'Disclaimer should contain "Preview snapshot" text'
  )
})

test('secondary CTA block renders with social proof', () => {
  const highSessionData: RouteDistributionData = { ...BASE_DATA, session_count: 20 }
  const html = render(highSessionData)
  assert.ok(html.includes('data-testid="secondary-cta-section"'))
  assert.ok(html.includes('data-testid="social-proof"'))
  const socialPos = html.indexOf('data-testid="social-proof"')
  const socialEnd = html.indexOf('</p>', socialPos)
  const socialContent = html.slice(socialPos, socialEnd)
  assert.ok(socialContent.includes('20'), 'Social proof should contain session_count (20) when >= 10')
})

test('snapshot history renders as collapsible details element', () => {
  const html = render(BASE_DATA)
  assert.ok(html.includes('data-testid="snapshot-history"'))
  // Should be inside a <details> element (collapsible)
  const detailsPos = html.lastIndexOf('<details', html.indexOf('data-testid="snapshot-history"'))
  assert.ok(detailsPos >= 0, 'Snapshot history should be inside a <details> element')
})

test('snapshot footer text is present', () => {
  const html = render(BASE_DATA)
  assert.ok(html.includes('data-testid="snapshot-footer"'))
  const footerPos = html.indexOf('data-testid="snapshot-footer"')
  const footerEnd = html.indexOf('</p>', footerPos)
  const footerText = html.slice(footerPos, footerEnd)
  assert.ok(
    footerText.includes('agent search'),
    'Snapshot footer should mention agent search'
  )
})

// ─── 19. Section ordering ────────────────────────────────────────────────────

test('page sections appear in correct order (hero → price → fees → carriers → connectors → facts → faq → secondary CTA)', () => {
  const html = render(BASE_DATA)
  const heroPos = html.indexOf('data-testid="hero"')
  const pricePos = html.indexOf('data-testid="price-distribution-section"')
  const feePos = html.indexOf('data-testid="fee-analysis-section"')
  const carrierPos = html.indexOf('data-testid="carrier-comparison-section"')
  const connectorPos = html.indexOf('data-testid="connector-comparison-section"')
  const factsPos = html.indexOf('data-testid="key-facts-section"')
  const faqPos = html.indexOf('data-testid="faq-section"')
  const secondaryCtaPos = html.indexOf('data-testid="secondary-cta-section"')

  assert.ok(heroPos < pricePos, 'hero before price distribution')
  assert.ok(pricePos < feePos, 'price distribution before fees')
  assert.ok(feePos < carrierPos, 'fees before carriers')
  assert.ok(carrierPos < connectorPos, 'carriers before connectors')
  assert.ok(connectorPos < factsPos, 'connectors before key facts')
  assert.ok(factsPos < faqPos, 'key facts before FAQ')
  assert.ok(faqPos < secondaryCtaPos, 'FAQ before secondary CTA')
})

// ─── GROUP 1 — GEO TEXT STRUCTURE ────────────────────────────────────────────

// Fix 1: TLDR paragraph structure and content

test('[G1-F1] TLDR paragraph has class="tldr-summary"', () => {
  const html = render(BASE_DATA)
  assert.ok(html.includes('class="tldr-summary"'), 'TLDR paragraph should have class="tldr-summary"')
})

test('[G1-F1] TLDR contains origin city name (not IATA code)', () => {
  const html = render(BASE_DATA)
  const tldrStart = html.indexOf('class="tldr-summary"')
  const tldrEnd = html.indexOf('</p>', tldrStart)
  const tldrText = html.slice(tldrStart, tldrEnd).replace(/<[^>]+>/g, '')
  assert.ok(tldrText.includes('Gdansk'), `TLDR should contain origin city "Gdansk", got: "${tldrText}"`)
})

test('[G1-F1] TLDR contains destination city name (not IATA code)', () => {
  const html = render(BASE_DATA)
  const tldrStart = html.indexOf('class="tldr-summary"')
  const tldrEnd = html.indexOf('</p>', tldrStart)
  const tldrText = html.slice(tldrStart, tldrEnd).replace(/<[^>]+>/g, '')
  assert.ok(tldrText.includes('Barcelona'), `TLDR should contain dest city "Barcelona", got: "${tldrText}"`)
})

test('[G1-F1] TLDR contains a month name and year', () => {
  const html = render(BASE_DATA)
  const tldrStart = html.indexOf('class="tldr-summary"')
  const tldrEnd = html.indexOf('</p>', tldrStart)
  const tldrText = html.slice(tldrStart, tldrEnd).replace(/<[^>]+>/g, '')
  const months = ['January','February','March','April','May','June','July',
    'August','September','October','November','December']
  const hasMonth = months.some(m => tldrText.includes(m))
  assert.ok(hasMonth, `TLDR should contain a month name, got: "${tldrText}"`)
  assert.ok(/20\d\d/.test(tldrText), `TLDR should contain a year, got: "${tldrText}"`)
})

test('[G1-F1] TLDR is between 40 and 80 words', () => {
  const html = render(BASE_DATA)
  const tldrStart = html.indexOf('class="tldr-summary"')
  const tldrEnd = html.indexOf('</p>', tldrStart)
  const tldrText = html.slice(tldrStart, tldrEnd).replace(/<[^>]+>/g, '').trim()
  const words = tldrText.split(/\s+/).filter(w => w.length > 0)
  assert.ok(words.length >= 40, `TLDR should have >= 40 words, got ${words.length}: "${tldrText}"`)
  assert.ok(words.length <= 80, `TLDR should have <= 80 words, got ${words.length}: "${tldrText}"`)
})

test('[G1-F1] TLDR contains offer count and p50 value', () => {
  const html = render(BASE_DATA)
  const tldrStart = html.indexOf('class="tldr-summary"')
  const tldrEnd = html.indexOf('</p>', tldrStart)
  const tldrText = html.slice(tldrStart, tldrEnd).replace(/<[^>]+>/g, '')
  assert.ok(tldrText.includes('180'), `TLDR should contain offer count 180, got: "${tldrText}"`)
  // p50 = 368
  assert.ok(tldrText.includes('368'), `TLDR should contain p50 value 368, got: "${tldrText}"`)
})

// Fix 2: H2/H3 headings — no dates, no IATA codes, phrased as questions

test('[G1-F2] no H2 or H3 contains raw date string in YYYY-MM-DD format', () => {
  const html = render(BASE_DATA)
  const headings = html.match(/<h[23][^>]*>[\s\S]*?<\/h[23]>/g) ?? []
  for (const h of headings) {
    const text = h.replace(/<[^>]+>/g, '')
    assert.ok(!/\d{4}-\d{2}-\d{2}/.test(text),
      `H2/H3 should not contain YYYY-MM-DD date, found in: "${text}"`)
  }
})

test('[G1-F2] no H2 or H3 contains standalone uppercase IATA code (2-3 caps)', () => {
  const html = render(BASE_DATA)
  const headings = html.match(/<h[23][^>]*>[\s\S]*?<\/h[23]>/g) ?? []
  for (const h of headings) {
    const text = h.replace(/<[^>]+>/g, '')
    assert.ok(!/\b[A-Z]{2,3}\b/.test(text),
      `H2/H3 should not contain standalone IATA code, found in: "${text}"`)
  }
})

test('[G1-F2] distribution section H2 contains a question mark', () => {
  const html = render(BASE_DATA)
  const distStart = html.indexOf('data-testid="price-distribution-section"')
  const distEnd = html.indexOf('data-testid="fee-analysis-section"')
  const distSection = html.slice(distStart, distEnd)
  const h2Match = distSection.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)
  assert.ok(h2Match, 'Distribution section must have an H2')
  const h2Text = h2Match![1].replace(/<[^>]+>/g, '')
  assert.ok(h2Text.includes('?'), `Distribution H2 should end with "?", got: "${h2Text}"`)
})

test('[G1-F2] fees section H2 contains a question mark', () => {
  const html = render(BASE_DATA)
  const feeStart = html.indexOf('data-testid="fee-analysis-section"')
  const feeEnd = html.indexOf('data-testid="carrier-comparison-section"')
  const feeSection = feeEnd > feeStart ? html.slice(feeStart, feeEnd) : html.slice(feeStart, feeStart + 800)
  const h2Match = feeSection.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)
  assert.ok(h2Match, 'Fee section must have an H2')
  const h2Text = h2Match![1].replace(/<[^>]+>/g, '')
  assert.ok(h2Text.includes('?'), `Fee H2 should contain "?", got: "${h2Text}"`)
})

test('[G1-F2] carriers section H2 contains a question mark', () => {
  const html = render(BASE_DATA)
  const carrierStart = html.indexOf('data-testid="carrier-comparison-section"')
  const carrierEnd = html.indexOf('data-testid="connector-comparison-section"')
  const section = html.slice(carrierStart, carrierEnd)
  const h2Match = section.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)
  assert.ok(h2Match, 'Carrier section must have an H2')
  const h2Text = h2Match![1].replace(/<[^>]+>/g, '')
  assert.ok(h2Text.includes('?'), `Carrier H2 should contain "?", got: "${h2Text}"`)
})

// Fix 3: Prose intro <p> before each data section

test('[G1-F3] distribution section has a prose <p> before the histogram element', () => {
  const html = render(BASE_DATA)
  const distStart = html.indexOf('data-testid="price-distribution-section"')
  const histPos = html.indexOf('data-testid="price-histogram"', distStart)
  const h2End = html.indexOf('</h2>', distStart) + '</h2>'.length
  // There should be at least one <p> between the H2 and the histogram
  const betweenH2AndHist = html.slice(h2End, histPos)
  assert.ok(betweenH2AndHist.includes('<p'), `Distribution section should have prose <p> between H2 and histogram`)
})

test('[G1-F3] fees section has a prose <p> before fee-no-data message', () => {
  const html = render(BASE_DATA) // fee_breakdown_available: false
  const feeStart = html.indexOf('data-testid="fee-analysis-section"')
  const feeNoDataPos = html.indexOf('data-testid="fee-no-data"', feeStart)
  const h2End = html.indexOf('</h2>', feeStart) + '</h2>'.length
  const betweenH2AndNoData = html.slice(h2End, feeNoDataPos)
  assert.ok(betweenH2AndNoData.includes('<p'),
    `Fee section should have prose <p> between H2 and fee-no-data message`)
})

test('[G1-F3] carriers section has a prose <p> before the carrier table', () => {
  const html = render(BASE_DATA)
  const carrierStart = html.indexOf('data-testid="carrier-comparison-section"')
  const tablePos = html.indexOf('data-testid="carrier-table"', carrierStart)
  const h2End = html.indexOf('</h2>', carrierStart) + '</h2>'.length
  const betweenH2AndTable = html.slice(h2End, tablePos)
  assert.ok(betweenH2AndTable.includes('<p'),
    `Carrier section should have prose <p> between H2 and carrier table`)
})

test('[G1-F3] connector section has a prose <p> before the connector table', () => {
  const html = render(BASE_DATA)
  const connStart = html.indexOf('data-testid="connector-comparison-section"')
  const tablePos = html.indexOf('data-testid="connector-table"', connStart)
  const h2End = html.indexOf('</h2>', connStart) + '</h2>'.length
  const betweenH2AndTable = html.slice(h2End, tablePos)
  assert.ok(betweenH2AndTable.includes('<p'),
    `Connector section should have prose <p> between H2 and connector table`)
})

test('[G1-F3] distribution section intro paragraph contains at least one number', () => {
  const html = render(BASE_DATA)
  const distStart = html.indexOf('data-testid="price-distribution-section"')
  const histPos = html.indexOf('data-testid="price-histogram"', distStart)
  const h2End = html.indexOf('</h2>', distStart) + '</h2>'.length
  const introArea = html.slice(h2End, histPos)
  const firstPMatch = introArea.match(/<p[^>]*>([\s\S]*?)<\/p>/)
  assert.ok(firstPMatch, 'Should find a prose intro <p> before histogram')
  const introText = firstPMatch![1].replace(/<[^>]+>/g, '')
  assert.ok(/\d+/.test(introText), `Distribution intro should contain a number, got: "${introText}"`)
})

// Fix 4: Key facts tested at the data generation level — see distribution-service.test.ts GROUP 1

// ─── GROUP 2 — Data Integrity Fixes ──────────────────────────────────────────

// Fix 6: connector insight uses display_name, not raw slug

test('[G2-F6] connector insight shows humanized display_name (no underscore)', () => {
  const html = render(BASE_DATA)
  const insightPos = html.indexOf('data-testid="connector-insight"')
  assert.ok(insightPos >= 0, 'connector-insight element should be present')
  const insightEnd = html.indexOf('</p>', insightPos)
  const insightText = html.slice(insightPos, insightEnd).replace(/<[^>]+>/g, '')
  assert.ok(
    !insightText.includes('_'),
    `Connector insight should not contain underscored slug, got: "${insightText}"`
  )
})

test('[G2-F6] connector table cells show display_name (no underscore)', () => {
  const html = render(BASE_DATA)
  const tableStart = html.indexOf('data-testid="connector-table"')
  const tableEnd = html.indexOf('</table>', tableStart)
  const tableHtml = html.slice(tableStart, tableEnd)
  // Extract text content of <td> cells
  const tds = [...tableHtml.matchAll(/<td>([\s\S]*?)<\/td>/g)].map(m => m[1])
  // First <td> in each row is the connector name — should not contain underscore
  for (let i = 0; i < tds.length; i += 4) { // 4 cols: name, offers, median, vs-avg
    const nameTd = tds[i]
    assert.ok(
      !nameTd.includes('_'),
      `Connector table name cell should not contain underscore, got: "${nameTd}"`
    )
  }
})

// Fix 8: Social proof threshold guard — hide when session_count < 10

test('[G2-F8] social proof shows "New route" message when session_count < 3', () => {
  const lowSessionData: RouteDistributionData = { ...BASE_DATA, session_count: 1 }
  const html = render(lowSessionData)
  const socialPos = html.indexOf('data-testid="social-proof"')
  const socialEnd = html.indexOf('</p>', socialPos)
  const socialText = html.slice(socialPos, socialEnd)
  assert.ok(
    socialText.includes('New route') || socialText.includes('first'),
    `Social proof with session_count=1 should show new-route message, got: "${socialText}"`
  )
})

test('[G2-F8] social proof shows offer count when session_count >= 3', () => {
  const lowSessionData: RouteDistributionData = { ...BASE_DATA, session_count: 3 }
  const html = render(lowSessionData)
  const socialPos = html.indexOf('data-testid="social-proof"')
  const socialEnd = html.indexOf('</p>', socialPos)
  const socialText = html.slice(socialPos, socialEnd)
  // Should show total_offers_analyzed (180), not session_count (3)
  assert.ok(
    socialText.includes('180'),
    `Social proof should contain total_offers_analyzed (180), got: "${socialText}"`
  )
})

// Fix 9: Snapshot history hidden when session_count < 3

test('[G2-F9] snapshot history absent when session_count = 1', () => {
  const singleSession: RouteDistributionData = { ...BASE_DATA, session_count: 1 }
  const html = render(singleSession)
  assert.ok(!html.includes('data-testid="snapshot-history"'),
    'Snapshot history should be absent when session_count=1')
})

test('[G2-F9] snapshot history absent when session_count = 2', () => {
  const twoSessions: RouteDistributionData = { ...BASE_DATA, session_count: 2 }
  const html = render(twoSessions)
  assert.ok(!html.includes('data-testid="snapshot-history"'),
    'Snapshot history should be absent when session_count=2')
})

test('[G2-F9] snapshot history present when session_count >= 3', () => {
  const html = render(BASE_DATA) // session_count: 3
  assert.ok(html.includes('data-testid="snapshot-history"'),
    'Snapshot history should be present when session_count=3')
})

// Fix 10: Hero stats-row contains both "base"/"advertised" and "total"/"incl." framing

test('[G2-F12] stats-row variant A shows fee framing, not "from EUR min" (updated from G2-F10)', () => {
  const html = render(BASE_DATA, 'A')
  const statsStart = html.indexOf('data-testid="stats-row"')
  const statsEnd = html.indexOf('</div>', statsStart)
  const statsText = html.slice(statsStart, statsEnd).replace(/<[^>]+>/g, '').toLowerCase()
  // After Fix 12, variant A shows fee info rather than min-price "from EUR N" framing
  assert.ok(
    statsText.includes('fee') || statsText.includes('varies') || statsText.includes('carrier') || statsText.includes('avg'),
    `Stats row variant A should show fee framing, got: "${statsText}"`
  )
})

test('[G2-F10] TLDR or stats-row mentions total/inclusive price framing', () => {
  const html = render(BASE_DATA)
  const heroStart = html.indexOf('data-testid="hero"')
  const heroEnd = html.indexOf('data-testid="price-distribution-section"')
  const heroText = html.slice(heroStart, heroEnd).replace(/<[^>]+>/g, '').toLowerCase()
  assert.ok(
    heroText.includes('total') || heroText.includes('median') || heroText.includes('incl'),
    `Hero section should mention total/median price framing, got: "${heroText}"`
  )
})

// ─── GROUP 3 — Copy/UX Fixes ──────────────────────────────────────────────────

// Fix 11: Remove IATA codes from FAQ questions and answers

test('[G3-F11] FAQ questions contain no raw IATA arrow pattern (XX→YY)', () => {
  const html = render(BASE_DATA)
  const faqSection = html.slice(
    html.indexOf('data-testid="faq-section"'),
    html.indexOf('data-testid="secondary-cta-section"')
  )
  // Extract all question text
  const qs = [...faqSection.matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>/g)].map(m => m[1])
  for (const q of qs) {
    assert.ok(
      !/[A-Z]{2,3}→[A-Z]{2,3}/.test(q),
      `FAQ question should not contain IATA arrow pattern, got: "${q}"`
    )
    assert.ok(
      !/\b[A-Z]{3}\b/.test(q),
      `FAQ question should not contain standalone 3-letter IATA code, got: "${q}"`
    )
  }
})

test('[G3-F11] FAQ answers contain no raw IATA arrow pattern (XX→YY)', () => {
  const html = render(BASE_DATA)
  const faqSection = html.slice(
    html.indexOf('data-testid="faq-section"'),
    html.indexOf('data-testid="secondary-cta-section"')
  )
  const answers = [...faqSection.matchAll(/<dd[^>]*>([\s\S]*?)<\/dd>/g)].map(m => m[1])
  for (const a of answers) {
    assert.ok(
      !/[A-Z]{2,3}→[A-Z]{2,3}/.test(a),
      `FAQ answer should not contain IATA arrow pattern, got: "${a}"`
    )
  }
})

// Fix 12: Carrier display name in FAQ Q3 (not raw IATA code)

test('[G3-F12] FAQ Q3 carrier answer uses carrier display name, not raw IATA code', () => {
  const html = render(BASE_DATA)
  // Q3 (index 2) is the carrier question
  const q2Pos = html.indexOf('data-testid="faq-a-2"')
  const q2End = html.indexOf('</dd>', q2Pos)
  const answerText = html.slice(q2Pos, q2End).replace(/<[^>]+>/g, '')
  // Should contain a human-readable name (like "Ryanair") not just "FR"
  // cheapest carrier in BASE_DATA is FR (Ryanair) with price_p50=200
  assert.ok(
    !answerText.match(/^\s*FR\b/) && !answerText.includes(' FR ') && !answerText.startsWith('FR '),
    `FAQ Q3 should not use raw IATA "FR" as carrier name, got: "${answerText}"`
  )
  assert.ok(
    answerText.length > 20,
    `FAQ Q3 answer should have substantive content, got: "${answerText}"`
  )
})

// Fix 13: FAQ Q2 answer text differs from fee section intro text

test('[G3-F13] FAQ Q2 answer and fee section intro have < 60% token overlap', () => {
  const html = render(BASE_DATA)

  // Get fee section intro text
  const feeStart = html.indexOf('data-testid="fee-analysis-section"')
  const feeIntroMatch = html.slice(feeStart, feeStart + 800).match(/<p[^>]*>([\s\S]*?)<\/p>/)
  const feeIntroText = feeIntroMatch ? feeIntroMatch[1].replace(/<[^>]+>/g, '').toLowerCase() : ''

  // Get FAQ Q2 answer (index 1)
  const faqA1Pos = html.indexOf('data-testid="faq-a-1"')
  const faqA1End = html.indexOf('</dd>', faqA1Pos)
  const faqA1Text = html.slice(faqA1Pos, faqA1End).replace(/<[^>]+>/g, '').toLowerCase()

  if (feeIntroText.length > 10 && faqA1Text.length > 10) {
    const feeTokens = new Set(feeIntroText.split(/\W+/).filter(w => w.length > 3))
    const faqTokens = new Set(faqA1Text.split(/\W+/).filter(w => w.length > 3))
    const intersect = [...faqTokens].filter(t => feeTokens.has(t))
    const overlap = intersect.length / Math.max(faqTokens.size, feeTokens.size)
    assert.ok(
      overlap < 0.6,
      `FAQ Q2 and fee intro should have < 60% token overlap, got ${Math.round(overlap * 100)}%`
    )
  }
})

// Fix 14: Share button has accessible data attributes

test('[G3-F14] share button has data-share-url and aria-label attributes', () => {
  const html = render(BASE_DATA)
  const sharePos = html.indexOf('data-testid="share-button"')
  assert.ok(sharePos >= 0, 'Share button should be present')
  const shareEnd = html.indexOf('>', sharePos) + 1
  const shareTag = html.slice(sharePos - 50, shareEnd)
  assert.ok(
    shareTag.includes('data-share-url'),
    `Share button should have data-share-url attribute, got: "${shareTag}"`
  )
  assert.ok(
    shareTag.includes('aria-label'),
    `Share button should have aria-label attribute, got: "${shareTag}"`
  )
})

// Fix 16: Fee table — replace em-dash with <td title="Fee data not available">n/a</td>

test('[G3-F16] fee table does not use bare em-dash in td cells', () => {
  const html = render(WITH_FEES_DATA)
  const tableStart = html.indexOf('data-testid="fee-breakdown-table"')
  assert.ok(tableStart >= 0, 'fee-breakdown-table should be present')
  const tableEnd = html.indexOf('</table>', tableStart)
  const tableHtml = html.slice(tableStart, tableEnd)
  // Should not have <td>—</td> pattern
  assert.ok(
    !tableHtml.includes('<td>—</td>'),
    `Fee table should not use bare em-dash, use n/a with title instead`
  )
})

test('[G3-F16] carrier table does not use bare em-dash in td cells', () => {
  const html = render(BASE_DATA)
  const tableStart = html.indexOf('data-testid="carrier-table"')
  const tableEnd = html.indexOf('</table>', tableStart)
  const tableHtml = html.slice(tableStart, tableEnd)
  assert.ok(
    !tableHtml.includes('<td>—</td>'),
    `Carrier table should not use bare em-dash, use n/a with title attribute instead`
  )
})

// Fix 17: Histogram axis labels include currency

test('[G3-F17] histogram bucket labels include currency code', () => {
  const html = render(BASE_DATA)
  const chartStart = html.indexOf('data-testid="histogram-chart"')
  const chartEnd = html.indexOf('</div>', chartStart + 100)
  // Look for the first bucket span
  const bucket0 = html.indexOf('data-testid="histogram-bucket-0"', chartStart)
  const bucket0End = html.indexOf('</div>', bucket0)
  const bucket0Html = html.slice(bucket0, bucket0End)
  assert.ok(
    bucket0Html.includes('EUR') || bucket0Html.includes('currency'),
    `Histogram bucket labels should include currency, got: "${bucket0Html}"`
  )
})

// ─── GROUP 4: SEO / Technical fixes ──────────────────────────────────────────

// Fix 18: JSON-LD structured data — @graph with required schema types (use full HTML)

test('[G4-F18] page includes JSON-LD script tag', () => {
  const html = renderFullHtml(BASE_DATA)
  const head = extractHead(html)
  assert.ok(
    head.includes('"@type"') && head.includes('application/ld+json'),
    'JSON-LD should be in <head>'
  )
})

test('[G4-F18] JSON-LD includes FAQPage schema', () => {
  const html = renderFullHtml(BASE_DATA)
  assert.ok(extractHead(html).includes('"FAQPage"'), 'JSON-LD should include FAQPage type')
})

test('[G4-F18] JSON-LD includes BreadcrumbList schema', () => {
  const html = renderFullHtml(BASE_DATA)
  assert.ok(extractHead(html).includes('"BreadcrumbList"'), 'JSON-LD should include BreadcrumbList type')
})

test('[G4-F18] JSON-LD includes Dataset schema', () => {
  const html = renderFullHtml(BASE_DATA)
  assert.ok(extractHead(html).includes('"Dataset"'), 'JSON-LD should include Dataset type')
})

test('[G4-F18] JSON-LD uses @graph array', () => {
  const html = renderFullHtml(BASE_DATA)
  const head = extractHead(html)
  const ldStart = head.indexOf('application/ld+json')
  const scriptStart = head.lastIndexOf('<script', ldStart)
  const scriptEnd = head.indexOf('</script>', ldStart)
  const scriptContent = head.slice(scriptStart, scriptEnd)
  assert.ok(scriptContent.includes('"@graph"'), 'JSON-LD should use @graph array structure')
})

// Fix 19: Page title element — correct SEO format (use full HTML)

test('[G4-F19] page title element includes origin and dest city names', () => {
  const html = renderFullHtml(BASE_DATA)
  const head = extractHead(html)
  const titleStart = head.indexOf('<title')
  const titleEnd = head.indexOf('</title>', titleStart)
  assert.ok(titleStart >= 0 && titleEnd > titleStart, 'Page should render a <title> element in <head>')
  const titleText = head.slice(titleStart, titleEnd)
  assert.ok(titleText.includes('Gdansk'), 'Title should include origin city')
  assert.ok(titleText.includes('Barcelona'), 'Title should include dest city')
})

test('[G4-F19] page title follows SEO format with brand', () => {
  const html = renderFullHtml(BASE_DATA)
  const head = extractHead(html)
  const titleStart = head.indexOf('<title')
  const titleEnd = head.indexOf('</title>', titleStart)
  const titleText = head.slice(titleStart, titleEnd + 8)
  assert.ok(
    titleText.includes('LetsFG') || titleText.includes('letsfg'),
    'Title should include brand name'
  )
  assert.ok(
    titleText.toLowerCase().includes('flights'),
    'Title should include "flights"'
  )
})

// Fix 20: Snapshot date — relative time + absolute

test('[G4-F20] snapshot history shows relative time description', () => {
  const data = { ...BASE_DATA, session_count: 10 }
  const html = render(data)
  const detailsStart = html.indexOf('data-testid="snapshot-history"')
  const detailsEnd = html.indexOf('</details>', detailsStart)
  const detailsHtml = html.slice(detailsStart, detailsEnd)
  // Should contain a relative/descriptive time reference like "days ago" or "ago" or "recent"
  const hasRelativeTime = detailsHtml.includes('ago') ||
    detailsHtml.includes('today') || detailsHtml.includes('yesterday') ||
    detailsHtml.includes('day') || detailsHtml.includes('week') ||
    detailsHtml.includes('month') || detailsHtml.includes('<time ')
  assert.ok(
    hasRelativeTime,
    `Snapshot history should include relative or descriptive time, got: "${detailsHtml}"`
  )
})

test('[G4-F20] snapshot history retains absolute ISO date', () => {
  const data = { ...BASE_DATA, session_count: 10 }
  const html = render(data)
  const detailsStart = html.indexOf('data-testid="snapshot-history"')
  const detailsEnd = html.indexOf('</details>', detailsStart)
  const detailsHtml = html.slice(detailsStart, detailsEnd)
  // The absolute date should be somewhere visible
  assert.ok(
    detailsHtml.includes('2026-05-05') || detailsHtml.includes('2026'),
    `Snapshot history should retain absolute date, got: "${detailsHtml}"`
  )
})

// ─── GROUP 1: Critical structural / technical (head/SEO) ─────────────────────

// Fix 1: <title> and JSON-LD belong in <head>, not <body>

test('[G1-F1] FlightPage component does not render <title> tag', () => {
  const html = render(BASE_DATA)
  assert.ok(!html.includes('<title'), 'FlightPage component should not render <title> — belongs in <head> via FlightPageHead')
})

test('[G1-F1] FlightPage component does not render JSON-LD script', () => {
  const html = render(BASE_DATA)
  assert.ok(!html.includes('application/ld+json'), 'FlightPage component should not render JSON-LD — belongs in <head> via FlightPageHead')
})

test('[G1-F1] full page HTML has <title> inside <head>', () => {
  const html = renderFullHtml(BASE_DATA)
  const headEnd = html.indexOf('</head>')
  const titleIdx = html.indexOf('<title')
  assert.ok(titleIdx >= 0, '<title> should exist in the full HTML')
  assert.ok(titleIdx < headEnd, `<title> should appear before </head>, titleIdx=${titleIdx} headEnd=${headEnd}`)
})

test('[G1-F1] full page HTML has JSON-LD <script> inside <head>', () => {
  const html = renderFullHtml(BASE_DATA)
  const head = extractHead(html)
  assert.ok(head.includes('application/ld+json'), 'JSON-LD <script> should be in <head>')
})

test('[G1-F1] <body> contains no <title> tag', () => {
  const html = renderFullHtml(BASE_DATA)
  const body = extractBody(html)
  assert.ok(!body.includes('<title'), '<body> should not contain <title>')
})

test('[G1-F1] <body> contains no JSON-LD script', () => {
  const html = renderFullHtml(BASE_DATA)
  const body = extractBody(html)
  assert.ok(!body.includes('application/ld+json'), '<body> should not contain JSON-LD script')
})

// Fix 2: Article schema in @graph

test('[G1-F2] @graph contains an Article item', () => {
  const graph = extractJsonLdGraph(renderFullHtml(BASE_DATA))
  assert.ok(graph.some(item => item['@type'] === 'Article'), '@graph should contain Article type')
})

test('[G1-F2] Article.headline matches page title format', () => {
  const graph = extractJsonLdGraph(renderFullHtml(BASE_DATA))
  const article = graph.find(item => item['@type'] === 'Article') as Record<string, unknown> | undefined
  assert.ok(article, 'Article should exist')
  const headline = article!['headline'] as string
  assert.ok(headline.includes('Gdansk'), 'Article.headline should include origin city')
  assert.ok(headline.includes('Barcelona'), 'Article.headline should include dest city')
})

test('[G1-F2] Article.dateModified equals snapshot_computed_at', () => {
  const graph = extractJsonLdGraph(renderFullHtml(BASE_DATA))
  const article = graph.find(item => item['@type'] === 'Article') as Record<string, unknown> | undefined
  assert.ok(article, 'Article should exist')
  assert.equal(article!['dateModified'], BASE_DATA.snapshot_computed_at, 'Article.dateModified should equal snapshot_computed_at')
})

test('[G1-F2] Article.datePublished is a valid ISO date string', () => {
  const graph = extractJsonLdGraph(renderFullHtml(BASE_DATA))
  const article = graph.find(item => item['@type'] === 'Article') as Record<string, unknown> | undefined
  assert.ok(article, 'Article should exist')
  const pub = article!['datePublished'] as string
  assert.ok(pub && !isNaN(Date.parse(pub)), `Article.datePublished should be a valid ISO date, got: "${pub}"`)
})

test('[G1-F2] Article.author is an Organization', () => {
  const graph = extractJsonLdGraph(renderFullHtml(BASE_DATA))
  const article = graph.find(item => item['@type'] === 'Article') as Record<string, unknown> | undefined
  assert.ok(article, 'Article should exist')
  const author = article!['author'] as Record<string, unknown>
  assert.equal(author?.['@type'], 'Organization', 'Article.author should be Organization')
  assert.ok(author?.['name'], 'Article.author.name should be set')
})

test('[G1-F2] Article.about is a Trip with departure/arrival airports', () => {
  const graph = extractJsonLdGraph(renderFullHtml(BASE_DATA))
  const article = graph.find(item => item['@type'] === 'Article') as Record<string, unknown> | undefined
  assert.ok(article, 'Article should exist')
  const about = article!['about'] as Record<string, unknown>
  assert.equal(about?.['@type'], 'Trip', 'Article.about should be Trip')
  const dep = about?.['departureLocation'] as Record<string, unknown>
  const arr = about?.['arrivalLocation'] as Record<string, unknown>
  assert.equal(dep?.['@type'], 'Airport', 'departureLocation should be Airport')
  assert.equal(arr?.['@type'], 'Airport', 'arrivalLocation should be Airport')
  assert.equal(dep?.['iataCode'], 'GDN', 'departureLocation.iataCode should be GDN')
  assert.equal(arr?.['iataCode'], 'BCN', 'arrivalLocation.iataCode should be BCN')
})

// Fix 3: Dataset variableMeasured expanded

test('[G1-F3] Dataset variableMeasured has at least 10 items', () => {
  const graph = extractJsonLdGraph(renderFullHtml(BASE_DATA))
  const dataset = graph.find(item => item['@type'] === 'Dataset') as Record<string, unknown> | undefined
  assert.ok(dataset, 'Dataset should exist')
  const vm = dataset!['variableMeasured'] as unknown[]
  assert.ok(vm.length >= 10, `Dataset.variableMeasured should have >= 10 items, got ${vm.length}`)
})

test('[G1-F3] Dataset variableMeasured includes median_price_by_carrier proxy', () => {
  const graph = extractJsonLdGraph(renderFullHtml(BASE_DATA))
  const dataset = graph.find(item => item['@type'] === 'Dataset') as Record<string, unknown> | undefined
  const vm = (dataset!['variableMeasured'] as Array<Record<string, unknown>>) ?? []
  const names = vm.map(v => v['name'])
  assert.ok(names.includes('airlines_compared'), 'variableMeasured should include airlines_compared (carrier coverage proxy)')
})

test('[G1-F3] Dataset variableMeasured includes connectors_searched', () => {
  const graph = extractJsonLdGraph(renderFullHtml(BASE_DATA))
  const dataset = graph.find(item => item['@type'] === 'Dataset') as Record<string, unknown> | undefined
  const vm = (dataset!['variableMeasured'] as Array<Record<string, unknown>>) ?? []
  assert.ok(vm.some(v => v['name'] === 'connectors_searched'), 'variableMeasured should include connectors_searched')
})

test('[G1-F3] Dataset variableMeasured includes p10 through p90 percentiles', () => {
  const graph = extractJsonLdGraph(renderFullHtml(BASE_DATA))
  const dataset = graph.find(item => item['@type'] === 'Dataset') as Record<string, unknown> | undefined
  const vm = (dataset!['variableMeasured'] as Array<Record<string, unknown>>) ?? []
  const names = vm.map(v => v['name'])
  assert.ok(names.includes('p10_price'), 'should include p10_price')
  assert.ok(names.includes('p90_price'), 'should include p90_price')
})

test('[G1-F3] Dataset.description contains offer count and city names', () => {
  const graph = extractJsonLdGraph(renderFullHtml(BASE_DATA))
  const dataset = graph.find(item => item['@type'] === 'Dataset') as Record<string, unknown> | undefined
  const desc = dataset!['description'] as string
  assert.ok(desc.includes('180') || desc.includes(String(BASE_DATA.total_offers_analyzed)), 'description should include offer count')
  assert.ok(desc.includes('Gdansk') || desc.includes('Barcelona'), 'description should include city names')
})

test('[G1-F3] Dataset.measurementTechnique describes AI agent methodology', () => {
  const graph = extractJsonLdGraph(renderFullHtml(BASE_DATA))
  const dataset = graph.find(item => item['@type'] === 'Dataset') as Record<string, unknown> | undefined
  const tech = dataset!['measurementTechnique'] as string
  assert.ok(tech && tech.length > 10, `Dataset.measurementTechnique should be a non-trivial string, got: "${tech}"`)
})

// Fix 4: meta description, canonical, html lang

test('[G1-F4] <html> element has lang="en" attribute', () => {
  const html = renderFullHtml(BASE_DATA)
  assert.ok(html.includes('<html lang="en">'), '<html> should have lang="en"')
})

test('[G1-F4] <head> contains meta description', () => {
  const head = extractHead(renderFullHtml(BASE_DATA))
  assert.ok(head.includes('name="description"'), '<head> should contain meta description')
})

test('[G1-F4] meta description contains offer count and price range', () => {
  const head = extractHead(renderFullHtml(BASE_DATA))
  const metaMatch = head.match(/name="description"\s+content="([^"]+)"/)
  const content = metaMatch?.[1] ?? ''
  assert.ok(content.includes('180') || content.includes('368'), `meta description should contain offer count or median price, got: "${content}"`)
  assert.ok(content.includes('Gdansk') || content.includes('Barcelona'), 'meta description should include city names')
})

test('[G1-F4] meta description length is 100–160 characters', () => {
  const head = extractHead(renderFullHtml(BASE_DATA))
  const metaMatch = head.match(/name="description"\s+content="([^"]+)"/)
  const content = metaMatch?.[1] ?? ''
  assert.ok(content.length >= 100 && content.length <= 160, `meta description length ${content.length} should be 100–160 chars. Content: "${content}"`)
})

test('[G1-F4] <head> contains canonical link', () => {
  const head = extractHead(renderFullHtml(BASE_DATA))
  assert.ok(head.includes('rel="canonical"'), '<head> should contain canonical link')
})

test('[G1-F4] canonical href matches /flights/gdn-bcn/ pattern', () => {
  const head = extractHead(renderFullHtml(BASE_DATA))
  const canonMatch = head.match(/rel="canonical"\s+href="([^"]+)"/)
  const href = canonMatch?.[1] ?? ''
  assert.ok(href.includes('/flights/gdn-bcn'), `canonical href should contain /flights/gdn-bcn, got: "${href}"`)
})

// Fix 5: BreadcrumbList with 4 items

test('[G1-F5] BreadcrumbList has exactly 4 ListItem elements', () => {
  const graph = extractJsonLdGraph(renderFullHtml(BASE_DATA))
  const bc = graph.find(item => item['@type'] === 'BreadcrumbList') as Record<string, unknown> | undefined
  assert.ok(bc, 'BreadcrumbList should exist')
  const items = bc!['itemListElement'] as unknown[]
  assert.equal(items.length, 4, `BreadcrumbList should have 4 items, got ${items.length}`)
})

test('[G1-F5] BreadcrumbList item 3 is origin city page', () => {
  const graph = extractJsonLdGraph(renderFullHtml(BASE_DATA))
  const bc = graph.find(item => item['@type'] === 'BreadcrumbList') as Record<string, unknown> | undefined
  const items = (bc!['itemListElement'] as Array<Record<string, unknown>>) ?? []
  const item3 = items.find(i => i['position'] === 3)
  assert.ok(item3, 'position 3 should exist')
  const name = item3!['name'] as string
  const url = item3!['item'] as string
  assert.ok(name.includes('Gdansk'), `position 3 name should include origin city, got: "${name}"`)
  assert.ok(url.includes('/flights/'), `position 3 url should be a flights page, got: "${url}"`)
})

test('[G1-F5] BreadcrumbList item 4 is the specific route page', () => {
  const graph = extractJsonLdGraph(renderFullHtml(BASE_DATA))
  const bc = graph.find(item => item['@type'] === 'BreadcrumbList') as Record<string, unknown> | undefined
  const items = (bc!['itemListElement'] as Array<Record<string, unknown>>) ?? []
  const item4 = items.find(i => i['position'] === 4)
  assert.ok(item4, 'position 4 should exist')
  const url = item4!['item'] as string
  assert.ok(url.includes('gdn') && url.includes('bcn'), `position 4 url should contain route slug gdn-bcn, got: "${url}"`)
})

// ─── GROUP 2: Copy / prose fixes ─────────────────────────────────────────────

// Fix 6: CTA text uses city names; fee H2 uses "to" not "→"

test('[G2-F6] CTA text variant A uses city names, not IATA codes', () => {
  const html = render(BASE_DATA, 'A')
  const ctaPos = html.indexOf('data-testid="primary-cta"')
  const ctaEnd = html.indexOf('</a>', ctaPos)
  const ctaText = html.slice(ctaPos, ctaEnd)
  assert.ok(!ctaText.includes('>GDN<') && !ctaText.match(/Search GDN/), 'CTA text should not use origin IATA code GDN')
  assert.ok(!ctaText.includes('>BCN<') && !ctaText.match(/→BCN /), 'CTA text should not use dest IATA code BCN')
  assert.ok(ctaText.includes('Gdansk'), 'CTA text should include origin city name')
  assert.ok(ctaText.includes('Barcelona'), 'CTA text should include dest city name')
})

test('[G2-F6] fee section H2 uses "to", not "→"', () => {
  const html = render(BASE_DATA)
  const feeSecPos = html.indexOf('data-testid="fee-analysis-section"')
  const h2Start = html.indexOf('<h2', feeSecPos)
  const h2End = html.indexOf('</h2>', h2Start)
  const h2Text = html.slice(h2Start, h2End)
  assert.ok(!h2Text.includes('→'), `Fee H2 should not contain "→", got: "${h2Text}"`)
  assert.ok(h2Text.toLowerCase().includes(' to '), `Fee H2 should use " to ", got: "${h2Text}"`)
})

// Fix 7: Key facts generated from data (buildKeyFacts), not editorial tldr.key_facts

test('[G2-F7] key facts section has exactly 3 items from buildKeyFacts', () => {
  const html = render(BASE_DATA)
  const listStart = html.indexOf('data-testid="key-facts-list"')
  const listEnd = html.indexOf('</ul>', listStart)
  const listHtml = html.slice(listStart, listEnd)
  const count = (listHtml.match(/<li /g) ?? []).length
  assert.equal(count, 3, `Key facts list should have exactly 3 items from buildKeyFacts, got ${count}`)
})

test('[G2-F7] key facts include p50 median price from data', () => {
  const html = render(BASE_DATA)
  const listStart = html.indexOf('data-testid="key-facts-list"')
  const listEnd = html.indexOf('</ul>', listStart)
  const listHtml = html.slice(listStart, listEnd)
  assert.ok(listHtml.includes('368'), 'Key facts should include p50 median price (368) from data')
})

test('[G2-F7] key facts do not contain editorial tldr string "2026-06-15"', () => {
  const html = render(BASE_DATA)
  const listStart = html.indexOf('data-testid="key-facts-list"')
  const listEnd = html.indexOf('</ul>', listStart)
  const listHtml = html.slice(listStart, listEnd)
  assert.ok(!listHtml.includes('2026-06-15'), 'Key facts should not contain editorial tldr date "2026-06-15"')
})

test('[G2-F7] fee section does not render raw tldr.key_facts[1] content', () => {
  const html = render(BASE_DATA)
  // tldr.key_facts[1] = '180 offers analyzed as of 2026-05-05'
  // This exact editorial string should NOT appear inside fee-analysis-section
  const feeStart = html.indexOf('data-testid="fee-analysis-section"')
  const feeEnd = html.indexOf('</section>', feeStart)
  const feeHtml = html.slice(feeStart, feeEnd)
  assert.ok(
    !feeHtml.includes('offers analyzed as of'),
    'Fee section should not render raw tldr.key_facts editorial string'
  )
})

// Fix 8: FAQ Q3 answer uses airline display name, not carrier IATA code

test('[G2-F8] FAQ Q3 answer contains "Ryanair" display name for carrier code "FR"', () => {
  const html = render(BASE_DATA)
  const ddStart = html.indexOf('data-testid="faq-a-2"')
  const ddEnd = html.indexOf('</dd>', ddStart)
  const ddText = html.slice(ddStart, ddEnd)
  assert.ok(ddText.includes('Ryanair'), `FAQ Q3 answer should contain "Ryanair" display name, got: "${ddText.slice(0, 200)}"`)
})

test('[G2-F8] FAQ Q3 answer does not contain raw carrier IATA code as standalone text', () => {
  const html = render(BASE_DATA)
  const ddStart = html.indexOf('data-testid="faq-a-2"')
  const ddEnd = html.indexOf('</dd>', ddStart)
  const ddText = html.slice(ddStart, ddEnd)
  // Should not start with "FR has the lowest..." pattern
  assert.ok(!ddText.match(/>\s*FR\s+has/), `FAQ Q3 should not use raw IATA code "FR", got: "${ddText.slice(0, 200)}"`)
})

// Fix 9: FAQ Q5 answer is data-driven (bimodal vs non-bimodal paths)

test('[G2-F9] FAQ Q5 non-bimodal answer includes concrete offer count and price range', () => {
  const html = render(BASE_DATA) // is_bimodal: false
  const ddStart = html.indexOf('data-testid="faq-a-4"')
  const ddEnd = html.indexOf('</dd>', ddStart)
  const ddText = html.slice(ddStart, ddEnd)
  // Should include offer count (180) and/or actual price range
  assert.ok(
    ddText.includes('180') || ddText.includes('100') || ddText.includes('637'),
    `Non-bimodal FAQ Q5 should include data values (180 offers, min 100, max 637), got: "${ddText.slice(0, 300)}"`
  )
})

test('[G2-F9] FAQ Q5 bimodal answer explicitly mentions two fare clusters', () => {
  const html = render(BIMODAL_DATA)
  const ddStart = html.indexOf('data-testid="faq-a-4"')
  const ddEnd = html.indexOf('</dd>', ddStart)
  const ddText = html.slice(ddStart, ddEnd)
  assert.ok(
    ddText.toLowerCase().includes('two') || ddText.toLowerCase().includes('cluster') || ddText.includes('bimodal'),
    `Bimodal FAQ Q5 should mention two clusters, got: "${ddText.slice(0, 300)}"`
  )
})

// Fix 10: Staleness badge shows human-readable date / age, not "Live data"

test('[G2-F10] staleness badge "fresh" shows "Fresh" and month+year, not "Live data"', () => {
  const html = render(BASE_DATA) // staleness: 'fresh', snapshot_computed_at: '2026-05-05T10:00:00Z'
  const bdgStart = html.indexOf('data-testid="staleness-badge"')
  const bdgEnd = html.indexOf('</span>', bdgStart)
  const bdgText = html.slice(bdgStart, bdgEnd)
  assert.ok(!bdgText.includes('Live data'), `Staleness badge should not say "Live data", got: "${bdgText}"`)
  assert.ok(
    bdgText.includes('Fresh') || bdgText.includes('May') || bdgText.includes('2026'),
    `"fresh" badge should show "Fresh · Month YYYY", got: "${bdgText}"`
  )
})

test('[G2-F10] staleness badge "stale" shows days-old warning indicator', () => {
  const html = render(STALE_NOINDEX_DATA) // staleness: 'stale'
  const bdgStart = html.indexOf('data-testid="staleness-badge"')
  const bdgEnd = html.indexOf('</span>', bdgStart)
  const bdgText = html.slice(bdgStart, bdgEnd)
  assert.ok(
    bdgText.includes('⚠') || bdgText.toLowerCase().includes('old') || bdgText.includes('day'),
    `"stale" badge should show warning with days-old count, got: "${bdgText}"`
  )
})

test('[G2-F10] staleness badge "recent" shows "Updated N days ago"', () => {
  const recentData: RouteDistributionData = { ...BASE_DATA, staleness: 'recent' }
  const html = render(recentData)
  const bdgStart = html.indexOf('data-testid="staleness-badge"')
  const bdgEnd = html.indexOf('</span>', bdgStart)
  const bdgText = html.slice(bdgStart, bdgEnd)
  assert.ok(
    bdgText.includes('ago') || bdgText.toLowerCase().includes('updated') || bdgText.includes('day'),
    `"recent" badge should show "Updated N days ago", got: "${bdgText}"`
  )
})

// Fix 11: TLDR includes "typical range" and "full range" labels

test('[G2-F11] TLDR contains "typical range" label for p10–p90 span', () => {
  const html = render(BASE_DATA)
  const pStart = html.indexOf('data-testid="tldr-summary"')
  const pEnd = html.indexOf('</p>', pStart)
  const tldr = html.slice(pStart, pEnd)
  assert.ok(
    tldr.toLowerCase().includes('typical range') || tldr.toLowerCase().includes('typical'),
    `TLDR should include "typical range" label, got: "${tldr.slice(0, 400)}"`
  )
})

test('[G2-F11] TLDR contains "full range" label mentioning all offers for min–max span', () => {
  const html = render(BASE_DATA)
  const pStart = html.indexOf('data-testid="tldr-summary"')
  const pEnd = html.indexOf('</p>', pStart)
  const tldr = html.slice(pStart, pEnd)
  assert.ok(
    tldr.toLowerCase().includes('full range') || (tldr.includes('100') && tldr.includes('637')),
    `TLDR should include min-max full range (100–637), got: "${tldr.slice(0, 400)}"`
  )
})

// Fix 12: Hero variant A stat shows avg fees, not "from EUR min"

test('[G2-F12] hero variant A stat does not show "from EUR min" pattern', () => {
  const html = render(BASE_DATA, 'A')
  const statStart = html.indexOf('data-testid="hero-stat-price-range"')
  const statEnd = html.indexOf('</span>', statStart)
  const statText = html.slice(statStart, statEnd)
  assert.ok(
    !statText.match(/from\s+EUR\s+\d+/) && !statText.includes('from&nbsp;EUR'),
    `Hero variant A stat should not show "from EUR min", got: "${statText}"`
  )
})

test('[G2-F12] hero variant A stat with fee data shows avg fee amount', () => {
  const html = render(WITH_FEES_DATA, 'A') // avg_hidden_fees_amount: 35
  const statStart = html.indexOf('data-testid="hero-stat-price-range"')
  const statEnd = html.indexOf('</span>', statStart)
  const statText = html.slice(statStart, statEnd)
  assert.ok(
    statText.includes('35') || statText.toLowerCase().includes('fee'),
    `Hero variant A with fee data should show avg fee amount (35), got: "${statText}"`
  )
})

// ─── GROUP 4: Fixes 14-18 ────────────────────────────────────────────────────

// Fix 14: session_history table rendered when data present
test('[G4-F14] session_history table renders when session_history is provided', () => {
  const dataWithHistory = {
    ...BASE_DATA,
    session_history: [
      { session_id: 'sess-001', captured_at: '2026-05-01T08:00:00Z', total_offers: 150, median_price: 350, currency: 'EUR' },
      { session_id: 'sess-002', captured_at: '2026-05-03T10:00:00Z', total_offers: 165, median_price: 368, currency: 'EUR' },
    ],
  }
  const html = renderToStaticMarkup(<FlightPage data={dataWithHistory} />)
  assert.ok(html.includes('data-testid="session-history-table"'), 'session-history-table should be rendered when session_history present')
  assert.ok(html.includes('2026-05-01'), 'first session date should appear in table')
  assert.ok(html.includes('2026-05-03'), 'second session date should appear in table')
  assert.ok(html.includes('150'), 'first session offer count should appear')
  assert.ok(html.includes('165'), 'second session offer count should appear')
})

test('[G4-F14] session_history table NOT rendered when session_history absent', () => {
  const html = renderToStaticMarkup(<FlightPage data={BASE_DATA} />)
  assert.ok(!html.includes('data-testid="session-history-table"'), 'session-history-table should NOT render when session_history absent')
})

test('[G4-F14] session_history table NOT rendered when session_history is empty array', () => {
  const dataEmpty = { ...BASE_DATA, session_history: [] }
  const html = renderToStaticMarkup(<FlightPage data={dataEmpty} />)
  assert.ok(!html.includes('data-testid="session-history-table"'), 'session-history-table should NOT render when session_history is empty')
})

// Fix 15: histogram bars use inline style height, not data-height attribute
test('[G4-F15] histogram buckets use inline style for height, not data-height attribute', () => {
  const html = renderToStaticMarkup(<FlightPage data={BASE_DATA} />)
  // data-height should NOT appear
  assert.ok(!html.includes('data-height='), 'histogram bars should NOT use data-height attribute')
  // Should have inline style with height percentage
  assert.ok(html.includes('style="height:') || html.includes("style=\"height:"), 'histogram bars should have inline style height')
})

test('[G4-F15] histogram bucket min height is at least 4%', () => {
  const html = renderToStaticMarkup(<FlightPage data={BASE_DATA} />)
  // Extract all height values from style="height:X%"
  const matches = [...html.matchAll(/style="height:(\d+(?:\.\d+)?)%"/g)]
  assert.ok(matches.length > 0, 'histogram bars should have style height attributes')
  for (const [, pct] of matches) {
    assert.ok(parseFloat(pct) >= 4, `histogram bar height should be at least 4%, got ${pct}%`)
  }
})

// Fix 16: carrier table has NO img tags
test('[G4-F16] carrier table does NOT contain img elements for airline logos', () => {
  const html = renderToStaticMarkup(<FlightPage data={BASE_DATA} />)
  // Should not have airline logo img tags
  assert.ok(!html.includes('airline-logos'), 'carrier table should NOT contain airline-logos img src')
})

// Fix 17: secondary CTA H2 dynamic text
test('[G4-F17] secondary CTA H2 shows bimodal text when is_bimodal=true', () => {
  const html = renderToStaticMarkup(<FlightPage data={BIMODAL_DATA} />)
  const bimodalCarrierCount = BIMODAL_DATA.carrier_summary.length
  assert.ok(
    html.includes('two price clusters'),
    'bimodal secondary CTA H2 should say "two price clusters"'
  )
  assert.ok(
    html.includes(String(bimodalCarrierCount)),
    `bimodal secondary CTA H2 should include carrier count (${bimodalCarrierCount})`
  )
})

test('[G4-F17] secondary CTA H2 shows default text when is_bimodal=false', () => {
  const html = renderToStaticMarkup(<FlightPage data={BASE_DATA} />)
  const carrierCount = BASE_DATA.carrier_summary.length
  assert.ok(
    html.includes('compete on this route'),
    'default secondary CTA H2 should say "compete on this route"'
  )
  assert.ok(
    html.includes(String(carrierCount)),
    `default secondary CTA H2 should include carrier count (${carrierCount})`
  )
})

// Fix 18: snapshot details wrapped in section with h2
test('[G4-F18] snapshot history details is wrapped in a section with aria-labelledby', () => {
  const data = { ...BASE_DATA, session_count: 5 }
  const html = renderToStaticMarkup(<FlightPage data={data} />)
  assert.ok(
    html.includes('data-testid="snapshot-history-section"'),
    'snapshot history should be wrapped in a section with data-testid="snapshot-history-section"'
  )
  assert.ok(
    html.includes('aria-labelledby="history-h2"'),
    'snapshot section should have aria-labelledby="history-h2"'
  )
  assert.ok(
    html.includes('id="history-h2"'),
    'section should contain an h2 with id="history-h2"'
  )
  assert.ok(
    html.includes('Search history for this route'),
    'h2 text should be "Search history for this route"'
  )
})

test('[G4-F18] snapshot details element is still present inside the section', () => {
  const data = { ...BASE_DATA, session_count: 5 }
  const html = renderToStaticMarkup(<FlightPage data={data} />)
  assert.ok(
    html.includes('data-testid="snapshot-history"'),
    'snapshot-history details element should still be present'
  )
})

// ═══════════════════════════════════════════════════════════════════════════
// GROUP 0 — P0 REGRESSION: SEO head elements
// ═══════════════════════════════════════════════════════════════════════════

// Fix 0A: Restore and finalize all SEO head elements

test('[G0-F0A] rendered <head> contains exactly one <title> element', () => {
  const head = extractHead(renderFullHtml(BASE_DATA))
  const titleMatches = head.match(/<title/g) ?? []
  assert.equal(titleMatches.length, 1, `<head> should contain exactly one <title>, got ${titleMatches.length}`)
})

test('[G0-F0A] rendered <head> contains <meta name="description"> with content attr', () => {
  const head = extractHead(renderFullHtml(BASE_DATA))
  assert.ok(
    head.includes('name="description"') && head.includes('content='),
    `<head> should contain <meta name="description" content="...">`
  )
})

test('[G0-F0A] meta description length is between 100 and 160 characters', () => {
  const head = extractHead(renderFullHtml(BASE_DATA))
  const m = head.match(/name="description"\s+content="([^"]+)"/)
  const desc = m?.[1] ?? ''
  assert.ok(
    desc.length >= 100 && desc.length <= 160,
    `meta description length should be 100–160 chars, got ${desc.length}: "${desc}"`
  )
})

test('[G0-F0A] rendered <head> contains <link rel="canonical"> with https URL', () => {
  const head = extractHead(renderFullHtml(BASE_DATA))
  const m = head.match(/rel="canonical"\s+href="([^"]+)"/)
  const href = m?.[1] ?? ''
  assert.ok(href.startsWith('https://'), `canonical href should start with https://, got: "${href}"`)
  assert.ok(href.includes('/flights/gdn-bcn'), `canonical href should contain /flights/gdn-bcn, got: "${href}"`)
})

test('[G0-F0A] canonical URL ends with trailing slash', () => {
  const head = extractHead(renderFullHtml(BASE_DATA))
  const m = head.match(/rel="canonical"\s+href="([^"]+)"/)
  const href = m?.[1] ?? ''
  assert.ok(href.endsWith('/'), `canonical href should end with trailing slash, got: "${href}"`)
})

test('[G0-F0A] rendered <body> contains no <title>, no JSON-LD, no canonical, no meta desc', () => {
  const html = renderFullHtml(BASE_DATA)
  const body = extractBody(html)
  assert.ok(!body.includes('<title'), '<body> must not contain <title>')
  assert.ok(!body.includes('ld+json'), '<body> must not contain JSON-LD')
  assert.ok(!body.includes('rel="canonical"'), '<body> must not contain canonical link')
  assert.ok(!body.includes('name="description"'), '<body> must not contain meta description')
})

// Fix 0B: Complete @graph with all 4 schema types

test('[G0-F0B] @graph contains item with @type "Article"', () => {
  const graph = extractJsonLdGraph(renderFullHtml(BASE_DATA))
  assert.ok(graph.some(x => x['@type'] === 'Article'), '@graph must contain Article')
})

test('[G0-F0B] @graph contains item with @type "FAQPage"', () => {
  const graph = extractJsonLdGraph(renderFullHtml(BASE_DATA))
  assert.ok(graph.some(x => x['@type'] === 'FAQPage'), '@graph must contain FAQPage')
})

test('[G0-F0B] @graph contains item with @type "BreadcrumbList"', () => {
  const graph = extractJsonLdGraph(renderFullHtml(BASE_DATA))
  assert.ok(graph.some(x => x['@type'] === 'BreadcrumbList'), '@graph must contain BreadcrumbList')
})

test('[G0-F0B] @graph contains item with @type "Dataset"', () => {
  const graph = extractJsonLdGraph(renderFullHtml(BASE_DATA))
  assert.ok(graph.some(x => x['@type'] === 'Dataset'), '@graph must contain Dataset')
})

test('[G0-F0B] Article.datePublished is a valid ISO 8601 string', () => {
  const graph = extractJsonLdGraph(renderFullHtml(BASE_DATA))
  const art = graph.find(x => x['@type'] === 'Article') as Record<string,unknown>|undefined
  assert.ok(art, 'Article must exist')
  const pub = art!['datePublished'] as string
  assert.ok(pub && !isNaN(Date.parse(pub)), `Article.datePublished should be valid ISO 8601, got: "${pub}"`)
})

test('[G0-F0B] Article.dateModified equals snapshot_computed_at ISO string', () => {
  const graph = extractJsonLdGraph(renderFullHtml(BASE_DATA))
  const art = graph.find(x => x['@type'] === 'Article') as Record<string,unknown>|undefined
  assert.equal(
    (art!['dateModified'] as string),
    BASE_DATA.snapshot_computed_at,
    'Article.dateModified should equal snapshot_computed_at'
  )
})

test('[G0-F0B] Article.author.@type is "Organization"', () => {
  const graph = extractJsonLdGraph(renderFullHtml(BASE_DATA))
  const art = graph.find(x => x['@type'] === 'Article') as Record<string,unknown>|undefined
  const author = art!['author'] as Record<string,unknown>
  assert.equal(author?.['@type'], 'Organization', 'Article.author.@type should be Organization')
})

test('[G0-F0B] Article.author.url is defined', () => {
  const graph = extractJsonLdGraph(renderFullHtml(BASE_DATA))
  const art = graph.find(x => x['@type'] === 'Article') as Record<string,unknown>|undefined
  const author = art!['author'] as Record<string,unknown>
  assert.ok(author?.['url'], `Article.author.url should be defined, got: ${JSON.stringify(author)}`)
})

test('[G0-F0B] Article.about contains departure and arrival Airport with iataCode', () => {
  const graph = extractJsonLdGraph(renderFullHtml(BASE_DATA))
  const art = graph.find(x => x['@type'] === 'Article') as Record<string,unknown>|undefined
  const about = art!['about'] as Record<string,unknown>
  assert.equal(about?.['@type'], 'Trip', 'Article.about should be Trip')
  const dep = about?.['departureLocation'] as Record<string,unknown>
  const arr = about?.['arrivalLocation'] as Record<string,unknown>
  assert.equal(dep?.['@type'], 'Airport', 'departureLocation should be Airport')
  assert.equal(arr?.['@type'], 'Airport', 'arrivalLocation should be Airport')
  assert.equal(dep?.['iataCode'], 'GDN', 'departure iataCode should be GDN')
  assert.equal(arr?.['iataCode'], 'BCN', 'arrival iataCode should be BCN')
})

test('[G0-F0B] BreadcrumbList has exactly 4 ListItem elements', () => {
  const graph = extractJsonLdGraph(renderFullHtml(BASE_DATA))
  const bc = graph.find(x => x['@type'] === 'BreadcrumbList') as Record<string,unknown>|undefined
  const items = (bc!['itemListElement'] as unknown[]) ?? []
  assert.equal(items.length, 4, `BreadcrumbList should have 4 items, got ${items.length}`)
})

test('[G0-F0B] ListItem position 4 item equals canonical URL', () => {
  const graph = extractJsonLdGraph(renderFullHtml(BASE_DATA))
  const bc = graph.find(x => x['@type'] === 'BreadcrumbList') as Record<string,unknown>|undefined
  const items = (bc!['itemListElement'] as Array<Record<string,unknown>>) ?? []
  const item4 = items.find(i => i['position'] === 4)
  assert.ok(item4, 'position 4 item should exist')
  const url = item4!['item'] as string
  assert.ok(url.includes('/flights/gdn-bcn') && url.endsWith('/'), `ListItem 4 item should be canonical URL, got: "${url}"`)
})

test('[G0-F0B] Dataset.variableMeasured has at least 13 PropertyValue items', () => {
  const graph = extractJsonLdGraph(renderFullHtml(BASE_DATA))
  const ds = graph.find(x => x['@type'] === 'Dataset') as Record<string,unknown>|undefined
  const vm = (ds!['variableMeasured'] as unknown[]) ?? []
  assert.ok(vm.length >= 13, `Dataset.variableMeasured should have >= 13 items, got ${vm.length}`)
})

test('[G0-F0B] Dataset.variableMeasured includes "avg_hidden_fees_amount"', () => {
  const graph = extractJsonLdGraph(renderFullHtml(BASE_DATA))
  const ds = graph.find(x => x['@type'] === 'Dataset') as Record<string,unknown>|undefined
  const vm = (ds!['variableMeasured'] as Array<Record<string,unknown>>) ?? []
  assert.ok(vm.some(v => v['name'] === 'avg_hidden_fees_amount'), 'variableMeasured must include avg_hidden_fees_amount')
})

test('[G0-F0B] Dataset.variableMeasured includes "budget_carrier_share_pct"', () => {
  const graph = extractJsonLdGraph(renderFullHtml(BASE_DATA))
  const ds = graph.find(x => x['@type'] === 'Dataset') as Record<string,unknown>|undefined
  const vm = (ds!['variableMeasured'] as Array<Record<string,unknown>>) ?? []
  assert.ok(vm.some(v => v['name'] === 'budget_carrier_share_pct'), 'variableMeasured must include budget_carrier_share_pct')
})

test('[G0-F0B] Dataset.measurementTechnique is defined and non-empty', () => {
  const graph = extractJsonLdGraph(renderFullHtml(BASE_DATA))
  const ds = graph.find(x => x['@type'] === 'Dataset') as Record<string,unknown>|undefined
  const tech = ds!['measurementTechnique'] as string
  assert.ok(tech && tech.length > 10, `Dataset.measurementTechnique should be non-empty string, got: "${tech}"`)
})

// ═══════════════════════════════════════════════════════════════════════════
// GROUP 1 — CONVERSION ARCHITECTURE
// ═══════════════════════════════════════════════════════════════════════════

// Fix 1A: date-variable-note in price distribution section

test('[G1-F1A] price distribution section contains date-variable-note element', () => {
  const html = render(BASE_DATA)
  assert.ok(
    html.includes('data-testid="date-variable-note"'),
    'price distribution section should contain a <p data-testid="date-variable-note">'
  )
})

test('[G1-F1A] date-variable-note appears between percentile-markers and the IQR sentence', () => {
  const html = render(BASE_DATA)
  const markersIdx = html.indexOf('data-testid="percentile-markers"')
  const noteIdx = html.indexOf('data-testid="date-variable-note"')
  // Note: IQR sentence is "50% of offers priced between"
  const iqrIdx = html.indexOf('50% of offers priced between')
  assert.ok(markersIdx > 0, 'percentile-markers should exist')
  assert.ok(noteIdx > markersIdx, `date-variable-note (${noteIdx}) should appear after percentile-markers (${markersIdx})`)
  assert.ok(iqrIdx === -1 || noteIdx < iqrIdx, 'date-variable-note should appear before or instead of IQR sentence')
})

test('[G1-F1A] date-variable-note mentions the snapshot month/year', () => {
  const html = render(BASE_DATA) // snapshot_computed_at: 2026-05-05
  const noteStart = html.indexOf('data-testid="date-variable-note"')
  const noteEnd = html.indexOf('</p>', noteStart)
  const noteText = html.slice(noteStart, noteEnd)
  assert.ok(
    noteText.includes('May') || noteText.includes('2026'),
    `date-variable-note should mention snapshot month/year (May 2026), got: "${noteText.slice(0, 200)}"`
  )
})

// Fix 1B: Connector insight with EUR spread + Type column

test('[G1-F1B] connector-insight contains a EUR spread value comparing cheapest to most expensive connector', () => {
  const html = render(BASE_DATA)
  // Cheapest: ryanair_direct p50=200, most expensive: skyscanner_meta p50=300 → spread = 100
  const insightStart = html.indexOf('data-testid="connector-insight"')
  const insightEnd = html.indexOf('</p>', insightStart)
  const insightText = html.slice(insightStart, insightEnd)
  assert.ok(
    insightText.includes('EUR') || insightText.includes(BASE_DATA.price_distribution.currency),
    `connector-insight should mention the currency, got: "${insightText.slice(0, 300)}"`
  )
  // Should mention count of connectors
  assert.ok(
    insightText.includes(String(BASE_DATA.connector_comparison.length)),
    `connector-insight should mention connector count (${BASE_DATA.connector_comparison.length}), got: "${insightText.slice(0, 300)}"`
  )
})

test('[G1-F1B] connector table has a "Type" column header', () => {
  const html = render(BASE_DATA)
  const tableStart = html.indexOf('data-testid="connector-table"')
  const theadEnd = html.indexOf('</thead>', tableStart)
  const theadHtml = html.slice(tableStart, theadEnd)
  assert.ok(
    theadHtml.includes('>Type<') || theadHtml.includes('>Type</'),
    `connector-table thead should include "Type" column, got: "${theadHtml}"`
  )
})

test('[G1-F1B] connector table rows contain type label (Direct / Meta / OTA)', () => {
  const html = render(BASE_DATA)
  const tableStart = html.indexOf('data-testid="connector-table"')
  const tableEnd = html.indexOf('</table>', tableStart)
  const tableHtml = html.slice(tableStart, tableEnd)
  assert.ok(
    tableHtml.includes('Direct') || tableHtml.includes('Meta') || tableHtml.includes('OTA'),
    `connector-table rows should include type labels (Direct/Meta/OTA), got excerpt: "${tableHtml.slice(0, 400)}"`
  )
})

// Fix 1C: FAQ micro-CTA conversion hooks (each answer contains a search link)

test('[G1-F1C] each FAQ answer contains an anchor tag with search link', () => {
  const html = render(BASE_DATA)
  for (let i = 0; i < 5; i++) {
    const ddStart = html.indexOf(`data-testid="faq-a-${i}"`)
    const ddEnd = html.indexOf('</dd>', ddStart)
    const ddHtml = html.slice(ddStart, ddEnd)
    assert.ok(
      ddHtml.includes('<a ') && ddHtml.includes('href='),
      `faq-a-${i} should contain an <a href="..."> search link, got: "${ddHtml.slice(0, 200)}"`
    )
  }
})

test('[G1-F1C] FAQ answer links point to /search with origin and dest params', () => {
  const html = render(BASE_DATA)
  const ddStart = html.indexOf('data-testid="faq-a-0"')
  const ddEnd = html.indexOf('</dd>', ddStart)
  const ddHtml = html.slice(ddStart, ddEnd)
  assert.ok(
    ddHtml.includes('/search') && (ddHtml.includes('GDN') || ddHtml.includes('gdn')),
    `FAQ answer link should point to /search with origin, got: "${ddHtml.slice(0, 300)}"`
  )
})

// Fix 1D: Secondary CTA text change

test('[G1-F1D] secondary CTA link says "Find flights for my dates", not "Customize your search"', () => {
  const html = render(BASE_DATA)
  const ctaStart = html.indexOf('data-testid="search-cta-secondary"')
  const ctaEnd = html.indexOf('</a>', ctaStart)
  const ctaText = html.slice(ctaStart, ctaEnd)
  assert.ok(
    !ctaText.includes('Customize'),
    `secondary CTA should not say "Customize your search", got: "${ctaText}"`
  )
  assert.ok(
    ctaText.includes('Find flights') || ctaText.toLowerCase().includes('find flights'),
    `secondary CTA should say "Find flights for my dates", got: "${ctaText}"`
  )
})

// Fix 1E: Total-cost reversal callout in fee section

test('[G1-F1E] fee section contains total-cost-callout when fee data is available', () => {
  const html = render(WITH_FEES_DATA)
  assert.ok(
    html.includes('data-testid="total-cost-callout"'),
    'fee section should contain total-cost-callout when avg_hidden_fees_amount is present'
  )
})

test('[G1-F1E] fee section contains total-cost-reversal-note when fee data is available', () => {
  const html = render(WITH_FEES_DATA)
  assert.ok(
    html.includes('data-testid="total-cost-reversal-note"'),
    'fee section should contain total-cost-reversal-note when avg_hidden_fees_amount is present'
  )
})

test('[G1-F1E] total-cost-callout is NOT rendered when no fee data', () => {
  const html = render(BASE_DATA) // no fee data
  assert.ok(
    !html.includes('data-testid="total-cost-callout"'),
    'total-cost-callout should NOT render when avg_hidden_fees_amount is null'
  )
})

// ═══════════════════════════════════════════════════════════════════════════
// GROUP 2 — PROSE & COPY FIXES
// ═══════════════════════════════════════════════════════════════════════════

// Fix 2A: TLDR rewrite — remove awkward "(typical range, excluding outliers)" bracket

test('[G2-F2A] TLDR does NOT contain "(typical range, excluding outliers)"', () => {
  const html = render(BASE_DATA)
  const tldrStart = html.indexOf('data-testid="tldr-summary"')
  const tldrEnd = html.indexOf('</p>', tldrStart)
  const tldr = html.slice(tldrStart, tldrEnd)
  assert.ok(
    !tldr.includes('(typical range, excluding outliers)'),
    `TLDR must not contain "(typical range, excluding outliers)", got: "${tldr.slice(0, 400)}"`
  )
})

test('[G2-F2A] TLDR still includes p10–p90 typical range values', () => {
  const html = render(BASE_DATA) // p10=153, p90=583
  const tldrStart = html.indexOf('data-testid="tldr-summary"')
  const tldrEnd = html.indexOf('</p>', tldrStart)
  const tldr = html.slice(tldrStart, tldrEnd)
  assert.ok(
    tldr.includes('153') && tldr.includes('583'),
    `TLDR should include p10 (153) and p90 (583) range values, got: "${tldr.slice(0, 400)}"`
  )
})

test('[G2-F2A] TLDR still includes offer count and median price', () => {
  const html = render(BASE_DATA) // total=180, p50=368
  const tldrStart = html.indexOf('data-testid="tldr-summary"')
  const tldrEnd = html.indexOf('</p>', tldrStart)
  const tldr = html.slice(tldrStart, tldrEnd)
  assert.ok(tldr.includes('180'), 'TLDR should include offer count (180)')
  assert.ok(tldr.includes('368'), 'TLDR should include p50 median (368)')
})

// Fix 2B: Fee section intro paragraph before fee table/content

test('[G2-F2B] fee section contains a fee-section-intro paragraph', () => {
  const html = render(BASE_DATA)
  assert.ok(
    html.includes('data-testid="fee-section-intro"'),
    'fee section should contain <p data-testid="fee-section-intro">'
  )
})

test('[G2-F2B] fee-section-intro mentions the route cities', () => {
  const html = render(BASE_DATA)
  const introStart = html.indexOf('data-testid="fee-section-intro"')
  const introEnd = html.indexOf('</p>', introStart)
  const introText = html.slice(introStart, introEnd)
  assert.ok(
    introText.includes('Gdansk') || introText.includes('Barcelona'),
    `fee-section-intro should mention route cities, got: "${introText.slice(0, 300)}"`
  )
})

test('[G2-F2B] fee-section-intro appears before fee-variance-insight', () => {
  const html = render(BASE_DATA)
  const introIdx = html.indexOf('data-testid="fee-section-intro"')
  const varianceIdx = html.indexOf('data-testid="fee-variance-insight"')
  assert.ok(introIdx > 0, 'fee-section-intro should exist')
  assert.ok(introIdx < varianceIdx, `fee-section-intro (${introIdx}) should appear before fee-variance-insight (${varianceIdx})`)
})

// Fix 2C: fee-variance-insight quantified with ratio when breakdown data is available

test('[G2-F2C] fee-variance-insight with medium variance and breakdown contains a ratio like "Nx"', () => {
  // WITH_FEES_DATA: fee_variance='medium', breakdown: [FR(avg_fee:25), W6(avg_fee:45)] → ratio = 45/25 = 1.8x
  const html = render(WITH_FEES_DATA)
  const insightStart = html.indexOf('data-testid="fee-variance-insight"')
  const insightEnd = html.indexOf('</p>', insightStart)
  const insightText = html.slice(insightStart, insightEnd)
  assert.ok(
    insightText.match(/\d+(?:\.\d+)?x/) || insightText.match(/\d+\.\d+[×x]/),
    `fee-variance-insight should contain a ratio like "1.8x" or "2.0x", got: "${insightText.slice(0, 300)}"`
  )
})

test('[G2-F2C] fee-variance-insight with medium variance does NOT say just "moderately"', () => {
  const html = render(WITH_FEES_DATA)
  const insightStart = html.indexOf('data-testid="fee-variance-insight"')
  const insightEnd = html.indexOf('</p>', insightStart)
  const insightText = html.slice(insightStart, insightEnd)
  assert.ok(
    !insightText.includes('vary moderately'),
    `fee-variance-insight should not say "vary moderately", got: "${insightText.slice(0, 300)}"`
  )
})

test('[G2-F2C] fee-variance-insight with low variance retains simple message', () => {
  const html = render(BASE_DATA) // fee_variance: 'low'
  const insightStart = html.indexOf('data-testid="fee-variance-insight"')
  const insightEnd = html.indexOf('</p>', insightStart)
  const insightText = html.slice(insightStart, insightEnd)
  assert.ok(insightText.length > 10, 'fee-variance-insight should still render for low variance')
})

// Fix 2D: buildKeyFacts returns comparative facts

test('[G2-F2D] at least one key fact contains comparative language (vs, than, gap, spread, x more)', () => {
  const html = render(BASE_DATA)
  let hasComparative = false
  for (let i = 0; i < 3; i++) {
    const liStart = html.indexOf(`data-testid="key-fact-${i}"`)
    const liEnd = html.indexOf('</li>', liStart)
    const liText = html.slice(liStart, liEnd).toLowerCase()
    if (
      liText.includes(' vs ') || liText.includes(' than ') ||
      liText.includes('gap') || liText.includes('spread') ||
      liText.includes('compared') || liText.match(/\d+x /) ||
      liText.includes('despite') || liText.includes('cheaper') ||
      liText.includes('pricier') || liText.includes('lower') ||
      liText.includes('higher')
    ) {
      hasComparative = true
      break
    }
  }
  assert.ok(hasComparative, 'At least one key fact should contain comparative language (vs/than/gap/spread/cheaper/higher etc.)')
})

test('[G2-F2D] key fact 2 (carrier comparison) includes cheapest airline name', () => {
  const html = render(BASE_DATA) // cheapest carrier FR → Ryanair
  const liStart = html.indexOf('data-testid="key-fact-2"')
  const liEnd = html.indexOf('</li>', liStart)
  const liText = html.slice(liStart, liEnd)
  assert.ok(
    liText.includes('Ryanair') || liText.includes('FR'),
    `key-fact-2 should mention the cheapest airline, got: "${liText.slice(0, 200)}"`
  )
})

// Fix 2E: FAQ Q5 answer contains 3+ numeric values from route data

test('[G2-F2E] FAQ Q5 answer contains at least 3 numbers derived from route data', () => {
  const html = render(BASE_DATA)
  // carrier_count=6, min=100, max=637, total_offers=180
  const ddStart = html.indexOf('data-testid="faq-a-4"')
  const ddEnd = html.indexOf('</dd>', ddStart)
  const ddText = html.slice(ddStart, ddEnd)
  const numbers = ddText.match(/\d+/g) ?? []
  assert.ok(
    numbers.length >= 3,
    `FAQ Q5 answer should contain at least 3 numbers from route data, got ${numbers.length}: "${ddText.slice(0, 400)}"`
  )
})

test('[G2-F2E] FAQ Q5 answer does NOT end with generic "cabin class, booking timing, and ancillary fees"', () => {
  const html = render(BASE_DATA)
  const ddStart = html.indexOf('data-testid="faq-a-4"')
  const ddEnd = html.indexOf('</dd>', ddStart)
  const ddText = html.slice(ddStart, ddEnd)
  assert.ok(
    !ddText.includes('cabin class, booking timing, and ancillary fees'),
    'FAQ Q5 should not end with the generic phrase from prior implementation'
  )
})

// ═══════════════════════════════════════════════════════════════════════════
// GROUP 3 — TRUST & UX FIXES
// ═══════════════════════════════════════════════════════════════════════════

// Fix 3A: Social proof → offer count, not "community members"

test('[G3-F3A] social proof shows offer count, not session_count community members', () => {
  const data = { ...BASE_DATA, session_count: 10 } // was triggering community members
  const html = render(data)
  const spStart = html.indexOf('data-testid="social-proof"')
  const spEnd = html.indexOf('</p>', spStart)
  const spText = html.slice(spStart, spEnd)
  assert.ok(
    !spText.includes('community member'),
    `social-proof should NOT say "community members", got: "${spText}"`
  )
})

test('[G3-F3A] social proof contains offer count (total_offers_analyzed)', () => {
  const html = render(BASE_DATA) // total_offers_analyzed: 180
  const spStart = html.indexOf('data-testid="social-proof"')
  const spEnd = html.indexOf('</p>', spStart)
  const spText = html.slice(spStart, spEnd)
  assert.ok(
    spText.includes('180'),
    `social-proof should contain total_offers_analyzed (180), got: "${spText}"`
  )
})

test('[G3-F3A] social proof contains "analyzed" or "offers"', () => {
  const html = render(BASE_DATA)
  const spStart = html.indexOf('data-testid="social-proof"')
  const spEnd = html.indexOf('</p>', spStart)
  const spText = html.slice(spStart, spEnd)
  assert.ok(
    spText.toLowerCase().includes('analyzed') || spText.toLowerCase().includes('offers'),
    `social-proof should say "analyzed" or "offers", got: "${spText}"`
  )
})

// Fix 3B: Session history table has 5 columns (Date, Offers, Median, Airlines, Connectors)

test('[G3-F3B] session history table has 5 column headers', () => {
  const dataWithHistory = {
    ...BASE_DATA,
    session_count: 5,
    session_history: [
      {
        session_id: 'sess-001', captured_at: '2026-05-01T08:00:00Z',
        total_offers: 150, median_price: 350, currency: 'EUR',
        airline_count: 5, connector_count: 12,
      },
    ],
  }
  const html = renderToStaticMarkup(<FlightPage data={dataWithHistory} />)
  const tableStart = html.indexOf('data-testid="session-history-table"')
  const theadEnd = html.indexOf('</thead>', tableStart)
  const theadHtml = html.slice(tableStart, theadEnd)
  const thCount = (theadHtml.match(/<th[\s>]/g) ?? []).length
  assert.equal(thCount, 5, `session-history-table should have 5 columns, got ${thCount}: "${theadHtml}"`)
})

test('[G3-F3B] session history table headers include "Airlines" and "Connectors"', () => {
  const dataWithHistory = {
    ...BASE_DATA,
    session_count: 5,
    session_history: [
      {
        session_id: 'sess-001', captured_at: '2026-05-01T08:00:00Z',
        total_offers: 150, median_price: 350, currency: 'EUR',
        airline_count: 5, connector_count: 12,
      },
    ],
  }
  const html = renderToStaticMarkup(<FlightPage data={dataWithHistory} />)
  const tableStart = html.indexOf('data-testid="session-history-table"')
  const theadEnd = html.indexOf('</thead>', tableStart)
  const theadHtml = html.slice(tableStart, theadEnd)
  assert.ok(theadHtml.includes('Airlines'), `table headers should include "Airlines", got: "${theadHtml}"`)
  assert.ok(theadHtml.includes('Connectors'), `table headers should include "Connectors", got: "${theadHtml}"`)
})

test('[G3-F3B] session history table rows show airline_count and connector_count values', () => {
  const dataWithHistory = {
    ...BASE_DATA,
    session_count: 5,
    session_history: [
      {
        session_id: 'sess-001', captured_at: '2026-05-01T08:00:00Z',
        total_offers: 150, median_price: 350, currency: 'EUR',
        airline_count: 5, connector_count: 12,
      },
    ],
  }
  const html = renderToStaticMarkup(<FlightPage data={dataWithHistory} />)
  const tableStart = html.indexOf('data-testid="session-history-table"')
  const tableEnd = html.indexOf('</table>', tableStart)
  const tableHtml = html.slice(tableStart, tableEnd)
  assert.ok(tableHtml.includes('>5<') || tableHtml.includes('>5</'), 'airline_count (5) should appear in table row')
  assert.ok(tableHtml.includes('>12<') || tableHtml.includes('>12</'), 'connector_count (12) should appear in table row')
})

// Fix 3C: Connector delta "vs group avg" column header

test('[G3-F3C] connector table "vs avg" column says "vs group avg" or "vs type avg"', () => {
  const html = render(BASE_DATA)
  const tableStart = html.indexOf('data-testid="connector-table"')
  const theadEnd = html.indexOf('</thead>', tableStart)
  const theadHtml = html.slice(tableStart, theadEnd)
  assert.ok(
    theadHtml.includes('group avg') || theadHtml.includes('type avg'),
    `connector-table header should say "vs group avg" or "vs type avg", got: "${theadHtml}"`
  )
})

// Fix 3D: Connector table has border-collapse CSS fix

test('[G3-F3D] connector table has border-collapse:collapse inline style', () => {
  const html = render(BASE_DATA)
  const tableStart = html.indexOf('data-testid="connector-table"')
  const tableTagEnd = html.indexOf('>', tableStart)
  const tableTag = html.slice(tableStart, tableTagEnd + 1)
  assert.ok(
    tableTag.includes('border-collapse') || tableTag.includes('borderCollapse'),
    `connector-table should have border-collapse style, got: "${tableTag}"`
  )
})

// ═══════════════════════════════════════════════════════════════════════════
// FINAL PRE-LAUNCH PASS — GROUP 0: BLOCKERS
// ═══════════════════════════════════════════════════════════════════════════

// Fix 0A (new): robots meta, title content, stricter desc length, ld+json presence

test('[FPL-G0-F0A] <head> contains <meta name="robots" content="index, follow">', () => {
  const head = extractHead(renderFullHtml(BASE_DATA))
  assert.ok(
    head.includes('name="robots"') && head.includes('index, follow'),
    `<head> should contain <meta name="robots" content="index, follow">, got head excerpt: "${head.slice(0, 300)}"`
  )
})

test('[FPL-G0-F0A] <title> text contains both origin city and destination city', () => {
  const head = extractHead(renderFullHtml(BASE_DATA))
  const titleMatch = head.match(/<title>([^<]+)<\/title>/)
  const titleText = titleMatch?.[1] ?? ''
  assert.ok(titleText.includes('Gdansk'), `<title> should contain origin city Gdansk, got: "${titleText}"`)
  assert.ok(titleText.includes('Barcelona'), `<title> should contain dest city Barcelona, got: "${titleText}"`)
})

test('[FPL-G0-F0A] meta description content is between 140 and 160 characters', () => {
  const head = extractHead(renderFullHtml(BASE_DATA))
  const m = head.match(/name="description"\s+content="([^"]+)"/)
  const desc = m?.[1] ?? ''
  assert.ok(
    desc.length >= 140 && desc.length <= 160,
    `meta description length should be 140–160 chars, got ${desc.length}: "${desc}"`
  )
})

test('[FPL-G0-F0A] <head> contains <script type="application/ld+json">', () => {
  const head = extractHead(renderFullHtml(BASE_DATA))
  assert.ok(
    head.includes('type="application/ld+json"') || head.includes("type='application/ld+json'"),
    `<head> should contain <script type="application/ld+json">`
  )
})

// Fix 0C: Key facts — comparative insights, not restatements

test('[FPL-G0-F0C] key-fact-0 first 40 chars do not appear verbatim in tldr text', () => {
  const html = render(BASE_DATA)
  const kfStart = html.indexOf('data-testid="key-fact-0"')
  const kfEnd = html.indexOf('</li>', kfStart)
  const kfText = html.slice(kfStart, kfEnd).replace(/^[^>]+>/, '').trim()
  const first40 = kfText.slice(0, 40)
  const tldrStart = html.indexOf('data-testid="tldr-summary"')
  const tldrEnd = html.indexOf('</p>', tldrStart)
  const tldrText = html.slice(tldrStart, tldrEnd)
  assert.ok(
    first40.length < 10 || !tldrText.includes(first40),
    `key-fact-0 first 40 chars ("${first40}") should NOT appear verbatim in tldr summary`
  )
})

test('[FPL-G0-F0C] key-fact-0 contains a ratio or multiplier (Nx) comparing LCC and FSC', () => {
  const html = render(BASE_DATA)
  const kfStart = html.indexOf('data-testid="key-fact-0"')
  const kfEnd = html.indexOf('</li>', kfStart)
  const kfText = html.slice(kfStart, kfEnd)
  assert.ok(
    kfText.match(/\d+(?:\.\d+)?x/) || kfText.match(/\d+\.\d+[×x]/i),
    `key-fact-0 should contain a ratio like "2.0x" comparing LCC and FSC, got: "${kfText.slice(0, 300)}"`
  )
})

test('[FPL-G0-F0C] key-fact-1 contains both highest-fee and lowest-fee carrier names', () => {
  const html = render(WITH_FULL_FEES_DATA) // British Airways: 55, LOT Polish: 15
  const kfStart = html.indexOf('data-testid="key-fact-1"')
  const kfEnd = html.indexOf('</li>', kfStart)
  const kfText = html.slice(kfStart, kfEnd)
  assert.ok(
    kfText.includes('British Airways'),
    `key-fact-1 should contain max fee carrier name "British Airways", got: "${kfText.slice(0, 300)}"`
  )
  assert.ok(
    kfText.includes('LOT Polish'),
    `key-fact-1 should contain min fee carrier name "LOT Polish", got: "${kfText.slice(0, 300)}"`
  )
})

test('[FPL-G0-F0C] key-fact-2 contains connector spread EUR value and connector count', () => {
  const html = render(BASE_DATA) // connectors: 5, spread=300-200=100
  const kfStart = html.indexOf('data-testid="key-fact-2"')
  const kfEnd = html.indexOf('</li>', kfStart)
  const kfText = html.slice(kfStart, kfEnd)
  // Should contain spread value (100) and connector count (5)
  assert.ok(
    kfText.includes('100'),
    `key-fact-2 should contain spread value 100 (EUR 300-200), got: "${kfText.slice(0, 300)}"`
  )
  assert.ok(
    kfText.includes('5'),
    `key-fact-2 should contain connector count 5, got: "${kfText.slice(0, 300)}"`
  )
})

test('[FPL-G0-F0C] each key fact is between 80 and 240 characters', () => {
  const html = render(WITH_FULL_FEES_DATA)
  for (let i = 0; i < 3; i++) {
    const liStart = html.indexOf(`data-testid="key-fact-${i}"`)
    const liEnd = html.indexOf('</li>', liStart)
    // Strip the data-testid wrapper tag to get only text content
    const liHtml = html.slice(liStart, liEnd)
    const textContent = liHtml.replace(/<[^>]+>/g, '').trim()
    assert.ok(
      textContent.length >= 80 && textContent.length <= 240,
      `key-fact-${i} text length should be 80–240 chars, got ${textContent.length}: "${textContent.slice(0, 100)}..."`
    )
  }
})

// Fix 0D: Snapshot history — limit to last 5 rows

test('[FPL-G0-F0D] snapshot history table shows at most 5 rows when session_history has more than 5', () => {
  const dataWith8Sessions: RouteDistributionData = {
    ...BASE_DATA,
    session_count: 24,
    session_history: Array.from({ length: 8 }, (_, i) => ({
      session_id: `sess-${i + 1}`,
      captured_at: `2026-0${Math.min(5, i + 1)}-0${(i % 28) + 1}T10:00:00Z`,
      total_offers: 150 + i * 5,
      median_price: 350 + i * 3,
      currency: 'EUR',
      airline_count: 5,
      connector_count: 12,
    })),
  }
  const html = renderToStaticMarkup(<FlightPage data={dataWith8Sessions} />)
  const tableStart = html.indexOf('data-testid="session-history-table"')
  if (tableStart === -1) {
    assert.fail('session-history-table should be rendered')
  }
  const tableEnd = html.indexOf('</table>', tableStart)
  const tableHtml = html.slice(tableStart, tableEnd)
  const tbodyStart = tableHtml.indexOf('<tbody>')
  const tbodyEnd = tableHtml.indexOf('</tbody>')
  const tbodyHtml = tbodyStart >= 0 ? tableHtml.slice(tbodyStart, tbodyEnd) : tableHtml
  const rowCount = (tbodyHtml.match(/<tr>/g) ?? []).length
  assert.ok(rowCount <= 5, `session history table should show at most 5 data rows, got ${rowCount}`)
  assert.ok(rowCount >= 1, `session history table should show at least 1 row`)
})

test('[FPL-G0-F0D] when session_count < 3, snapshot history section is not rendered', () => {
  const lowSessionData: RouteDistributionData = { ...BASE_DATA, session_count: 2 }
  const html = renderToStaticMarkup(<FlightPage data={lowSessionData} />)
  assert.ok(
    !html.includes('data-testid="snapshot-history-section"'),
    'snapshot history section should NOT render when session_count < 3'
  )
})

// ═══════════════════════════════════════════════════════════════════════════
// FINAL PRE-LAUNCH PASS — GROUP 1: HIGH IMPACT
// ═══════════════════════════════════════════════════════════════════════════

// Fix 1A: total-cost-callout as carrier comparison, not generic average

test('[FPL-G1-F1A] total-cost-callout contains at least 2 carrier names', () => {
  const html = render(WITH_FEES_DATA)
  const calloutStart = html.indexOf('data-testid="total-cost-callout"')
  const calloutEnd = html.indexOf('</p>', calloutStart)
  const calloutText = html.slice(calloutStart, calloutEnd)
  // Should contain at least 2 distinct airline names from the breakdown
  const carrierNames = ['Ryanair', 'Wizz Air', 'easyJet', 'LOT Polish', 'Lufthansa', 'British Airways', 'FR', 'W6', 'U2']
  const found = carrierNames.filter(name => calloutText.includes(name))
  assert.ok(found.length >= 2, `total-cost-callout should contain at least 2 carrier names, found: [${found.join(', ')}] in: "${calloutText.slice(0, 300)}"`)
})

test('[FPL-G1-F1A] total-cost-callout contains base fare + fee = total math for 2 carriers', () => {
  const html = render(WITH_FEES_DATA)
  const calloutStart = html.indexOf('data-testid="total-cost-callout"')
  const calloutEnd = html.indexOf('</p>', calloutStart)
  const calloutText = html.slice(calloutStart, calloutEnd)
  // Should contain a fee/base/total breakdown with numbers
  // e.g. "base EUR 175 + fees EUR 25 = total EUR 200"
  const numbersFound = (calloutText.match(/EUR\s*\d+|\d+\s*EUR/gi) ?? []).length
  assert.ok(
    numbersFound >= 4,
    `total-cost-callout should contain at least 4 currency+number pairs (base/fee/total for 2 carriers), got ${numbersFound}: "${calloutText.slice(0, 300)}"`
  )
})

test('[FPL-G1-F1A] total-cost-callout is not a single generic average sentence', () => {
  const html = render(WITH_FEES_DATA)
  const calloutStart = html.indexOf('data-testid="total-cost-callout"')
  const calloutEnd = html.indexOf('</p>', calloutStart)
  const calloutText = html.slice(calloutStart, calloutEnd)
  assert.ok(
    !calloutText.includes('Add') && !calloutText.match(/^[^.]+average fees to base fare/),
    `total-cost-callout should not be a generic "Add EUR X in average fees" sentence, got: "${calloutText.slice(0, 200)}"`
  )
})

test('[FPL-G1-F1A] total-cost-reversal-note names the two carriers being compared', () => {
  const html = render(WITH_FEES_DATA)
  const noteStart = html.indexOf('data-testid="total-cost-reversal-note"')
  const noteEnd = html.indexOf('</p>', noteStart)
  const noteText = html.slice(noteStart, noteEnd)
  const carrierNames = ['Ryanair', 'Wizz Air', 'easyJet', 'LOT Polish', 'Lufthansa', 'British Airways', 'FR', 'W6']
  const found = carrierNames.filter(name => noteText.includes(name))
  assert.ok(found.length >= 2, `total-cost-reversal-note should name 2 carriers, found [${found.join(', ')}] in: "${noteText.slice(0, 300)}"`)
})

test('[FPL-G1-F1A] total-cost-reversal-note contains "despite" or "closes" or "gap"', () => {
  const html = render(WITH_FEES_DATA)
  const noteStart = html.indexOf('data-testid="total-cost-reversal-note"')
  const noteEnd = html.indexOf('</p>', noteStart)
  const noteText = html.slice(noteStart, noteEnd).toLowerCase()
  assert.ok(
    noteText.includes('despite') || noteText.includes('closes') || noteText.includes('gap'),
    `total-cost-reversal-note should contain "despite", "closes", or "gap", got: "${noteText.slice(0, 200)}"`
  )
})

// Fix 1B: Connector insight — multi-connector value argument

test('[FPL-G1-F1B] connector insight argues for searching all connectors simultaneously', () => {
  const html = render(BASE_DATA)
  const insightStart = html.indexOf('data-testid="connector-insight"')
  const insightEnd = html.indexOf('</p>', insightStart)
  const insightText = html.slice(insightStart, insightEnd).toLowerCase()
  assert.ok(
    insightText.includes('all') || insightText.includes('simultaneously'),
    `connector insight should argue for searching all connectors, got: "${insightText.slice(0, 300)}"`
  )
})

test('[FPL-G1-F1B] connector insight does not use single-connector "was cheaper than" pattern', () => {
  const html = render(BASE_DATA)
  const insightStart = html.indexOf('data-testid="connector-insight"')
  const insightEnd = html.indexOf('</p>', insightStart)
  const insightText = html.slice(insightStart, insightEnd)
  assert.ok(
    !insightText.match(/was EUR \d+ cheaper than/),
    `connector insight should not say "was EUR N cheaper than" — got: "${insightText.slice(0, 300)}"`
  )
})

// Fix 1C: Distinct FAQ hook CTAs per question

test('[FPL-G1-F1C] faq-a-0 hook link text contains "dates" or "your price"', () => {
  const html = render(BASE_DATA)
  const ddStart = html.indexOf('data-testid="faq-a-0"')
  const ddEnd = html.indexOf('</dd>', ddStart)
  const ddHtml = html.slice(ddStart, ddEnd)
  const linkMatch = ddHtml.match(/<a [^>]*>([^<]+)<\/a>/)
  const linkText = (linkMatch?.[1] ?? '').toLowerCase()
  assert.ok(
    linkText.includes('dates') || linkText.includes('your price'),
    `faq-a-0 hook link text should contain "dates" or "your price", got: "${linkText}"`
  )
})

test('[FPL-G1-F1C] faq-a-1 hook link text contains "fees" or "itemized"', () => {
  const html = render(BASE_DATA)
  const ddStart = html.indexOf('data-testid="faq-a-1"')
  const ddEnd = html.indexOf('</dd>', ddStart)
  const ddHtml = html.slice(ddStart, ddEnd)
  const linkMatch = ddHtml.match(/<a [^>]*>([^<]+)<\/a>/)
  const linkText = (linkMatch?.[1] ?? '').toLowerCase()
  assert.ok(
    linkText.includes('fees') || linkText.includes('itemized'),
    `faq-a-1 hook link text should contain "fees" or "itemized", got: "${linkText}"`
  )
})

test('[FPL-G1-F1C] faq-a-2 hook link text contains "airline" or "your dates"', () => {
  const html = render(BASE_DATA)
  const ddStart = html.indexOf('data-testid="faq-a-2"')
  const ddEnd = html.indexOf('</dd>', ddStart)
  const ddHtml = html.slice(ddStart, ddEnd)
  const linkMatch = ddHtml.match(/<a [^>]*>([^<]+)<\/a>/)
  const linkText = (linkMatch?.[1] ?? '').toLowerCase()
  assert.ok(
    linkText.includes('airline') || linkText.includes('your dates'),
    `faq-a-2 hook link text should contain "airline" or "your dates", got: "${linkText}"`
  )
})

test('[FPL-G1-F1C] faq-a-3 hook link text contains "connectors" or "live"', () => {
  const html = render(BASE_DATA)
  const ddStart = html.indexOf('data-testid="faq-a-3"')
  const ddEnd = html.indexOf('</dd>', ddStart)
  const ddHtml = html.slice(ddStart, ddEnd)
  const linkMatch = ddHtml.match(/<a [^>]*>([^<]+)<\/a>/)
  const linkText = (linkMatch?.[1] ?? '').toLowerCase()
  assert.ok(
    linkText.includes('connectors') || linkText.includes('live'),
    `faq-a-3 hook link text should contain "connectors" or "live", got: "${linkText}"`
  )
})

test('[FPL-G1-F1C] faq-a-4 hook link text contains "distribution" or "range"', () => {
  const html = render(BASE_DATA)
  const ddStart = html.indexOf('data-testid="faq-a-4"')
  const ddEnd = html.indexOf('</dd>', ddStart)
  const ddHtml = html.slice(ddStart, ddEnd)
  const linkMatch = ddHtml.match(/<a [^>]*>([^<]+)<\/a>/)
  const linkText = (linkMatch?.[1] ?? '').toLowerCase()
  assert.ok(
    linkText.includes('distribution') || linkText.includes('range') || linkText.includes('where'),
    `faq-a-4 hook link text should contain "distribution", "range", or "where", got: "${linkText}"`
  )
})

test('[FPL-G1-F1C] no two FAQ hook link texts are identical', () => {
  const html = render(BASE_DATA)
  const hookTexts: string[] = []
  for (let i = 0; i < 5; i++) {
    const ddStart = html.indexOf(`data-testid="faq-a-${i}"`)
    const ddEnd = html.indexOf('</dd>', ddStart)
    const ddHtml = html.slice(ddStart, ddEnd)
    const linkMatch = ddHtml.match(/<a [^>]*>([^<]+)<\/a>/)
    hookTexts.push(linkMatch?.[1] ?? `(no link ${i})`)
  }
  const unique = new Set(hookTexts)
  assert.equal(unique.size, 5, `All 5 FAQ hook link texts should be distinct, got: [${hookTexts.map(t => `"${t}"`).join(', ')}]`)
})

// Fix 1D: fee-variance-insight names both carriers

test('[FPL-G1-F1D] fee-variance-insight contains max_fee_carrier name (British Airways)', () => {
  const html = render(WITH_FULL_FEES_DATA) // British Airways: fee 55 (max), LOT Polish: fee 15 (min)
  const insightStart = html.indexOf('data-testid="fee-variance-insight"')
  const insightEnd = html.indexOf('</p>', insightStart)
  const insightText = html.slice(insightStart, insightEnd)
  assert.ok(
    insightText.includes('British Airways'),
    `fee-variance-insight should name the max fee carrier "British Airways", got: "${insightText.slice(0, 300)}"`
  )
})

test('[FPL-G1-F1D] fee-variance-insight contains min_fee_carrier name (LOT Polish)', () => {
  const html = render(WITH_FULL_FEES_DATA) // LOT Polish: fee 15 (min)
  const insightStart = html.indexOf('data-testid="fee-variance-insight"')
  const insightEnd = html.indexOf('</p>', insightStart)
  const insightText = html.slice(insightStart, insightEnd)
  assert.ok(
    insightText.includes('LOT Polish'),
    `fee-variance-insight should name the min fee carrier "LOT Polish", got: "${insightText.slice(0, 300)}"`
  )
})

// Fix 1E: date-variable-note — info gap, not staleness warning

test('[FPL-G1-F1E] date-variable-note contains "departure dates"', () => {
  const html = render(BASE_DATA)
  const noteStart = html.indexOf('data-testid="date-variable-note"')
  const noteEnd = html.indexOf('</p>', noteStart)
  const noteText = html.slice(noteStart, noteEnd)
  assert.ok(
    noteText.toLowerCase().includes('departure dates') || noteText.toLowerCase().includes('travel dates'),
    `date-variable-note should contain "departure dates" or "travel dates", got: "${noteText.slice(0, 300)}"`
  )
})

test('[FPL-G1-F1E] date-variable-note does not say "reflect data" or "data captured"', () => {
  const html = render(BASE_DATA)
  const noteStart = html.indexOf('data-testid="date-variable-note"')
  const noteEnd = html.indexOf('</p>', noteStart)
  const noteText = html.slice(noteStart, noteEnd)
  assert.ok(!noteText.includes('reflect data'), `date-variable-note must not say "reflect data", got: "${noteText.slice(0, 200)}"`)
  assert.ok(!noteText.includes('data captured'), `date-variable-note must not say "data captured", got: "${noteText.slice(0, 200)}"`)
})

test('[FPL-G1-F1E] date-variable-note contains action language about live search', () => {
  const html = render(BASE_DATA)
  const noteStart = html.indexOf('data-testid="date-variable-note"')
  const noteEnd = html.indexOf('</p>', noteStart)
  const noteText = html.slice(noteStart, noteEnd).toLowerCase()
  assert.ok(
    noteText.includes('live') || noteText.includes('where your') || noteText.includes('lands'),
    `date-variable-note should contain action language (live/where your/lands), got: "${noteText.slice(0, 300)}"`
  )
})

// Fix 1F: CSS double-border fix in render script

test('[FPL-G1-F1F] render script CSS does not use "section, details" compound selector', () => {
  const scriptPath = resolve(__dir, '../../../scripts/render-pfp-preview.tsx')
  const scriptContent = readFileSync(scriptPath, 'utf8')
  assert.ok(
    !scriptContent.includes('section, details {') && !scriptContent.includes('section,details{'),
    'render script should not use "section, details {" compound CSS selector — causes double-border on <details>'
  )
})

// ═══════════════════════════════════════════════════════════════════════════
// LAUNCH-GATE SESSION — GROUP 1A: Fix total-cost-callout misleading claim
// ═══════════════════════════════════════════════════════════════════════════

test('[LG-G1A] total-cost-reversal-note does NOT contain "close the gap" when LOT Polish vs BA (gap widens)', () => {
  // WITH_FULL_FEES_DATA: LOT Polish total=298, BA total=531
  // Base: LOT ~283, BA ~476 → base gap=193, total gap=233 → gap WIDENS, "close the gap" is false
  const html = render(WITH_FULL_FEES_DATA)
  const reversalStart = html.indexOf('data-testid="total-cost-reversal-note"')
  const reversalEnd = html.indexOf('</p>', reversalStart)
  const reversalText = reversalStart >= 0 ? html.slice(reversalStart, reversalEnd) : ''
  assert.ok(
    !reversalText.includes('close the gap'),
    `total-cost-reversal-note must not say "close the gap" when gap widens after fees, got: "${reversalText.slice(0, 300)}"`
  )
})

test('[LG-G1A] total-cost-callout uses the pair with maximum fee-narrowing (Wizz Air vs LOT Polish)', () => {
  // Wizz Air (total=215, fee=38) vs LOT Polish (total=298, fee=15):
  //   base gap = (298-15)-(215-38) = 283-177 = 106; total gap = 298-215 = 83; narrowing = 23 ✓
  const html = render(WITH_FULL_FEES_DATA)
  const calloutStart = html.indexOf('data-testid="total-cost-callout"')
  const calloutEnd = html.indexOf('</p>', calloutStart)
  const calloutText = calloutStart >= 0 ? html.slice(calloutStart, calloutEnd) : ''
  assert.ok(
    calloutText.includes('Wizz Air'),
    `total-cost-callout should use Wizz Air (highest fee-narrowing pair), got: "${calloutText.slice(0, 300)}"`
  )
  assert.ok(
    calloutText.includes('LOT Polish'),
    `total-cost-callout should use LOT Polish (highest fee-narrowing pair), got: "${calloutText.slice(0, 300)}"`
  )
})

test('[LG-G1A] total-cost-reversal-note describes the base-to-total gap narrowing with correct numbers', () => {
  // Wizz Air base~177 vs LOT base~283 = 106 gap; total 215 vs 298 = 83 gap; narrows by 23
  const html = render(WITH_FULL_FEES_DATA)
  const reversalStart = html.indexOf('data-testid="total-cost-reversal-note"')
  const reversalEnd = html.indexOf('</p>', reversalStart)
  const reversalText = reversalStart >= 0 ? html.slice(reversalStart, reversalEnd) : ''
  // Should mention "106" (base gap) and "83" (total gap) — or at least the narrowing framing
  assert.ok(
    reversalText.includes('106') && reversalText.includes('83'),
    `total-cost-reversal-note should cite base gap (106) and total gap (83), got: "${reversalText.slice(0, 400)}"`
  )
})

// ═══════════════════════════════════════════════════════════════════════════
// LAUNCH-GATE SESSION — GROUP 1B: Connector table footnote
// ═══════════════════════════════════════════════════════════════════════════

test('[LG-G1B] connector-comparison-section contains a footnote explaining "vs group avg" column', () => {
  const html = render(BASE_DATA)
  assert.ok(
    html.includes('data-testid="connector-group-note"'),
    'connector-comparison-section should contain connector-group-note element'
  )
})

test('[LG-G1B] connector-group-note explains Direct vs Meta grouping', () => {
  const html = render(BASE_DATA)
  const noteStart = html.indexOf('data-testid="connector-group-note"')
  const noteEnd = html.indexOf('</p>', noteStart)
  const noteText = noteStart >= 0 ? html.slice(noteStart, noteEnd) : ''
  assert.ok(
    noteText.includes('Direct') || noteText.toLowerCase().includes('direct'),
    `connector-group-note should mention "Direct" connector type, got: "${noteText.slice(0, 300)}"`
  )
  assert.ok(
    noteText.includes('Meta') || noteText.toLowerCase().includes('meta'),
    `connector-group-note should mention "Meta" connector type, got: "${noteText.slice(0, 300)}"`
  )
})

// ═══════════════════════════════════════════════════════════════════════════
// LAUNCH-GATE SESSION — GROUP 2A: Snapshot history table tests
// ═══════════════════════════════════════════════════════════════════════════

test('[LG-G2A] snapshot history <details> contains a <table> when session_count >= 3 and session_history provided', () => {
  const dataWithHistory: RouteDistributionData = {
    ...BASE_DATA,
    session_count: 5,
    session_history: [
      { session_id: 'sess-1', captured_at: '2026-04-01T10:00:00Z', total_offers: 160, median_price: 345, currency: 'EUR', airline_count: 5, connector_count: 12 },
      { session_id: 'sess-2', captured_at: '2026-04-15T10:00:00Z', total_offers: 172, median_price: 358, currency: 'EUR', airline_count: 6, connector_count: 14 },
      { session_id: 'sess-3', captured_at: '2026-05-01T10:00:00Z', total_offers: 180, median_price: 368, currency: 'EUR', airline_count: 6, connector_count: 15 },
    ],
  }
  const html = renderToStaticMarkup(<FlightPage data={dataWithHistory} />)
  const detailsStart = html.indexOf('data-testid="snapshot-history"')
  const detailsEnd = html.indexOf('</details>', detailsStart)
  const detailsHtml = detailsStart >= 0 ? html.slice(detailsStart, detailsEnd) : ''
  assert.ok(
    detailsHtml.includes('<table'),
    'snapshot history <details> should contain a <table> when session_count >= 3 and session_history provided'
  )
})

test('[LG-G2A] snapshot history table has columns: Date, Offers, Median, Airlines, Connectors', () => {
  const dataWithHistory: RouteDistributionData = {
    ...BASE_DATA,
    session_count: 3,
    session_history: [
      { session_id: 'sess-1', captured_at: '2026-05-01T10:00:00Z', total_offers: 180, median_price: 368, currency: 'EUR', airline_count: 6, connector_count: 15 },
    ],
  }
  const html = renderToStaticMarkup(<FlightPage data={dataWithHistory} />)
  const tableStart = html.indexOf('data-testid="session-history-table"')
  const tableEnd = html.indexOf('</table>', tableStart)
  const tableHtml = tableStart >= 0 ? html.slice(tableStart, tableEnd) : ''
  assert.ok(tableHtml.includes('Date'), 'session-history-table should have Date column')
  assert.ok(tableHtml.includes('Offers'), 'session-history-table should have Offers column')
  assert.ok(tableHtml.includes('Median'), 'session-history-table should have Median column')
  assert.ok(tableHtml.includes('Airlines'), 'session-history-table should have Airlines column')
  assert.ok(tableHtml.includes('Connectors'), 'session-history-table should have Connectors column')
})

test('[LG-G2A] snapshot history table has min(session_count, 5) data rows', () => {
  const dataWith7: RouteDistributionData = {
    ...BASE_DATA,
    session_count: 7,
    session_history: Array.from({ length: 7 }, (_, i) => ({
      session_id: `sess-${i + 1}`,
      captured_at: `2026-04-${String(i + 1).padStart(2, '0')}T10:00:00Z`,
      total_offers: 160 + i * 5,
      median_price: 340 + i * 4,
      currency: 'EUR',
      airline_count: 5 + (i % 2),
      connector_count: 12 + i,
    })),
  }
  const html = renderToStaticMarkup(<FlightPage data={dataWith7} />)
  const tableStart = html.indexOf('data-testid="session-history-table"')
  const tableEnd = html.indexOf('</table>', tableStart)
  const tableHtml = tableStart >= 0 ? html.slice(tableStart, tableEnd) : ''
  const tbodyStart = tableHtml.indexOf('<tbody>')
  const tbodyEnd = tableHtml.indexOf('</tbody>')
  const tbodyHtml = tbodyStart >= 0 ? tableHtml.slice(tbodyStart, tbodyEnd) : tableHtml
  const rowCount = (tbodyHtml.match(/<tr>/g) ?? []).length
  assert.equal(rowCount, 5, `session history table should show exactly min(7,5)=5 rows, got ${rowCount}`)
})

// ═══════════════════════════════════════════════════════════════════════════
// GROUP 0 — RICH RESULTS BLOCKER: FAQPage acceptedAnswer.text must be strings
// ═══════════════════════════════════════════════════════════════════════════

test('[G0-F1] all FAQPage acceptedAnswer.text values are plain strings', () => {
  const graph = extractJsonLdGraph(renderFullHtml(BASE_DATA))
  const faq = graph.find(n => n['@type'] === 'FAQPage') as Record<string, unknown>
  assert.ok(faq, 'FAQPage node should exist in @graph')
  const entities = faq['mainEntity'] as Array<Record<string, unknown>>
  assert.ok(Array.isArray(entities) && entities.length > 0, 'FAQPage should have mainEntity array')
  entities.forEach((q, i) => {
    const ans = q['acceptedAnswer'] as Record<string, unknown>
    assert.equal(
      typeof ans['text'], 'string',
      `FAQ Q${i} acceptedAnswer.text should be a plain string, got ${typeof ans['text']}: ${JSON.stringify(ans['text']).slice(0, 120)}`
    )
  })
})

test('[G0-F2] no acceptedAnswer.text contains "props" key', () => {
  const graph = extractJsonLdGraph(renderFullHtml(BASE_DATA))
  const faq = graph.find(n => n['@type'] === 'FAQPage') as Record<string, unknown>
  assert.ok(faq, 'FAQPage node should exist')
  const entities = faq['mainEntity'] as Array<Record<string, unknown>>
  entities.forEach((q, i) => {
    const ans = q['acceptedAnswer'] as Record<string, unknown>
    const textJson = JSON.stringify(ans['text'])
    assert.ok(
      !textJson.includes('"props"'),
      `FAQ Q${i} acceptedAnswer.text should not contain React "props" key — got serialized React element: ${textJson.slice(0, 120)}`
    )
  })
})

test('[G0-F3] no acceptedAnswer.text contains "_owner" key', () => {
  const graph = extractJsonLdGraph(renderFullHtml(BASE_DATA))
  const faq = graph.find(n => n['@type'] === 'FAQPage') as Record<string, unknown>
  assert.ok(faq, 'FAQPage node should exist')
  const entities = faq['mainEntity'] as Array<Record<string, unknown>>
  entities.forEach((q, i) => {
    const ans = q['acceptedAnswer'] as Record<string, unknown>
    const textJson = JSON.stringify(ans['text'])
    assert.ok(
      !textJson.includes('"_owner"'),
      `FAQ Q${i} acceptedAnswer.text should not contain React "_owner" key — got serialized React element: ${textJson.slice(0, 120)}`
    )
  })
})

test('[G0-F4] all acceptedAnswer.text strings are >= 60 characters', () => {
  const graph = extractJsonLdGraph(renderFullHtml(WITH_FULL_FEES_DATA))
  const faq = graph.find(n => n['@type'] === 'FAQPage') as Record<string, unknown>
  assert.ok(faq, 'FAQPage node should exist')
  const entities = faq['mainEntity'] as Array<Record<string, unknown>>
  entities.forEach((q, i) => {
    const ans = q['acceptedAnswer'] as Record<string, unknown>
    assert.equal(typeof ans['text'], 'string', `FAQ Q${i} text must be a string to check length`)
    assert.ok(
      (ans['text'] as string).length >= 60,
      `FAQ Q${i} text should be >= 60 chars, got ${(ans['text'] as string).length}: "${(ans['text'] as string).slice(0, 80)}"`
    )
  })
})

test('[G0-F5] all acceptedAnswer.text strings contain at least one EUR value', () => {
  const graph = extractJsonLdGraph(renderFullHtml(WITH_FULL_FEES_DATA))
  const faq = graph.find(n => n['@type'] === 'FAQPage') as Record<string, unknown>
  assert.ok(faq, 'FAQPage node should exist')
  const entities = faq['mainEntity'] as Array<Record<string, unknown>>
  entities.forEach((q, i) => {
    const ans = q['acceptedAnswer'] as Record<string, unknown>
    assert.equal(typeof ans['text'], 'string', `FAQ Q${i} text must be a string`)
    assert.ok(
      (ans['text'] as string).includes('EUR'),
      `FAQ Q${i} text should contain "EUR", got: "${(ans['text'] as string).slice(0, 120)}"`
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// GROUP 1A — Head element ordering (charset + viewport before title)
// ═══════════════════════════════════════════════════════════════════════════

test('[G1A-F1] <head> first element is <meta charset>', () => {
  const headHtml = buildFlightPageHeadHtml(BASE_DATA)
  assert.ok(
    headHtml.trimStart().startsWith('<meta charset'),
    `First element in buildFlightPageHeadHtml output should be <meta charset>, got: "${headHtml.trimStart().slice(0, 80)}"`
  )
})

test('[G1A-F2] <meta charset> appears before <title> in head string index', () => {
  const headHtml = buildFlightPageHeadHtml(BASE_DATA)
  const charsetPos = headHtml.indexOf('charset')
  const titlePos = headHtml.indexOf('<title')
  assert.ok(charsetPos >= 0, '<meta charset> must be present in buildFlightPageHeadHtml output')
  assert.ok(titlePos >= 0, '<title> must be present in buildFlightPageHeadHtml output')
  assert.ok(
    charsetPos < titlePos,
    `charset (pos ${charsetPos}) should appear before <title> (pos ${titlePos})`
  )
})

test('[G1A-F3] <meta viewport> appears before <title> in head string index', () => {
  const headHtml = buildFlightPageHeadHtml(BASE_DATA)
  const viewportPos = headHtml.indexOf('viewport')
  const titlePos = headHtml.indexOf('<title')
  assert.ok(viewportPos >= 0, '<meta viewport> must be present in buildFlightPageHeadHtml output')
  assert.ok(titlePos >= 0, '<title> must be present in buildFlightPageHeadHtml output')
  assert.ok(
    viewportPos < titlePos,
    `viewport (pos ${viewportPos}) should appear before <title> (pos ${titlePos})`
  )
})

// ═══════════════════════════════════════════════════════════════════════════
// GROUP 1B — Dataset measurementTechnique must use actual connector count
// ═══════════════════════════════════════════════════════════════════════════

test('[G1B-F1] Dataset measurementTechnique does not contain "180+"', () => {
  const graph = extractJsonLdGraph(renderFullHtml(BASE_DATA))
  const ds = graph.find(n => n['@type'] === 'Dataset') as Record<string, unknown>
  assert.ok(ds, 'Dataset node should exist in @graph')
  assert.ok(
    !(ds['measurementTechnique'] as string).includes('180+'),
    `measurementTechnique should not contain hardcoded "180+", got: "${ds['measurementTechnique']}"`
  )
})

test('[G1B-F2] Dataset measurementTechnique contains the actual connector count', () => {
  const graph = extractJsonLdGraph(renderFullHtml(BASE_DATA))
  const ds = graph.find(n => n['@type'] === 'Dataset') as Record<string, unknown>
  assert.ok(ds, 'Dataset node should exist in @graph')
  // BASE_DATA has 5 connectors in connector_comparison
  const expectedCount = String(BASE_DATA.connector_comparison.length) // "5"
  assert.ok(
    (ds['measurementTechnique'] as string).includes(expectedCount),
    `measurementTechnique should contain actual connector count "${expectedCount}", got: "${ds['measurementTechnique']}"`
  )
})

// ═══════════════════════════════════════════════════════════════════════════
// GROUP 1C — Snapshot history Connectors column definition footnote
// ═══════════════════════════════════════════════════════════════════════════

test('[G1C-F1] snapshot history Connectors column values are <= connector_count * 3', () => {
  const dataWithHistory: RouteDistributionData = {
    ...BASE_DATA,
    session_count: 3,
    session_history: [
      { session_id: 'sess-1', captured_at: '2026-03-01T10:00:00Z', total_offers: 143, median_price: 391, currency: 'EUR', airline_count: 5, connector_count: 11 },
      { session_id: 'sess-2', captured_at: '2026-04-15T10:00:00Z', total_offers: 159, median_price: 378, currency: 'EUR', airline_count: 6, connector_count: 13 },
      { session_id: 'sess-3', captured_at: '2026-05-05T10:00:00Z', total_offers: 180, median_price: 368, currency: 'EUR', airline_count: 6, connector_count: 15 },
    ],
  }
  const html = renderToStaticMarkup(<FlightPage data={dataWithHistory} />)
  const tableStart = html.indexOf('data-testid="session-history-table"')
  const tableEnd = html.indexOf('</table>', tableStart)
  const tableHtml = tableStart >= 0 ? html.slice(tableStart, tableEnd) : ''
  // Extract numeric cell values from Connectors column (5th cell, 0-indexed col 4)
  const rows = [...tableHtml.matchAll(/<tr>([\s\S]*?)<\/tr>/g)]
    .filter(m => m[1].includes('<td'))
  rows.forEach((row, i) => {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
      .map(m => m[1].replace(/<[^>]+>/g, '').trim())
    const connectorVal = parseInt(cells[4] ?? '0', 10)
    const maxAllowed = dataWithHistory.connector_comparison.length * 3
    assert.ok(
      connectorVal <= maxAllowed,
      `Row ${i} Connectors value ${connectorVal} exceeds max allowed ${maxAllowed} (connector_count * 3 = ${dataWithHistory.connector_comparison.length} * 3)`
    )
  })
})

test('[G1C-F2] snapshot history table has a footnote explaining the Connectors column', () => {
  const dataWithHistory: RouteDistributionData = {
    ...BASE_DATA,
    session_count: 3,
    session_history: [
      { session_id: 'sess-1', captured_at: '2026-03-01T10:00:00Z', total_offers: 143, median_price: 391, currency: 'EUR', airline_count: 5, connector_count: 11 },
    ],
  }
  const html = renderToStaticMarkup(<FlightPage data={dataWithHistory} />)
  const sectionStart = html.indexOf('data-testid="snapshot-history-section"')
  const sectionEnd = html.indexOf('</section>', sectionStart)
  const sectionHtml = sectionStart >= 0 ? html.slice(sectionStart, sectionEnd) : ''
  assert.ok(
    sectionHtml.includes('connector') || sectionHtml.includes('search'),
    `snapshot history section should have a footnote explaining what the Connectors column means, got section: "${sectionHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300)}"`
  )
  // The footnote must be in a <small> element
  const smallStart = sectionHtml.lastIndexOf('<small')
  assert.ok(
    smallStart >= 0,
    'snapshot history section should have a <small> footnote element'
  )
})

// ─── New: E-E-A-T / legal / related routes ─────────────────────────────────

test('[eeeat] disclaimer renders with preview snapshot text', () => {
  const html = renderToStaticMarkup(<FlightPage data={BASE_DATA} />)
  assert.ok(
    html.includes('data-testid="disclaimer"'),
    'disclaimer element missing',
  )
})

test('[eeeat] eeeat-attribution renders with methodology link', () => {
  const html = renderToStaticMarkup(<FlightPage data={BASE_DATA} />)
  assert.ok(
    html.includes('data-testid="eeeat-attribution"'),
    'eeeat-attribution element missing',
  )
  assert.ok(
    html.includes('/flights/methodology/'),
    'methodology link missing in eeeat-attribution',
  )
})

test('[eeeat] connector-data-note renders after connector table', () => {
  const html = renderToStaticMarkup(<FlightPage data={BASE_DATA} />)
  assert.ok(
    html.includes('data-testid="connector-data-note"'),
    'connector-data-note element missing',
  )
  const noteStart = html.indexOf('data-testid="connector-data-note"')
  const tableStart = html.indexOf('data-testid="connector-table"')
  assert.ok(
    noteStart > tableStart,
    'connector-data-note should appear after connector-table',
  )
})

test('[eeeat] article element has Schema.org Article microdata attributes', () => {
  const html = renderToStaticMarkup(<FlightPage data={BASE_DATA} />)
  assert.ok(
    html.includes('itemScope') || html.includes('itemscope'),
    'article should have itemScope',
  )
  assert.ok(
    html.includes('schema.org/Article'),
    'article should have schema.org/Article itemType',
  )
})

test('[related-routes] section renders when data.related_routes is provided', () => {
  const dataWithRoutes: RouteDistributionData = {
    ...BASE_DATA,
    related_routes: [
      { origin_iata: 'GDN', dest_iata: 'MAD', origin_city: 'Gdansk', dest_city: 'Madrid', median_price: 210, currency: 'EUR' },
      { origin_iata: 'GDN', dest_iata: 'LIS', origin_city: 'Gdansk', dest_city: 'Lisbon' },
    ],
  }
  const html = renderToStaticMarkup(<FlightPage data={dataWithRoutes} />)
  assert.ok(
    html.includes('data-testid="related-routes-section"'),
    'related-routes-section should render when related_routes is populated',
  )
  assert.ok(
    html.includes('data-testid="related-route-gdn-mad"'),
    'related route GDN-MAD link should render',
  )
  assert.ok(
    html.includes('/flights/gdn-mad/'),
    'related route href should be /flights/gdn-mad/',
  )
})

test('[related-routes] section does not render when data.related_routes is absent', () => {
  const html = renderToStaticMarkup(<FlightPage data={BASE_DATA} />)
  assert.ok(
    !html.includes('data-testid="related-routes-section"'),
    'related-routes-section should NOT render when related_routes is not set',
  )
})

test('[related-routes] section shows price when median_price and currency are present', () => {
  const dataWithRoutes: RouteDistributionData = {
    ...BASE_DATA,
    related_routes: [
      { origin_iata: 'GDN', dest_iata: 'MAD', origin_city: 'Gdansk', dest_city: 'Madrid', median_price: 210, currency: 'EUR' },
    ],
  }
  const html = renderToStaticMarkup(<FlightPage data={dataWithRoutes} />)
  assert.ok(html.includes('210'), 'median price 210 should appear in related routes section')
  assert.ok(html.includes('EUR'), 'currency EUR should appear in related routes section')
})
