import assert from 'node:assert/strict'
import test from 'node:test'

import { formatFlightTime } from '../lib/flight-datetime.ts'
import { normalizeTrustedOffer } from '../lib/trusted-offer.ts'

test('formatFlightTime keeps unknown clock times as placeholders', () => {
  assert.equal(formatFlightTime('2026-06-01'), '--:--')
  assert.equal(formatFlightTime('2026-06-01T14:35:00Z'), '14:35')
})

test('normalizeTrustedOffer does not invent clock times from date-only route data', () => {
  const offer = normalizeTrustedOffer({
    id: 'date-only-offer',
    price: 99,
    currency: 'EUR',
    airline: 'Example Air',
    outbound: {
      stopovers: 0,
      total_duration_seconds: 2 * 60 * 60,
      segments: [
        {
          origin: 'SOU',
          destination: 'EDI',
          departure: '2026-06-01',
          arrival: '2026-06-01',
        },
      ],
    },
  }, 0)

  assert.equal(offer.departure_time, '2026-06-01')
  assert.equal(offer.arrival_time, '2026-06-01')
  assert.equal(offer.duration_minutes, 120)
})

test('normalizeTrustedOffer still infers missing clock times when an explicit clock is present', () => {
  const offer = normalizeTrustedOffer({
    id: 'timed-offer',
    price: 149,
    currency: 'EUR',
    airline: 'Example Air',
    outbound: {
      stopovers: 0,
      total_duration_seconds: 95 * 60,
      segments: [
        {
          origin: 'SOU',
          destination: 'EDI',
          departure: '2026-06-01T10:15:00Z',
          arrival: '',
        },
      ],
    },
  }, 0)

  assert.equal(offer.departure_time, '2026-06-01T10:15:00Z')
  assert.equal(offer.arrival_time, '2026-06-01T11:50:00.000Z')
  assert.equal(offer.duration_minutes, 95)
})

test('normalizeTrustedOffer reads alternate upstream timestamp keys', () => {
  const offer = normalizeTrustedOffer({
    id: 'alternate-time-keys-offer',
    price: 149,
    currency: 'EUR',
    airline: 'Example Air',
    outbound: {
      stopovers: 0,
      total_duration_seconds: 95 * 60,
      segments: [
        {
          origin: 'SOU',
          destination: 'EDI',
          departureTime: '2026-06-01T10:15:00Z',
          arrivalTime: '2026-06-01T11:50:00Z',
        },
      ],
    },
  }, 0)

  assert.equal(offer.departure_time, '2026-06-01T10:15:00Z')
  assert.equal(offer.arrival_time, '2026-06-01T11:50:00Z')
  assert.equal(offer.origin, 'SOU')
  assert.equal(offer.destination, 'EDI')
  assert.equal(offer.duration_minutes, 95)
})