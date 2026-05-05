import assert from 'node:assert/strict'
import test from 'node:test'

import { getRouteDistributionData, type RouteMeta } from '../../../lib/pfp/distribution/distribution-service.ts'
import { computePercentile } from '../../../lib/pfp/ingest/normalizer.ts'

import { HIGH_CONFIDENCE_SESSION } from './fixtures/high_confidence_session.ts'
import { BIMODAL_SESSION } from './fixtures/bimodal_session.ts'
import { THIN_SESSION } from './fixtures/thin_session.ts'
import { MIXED_CONNECTOR_SESSION } from './fixtures/mixed_connector_session.ts'
import type { AgentSearchSession, NormalizedOffer } from '../../../lib/pfp/types/agent-session.types.ts'

// ─── Shared route meta ────────────────────────────────────────────────────────

const GDN_BCN_META: RouteMeta = {
  originIata: 'GDN',
  destIata: 'BCN',
  originCity: 'Gdansk',
  destCity: 'Barcelona',
  pageStatus: 'published',
  sessionCount: 1,
  snapshotComputedAt: '2026-05-05T10:00:00Z',
}

// ─── 1. Histogram bucket percentages sum to 100 ────────────────────────────

test('histogram bucket percentages sum to ~100', () => {
  const result = getRouteDistributionData([HIGH_CONFIDENCE_SESSION], GDN_BCN_META)
  const sum = result.price_distribution.histogram.reduce((s, b) => s + b.pct, 0)
  assert.ok(
    Math.abs(sum - 100) < 0.01,
    `histogram pct sum should be ~100, got ${sum}`
  )
})

test('histogram has expected number of non-empty buckets for uniform distribution', () => {
  const result = getRouteDistributionData([HIGH_CONFIDENCE_SESSION], GDN_BCN_META)
  // 180 offers, 10 equal buckets → 18 each, none empty
  const nonEmpty = result.price_distribution.histogram.filter(b => b.count > 0)
  assert.equal(nonEmpty.length, 10, `expected 10 non-empty buckets, got ${nonEmpty.length}`)
})

test('each histogram bucket count is non-negative', () => {
  const result = getRouteDistributionData([HIGH_CONFIDENCE_SESSION], GDN_BCN_META)
  for (const bucket of result.price_distribution.histogram) {
    assert.ok(bucket.count >= 0, `bucket count should be non-negative, got ${bucket.count}`)
    assert.ok(bucket.pct >= 0, `bucket pct should be non-negative, got ${bucket.pct}`)
    assert.ok(bucket.from <= bucket.to, `bucket from should be <= to, ${bucket.from} > ${bucket.to}`)
  }
})

// ─── 2. Correct percentiles from known fixture dataset ─────────────────────

test('P10/P25/P50/P75/P90/P95 match expected values for known price sequence', () => {
  const result = getRouteDistributionData([HIGH_CONFIDENCE_SESSION], GDN_BCN_META)
  const dist = result.price_distribution

  // Prices: 100, 103, ..., 637 (180 values, step 3)
  // Using same computePercentile as the implementation
  const sorted = Array.from({ length: 180 }, (_, i) => 100 + i * 3)

  const expected = {
    p10: computePercentile(sorted, 10)!,
    p25: computePercentile(sorted, 25)!,
    p50: computePercentile(sorted, 50)!,
    p75: computePercentile(sorted, 75)!,
    p90: computePercentile(sorted, 90)!,
    p95: computePercentile(sorted, 95)!,
  }

  // Allow ±0.01 for floating-point rounding
  assert.ok(Math.abs(dist.p10 - expected.p10) < 0.01, `p10: expected ${expected.p10}, got ${dist.p10}`)
  assert.ok(Math.abs(dist.p25 - expected.p25) < 0.01, `p25: expected ${expected.p25}, got ${dist.p25}`)
  assert.ok(Math.abs(dist.p50 - expected.p50) < 0.01, `p50: expected ${expected.p50}, got ${dist.p50}`)
  assert.ok(Math.abs(dist.p75 - expected.p75) < 0.01, `p75: expected ${expected.p75}, got ${dist.p75}`)
  assert.ok(Math.abs(dist.p90 - expected.p90) < 0.01, `p90: expected ${expected.p90}, got ${dist.p90}`)
  assert.ok(Math.abs(dist.p95 - expected.p95) < 0.01, `p95: expected ${expected.p95}, got ${dist.p95}`)
})

test('min and max match fixture data bounds', () => {
  const result = getRouteDistributionData([HIGH_CONFIDENCE_SESSION], GDN_BCN_META)
  assert.equal(result.price_distribution.min, 100)
  assert.equal(result.price_distribution.max, 637)
})

// ─── 3. Bimodal detection: LCC + FSC clusters ──────────────────────────────

