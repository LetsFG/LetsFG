/**
 * Tests for validateOfferBatch and detectSuspectReason in offer-validation.ts.
 *
 * Each of the 5 validation rules has:
 *   - a red-path test (offer flagged as suspect)
 *   - a green-path test (valid offer NOT flagged)
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { validateOfferBatch, detectSuspectReason } from '../lib/offer-validation.ts'
import type { PublicOffer } from '../lib/trusted-offer.ts'

// ── minimal offer factory ─────────────────────────────────────────────────────

function offer(overrides: Partial<PublicOffer> & { id?: string } = {}): PublicOffer {
  return {
    id: 'test-offer',
    price: 120,
    displayPrice: 120,
    currency: 'EUR',
    airline: 'Example Air',
    airline_code: 'EA',
    origin: 'STN',
    destination: 'BCN',
    departure_time: '2026-06-15T09:00:00Z',
    arrival_time: '2026-06-15T11:15:00Z',
    duration_minutes: 135,
    stops: 0,
    ...overrides,
  } as PublicOffer
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule 1 — duration plausibility
// ─────────────────────────────────────────────────────────────────────────────

test('Rule 1 red: duration_too_short flagged for < 20 min', () => {
  const reason = detectSuspectReason(offer({ duration_minutes: 5 }))
  assert.ok(reason?.startsWith('duration_too_short'), `Expected duration_too_short, got: ${reason}`)
})

test('Rule 1 red: duration_too_long flagged for > 1440 min (> 24h)', () => {
  const reason = detectSuspectReason(offer({ duration_minutes: 2000 }))
  assert.ok(reason?.startsWith('duration_too_long'), `Expected duration_too_long, got: ${reason}`)
})

test('Rule 1 green: normal duration 135 min is not flagged', () => {
  const reason = detectSuspectReason(offer({ duration_minutes: 135 }))
  assert.equal(reason, null)
})

test('Rule 1 green: boundary value 20 min is not flagged', () => {
  const reason = detectSuspectReason(offer({
    duration_minutes: 20,
    departure_time: '2026-06-15T09:00:00Z',
    arrival_time: '2026-06-15T09:20:00Z',
  }))
  assert.equal(reason, null)
})

// ─────────────────────────────────────────────────────────────────────────────
// Rule 2 — time ordering (arrival must be after departure)
// ─────────────────────────────────────────────────────────────────────────────

test('Rule 2 red: arrival_before_departure flagged when arrival == departure', () => {
  const reason = detectSuspectReason(offer({
    departure_time: '2026-06-15T11:00:00Z',
    arrival_time:   '2026-06-15T11:00:00Z',
    duration_minutes: 135,
  }))
  assert.equal(reason, 'arrival_before_departure')
})

test('Rule 2 red: arrival_before_departure flagged when arrival is before departure', () => {
  const reason = detectSuspectReason(offer({
    departure_time: '2026-06-15T11:00:00Z',
    arrival_time:   '2026-06-15T09:00:00Z',
    duration_minutes: 135,
  }))
  assert.equal(reason, 'arrival_before_departure')
})

test('Rule 2 green: correct ordering is not flagged', () => {
  const reason = detectSuspectReason(offer({
    departure_time: '2026-06-15T09:00:00Z',
    arrival_time:   '2026-06-15T11:15:00Z',
    duration_minutes: 135,
  }))
  assert.equal(reason, null)
})

// ─────────────────────────────────────────────────────────────────────────────
// Rule 3 — timezone drift
// ─────────────────────────────────────────────────────────────────────────────

test('Rule 3 red: timezone_drift flagged when stored and computed durations differ > 120 min', () => {
  // Dep 09:00Z, arr 13:15Z → epoch diff = 255 min.
  // Stored duration = 60 min — clearly wrong.
  const reason = detectSuspectReason(offer({
    departure_time: '2026-06-15T09:00:00Z',
    arrival_time:   '2026-06-15T13:15:00Z',
    duration_minutes: 60,
  }))
  assert.ok(reason?.startsWith('timezone_drift'),
    `Expected timezone_drift, got: ${reason}`)
})

test('Rule 3 green: stored and epoch-diff durations match within 120 min', () => {
  // Dep 09:00Z, arr 11:15Z → epoch diff = 135 min, stored = 135 min.
  const reason = detectSuspectReason(offer({
    departure_time: '2026-06-15T09:00:00Z',
    arrival_time:   '2026-06-15T11:15:00Z',
    duration_minutes: 135,
  }))
  assert.equal(reason, null)
})

test('Rule 3 green: timestamps without explicit tz do NOT trigger timezone_drift', () => {
  // Both strings lack Z or ±HH:MM so the drift check is skipped.
  const reason = detectSuspectReason(offer({
    departure_time: '2026-06-15T09:00:00',
    arrival_time:   '2026-06-15T13:15:00',
    duration_minutes: 60,
  }))
  // May be null (no other rule fires) or time-ordering flagged (arrival > departure here)
  // — important thing is it must NOT be timezone_drift
  assert.ok(reason !== 'timezone_drift' && !reason?.startsWith('timezone_drift'),
    `timezone_drift must not fire for naive timestamp strings, got: ${reason}`)
})

// ─────────────────────────────────────────────────────────────────────────────
// Rule 4 — price outlier
// ─────────────────────────────────────────────────────────────────────────────

test('Rule 4 red: price_outlier flagged for price < 1', () => {
  const reason = detectSuspectReason(offer({ price: 0 }))
  assert.ok(reason?.startsWith('price_outlier'), `Expected price_outlier, got: ${reason}`)
})

test('Rule 4 red: price_outlier flagged for price > 20000', () => {
  const reason = detectSuspectReason(offer({ price: 25000 }))
  assert.ok(reason?.startsWith('price_outlier'), `Expected price_outlier, got: ${reason}`)
})

test('Rule 4 green: normal price 120 is not flagged', () => {
  const reason = detectSuspectReason(offer({ price: 120 }))
  assert.equal(reason, null)
})

test('Rule 4 green: boundary price 1 is not flagged', () => {
  const reason = detectSuspectReason(offer({ price: 1 }))
  assert.equal(reason, null)
})

test('Rule 4 green: boundary price 20000 is not flagged', () => {
  const reason = detectSuspectReason(offer({ price: 20000 }))
  assert.equal(reason, null)
})

// ─────────────────────────────────────────────────────────────────────────────
// Rule 5 — layover anomaly
// ─────────────────────────────────────────────────────────────────────────────

test('Rule 5 red: layover_anomaly flagged when segment layover > 720 min on sub-24h itinerary', () => {
  const reason = detectSuspectReason(offer({
    // dep 09:00Z, arr 14:00Z → epoch diff = 300 min = stored duration → no timezone_drift
    departure_time: '2026-06-15T09:00:00Z',
    arrival_time:   '2026-06-15T14:00:00Z',
    duration_minutes: 300,
    segments: [
      { origin: 'STN', destination: 'FRA', layover_minutes: 900 } as any,
      { origin: 'FRA', destination: 'BCN' } as any,
    ],
  }))
  assert.ok(reason?.startsWith('layover_anomaly'),
    `Expected layover_anomaly, got: ${reason}`)
})

test('Rule 5 green: layover of 700 min (< 720) does not trigger anomaly', () => {
  const reason = detectSuspectReason(offer({
    departure_time: '2026-06-15T09:00:00Z',
    arrival_time:   '2026-06-15T14:00:00Z',
    duration_minutes: 300,
    segments: [
      { origin: 'STN', destination: 'FRA', layover_minutes: 700 } as any,
      { origin: 'FRA', destination: 'BCN' } as any,
    ],
  }))
  assert.equal(reason, null)
})

test('Rule 5 green: long layover on a 25h itinerary is NOT flagged (rule only applies sub-24h)', () => {
  const reason = detectSuspectReason(offer({
    duration_minutes: 1500, // 25 hours — rule skipped
    segments: [
      { origin: 'LON', destination: 'DXB', layover_minutes: 800 } as any,
      { origin: 'DXB', destination: 'SYD' } as any,
    ],
  }))
  // duration_too_long fires first, but layover_anomaly must NOT independently fire
  assert.ok(reason !== 'layover_anomaly' && !reason?.startsWith('layover_anomaly'))
})

// ─────────────────────────────────────────────────────────────────────────────
// validateOfferBatch integration
// ─────────────────────────────────────────────────────────────────────────────

test('validateOfferBatch separates valid and suspect offers', () => {
  const offers: PublicOffer[] = [
    offer({ id: 'good-1', price: 120, duration_minutes: 135 }),
    offer({ id: 'good-2', price: 200, duration_minutes: 200 }),
    offer({ id: 'bad-price', price: 0 }),
    offer({ id: 'bad-duration', duration_minutes: 5 }),
  ]
  const { valid, suspect } = validateOfferBatch(offers)

  assert.equal(valid.length, 2)
  assert.ok(valid.every(o => o.id === 'good-1' || o.id === 'good-2'))

  assert.equal(suspect.length, 2)
  assert.ok(suspect.every(s => s.offer.id === 'bad-price' || s.offer.id === 'bad-duration'))
  assert.ok(suspect.every(s => s.reason.length > 0), 'Every suspect must have a non-empty reason')
})

test('validateOfferBatch returns all valid when no suspect offers', () => {
  const offers: PublicOffer[] = [
    offer({ id: 'a', price: 80,  duration_minutes: 90 }),
    offer({ id: 'b', price: 150, duration_minutes: 135 }),
  ]
  const { valid, suspect } = validateOfferBatch(offers)
  assert.equal(valid.length, 2)
  assert.equal(suspect.length, 0)
})

test('validateOfferBatch handles empty batch without crashing', () => {
  const { valid, suspect } = validateOfferBatch([])
  assert.equal(valid.length, 0)
  assert.equal(suspect.length, 0)
})

test('validateOfferBatch preserves original offer object in suspect entries', () => {
  const original = offer({ id: 'broken', price: 0 })
  const { suspect } = validateOfferBatch([original])
  assert.equal(suspect.length, 1)
  assert.equal(suspect[0].offer, original, 'suspect.offer must be the original object reference')
})
