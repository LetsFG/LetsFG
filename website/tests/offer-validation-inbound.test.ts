/**
 * Tests for the Rule 0 inbound-timing integrity check added to
 * detectSuspectReason after the ws_47776b352af74a1b incident on 2026-05-23.
 *
 * Before the rule: a round-trip offer whose inbound leg had empty or
 * impossible timestamps (because the connector sent a date-only timestamp
 * and getRouteTiming used to fabricate a clock) sailed past validation as
 * valid. Result: the "00:00 → 01:00, 1h Direct" placeholder card was sorted
 * to the top of the list.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { detectSuspectReason, validateOfferBatch } from '../lib/offer-validation.ts'
import type { PublicOffer } from '../lib/trusted-offer.ts'

function offer(overrides: Partial<PublicOffer> & { id?: string } = {}): PublicOffer {
  return {
    id: 'test-offer',
    price: 120,
    displayPrice: 120,
    currency: 'EUR',
    airline: 'Example Air',
    airline_code: 'EA',
    origin: 'LHR',
    destination: 'BCN',
    departure_time: '2026-05-29T20:50:00+01:00',
    arrival_time: '2026-05-29T23:10:00+02:00',
    duration_minutes: 140,
    stops: 0,
    ...overrides,
  } as PublicOffer
}

const validInbound = {
  origin: 'BCN',
  destination: 'LHR',
  departure_time: '2026-05-31T22:30:00+02:00',
  arrival_time: '2026-06-01T00:50:00+01:00',
  duration_minutes: 140,
  stops: 0,
}

test('Rule 0 red: inbound_missing_timing flagged when both inbound timestamps are empty', () => {
  // The exact shape produced by the new getRouteTiming for date-only input.
  const reason = detectSuspectReason(offer({
    inbound: { ...validInbound, departure_time: '', arrival_time: '', duration_minutes: 0 },
  } as any))
  assert.equal(reason, 'inbound_missing_timing')
})

test('Rule 0 red: inbound_missing_timing flagged when only inbound departure is empty', () => {
  const reason = detectSuspectReason(offer({
    inbound: { ...validInbound, departure_time: '' },
  } as any))
  assert.equal(reason, 'inbound_missing_timing')
})

test('Rule 0 red: inbound_duration_too_short flagged for a 1h "direct" return on intercontinental route', () => {
  // The production symptom shape: duration_minutes = 60 from fabricated total_duration_seconds.
  // (Now we never get here from getRouteTiming, but defense-in-depth against other paths.)
  const reason = detectSuspectReason(offer({
    inbound: { ...validInbound, duration_minutes: 10 },
  } as any))
  assert.ok(reason?.startsWith('inbound_duration_too_short'),
    `Expected inbound_duration_too_short, got: ${reason}`)
})

test('Rule 0 red: inbound_arrival_before_departure flagged when inbound arrival ≤ departure', () => {
  const reason = detectSuspectReason(offer({
    inbound: {
      ...validInbound,
      departure_time: '2026-05-31T22:30:00+02:00',
      arrival_time:   '2026-05-31T22:30:00+02:00',
    },
  } as any))
  assert.equal(reason, 'inbound_arrival_before_departure')
})

test('Rule 0 green: a normal round-trip with sound inbound timing is not flagged', () => {
  const reason = detectSuspectReason(offer({
    inbound: validInbound,
  } as any))
  assert.equal(reason, null)
})

test('Rule 0 green: a one-way offer (no inbound) is not flagged by Rule 0', () => {
  const reason = detectSuspectReason(offer({ inbound: undefined } as any))
  assert.equal(reason, null)
})

test('validateOfferBatch sorts the placeholder-return offer into the suspect bucket', () => {
  const offers: PublicOffer[] = [
    offer({ id: 'good-1', inbound: validInbound } as any),
    offer({
      id: 'placeholder-return',
      inbound: { ...validInbound, departure_time: '', arrival_time: '', duration_minutes: 0 },
    } as any),
    offer({ id: 'good-2', inbound: validInbound } as any),
  ]
  const { valid, suspect } = validateOfferBatch(offers)
  assert.deepEqual(valid.map(o => o.id).sort(), ['good-1', 'good-2'])
  assert.equal(suspect.length, 1)
  assert.equal(suspect[0].offer.id, 'placeholder-return')
  assert.equal(suspect[0].reason, 'inbound_missing_timing')
})
