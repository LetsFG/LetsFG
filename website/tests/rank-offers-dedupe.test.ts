import { deduplicateOffers, getOfferInstanceKey, rankOffers, selectDiverseTop } from '../app/lib/rankOffers'
import assert from 'node:assert/strict'
import test from 'node:test'

import { deduplicateOffers, rankOffers } from '../app/lib/rankOffers.ts'

test('deduplicateOffers keeps the cheapest copy of the same physical flight', () => {
  const offers = [
    {
      id: 'meta-copy',
      price: 145,
      currency: 'GBP',
      airline: 'Example Air',
      origin: 'LON',
      destination: 'PAR',
      departure_time: '2026-06-15T19:00:00Z',
      arrival_time: '2026-06-15T20:20:00Z',
      duration_minutes: 80,
      stops: 0,
    },
    {
      id: 'direct-copy',
      price: 139,
      currency: 'GBP',
      airline: 'Example Air',
      origin: 'LON',
      destination: 'PAR',
      departure_time: '2026-06-15T19:05:00Z',
      arrival_time: '2026-06-15T20:25:00Z',
      duration_minutes: 80,
      stops: 0,
    },
    {
      id: 'later-flight',
      price: 151,
      currency: 'GBP',
      airline: 'Example Air',
      origin: 'LON',
      destination: 'PAR',
      departure_time: '2026-06-15T21:00:00Z',
      arrival_time: '2026-06-15T22:20:00Z',
      duration_minutes: 80,
      stops: 0,
    },
  ]

  const deduped = deduplicateOffers(offers)

  assert.equal(deduped.length, 2)
  assert.deepEqual(deduped.map((offer) => offer.id), ['direct-copy', 'later-flight'])
})

test('deduplicateOffers preserves distinct round-trip return variants', () => {
  const offers = [
    {
      id: 'shared-provider-id',
      price: 210,
      currency: 'GBP',
      airline: 'Example Air',
      origin: 'LON',
      destination: 'BCN',
      departure_time: '2026-06-19T20:50:00Z',
      arrival_time: '2026-06-19T23:10:00Z',
      duration_minutes: 140,
      stops: 0,
      inbound: {
        origin: 'BCN',
        destination: 'LON',
        departure_time: '2026-06-21T10:45:00Z',
        arrival_time: '2026-06-21T12:05:00Z',
        stops: 0,
      },
    },
    {
      id: 'shared-provider-id',
      price: 210,
      currency: 'GBP',
      airline: 'Example Air',
      origin: 'LON',
      destination: 'BCN',
      departure_time: '2026-06-19T20:50:00Z',
      arrival_time: '2026-06-19T23:10:00Z',
      duration_minutes: 140,
      stops: 0,
      inbound: {
        origin: 'BCN',
        destination: 'LON',
        departure_time: '2026-06-21T19:40:00Z',
        arrival_time: '2026-06-21T21:00:00Z',
        stops: 0,
      },
    },
  ]

  const deduped = deduplicateOffers(offers)

  assert.equal(deduped.length, 2)
  assert.deepEqual(
    deduped.map((offer) => offer.inbound?.departure_time),
    ['2026-06-21T10:45:00Z', '2026-06-21T19:40:00Z'],
  )
})

test('selectDiverseTop fallback keeps same-id variants when the itinerary differs', () => {
  const offers = [
    {
      id: 'shared-provider-id',
      price: 210,
      currency: 'GBP',
      airline: 'Example Air',
      origin: 'LON',
      destination: 'BCN',
      departure_time: '2026-06-19T20:50:00Z',
      arrival_time: '2026-06-19T23:10:00Z',
      duration_minutes: 140,
      stops: 0,
      inbound: {
        origin: 'BCN',
        destination: 'LON',
        departure_time: '2026-06-21T18:20:00Z',
        arrival_time: '2026-06-21T19:40:00Z',
        stops: 0,
      },
    },
    {
      id: 'shared-provider-id',
      price: 212,
      currency: 'GBP',
      airline: 'Example Air',
      origin: 'LON',
      destination: 'BCN',
      departure_time: '2026-06-19T20:50:00Z',
      arrival_time: '2026-06-19T23:10:00Z',
      duration_minutes: 140,
      stops: 0,
      inbound: {
        origin: 'BCN',
        destination: 'LON',
        departure_time: '2026-06-21T19:40:00Z',
        arrival_time: '2026-06-21T21:00:00Z',
        stops: 0,
      },
    },
  ]

  const ranked = rankOffers(offers, { tripPurpose: 'city_break', retTimePref: 'evening', preferDirect: true })
  const top = selectDiverseTop(ranked, 2)

  assert.equal(top.length, 2)
  assert.notEqual(getOfferInstanceKey(top[0].offer), getOfferInstanceKey(top[1].offer))
  assert.deepEqual(
    top.map((entry) => entry.offer.inbound?.departure_time),
    ['2026-06-21T18:20:00Z', '2026-06-21T19:40:00Z'],
  )
})