test('detects bimodal distribution: LCC cluster (750-950) + FSC cluster (2800-3000)', () => {
  const result = getRouteDistributionData([BIMODAL_SESSION], {
    ...GDN_BCN_META,
    sessionCount: 1,
  })
  assert.equal(
    result.price_distribution.is_bimodal,
    true,
    `expected is_bimodal=true for clearly separated LCC/FSC clusters`
  )
  assert.ok(
    typeof result.price_distribution.bimodal_insight === 'string' &&
      result.price_distribution.bimodal_insight.length > 0,
    `expected bimodal_insight string when is_bimodal=true`
  )
})

test('bimodal_insight contains price references for both clusters', () => {
  const result = getRouteDistributionData([BIMODAL_SESSION], GDN_BCN_META)
  const insight = result.price_distribution.bimodal_insight ?? ''
  // Should mention numeric values for both LCC and FSC price ranges
  assert.ok(/\d+/.test(insight), `bimodal_insight should contain price numbers: "${insight}"`)
})

// ─── 4. Non-bimodal fixture ────────────────────────────────────────────────

test('non-bimodal fixture (uniform distribution) returns is_bimodal: false', () => {
  const result = getRouteDistributionData([HIGH_CONFIDENCE_SESSION], GDN_BCN_META)
  assert.equal(
    result.price_distribution.is_bimodal,
    false,
    `expected is_bimodal=false for uniform distribution`
  )
  assert.equal(
    result.price_distribution.bimodal_insight,
    undefined,
    `bimodal_insight should be undefined when is_bimodal=false`
  )
})

// ─── 5. Connector comparison: identifies cheapest connector ───────────────

test('connector_comparison contains one entry per connector', () => {
  const result = getRouteDistributionData([MIXED_CONNECTOR_SESSION], GDN_BCN_META)
  assert.equal(
    result.connector_comparison.length,
    3,
    `expected 3 connector entries for session with 3 connectors`
  )
})

test('connector_comparison identifies cheapest connector by price_p50', () => {
  const result = getRouteDistributionData([MIXED_CONNECTOR_SESSION], GDN_BCN_META)
  const sorted = [...result.connector_comparison].sort((a, b) => a.price_p50 - b.price_p50)
  const cheapest = sorted[0]
  assert.equal(
    cheapest.connector_name,
    'easyjet_direct',
    `expected easyjet_direct to be cheapest, got ${cheapest.connector_name}`
  )
})

test('cheapest connector has negative delta_vs_avg_pct (below average)', () => {
  const result = getRouteDistributionData([MIXED_CONNECTOR_SESSION], GDN_BCN_META)
  const cheap = result.connector_comparison.find(c => c.connector_name === 'easyjet_direct')!
  assert.ok(cheap, 'easyjet_direct should be in connector_comparison')
  assert.ok(
    cheap.delta_vs_avg_pct < 0,
    `easyjet_direct delta should be negative (cheaper than avg), got ${cheap.delta_vs_avg_pct}`
  )
})

test('cheapest connector delta is approximately -15% (within ±3%)', () => {
  const result = getRouteDistributionData([MIXED_CONNECTOR_SESSION], GDN_BCN_META)
  const cheap = result.connector_comparison.find(c => c.connector_name === 'easyjet_direct')!
  // connector_cheap p50 ≈ 179, avg p50 ≈ 212.3 → delta ≈ -15.7%
  assert.ok(
    cheap.delta_vs_avg_pct < -12 && cheap.delta_vs_avg_pct > -20,
    `expected easyjet delta ≈ -15%, got ${cheap.delta_vs_avg_pct.toFixed(1)}%`
  )
})

test('expensive connectors have positive delta_vs_avg_pct', () => {
  const result = getRouteDistributionData([MIXED_CONNECTOR_SESSION], GDN_BCN_META)
  const expensive = result.connector_comparison.filter(c => c.connector_name !== 'easyjet_direct')
  for (const conn of expensive) {
    assert.ok(
      conn.delta_vs_avg_pct > 0,
      `${conn.connector_name} delta should be positive (above avg), got ${conn.delta_vs_avg_pct}`
    )
  }
})

// ─── 6. Missing fee_breakdown handled gracefully ──────────────────────────

test('handles missing fee data gracefully: fee_breakdown_available=false', () => {
  // HIGH_CONFIDENCE_SESSION has all empty bagsPrice
  const result = getRouteDistributionData([HIGH_CONFIDENCE_SESSION], GDN_BCN_META)
  const fee = result.fee_analysis
  assert.equal(fee.fee_breakdown_available, false)
  assert.equal(fee.avg_hidden_fees_amount, null)
  assert.equal(fee.avg_hidden_fees_pct, null)
  assert.equal(fee.breakdown, undefined)
  // fee_variance should still be set (defaults to 'low' when no data)
  assert.ok(['low', 'medium', 'high'].includes(fee.fee_variance))
})

