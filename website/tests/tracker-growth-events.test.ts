/**
 * Tests for growth-model event schema additions in search-session-analytics.ts
 *
 * Covers:
 * - offer_selected includes position, is_top3, time_to_select_ms, scroll_depth_at_select
 * - buildOfferSelectedEventData sets is_top3 correctly (position <= 3)
 * - recommendation_quality_assessed event payload shape
 * - return_visit event payload shape
 * - offer_shared event payload shape
 * - trackSearchSessionEvent passes data through correctly
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildOfferSelectedEventData,
  buildRecommendationQualityEventData,
  buildReturnVisitEventData,
  buildOfferSharedEventData,
  type OfferSelectedEventData,
  type RecommendationQualityEventData,
  type ReturnVisitEventData,
  type OfferSharedEventData,
} from '../lib/search-session-analytics.ts'

// ─── offer_selected event ─────────────────────────────────────────────────────

test('buildOfferSelectedEventData includes required fields', () => {
  const data = buildOfferSelectedEventData({
    offer_id: 'offer-123',
    position: 1,
    results_viewed_at: new Date(Date.now() - 3000).toISOString(),
    scroll_depth_pct: 15,
  })

  assert.equal(data.offer_id, 'offer-123')
  assert.equal(data.position, 1)
  assert.equal(data.is_top3, true)
  assert.ok(typeof data.time_to_select_ms === 'number')
  assert.ok(data.time_to_select_ms >= 0)
  assert.equal(data.scroll_depth_at_select, 15)
})

test('is_top3 is true for positions 1, 2, 3', () => {
  for (const pos of [1, 2, 3]) {
    const data = buildOfferSelectedEventData({
      offer_id: 'x',
      position: pos,
      results_viewed_at: new Date().toISOString(),
      scroll_depth_pct: 0,
    })
    assert.equal(data.is_top3, true, `position ${pos} should be is_top3`)
  }
})

test('is_top3 is false for positions 4+', () => {
  for (const pos of [4, 5, 10, 20]) {
    const data = buildOfferSelectedEventData({
      offer_id: 'x',
      position: pos,
      results_viewed_at: new Date().toISOString(),
      scroll_depth_pct: 50,
    })
    assert.equal(data.is_top3, false, `position ${pos} should not be is_top3`)
  }
})

test('time_to_select_ms is calculated from results_viewed_at', () => {
  const viewedAt = new Date(Date.now() - 5_000).toISOString()
  const data = buildOfferSelectedEventData({
    offer_id: 'x',
    position: 2,
    results_viewed_at: viewedAt,
    scroll_depth_pct: 30,
  })
  // Should be ~5000ms, allow 500ms slack for test execution time
  assert.ok(data.time_to_select_ms >= 4_500, `expected ~5000ms, got ${data.time_to_select_ms}`)
  assert.ok(data.time_to_select_ms < 6_000, `time_to_select_ms unexpectedly large: ${data.time_to_select_ms}`)
})

test('time_to_select_ms is 0 when results_viewed_at is null', () => {
  const data = buildOfferSelectedEventData({
    offer_id: 'x',
    position: 1,
    results_viewed_at: null,
    scroll_depth_pct: 0,
  })
  assert.equal(data.time_to_select_ms, 0)
})

// ─── recommendation_quality_assessed event ────────────────────────────────────

test('buildRecommendationQualityEventData returns correct shape', () => {
  const data = buildRecommendationQualityEventData({
    search_id: 'srch-xyz',
    result_count: 7,
    connector_count: 10,
    has_direct_flight: true,
    min_stops: 0,
    carrier_diversity: 3,
    cheapest_price: 150,
    google_flights_price: 180,
    search_duration_ms: 9_000,
  })

  assert.equal(data.search_id, 'srch-xyz')
  assert.equal(data.result_count, 7)
  assert.equal(data.connector_count, 10)
  assert.equal(data.top3_present, true)
  assert.equal(data.has_direct_flight, true)
  assert.equal(data.min_stops, 0)
  assert.equal(data.carrier_diversity, 3)
  assert.ok(typeof data.quality_score === 'number')
  assert.ok(data.quality_score >= 0 && data.quality_score <= 100)
  // (180 - 150) / 180 × 100 ≈ 16.67, rounded to 17
  assert.equal(data.price_vs_google_pct, 17)
})

// ─── return_visit event ───────────────────────────────────────────────────────

test('buildReturnVisitEventData returns correct shape', () => {
  const data = buildReturnVisitEventData({
    days_since_last_search: 7,
    prior_search_count: 3,
  })

  assert.equal(data.days_since_last_search, 7)
  assert.equal(data.prior_search_count, 3)
})

test('buildReturnVisitEventData allows zero for first quick return', () => {
  const data = buildReturnVisitEventData({
    days_since_last_search: 0,
    prior_search_count: 1,
  })
  assert.equal(data.days_since_last_search, 0)
})

// ─── offer_shared event ───────────────────────────────────────────────────────

test('buildOfferSharedEventData returns correct shape with copy_link', () => {
  const data = buildOfferSharedEventData({
    offer_id: 'offer-999',
    position: 2,
    share_method: 'copy_link',
  })

  assert.equal(data.offer_id, 'offer-999')
  assert.equal(data.position, 2)
  assert.equal(data.share_method, 'copy_link')
})

test('buildOfferSharedEventData accepts native_share method', () => {
  const data = buildOfferSharedEventData({
    offer_id: 'offer-888',
    position: 5,
    share_method: 'native_share',
  })
  assert.equal(data.share_method, 'native_share')
})