test('rankOffers keeps a reasonable direct value flight ahead of an absurdly long evening match', () => {
  const offers = [
    {
      id: 'direct-value',
      price: 120,
      displayPrice: 120,
      currency: 'GBP',
      airline: 'Example Air',
      origin: 'LON',
      destination: 'BCN',
      departure_time: '2026-06-15T17:05:00Z',
      arrival_time: '2026-06-15T19:45:00Z',
      duration_minutes: 160,
      stops: 0,
    },
    {
      id: 'late-odyssey',
      price: 265,
      displayPrice: 265,
      currency: 'GBP',
      airline: 'Example Air',
      origin: 'LON',
      destination: 'BCN',
      departure_time: '2026-06-15T18:30:00Z',
      arrival_time: '2026-06-16T03:30:00Z',
      duration_minutes: 540,
      stops: 2,
    },
    {
      id: 'cheap-red-eye',
      price: 105,
      displayPrice: 105,
      currency: 'GBP',
      airline: 'Example Air',
      origin: 'LON',
      destination: 'BCN',
      departure_time: '2026-06-15T05:30:00Z',
      arrival_time: '2026-06-15T08:10:00Z',
      duration_minutes: 160,
      stops: 0,
    },
  ]

  const ranked = rankOffers(offers, { depTimePref: 'evening' })

  assert.equal(ranked[0].offer.id, 'direct-value')
  assert.notEqual(ranked[0].offer.id, 'late-odyssey')
})

test('rankOffers breaks ties deterministically instead of preserving input order', () => {
  const alpha = {
    id: 'alpha',
    price: 149,
    displayPrice: 149,
    currency: 'EUR',
    airline: 'Alpha Air',
    origin: 'LON',
    destination: 'PAR',
    departure_time: '2026-07-01T09:00:00Z',
    arrival_time: '2026-07-01T10:20:00Z',
    duration_minutes: 80,
    stops: 0,
  }
  const zulu = {
    ...alpha,
    id: 'zulu',
    airline: 'Zulu Air',
  }

  const forward = rankOffers([zulu, alpha], {})
  const reverse = rankOffers([alpha, zulu], {})

  assert.equal(forward[0].offer.id, 'alpha')
  assert.equal(reverse[0].offer.id, 'alpha')
})

test('rankOffers prefers refundable fares when cancellation is required', () => {
  const offers = [
    {
      id: 'refundable',
      price: 220,
      displayPrice: 220,
      currency: 'GBP',
      airline: 'Example Air',
      origin: 'LON',
      destination: 'JFK',
      departure_time: '2026-06-15T09:00:00Z',
      arrival_time: '2026-06-15T16:30:00Z',
      duration_minutes: 450,
      stops: 0,
      conditions: { refund_before_departure: 'allowed' as const },
    },
    {
      id: 'cheaper-nonrefundable',
      price: 205,
      displayPrice: 205,
      currency: 'GBP',
      airline: 'Example Air',
      origin: 'LON',
      destination: 'JFK',
      departure_time: '2026-06-15T09:10:00Z',
      arrival_time: '2026-06-15T16:40:00Z',
      duration_minutes: 450,
      stops: 0,
      conditions: { refund_before_departure: 'not_allowed' as const },
    },
    {
      id: 'unknown-policy',
      price: 210,
      displayPrice: 210,
      currency: 'GBP',
      airline: 'Example Air',
      origin: 'LON',
      destination: 'JFK',
      departure_time: '2026-06-15T09:20:00Z',
      arrival_time: '2026-06-15T16:50:00Z',
      duration_minutes: 450,
      stops: 0,
    },
  ]

  const ranked = rankOffers(offers, { requireCancellation: true, tripContext: 'business_traveler' })

  assert.equal(ranked[0].offer.id, 'refundable')
  assert.equal(ranked[0].heroFacts.includes('refundable before departure'), true)
  assert.equal(ranked[ranked.length - 1].offer.id, 'cheaper-nonrefundable')
})