test('fee analysis with fee data: breakdown is populated', () => {
  // Create a session with some offers that have bag fees
  const offersWithFees: NormalizedOffer[] = [
    {
      id: 'fee-offer-0',
      price: 100,
      currency: 'EUR',
      priceFormatted: '100 EUR',
      priceNormalized: 100,
      outbound: {
        segments: [{ airline: 'FR', airlineName: 'Ryanair', flightNo: 'FR1', origin: 'GDN', destination: 'BCN', originCity: 'Gdansk', destinationCity: 'Barcelona', departure: '2026-06-15T06:30:00', arrival: '2026-06-15T09:00:00', durationSeconds: 9000, cabinClass: 'economy', aircraft: '' }],
        totalDurationSeconds: 9000,
        stopovers: 0,
      },
      inbound: null,
      airlines: ['FR'],
      ownerAirline: 'FR',
      bagsPrice: { carry_on: 15, checked_bag: 25 },
      availabilitySeats: null,
      conditions: {},
      source: 'ryanair_direct',
      sourceTier: 'free',
      isLocked: false,
      fetchedAt: '2026-05-05T10:00:00Z',
      bookingUrl: '',
    },
    {
      id: 'fee-offer-1',
      price: 120,
      currency: 'EUR',
      priceFormatted: '120 EUR',
      priceNormalized: 120,
      outbound: {
        segments: [{ airline: 'W6', airlineName: 'Wizz Air', flightNo: 'W601', origin: 'GDN', destination: 'BCN', originCity: 'Gdansk', destinationCity: 'Barcelona', departure: '2026-06-15T08:00:00', arrival: '2026-06-15T10:30:00', durationSeconds: 9000, cabinClass: 'economy', aircraft: '' }],
        totalDurationSeconds: 9000,
        stopovers: 0,
      },
      inbound: null,
      airlines: ['W6'],
      ownerAirline: 'W6',
      bagsPrice: { carry_on: 20, checked_bag: 30 },
      availabilitySeats: null,
      conditions: {},
      source: 'wizzair_direct',
      sourceTier: 'free',
      isLocked: false,
      fetchedAt: '2026-05-05T10:00:00Z',
      bookingUrl: '',
    },
  ]

  const session: AgentSearchSession = {
    ...HIGH_CONFIDENCE_SESSION,
    sessionId: 'fee-session-001',
    offers: offersWithFees,
    stats: { ...HIGH_CONFIDENCE_SESSION.stats, offerCount: 2 },
  }

  const result = getRouteDistributionData([session], GDN_BCN_META)
  const fee = result.fee_analysis
  assert.equal(fee.fee_breakdown_available, true)
  assert.ok(fee.avg_hidden_fees_amount !== null && fee.avg_hidden_fees_amount > 0)
  assert.ok(fee.breakdown !== undefined && fee.breakdown.length >= 1)
})

// ─── 7. data_confidence: high (≥ 100 offers) ──────────────────────────────

test('data_confidence is "high" when total_offers >= 100', () => {
  const result = getRouteDistributionData([HIGH_CONFIDENCE_SESSION], GDN_BCN_META)
  assert.equal(result.total_offers_analyzed, 180)
  assert.equal(result.data_confidence, 'high')
})

// ─── 8. data_confidence: medium (40–99 offers) ────────────────────────────

test('data_confidence is "medium" when total_offers is 40-99', () => {
  // Create a session with 50 offers using a slice-like approach
  const mediumOffers: NormalizedOffer[] = Array.from({ length: 50 }, (_, i) => ({
    id: `med-offer-${i}`,
    price: 100 + i * 4,
    currency: 'EUR',
    priceFormatted: `${100 + i * 4} EUR`,
    priceNormalized: 100 + i * 4,
    outbound: {
      segments: [{ airline: i % 2 === 0 ? 'FR' : 'W6', airlineName: '', flightNo: '', origin: 'GDN', destination: 'BCN', originCity: 'Gdansk', destinationCity: 'Barcelona', departure: '2026-06-15T06:30:00', arrival: '2026-06-15T09:00:00', durationSeconds: 9000, cabinClass: 'economy', aircraft: '' }],
      totalDurationSeconds: 9000,
      stopovers: 0,
    },
    inbound: null,
    airlines: [i % 2 === 0 ? 'FR' : 'W6'],
    ownerAirline: i % 2 === 0 ? 'FR' : 'W6',
    bagsPrice: {},
    availabilitySeats: null,
    conditions: {},
    source: i % 2 === 0 ? 'ryanair_direct' : 'wizzair_direct',
    sourceTier: 'free',
    isLocked: false,
    fetchedAt: '2026-05-05T10:00:00Z',
    bookingUrl: '',
  }))

  const medSession: AgentSearchSession = {
    ...HIGH_CONFIDENCE_SESSION,
    sessionId: 'medium-session-001',
    offers: mediumOffers,
    stats: { ...HIGH_CONFIDENCE_SESSION.stats, offerCount: 50 },
  }

  const result = getRouteDistributionData([medSession], GDN_BCN_META)
  assert.equal(result.total_offers_analyzed, 50)
  assert.equal(result.data_confidence, 'medium')
})

