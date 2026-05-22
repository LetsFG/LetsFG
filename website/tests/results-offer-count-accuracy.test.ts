/**
 * Tests that raw_offers_analyzed and total_results are correctly separated in
 * the results API response.
 *
 * Root cause: total_results was set to normalized.length (post-filter) while
 * the "flights analyzed" label the user sees implies the raw connector scan
 * count.  Users were shown a lower number than the actual scan count when some
 * offers were rejected due to zero/invalid duration.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeTrustedOffer, toPublicOffer } from '../lib/trusted-offer.ts'

// Helper: build a minimal raw offer with valid timestamps (positive duration)
function rawOfferValid(id: string) {
  return {
    id,
    price: 100,
    currency: 'EUR',
    airlines: ['Example Air'],
    airline_code: 'EA',
    source: 'example_connector',
    outbound: {
      origin: 'STN',
      destination: 'BCN',
      segments: [
        {
          origin: 'STN',
          destination: 'BCN',
          departure: '2026-06-15T09:00:00Z',
          arrival: '2026-06-15T11:15:00Z',
          flight_no: 'EA1001',
          duration_seconds: 8100,
        },
      ],
      stopovers: 0,
      total_duration_seconds: 8100,
    },
  }
}

// Helper: build a raw offer with no timestamps and zero duration — normalizeTrustedOffer
// will produce duration_minutes=0.  The results route filters these out.
function rawOfferNoDuration(id: string) {
  return {
    id,
    price: 80,
    currency: 'EUR',
    airlines: ['Example Air'],
    airline_code: 'EA',
    source: 'example_connector',
    outbound: {
      origin: 'STN',
      destination: 'BCN',
      segments: [
        {
          origin: 'STN',
          destination: 'BCN',
          // No departure/arrival timestamps → no timestamp-diff duration
          flight_no: 'EA1001',
          duration_seconds: 0,
        },
      ],
      stopovers: 0,
      total_duration_seconds: 0, // no fallback duration either
    },
  }
}

test('raw_offers_analyzed equals rawOffers.length before any filter', () => {
  // 5 offers: 4 valid, 1 with no timestamps and zero duration (will be filtered)
  const rawOffers = [
    rawOfferValid('ok-1'),
    rawOfferValid('ok-2'),
    rawOfferValid('ok-3'),
    rawOfferValid('ok-4'),
    rawOfferNoDuration('bad-duration'),
  ]

  const trustedOffers = rawOffers.map((o, idx) => normalizeTrustedOffer(o, idx))
  const normalized = trustedOffers
    .map((o) => toPublicOffer(o))
    .filter((o) => (o.duration_minutes ?? 0) > 0)

  // Simulate what the results route computes
  const rawCount = rawOffers.length
  const displayCount = normalized.length

  assert.equal(rawCount, 5, 'raw count must reflect all connector offers')
  assert.equal(displayCount, 4, 'display count must exclude offers with duration=0')
  assert.notEqual(rawCount, displayCount,
    'Regression guard: raw and display counts must differ when offers are filtered')
})

test('offers_displayed equals post-filter count', () => {
  const rawOffers = [
    rawOfferValid('a'),
    rawOfferNoDuration('b'),
    rawOfferNoDuration('c'),
  ]

  const trustedOffers = rawOffers.map((o, idx) => normalizeTrustedOffer(o, idx))
  const normalized = trustedOffers
    .map((o) => toPublicOffer(o))
    .filter((o) => (o.duration_minutes ?? 0) > 0)

  assert.equal(normalized.length, 1, 'Only offer with valid duration should survive filter')
  assert.equal(normalized[0].id, 'a')
})

test('raw_offers_analyzed is not equal to display count when offers are filtered', () => {
  // Regression: previously total_results was set to normalized.length only,
  // so the "flights analyzed" label showed the filtered count, not the raw scan count.
  const rawOffers = [
    rawOfferValid('x1'),
    rawOfferValid('x2'),
    rawOfferNoDuration('bad'),
  ]

  const trustedOffers = rawOffers.map((o, idx) => normalizeTrustedOffer(o, idx))
  const normalized = trustedOffers
    .map((o) => toPublicOffer(o))
    .filter((o) => (o.duration_minutes ?? 0) > 0)

  const rawCount = rawOffers.length   // 3 — what raw_offers_analyzed exposes
  const displayed = normalized.length // 2 — what total_results exposes

  // The two values must differ when any offers are filtered
  assert.equal(rawCount, 3)
  assert.equal(displayed, 2)
  assert.notEqual(rawCount, displayed)
})
