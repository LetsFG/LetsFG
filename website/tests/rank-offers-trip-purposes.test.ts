import assert from 'node:assert/strict'
import test from 'node:test'

import { rankOffers } from '../app/lib/rankOffers.ts'

test('rankOffers blends secondary trip purposes instead of collapsing to the primary only', () => {
  const offers = [
    {
      id: 'cheap-early-connection',
      price: 100,
      displayPrice: 100,
      currency: 'EUR',
      airline: 'Example Air',
      origin: 'LON',
      destination: 'BCN',
      departure_time: '2026-06-15T07:00:00Z',
      arrival_time: '2026-06-15T11:00:00Z',
      duration_minutes: 540,
      stops: 2,
      segments: [{ layover_minutes: 90 }, { layover_minutes: 80 }],
    },
    {
      id: 'faster-direct',
      price: 125,
      displayPrice: 125,
      currency: 'EUR',
      airline: 'Example Air',
      origin: 'LON',
      destination: 'BCN',
      departure_time: '2026-06-15T10:00:00Z',
      arrival_time: '2026-06-15T13:00:00Z',
      duration_minutes: 180,
      stops: 0,
    },
  ]

  const primaryOnly = rankOffers(offers, { tripPurpose: 'city_break' })
  const blended = rankOffers(offers, { tripPurpose: 'city_break', tripPurposes: ['city_break', 'business'] })

  assert.equal(primaryOnly[0].offer.id, 'cheap-early-connection')
  assert.equal(blended[0].offer.id, 'faster-direct')
})