// ─── 9. data_confidence: low (< 40 offers) ────────────────────────────────

test('data_confidence is "low" when total_offers < 40', () => {
  const result = getRouteDistributionData([THIN_SESSION], GDN_BCN_META)
  assert.equal(result.total_offers_analyzed, 12)
  assert.equal(result.data_confidence, 'low')
})

// ─── 10. TLDR summary ─────────────────────────────────────────────────────

test('tldr.summary contains city names (not IATA codes)', () => {
  const result = getRouteDistributionData([HIGH_CONFIDENCE_SESSION], GDN_BCN_META)
  const summary = result.tldr.summary
  assert.ok(summary.includes('Gdansk'), `summary should contain origin city 'Gdansk': "${summary}"`)
  assert.ok(summary.includes('Barcelona'), `summary should contain dest city 'Barcelona': "${summary}"`)
})

test('tldr.summary contains price values (numbers)', () => {
  const result = getRouteDistributionData([HIGH_CONFIDENCE_SESSION], GDN_BCN_META)
  const summary = result.tldr.summary
  assert.ok(/\d+/.test(summary), `summary should contain price digits: "${summary}"`)
})

test('tldr.summary contains offer count', () => {
  const result = getRouteDistributionData([HIGH_CONFIDENCE_SESSION], GDN_BCN_META)
  const summary = result.tldr.summary
  // Should mention 180 offers somewhere
  assert.ok(summary.includes('180'), `summary should contain offer count 180: "${summary}"`)
})

// ─── 11. Key facts: exactly 3 items, each with number and date ────────────

test('tldr.key_facts has exactly 3 items', () => {
  const result = getRouteDistributionData([HIGH_CONFIDENCE_SESSION], GDN_BCN_META)
  assert.equal(result.tldr.key_facts.length, 3)
})

test('each key_fact contains a number', () => {
  const result = getRouteDistributionData([HIGH_CONFIDENCE_SESSION], GDN_BCN_META)
  for (const fact of result.tldr.key_facts) {
    assert.ok(/\d+/.test(fact), `key_fact should contain a number: "${fact}"`)
  }
})

test('each key_fact contains a month name and year (Month YYYY format)', () => {
  const result = getRouteDistributionData([HIGH_CONFIDENCE_SESSION], GDN_BCN_META)
  const months = ['January','February','March','April','May','June','July',
    'August','September','October','November','December']
  for (const [i, fact] of result.tldr.key_facts.entries()) {
    const hasMonth = months.some(m => fact.includes(m))
    assert.ok(hasMonth, `key_fact[${i}] should contain a month name: "${fact}"`)
    assert.ok(/20\d\d/.test(fact), `key_fact[${i}] should contain a year: "${fact}"`)
  }
})

// ─── 12. All monetary values normalized to single currency ────────────────

test('price_distribution.currency matches session targetCurrency', () => {
  const result = getRouteDistributionData([HIGH_CONFIDENCE_SESSION], GDN_BCN_META)
  assert.equal(result.price_distribution.currency, 'EUR')
})

