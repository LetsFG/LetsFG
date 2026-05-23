/**
 * Tests for the date-only timestamp bug in getRouteTiming (lib/trusted-offer.ts).
 *
 * Observed in production (ws_47776b352af74a1b, 2026-05-23): a return leg
 * rendered as "June 5, 00:00 → 01:00, 1h Direct" with "Low-cost carrier" as
 * airline. Trace:
 *
 *   1. Connector emitted segment with only a *date* (e.g. "2026-06-05") and
 *      total_duration_seconds = 3600.
 *   2. getRouteTiming saw no clock component but still applied
 *      `durationMinutes = fallbackDurationMinutes` at the unconditional
 *      override at the bottom of the function.
 *   3. Result: { departure: "2026-06-05", arrival: "2026-06-05", durationMinutes: 60 }.
 *   4. UI's formatFlightTime("2026-06-05") → "00:00", and the date renders as
 *      whatever Date("2026-06-05") parses to (UTC midnight, displays as June 5).
 *   5. fmtDuration(60) → "1h", stops=0 → "Direct" badge.
 *
 * Fix: never synthesize timestamps from a date-only string. If neither the
 * connector nor any segment provides an explicit clock, return empty
 * timestamps and let the renderer/validator handle the absent data honestly.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeTrustedOffer, toPublicOffer } from '../lib/trusted-offer.ts'

function roundTripRaw(opts: {
  inboundDeparture: string
  inboundArrival: string
  inboundTotalDurationSeconds?: number
}) {
  return {
    id: 'test-offer',
    price: 100,
    currency: 'EUR',
    airlines: ['Example Air'],
    airline_code: 'EA',
    source: 'test',
    outbound: {
      origin: 'LHR',
      destination: 'BCN',
      segments: [{
        origin: 'LHR',
        destination: 'BCN',
        departure: '2026-05-29T20:50:00+01:00',
        arrival: '2026-05-29T23:10:00+02:00',
        duration_seconds: 8400,
        flight_no: 'EA100',
      }],
      stopovers: 0,
      total_duration_seconds: 8400,
    },
    inbound: {
      origin: 'BCN',
      destination: 'LHR',
      segments: [{
        origin: 'BCN',
        destination: 'LHR',
        departure: opts.inboundDeparture,
        arrival: opts.inboundArrival,
        flight_no: 'EA101',
      }],
      stopovers: 0,
      ...(opts.inboundTotalDurationSeconds !== undefined
        ? { total_duration_seconds: opts.inboundTotalDurationSeconds }
        : {}),
    },
  }
}

test('inbound with date-only timestamps does NOT synthesize fake clock', () => {
  // This is the exact production repro.
  const raw = roundTripRaw({
    inboundDeparture: '2026-06-05',
    inboundArrival: '2026-06-05',
    inboundTotalDurationSeconds: 3600,
  })
  const trusted = normalizeTrustedOffer(raw, 0)
  const publicOffer = toPublicOffer(trusted)
  const inbound = publicOffer.inbound!

  // Before fix: { departure_time: "2026-06-05", arrival_time: "2026-06-05", duration_minutes: 60 }
  // After fix: timestamps should be empty (no clock) or duration_minutes should be 0,
  // so the validator can flag the offer and the renderer can show "Times unavailable"
  // instead of fabricating a "00:00 → 01:00, 1h Direct" card.
  //
  // We accept either:
  //   - departure_time === '' AND arrival_time === '' (preferred — honestly absent), OR
  //   - duration_minutes === 0 (alternative — caught downstream by validator)
  const hasNoTimes = inbound.departure_time === '' && inbound.arrival_time === ''
  const hasZeroDuration = inbound.duration_minutes === 0
  assert.ok(
    hasNoTimes || hasZeroDuration,
    `Date-only inbound must NOT synthesize clock. Got: departure=${inbound.departure_time}, arrival=${inbound.arrival_time}, duration=${inbound.duration_minutes}`,
  )
})

test('inbound with proper clock + tz still works (regression guard)', () => {
  const raw = roundTripRaw({
    inboundDeparture: '2026-05-31T22:30:00+02:00',
    inboundArrival: '2026-06-01T00:50:00+01:00',
    inboundTotalDurationSeconds: 8400,
  })
  const trusted = normalizeTrustedOffer(raw, 0)
  const publicOffer = toPublicOffer(trusted)
  const inbound = publicOffer.inbound!

  // Departure clock should round-trip
  assert.ok(inbound.departure_time.startsWith('2026-05-31T22:30'),
    `Expected departure to start with 2026-05-31T22:30, got: ${inbound.departure_time}`)
  // Duration should be ~140 min (2h 20m)
  assert.ok(inbound.duration_minutes >= 130 && inbound.duration_minutes <= 150,
    `Expected ~140 min, got: ${inbound.duration_minutes}`)
})
