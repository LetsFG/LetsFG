/**
 * Tests for date-drift and duration-asymmetry rules added to
 * detectSuspectReason after the LHR→BCN incident where a search for
 * 2026-05-29 / return 2026-05-31 returned an offer with inbound on
 * 2026-06-03 and a fake 1h "Direct" BCN→LON leg.
 *
 * Before these rules:
 * - The validator had no concept of the user's requested dates, so an
 *   offer for the WRONG return date passed as valid.
 * - The validator only checked structural plausibility of the inbound
 *   leg (>20min, <1440min, arr>dep). A 1h BCN→LON return leg (real
 *   route is ~2h) passed every check.
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
    currency: 'GBP',
    airline: 'British Airways',
    airline_code: 'BA',
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
  departure_time: '2026-05-31T18:30:00+02:00',
  arrival_time: '2026-05-31T19:50:00+01:00',
  duration_minutes: 140,
  stops: 0,
}

test('Rule -1 red: outbound_date_drift flagged when offer departs on a different day than requested', () => {
  const reason = detectSuspectReason(
    offer({ departure_time: '2026-05-30T20:50:00+01:00' }),
    { date_from: '2026-05-29' },
  )
  assert.ok(reason?.startsWith('outbound_date_drift'),
    `expected outbound_date_drift, got ${reason}`)
})

test('Rule -1 green: outbound matching requested date_from is NOT flagged', () => {
  const reason = detectSuspectReason(
    offer({ departure_time: '2026-05-29T20:50:00+01:00', inbound: validInbound } as any),
    { date_from: '2026-05-29', return_date: '2026-05-31' },
  )
  assert.equal(reason, null)
})

test('Rule -1 green: missing expected dates skips date validation (backwards compat)', () => {
  const reason = detectSuspectReason(offer({ inbound: validInbound } as any))
  assert.equal(reason, null, 'no expected dates supplied → no drift check, must pass')
})

test('Rule 0a red: return_date_drift flagged when inbound departs on a different day', () => {
  // THE BUG: user asked for 2026-05-31 return, offer has inbound on 2026-06-03.
  const driftedInbound = {
    ...validInbound,
    departure_time: '2026-06-03T00:00:00+02:00',
    arrival_time: '2026-06-03T01:00:00+01:00',
    duration_minutes: 60,
  }
  const reason = detectSuspectReason(
    offer({ inbound: driftedInbound } as any),
    { date_from: '2026-05-29', return_date: '2026-05-31' },
  )
  assert.ok(reason?.startsWith('return_date_drift'),
    `expected return_date_drift, got ${reason}`)
})

test('Rule 0a green: inbound departing on requested return_date is NOT flagged', () => {
  const reason = detectSuspectReason(
    offer({ inbound: validInbound } as any),
    { date_from: '2026-05-29', return_date: '2026-05-31' },
  )
  assert.equal(reason, null)
})

test('Rule 0a tolerates late-night returns (depart 23:50 May 31, arr 02:00 Jun 1)', () => {
  // Real-world: a flight departing 23:50 May 31 from BCN is a "May 31 return"
  // from the user's perspective. Departure date is what counts.
  const lateNightInbound = {
    ...validInbound,
    departure_time: '2026-05-31T23:50:00+02:00',
    arrival_time: '2026-06-01T02:00:00+01:00',
    duration_minutes: 130,
  }
  const reason = detectSuspectReason(
    offer({ inbound: lateNightInbound } as any),
    { date_from: '2026-05-29', return_date: '2026-05-31' },
  )
  assert.equal(reason, null)
})

test('Rule 0b red: inbound duration wildly asymmetric to outbound flags as suspect', () => {
  // THE OTHER BUG: outbound LHR→BCN = 2h20m. Inbound shows 1h. Same physical
  // route reversed, durations should be comparable (±50%).
  const fakeShortInbound = {
    ...validInbound,
    duration_minutes: 60,  // 1h vs 140min outbound = 0.43x — implausible
  }
  const reason = detectSuspectReason(
    offer({ duration_minutes: 140, inbound: fakeShortInbound } as any),
    { date_from: '2026-05-29', return_date: '2026-05-31' },
  )
  assert.ok(reason?.startsWith('inbound_duration_asymmetric'),
    `expected inbound_duration_asymmetric, got ${reason}`)
})

test('Rule 0b green: legitimate inbound/outbound duration difference within ±50% is NOT flagged', () => {
  // Real route asymmetry exists (winds, ATC routing). 140 outbound, 160 inbound is normal.
  const normalAsymInbound = {
    ...validInbound,
    duration_minutes: 160,
  }
  const reason = detectSuspectReason(
    offer({ duration_minutes: 140, inbound: normalAsymInbound } as any),
    { date_from: '2026-05-29', return_date: '2026-05-31' },
  )
  assert.equal(reason, null)
})

test('validateOfferBatch separates drifted-date offers into suspect bucket', () => {
  const good = offer({
    id: 'good',
    inbound: validInbound,
  } as any)
  const drifted = offer({
    id: 'drifted',
    inbound: {
      ...validInbound,
      departure_time: '2026-06-03T00:00:00+02:00',
      arrival_time: '2026-06-03T01:00:00+01:00',
      duration_minutes: 60,
    },
  } as any)
  const { valid, suspect } = validateOfferBatch(
    [drifted, good],
    { date_from: '2026-05-29', return_date: '2026-05-31' },
  )
  assert.equal(valid.length, 1)
  assert.equal(valid[0].id, 'good')
  assert.equal(suspect.length, 1)
  assert.equal(suspect[0].offer.id, 'drifted')
})