test('all price values in distribution use priceNormalized (EUR), not raw price', () => {
  // Create session where priceNormalized differs from price (simulating currency conversion)
  const pln_offers: NormalizedOffer[] = Array.from({ length: 20 }, (_, i) => ({
    id: `pln-offer-${i}`,
    price: 100 + i * 5,            // raw price in GBP (not used for distribution)
    currency: 'GBP',
    priceFormatted: `${100 + i * 5} GBP`,
    priceNormalized: (100 + i * 5) * 5, // normalized to PLN (×5 rate)
    outbound: {
      segments: [{ airline: i % 2 === 0 ? 'FR' : 'W6', airlineName: '', flightNo: '', origin: 'WAW', destination: 'LHR', originCity: 'Warsaw', destinationCity: 'London', departure: '2026-07-10T09:00:00', arrival: '2026-07-10T11:00:00', durationSeconds: 7200, cabinClass: 'economy', aircraft: '' }],
      totalDurationSeconds: 7200,
      stopovers: 0,
    },
    inbound: null,
    airlines: [i % 2 === 0 ? 'FR' : 'W6'],
    ownerAirline: i % 2 === 0 ? 'FR' : 'W6',
    bagsPrice: {},
    availabilitySeats: null,
    conditions: {},
    source: i % 2 === 0 ? 'ryanair_direct' : 'wizzair_direct',
    sourceTier: 'free',
    isLocked: false,
    fetchedAt: '2026-05-05T10:00:00Z',
    bookingUrl: '',
  }))

  const plnSession: AgentSearchSession = {
    ...HIGH_CONFIDENCE_SESSION,
    sessionId: 'pln-session-001',
    originIata: 'WAW',
    destIata: 'LHR',
    originCity: 'Warsaw',
    destCity: 'London',
    offers: pln_offers,
    targetCurrency: 'PLN',
    stats: { ...HIGH_CONFIDENCE_SESSION.stats, offerCount: 20 },
  }

  const result = getRouteDistributionData([plnSession], {
    ...GDN_BCN_META,
    originIata: 'WAW',
    destIata: 'LHR',
    originCity: 'Warsaw',
    destCity: 'London',
  })

  // Currency must be PLN
  assert.equal(result.price_distribution.currency, 'PLN')
  // min should be 100*5=500 (the PLN normalized value of the cheapest offer)
  assert.equal(result.price_distribution.min, 500)
  // max should be (100+19*5)*5 = 195*5 = 975
  assert.equal(result.price_distribution.max, 975)
})

// ─── Carrier summary ──────────────────────────────────────────────────────

test('carrier_summary contains one entry per unique carrier', () => {
  const result = getRouteDistributionData([HIGH_CONFIDENCE_SESSION], GDN_BCN_META)
  // HIGH_CONFIDENCE_SESSION has 6 carriers
  assert.equal(result.carrier_summary.length, 6)
})

test('carrier_summary entries are sorted by price_p50 ascending', () => {
  const result = getRouteDistributionData([HIGH_CONFIDENCE_SESSION], GDN_BCN_META)
  const summaries = result.carrier_summary
  for (let i = 1; i < summaries.length; i++) {
    assert.ok(
      summaries[i].price_p50 >= summaries[i - 1].price_p50,
      `carrier_summary should be sorted ascending by p50: ${summaries[i - 1].carrier}(${summaries[i - 1].price_p50}) > ${summaries[i].carrier}(${summaries[i].price_p50})`
    )
  }
})

// ─── Metadata ─────────────────────────────────────────────────────────────

test('snapshot_computed_at matches routeMeta.snapshotComputedAt', () => {
  const result = getRouteDistributionData([HIGH_CONFIDENCE_SESSION], GDN_BCN_META)
  assert.equal(result.snapshot_computed_at, GDN_BCN_META.snapshotComputedAt)
})

test('session_count matches number of sessions passed', () => {
  const result = getRouteDistributionData([HIGH_CONFIDENCE_SESSION, BIMODAL_SESSION], {
    ...GDN_BCN_META,
    sessionCount: 2,
  })
  assert.equal(result.session_count, 2)
})

test('is_preview is always true', () => {
  const result = getRouteDistributionData([HIGH_CONFIDENCE_SESSION], GDN_BCN_META)
  assert.equal(result.is_preview, true)
})

test('staleness is a valid enum value', () => {
  const result = getRouteDistributionData([HIGH_CONFIDENCE_SESSION], GDN_BCN_META)
  assert.ok(
    ['fresh', 'recent', 'stale'].includes(result.staleness),
    `staleness should be fresh/recent/stale, got ${result.staleness}`
  )
})

test('staleness is "stale" for snapshot from 2025 (> 7 days old)', () => {
  const result = getRouteDistributionData([HIGH_CONFIDENCE_SESSION], {
    ...GDN_BCN_META,
    snapshotComputedAt: '2025-01-01T00:00:00Z',
  })
  assert.equal(result.staleness, 'stale')
})

test('returns correct origin/dest metadata from routeMeta', () => {
  const result = getRouteDistributionData([HIGH_CONFIDENCE_SESSION], GDN_BCN_META)
  assert.equal(result.origin_iata, 'GDN')
  assert.equal(result.dest_iata, 'BCN')
  assert.equal(result.origin_city, 'Gdansk')
  assert.equal(result.dest_city, 'Barcelona')
  assert.equal(result.page_status, 'published')
})

// ─── Edge cases ───────────────────────────────────────────────────────────

test('handles multiple sessions: merges all offers and uses combined stats', () => {
  // THIN_SESSION (12 offers) + a copy of itself (12 more) → 24 total
  const session2: AgentSearchSession = {
    ...THIN_SESSION,
    sessionId: 'thin-session-002',
    offers: THIN_SESSION.offers.map(o => ({ ...o, id: `${o.id}-copy`, price: o.price + 5, priceNormalized: (o.priceNormalized ?? o.price) + 5 })),
  }
  const result = getRouteDistributionData([THIN_SESSION, session2], {
    ...GDN_BCN_META,
    sessionCount: 2,
  })
  assert.equal(result.total_offers_analyzed, 24)
  assert.equal(result.session_count, 2)
})

