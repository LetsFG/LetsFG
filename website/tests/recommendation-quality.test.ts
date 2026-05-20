/**
 * Tests for /website/lib/recommendation-quality.ts
 *
 * Covers:
 * - computeQualityScore formula and weight correctness
 * - buildRecommendationQualityPayload produces the right event shape
 * - Edge cases: zero results, missing google price, negative price delta
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  computeQualityScore,
  buildRecommendationQualityPayload,
  type RecommendationQualityInput,
} from '../lib/recommendation-quality.ts'

// ─── computeQualityScore ──────────────────────────────────────────────────────

test('score is 0 when there are no results', () => {
  const score = computeQualityScore({
    result_count: 0,
    carrier_diversity: 0,
    price_vs_google_pct: 0,
    search_duration_ms: 5_000,
  })
  assert.equal(score, 0)
})

test('result_count_score: 0 results → 0, 10+ results → full 30 weight', () => {
  const noResults = computeQualityScore({
    result_count: 0,
    carrier_diversity: 5,
    price_vs_google_pct: 0,
    search_duration_ms: 5_000,
  })
  const fullResults = computeQualityScore({
    result_count: 10,
    carrier_diversity: 5,
    price_vs_google_pct: 0,
    search_duration_ms: 5_000,
  })
  assert.equal(noResults, 0)
  // With 10 results: result_count=30, price=40 (0% delta), diversity=20 (5 carriers), speed=10 (5s)
  assert.equal(fullResults, 100)
})

test('result_count_score: 5 results → 50% of 30 weight = 15', () => {
  const score = computeQualityScore({
    result_count: 5,
    carrier_diversity: 5,
    price_vs_google_pct: 0,
    search_duration_ms: 5_000,
  })
  // result=15, price=40, diversity=20, speed=10 → 85
  assert.equal(score, 85)
})

test('price_score: positive pct means we beat google → full 40 weight', () => {
  const score = computeQualityScore({
    result_count: 10,
    carrier_diversity: 5,
    price_vs_google_pct: 5, // we are 5% cheaper than google
    search_duration_ms: 5_000,
  })
  assert.equal(score, 100)
})

test('price_score: -20% or worse → 0 price weight', () => {
  const score = computeQualityScore({
    result_count: 10,
    carrier_diversity: 5,
    price_vs_google_pct: -20, // we are 20% more expensive than google
    search_duration_ms: 5_000,
  })
  // result=30, price=0, diversity=20, speed=10 → 60
  assert.equal(score, 60)
})

test('price_score: -10% delta → 50% of 40 weight = 20', () => {
  const score = computeQualityScore({
    result_count: 10,
    carrier_diversity: 5,
    price_vs_google_pct: -10,
    search_duration_ms: 5_000,
  })
  // result=30, price=20, diversity=20, speed=10 → 80
  assert.equal(score, 80)
})

test('price_score: null google price (pct = null) → treated as neutral (20 weight)', () => {
  const score = computeQualityScore({
    result_count: 10,
    carrier_diversity: 5,
    price_vs_google_pct: null,
    search_duration_ms: 5_000,
  })
  // result=30, price=20 (neutral), diversity=20, speed=10 → 80
  assert.equal(score, 80)
})

test('diversity_score: 0 carriers → 0, 5+ carriers → full 20 weight', () => {
  const lowDiv = computeQualityScore({
    result_count: 10,
    carrier_diversity: 0,
    price_vs_google_pct: 0,
    search_duration_ms: 5_000,
  })
  const highDiv = computeQualityScore({
    result_count: 10,
    carrier_diversity: 5,
    price_vs_google_pct: 0,
    search_duration_ms: 5_000,
  })
  // low: result=30, price=40, diversity=0, speed=10 → 80
  assert.equal(lowDiv, 80)
  assert.equal(highDiv, 100)
})

test('speed_score: < 5s → full 10 weight, > 30s → 0', () => {
  const fast = computeQualityScore({
    result_count: 10,
    carrier_diversity: 5,
    price_vs_google_pct: 0,
    search_duration_ms: 4_999,
  })
  const slow = computeQualityScore({
    result_count: 10,
    carrier_diversity: 5,
    price_vs_google_pct: 0,
    search_duration_ms: 30_001,
  })
  assert.equal(fast, 100)
  // slow: result=30, price=40, diversity=20, speed=0 → 90
  assert.equal(slow, 90)
})

test('score is clamped to [0, 100]', () => {
  const score = computeQualityScore({
    result_count: 100,
    carrier_diversity: 100,
    price_vs_google_pct: 999,
    search_duration_ms: 0,
  })
  assert.ok(score >= 0 && score <= 100, `score ${score} out of [0,100]`)
})

// ─── buildRecommendationQualityPayload ────────────────────────────────────────

test('buildRecommendationQualityPayload returns required fields', () => {
  const input: RecommendationQualityInput = {
    search_id: 'search-abc-123',
    result_count: 8,
    connector_count: 12,
    has_direct_flight: true,
    min_stops: 0,
    carrier_diversity: 4,
    cheapest_price: 180,
    google_flights_price: 200,
    search_duration_ms: 8_000,
  }
  const payload = buildRecommendationQualityPayload(input)

  assert.equal(payload.search_id, 'search-abc-123')
  assert.equal(payload.result_count, 8)
  assert.equal(payload.connector_count, 12)
  assert.equal(payload.top3_present, true)
  assert.equal(payload.has_direct_flight, true)
  assert.equal(payload.min_stops, 0)
  assert.equal(payload.carrier_diversity, 4)
  assert.ok(typeof payload.quality_score === 'number')
  assert.ok(payload.quality_score >= 0 && payload.quality_score <= 100)
})

test('top3_present is true when result_count >= 3', () => {
  const p3 = buildRecommendationQualityPayload({
    search_id: 'x',
    result_count: 3,
    connector_count: 1,
    has_direct_flight: false,
    min_stops: 1,
    carrier_diversity: 1,
    cheapest_price: 100,
    google_flights_price: null,
    search_duration_ms: 5_000,
  })
  const p2 = buildRecommendationQualityPayload({
    search_id: 'y',
    result_count: 2,
    connector_count: 1,
    has_direct_flight: false,
    min_stops: 1,
    carrier_diversity: 1,
    cheapest_price: 100,
    google_flights_price: null,
    search_duration_ms: 5_000,
  })
  assert.equal(p3.top3_present, true)
  assert.equal(p2.top3_present, false)
})

test('price_vs_google_pct is null when google_flights_price is null', () => {
  const payload = buildRecommendationQualityPayload({
    search_id: 'x',
    result_count: 5,
    connector_count: 3,
    has_direct_flight: false,
    min_stops: 1,
    carrier_diversity: 2,
    cheapest_price: 99,
    google_flights_price: null,
    search_duration_ms: 10_000,
  })
  assert.equal(payload.price_vs_google_pct, null)
})

test('price_vs_google_pct is positive when we beat google', () => {
  const payload = buildRecommendationQualityPayload({
    search_id: 'x',
    result_count: 5,
    connector_count: 3,
    has_direct_flight: false,
    min_stops: 1,
    carrier_diversity: 2,
    cheapest_price: 180,
    google_flights_price: 200,
    search_duration_ms: 10_000,
  })
  // (200 - 180) / 200 × 100 = 10%
  assert.equal(payload.price_vs_google_pct, 10)
})

test('price_vs_google_pct is negative when we are more expensive than google', () => {
  const payload = buildRecommendationQualityPayload({
    search_id: 'x',
    result_count: 5,
    connector_count: 3,
    has_direct_flight: false,
    min_stops: 1,
    carrier_diversity: 2,
    cheapest_price: 220,
    google_flights_price: 200,
    search_duration_ms: 10_000,
  })
  // (200 - 220) / 200 × 100 = -10%
  assert.equal(payload.price_vs_google_pct, -10)
})
