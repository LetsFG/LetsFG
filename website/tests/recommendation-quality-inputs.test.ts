/**
 * Tests for /website/lib/recommendation-quality-inputs.ts
 *
 * Covers:
 * - deriveQualityInput from an offer array
 * - zero offers returns a safe zero-result payload
 * - carrier_diversity counts unique airline_codes
 * - has_direct_flight, min_stops, cheapest_price derivation
 * - context fields (search_id, google price, duration, connector count) pass through
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { deriveQualityInput } from '../lib/recommendation-quality-inputs.ts'

const baseCtx = {
  searchId: 'ws_abc123',
  googleFlightsPrice: 200 as number | null,
  searchDurationMs: 10_000,
  connectorCount: 8,
}

test('deriveQualityInput — 0 offers returns zero-result payload', () => {
  const input = deriveQualityInput([], baseCtx)
  assert.equal(input.result_count, 0)
  assert.equal(input.carrier_diversity, 0)
  assert.equal(input.has_direct_flight, false)
  assert.equal(input.cheapest_price, null)
  assert.equal(input.google_flights_price, 200)
  assert.equal(input.connector_count, 8)
  assert.equal(input.search_id, 'ws_abc123')
})

test('deriveQualityInput — derives carrier_diversity from unique airline_codes', () => {
  const offers = [
    { price: 100, airline_code: 'FR', stops: 0 },
    { price: 120, airline_code: 'U2', stops: 1 },
    { price: 110, airline_code: 'FR', stops: 0 },
  ]
  const input = deriveQualityInput(offers, baseCtx)
  assert.equal(input.carrier_diversity, 2)
  assert.equal(input.result_count, 3)
})

test('deriveQualityInput — has_direct_flight true when any offer has 0 stops', () => {
  const offers = [
    { price: 100, airline_code: 'FR', stops: 0 },
    { price: 120, airline_code: 'U2', stops: 1 },
  ]
  assert.equal(deriveQualityInput(offers, baseCtx).has_direct_flight, true)
})

test('deriveQualityInput — has_direct_flight false when all offers have stops > 0', () => {
  const offers = [
    { price: 100, airline_code: 'FR', stops: 1 },
    { price: 120, airline_code: 'U2', stops: 2 },
  ]
  assert.equal(deriveQualityInput(offers, baseCtx).has_direct_flight, false)
})

test('deriveQualityInput — min_stops is the minimum across offers', () => {
  const offers = [
    { price: 100, airline_code: 'FR', stops: 2 },
    { price: 120, airline_code: 'U2', stops: 1 },
    { price: 130, airline_code: 'W6', stops: 3 },
  ]
  assert.equal(deriveQualityInput(offers, baseCtx).min_stops, 1)
})

test('deriveQualityInput — cheapest_price is the minimum price', () => {
  const offers = [
    { price: 150, airline_code: 'FR', stops: 0 },
    { price: 80, airline_code: 'U2', stops: 0 },
    { price: 120, airline_code: 'W6', stops: 0 },
  ]
  assert.equal(deriveQualityInput(offers, baseCtx).cheapest_price, 80)
})

test('deriveQualityInput — context fields pass through correctly', () => {
  const offers = [{ price: 100, airline_code: 'FR', stops: 0 }]
  const input = deriveQualityInput(offers, {
    searchId: 'ws_test999',
    googleFlightsPrice: 150,
    searchDurationMs: 7_000,
    connectorCount: 12,
  })
  assert.equal(input.search_id, 'ws_test999')
  assert.equal(input.google_flights_price, 150)
  assert.equal(input.search_duration_ms, 7_000)
  assert.equal(input.connector_count, 12)
})

test('deriveQualityInput — null google price passes through as null', () => {
  const input = deriveQualityInput([], { ...baseCtx, googleFlightsPrice: null })
  assert.equal(input.google_flights_price, null)
})

test('deriveQualityInput — single offer with 0 stops is a direct flight', () => {
  const offers = [{ price: 99, airline_code: 'FR', stops: 0 }]
  const input = deriveQualityInput(offers, baseCtx)
  assert.equal(input.has_direct_flight, true)
  assert.equal(input.min_stops, 0)
  assert.equal(input.carrier_diversity, 1)
  assert.equal(input.cheapest_price, 99)
})