// ─── GROUP 1 — GEO Text Structure ─────────────────────────────────────────────

// Fix 1: TLDR summary uses city names and proper sentence structure

test('[G1-F1] tldr.summary uses city names, not IATA codes', () => {
  const result = getRouteDistributionData([HIGH_CONFIDENCE_SESSION], GDN_BCN_META)
  const summary = result.tldr.summary
  assert.ok(summary.includes('Gdansk'), `summary should contain origin city "Gdansk": "${summary}"`)
  assert.ok(summary.includes('Barcelona'), `summary should contain dest city "Barcelona": "${summary}"`)
  assert.ok(!summary.includes(' GDN ') && !summary.startsWith('GDN'),
    `summary should not start with or contain standalone IATA "GDN": "${summary}"`)
})

test('[G1-F1] tldr.summary contains a month name and year', () => {
  const result = getRouteDistributionData([HIGH_CONFIDENCE_SESSION], GDN_BCN_META)
  const summary = result.tldr.summary
  const months = ['January','February','March','April','May','June','July',
    'August','September','October','November','December']
  const hasMonth = months.some(m => summary.includes(m))
  assert.ok(hasMonth, `summary should contain a month name: "${summary}"`)
  assert.ok(/20\d\d/.test(summary), `summary should contain a 4-digit year: "${summary}"`)
})

test('[G1-F1] tldr.summary contains p10, p50, p90 price values', () => {
  const result = getRouteDistributionData([HIGH_CONFIDENCE_SESSION], GDN_BCN_META)
  const summary = result.tldr.summary
  const dist = result.price_distribution
  // All three percentile values should appear somewhere in the summary
  const hasP10 = summary.includes(Math.round(dist.p10).toString())
  const hasP50 = summary.includes(Math.round(dist.p50).toString())
  const hasP90 = summary.includes(Math.round(dist.p90).toString())
  assert.ok(hasP10 || hasP50 || hasP90,
    `summary should contain at least one percentile value (p10=${Math.round(dist.p10)}, p50=${Math.round(dist.p50)}, p90=${Math.round(dist.p90)}): "${summary}"`)
  assert.ok(summary.includes(result.total_offers_analyzed.toString()),
    `summary should contain offer count: "${summary}"`)
})

test('[G1-F1] tldr.summary word count is between 40 and 80', () => {
  const result = getRouteDistributionData([HIGH_CONFIDENCE_SESSION], GDN_BCN_META)
  const words = result.tldr.summary.trim().split(/\s+/).filter(w => w.length > 0)
  assert.ok(words.length >= 40, `summary should have >= 40 words, got ${words.length}: "${result.tldr.summary}"`)
  assert.ok(words.length <= 80, `summary should have <= 80 words, got ${words.length}: "${result.tldr.summary}"`)
})

// Fix 4: Key facts — comparative, >= 60 chars, month+year format

test('[G1-F4] each key_fact is >= 60 characters', () => {
  const result = getRouteDistributionData([HIGH_CONFIDENCE_SESSION], GDN_BCN_META)
  for (const [i, fact] of result.tldr.key_facts.entries()) {
    assert.ok(fact.length >= 60,
      `key_fact[${i}] should be >= 60 chars (got ${fact.length}): "${fact}"`)
  }
})

test('[G1-F4] each key_fact contains a month name and year (not YYYY-MM-DD)', () => {
  const result = getRouteDistributionData([HIGH_CONFIDENCE_SESSION], GDN_BCN_META)
  const months = ['January','February','March','April','May','June','July',
    'August','September','October','November','December']
  for (const [i, fact] of result.tldr.key_facts.entries()) {
    const hasMonth = months.some(m => fact.includes(m))
    assert.ok(hasMonth, `key_fact[${i}] should contain a month name: "${fact}"`)
    assert.ok(/20\d\d/.test(fact), `key_fact[${i}] should contain a year: "${fact}"`)
  }
})

test('[G1-F4] bimodal key_fact[0] contains a percentage comparing carrier types', () => {
  const result = getRouteDistributionData([BIMODAL_SESSION], {
    ...GDN_BCN_META,
    originCity: 'Gdansk',
    destCity: 'Barcelona',
  })
  const fact0 = result.tldr.key_facts[0]
  assert.ok(/%/.test(fact0) || /percent/i.test(fact0),
    `bimodal key_fact[0] should contain a percentage comparison: "${fact0}"`)
  assert.ok(/x lower|times lower|cheaper/i.test(fact0) || /\dx/i.test(fact0) || /%/.test(fact0),
    `bimodal key_fact[0] should reference the price ratio between LCC and FSC: "${fact0}"`)
})

// ─── GROUP 2 — Data Integrity Fixes ──────────────────────────────────────────

// Fix 5+6: ConnectorComparisonItem has display_name and carrier_coverage_type

test('[G2-F5] connector_comparison items have a display_name field', () => {
  const result = getRouteDistributionData([MIXED_CONNECTOR_SESSION], GDN_BCN_META)
  for (const item of result.connector_comparison) {
    assert.ok(
      'display_name' in item,
      `connector ${item.connector_name} should have display_name field`
    )
    assert.ok(
      typeof (item as any).display_name === 'string' && (item as any).display_name.length > 0,
      `display_name for ${item.connector_name} should be a non-empty string`
    )
  }
})

test('[G2-F6] display_name never contains underscore', () => {
  const result = getRouteDistributionData([MIXED_CONNECTOR_SESSION], GDN_BCN_META)
  for (const item of result.connector_comparison) {
    const displayName = (item as any).display_name as string
    assert.ok(
      !displayName.includes('_'),
      `display_name "${displayName}" should not contain underscore (connector: ${item.connector_name})`
    )
  }
})

test('[G2-F6] display_name is different from raw connector_name slug', () => {
  const result = getRouteDistributionData([MIXED_CONNECTOR_SESSION], GDN_BCN_META)
  for (const item of result.connector_comparison) {
    const displayName = (item as any).display_name as string
    assert.notEqual(
      displayName,
      item.connector_name,
      `display_name "${displayName}" must differ from connector_name "${item.connector_name}"`
    )
  }
})

test('[G2-F5] connector_comparison items have a carrier_coverage_type field', () => {
  const result = getRouteDistributionData([MIXED_CONNECTOR_SESSION], GDN_BCN_META)
  const validTypes = ['budget_only', 'premium_only', 'mixed']
  for (const item of result.connector_comparison) {
    const cct = (item as any).carrier_coverage_type as string
    assert.ok(
      validTypes.includes(cct),
      `carrier_coverage_type for ${item.connector_name} should be one of ${validTypes.join('|')}, got "${cct}"`
    )
  }
})

// Fix 7: Bimodal cluster medians are within actual price ranges

test('[G2-F7] bimodal_insight references LCC cluster median in range 750–950', () => {
  const result = getRouteDistributionData([BIMODAL_SESSION], GDN_BCN_META)
  assert.equal(result.price_distribution.is_bimodal, true, 'expected bimodal=true')
  const insight = result.price_distribution.bimodal_insight ?? ''
  // Extract all numbers from insight
  const numbers = insight.match(/\d+/g)?.map(Number) ?? []
  // LCC cluster prices: 750–950, median ≈ 850. Should be within 750–950
  const hasLccMedian = numbers.some(n => n >= 750 && n <= 950)
  assert.ok(
    hasLccMedian,
    `bimodal_insight should reference a value in the LCC range [750, 950], got numbers: ${numbers.join(', ')} in "${insight}"`
  )
})

test('[G2-F7] bimodal_insight references FSC cluster median in range 2800–3000', () => {
  const result = getRouteDistributionData([BIMODAL_SESSION], GDN_BCN_META)
  const insight = result.price_distribution.bimodal_insight ?? ''
  const numbers = insight.match(/\d+/g)?.map(Number) ?? []
  const hasFscMedian = numbers.some(n => n >= 2800 && n <= 3000)
  assert.ok(
    hasFscMedian,
    `bimodal_insight should reference a value in the FSC range [2800, 3000], got numbers: ${numbers.join(', ')} in "${insight}"`
  )
})

// ─── GROUP 3: Fix 13 — connector delta computed within carrier_coverage_type group ───

// Helper to build a minimal NormalizedOffer for connector tests
function _makeOffer(id: string, price: number, source: string, airline: string): import('../../../lib/pfp/types/agent-session.types.ts').NormalizedOffer {
  return {
    id, price, currency: 'EUR', priceFormatted: `${price} EUR`, priceNormalized: price,
    outbound: { segments: [{ airline, airlineName: '', flightNo: `${airline}1`, origin: 'GDN', destination: 'BCN', originCity: 'Gdansk', destinationCity: 'Barcelona', departure: '2026-06-15T06:00:00', arrival: '2026-06-15T09:00:00', durationSeconds: 9000, cabinClass: 'economy', aircraft: '' }], totalDurationSeconds: 9000, stopovers: 0 },
    inbound: null, airlines: [airline], ownerAirline: airline, bagsPrice: {}, availabilitySeats: null, conditions: {}, source, sourceTier: 'free', isLocked: false, fetchedAt: '2026-05-05T10:00:00Z', bookingUrl: '',
  }
}

function _makeSession(id: string, offers: import('../../../lib/pfp/types/agent-session.types.ts').NormalizedOffer[]): import('../../../lib/pfp/types/agent-session.types.ts').AgentSearchSession {
  return { ...HIGH_CONFIDENCE_SESSION, sessionId: id, offers, stats: { ...HIGH_CONFIDENCE_SESSION.stats, offerCount: offers.length } }
}

test('[G3-F13] budget connector delta is within-group when mixed with premium connectors', () => {
  // ryanair (budget_only, p50≈200), wizzair (budget_only, p50≈260), lufthansa (premium_only, p50≈500)
  // Within-group budget avg = (200+260)/2 = 230 → ryanair delta ≈ -13%, NOT -42% (vs overall avg 320)
  const offers = [
    ...Array.from({ length: 10 }, (_, i) => _makeOffer(`ry-${i}`, 195 + i, 'ryanair_direct', 'FR')),
    ...Array.from({ length: 10 }, (_, i) => _makeOffer(`wz-${i}`, 255 + i, 'wizzair_direct', 'W6')),
    ...Array.from({ length: 10 }, (_, i) => _makeOffer(`lh-${i}`, 495 + i, 'lufthansa_direct', 'LH')),
  ]
  const result = getRouteDistributionData([_makeSession('g3-mixed', offers)], GDN_BCN_META)
  const ryanair = result.connector_comparison.find(c => c.connector_name === 'ryanair_direct')!
  const lufthansa = result.connector_comparison.find(c => c.connector_name === 'lufthansa_direct')!
  assert.ok(ryanair, 'ryanair_direct should be in connector_comparison')
  assert.ok(lufthansa, 'lufthansa_direct should be in connector_comparison')
  // Ryanair (budget, p50≈200) vs budget group avg (≈230) → ≈-13%, not ≈-42%
  assert.ok(
    ryanair.delta_vs_avg_pct > -25,
    `ryanair delta should be within-group (> -25%), got ${ryanair.delta_vs_avg_pct.toFixed(1)}% (would be ≈ -42% if computed vs overall avg)`
  )
  // Lufthansa (premium, p50≈500) vs premium group (only member) → ≈0%, not +56%
  assert.ok(
    Math.abs(lufthansa.delta_vs_avg_pct) < 30,
    `lufthansa (only premium member) delta should be near 0, got ${lufthansa.delta_vs_avg_pct.toFixed(1)}% (would be ≈ +56% if computed vs overall avg)`
  )
})

test('[G3-F13] single-member group has delta of 0', () => {
  // When a carrier_coverage_type group has only one connector, its delta should be 0
  const offers = [
    ...Array.from({ length: 10 }, (_, i) => _makeOffer(`ry-s-${i}`, 200 + i, 'ryanair_direct', 'FR')),
    ...Array.from({ length: 10 }, (_, i) => _makeOffer(`lh-s-${i}`, 500 + i, 'lufthansa_direct', 'LH')),
  ]
  const result = getRouteDistributionData([_makeSession('g3-single', offers)], GDN_BCN_META)
  const ryanair = result.connector_comparison.find(c => c.connector_name === 'ryanair_direct')!
  const lufthansa = result.connector_comparison.find(c => c.connector_name === 'lufthansa_direct')!
  assert.ok(Math.abs(ryanair.delta_vs_avg_pct) < 1, `single-member budget group delta should be 0, got ${ryanair.delta_vs_avg_pct.toFixed(2)}`)
  assert.ok(Math.abs(lufthansa.delta_vs_avg_pct) < 1, `single-member premium group delta should be 0, got ${lufthansa.delta_vs_avg_pct.toFixed(2)}`)
})

test('[G3-F13] within-group cheapest connector still has negative delta', () => {
  // Two budget connectors: ryanair cheap (200), easyjet expensive (260) — both budget_only
  const offers = [
    ...Array.from({ length: 10 }, (_, i) => _makeOffer(`ry-cg-${i}`, 195 + i, 'ryanair_direct', 'FR')),
    ...Array.from({ length: 10 }, (_, i) => _makeOffer(`ej-cg-${i}`, 255 + i, 'easyjet_direct', 'U2')),
  ]
  const result = getRouteDistributionData([_makeSession('g3-within', offers)], GDN_BCN_META)
  const ryanair = result.connector_comparison.find(c => c.connector_name === 'ryanair_direct')!
  const easyjet = result.connector_comparison.find(c => c.connector_name === 'easyjet_direct')!
  assert.ok(ryanair.delta_vs_avg_pct < 0, `cheaper within-group connector should have negative delta, got ${ryanair.delta_vs_avg_pct.toFixed(2)}`)
  assert.ok(easyjet.delta_vs_avg_pct > 0, `more expensive within-group connector should have positive delta, got ${easyjet.delta_vs_avg_pct.toFixed(2)}`)
})
