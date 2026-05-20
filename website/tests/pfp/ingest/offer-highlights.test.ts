import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildOfferHighlights,
  buildAmenitySummary,
  classifyDepartureTime,
} from '../../../lib/pfp/ingest/offer-highlights.ts'
import type { NormalizedOffer, NormalizedRoute } from '../../../lib/pfp/types/agent-session.types.ts'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSegment(departure = '2026-06-15T08:00:00', durationSec = 7200) {
  return {
    airline: 'FR',
    airlineName: 'Ryanair',
    flightNo: 'FR1234',
    origin: 'GDN',
    destination: 'BCN',
    originCity: 'Gdansk',
    destinationCity: 'Barcelona',
    departure,
    arrival: new Date(new Date(departure).getTime() + durationSec * 1000).toISOString(),
    durationSeconds: durationSec,
    cabinClass: 'economy',
    aircraft: '',
  }
}

function makeRoute(departure = '2026-06-15T08:00:00', durationSec = 7200, stopovers = 0): NormalizedRoute {
  return {
    segments: [makeSegment(departure, durationSec)],
    totalDurationSeconds: durationSec,
    stopovers,
  }
}

function makeOffer(overrides: Partial<NormalizedOffer> = {}): NormalizedOffer {
  return {
    id: 'o1',
    price: 89,
    currency: 'EUR',
    priceFormatted: '89 EUR',
    priceNormalized: 89,
    outbound: makeRoute(),
    inbound: null,
    airlines: ['FR'],
    ownerAirline: 'FR',
    source: 'ryanair_direct',
    sourceTier: 'free',
    bagsPrice: {},
    availabilitySeats: null,
    conditions: {},
    isFeatured: false,
    isLocked: false,
    fetchedAt: '2026-06-15T10:00:00Z',
    bookingUrl: '',
    ...overrides,
  }
}

// ─── classifyDepartureTime ────────────────────────────────────────────────────

test('classifyDepartureTime: early morning (00–05)', () => {
  assert.equal(classifyDepartureTime('2026-06-15T04:30:00'), 'early_morning')
})

test('classifyDepartureTime: morning (06–11)', () => {
  assert.equal(classifyDepartureTime('2026-06-15T08:00:00'), 'morning')
})

test('classifyDepartureTime: afternoon (12–17)', () => {
  assert.equal(classifyDepartureTime('2026-06-15T14:00:00'), 'afternoon')
})

test('classifyDepartureTime: evening (18–20)', () => {
  assert.equal(classifyDepartureTime('2026-06-15T19:00:00'), 'evening')
})

test('classifyDepartureTime: night (21–23)', () => {
  assert.equal(classifyDepartureTime('2026-06-15T22:30:00'), 'night')
})

test('classifyDepartureTime: invalid string → varies', () => {
  assert.equal(classifyDepartureTime(''), 'varies')
})

// ─── buildOfferHighlights ─────────────────────────────────────────────────────

test('buildOfferHighlights: returns one highlight per carrier', () => {
  const offers = [
    makeOffer({ ownerAirline: 'FR', priceNormalized: 89 }),
    makeOffer({ ownerAirline: 'FR', priceNormalized: 120, id: 'o2' }),
    makeOffer({ ownerAirline: 'W6', priceNormalized: 99, id: 'o3', airlines: ['W6'],
      source: 'wizzair_direct',
      outbound: makeRoute('2026-06-15T14:00:00', 7800, 0) }),
  ]
  const highlights = buildOfferHighlights(offers, 'EUR')
  assert.equal(highlights.length, 2)
  const fr = highlights.find(h => h.carrier === 'FR')!
  assert.ok(fr)
  assert.equal(fr.best_price, 89)
  assert.equal(fr.offer_count, 2)
})

test('buildOfferHighlights: best_price is the minimum normalized price', () => {
  const offers = [
    makeOffer({ priceNormalized: 150, id: 'o1' }),
    makeOffer({ priceNormalized: 89, id: 'o2' }),
    makeOffer({ priceNormalized: 200, id: 'o3' }),
  ]
  const highlights = buildOfferHighlights(offers, 'EUR')
  assert.equal(highlights[0].best_price, 89)
})

test('buildOfferHighlights: direct_available true when stopovers=0 exists', () => {
  const offers = [
    makeOffer({ outbound: makeRoute('2026-06-15T08:00:00', 7200, 0) }),
    makeOffer({ id: 'o2', outbound: makeRoute('2026-06-15T10:00:00', 9000, 1) }),
  ]
  const [h] = buildOfferHighlights(offers, 'EUR')
  assert.equal(h.direct_available, true)
  assert.equal(h.min_stops, 0)
})

test('buildOfferHighlights: direct_available false when all offers have stops', () => {
  const offers = [
    makeOffer({ outbound: makeRoute('2026-06-15T08:00:00', 9000, 1) }),
    makeOffer({ id: 'o2', outbound: makeRoute('2026-06-15T10:00:00', 10800, 2) }),
  ]
  const [h] = buildOfferHighlights(offers, 'EUR')
  assert.equal(h.direct_available, false)
  assert.equal(h.min_stops, 1)
})

test('buildOfferHighlights: duration range spans min and max', () => {
  const o1 = makeOffer({ outbound: makeRoute('2026-06-15T08:00:00', 6000) })  // 100 min
  const o2 = makeOffer({ id: 'o2', outbound: makeRoute('2026-06-15T10:00:00', 9000) }) // 150 min
  const [h] = buildOfferHighlights([o1, o2], 'EUR')
  assert.equal(h.duration_min_minutes, 100)
  assert.equal(h.duration_max_minutes, 150)
})

test('buildOfferHighlights: bags prices extracted from cheapest offer', () => {
  const cheap = makeOffer({
    priceNormalized: 89,
    bagsPrice: { carry_on: 12, checked_bag: 25, seat: 8 },
  })
  const expensive = makeOffer({
    id: 'o2',
    priceNormalized: 120,
    bagsPrice: { carry_on: 0 },
  })
  const [h] = buildOfferHighlights([cheap, expensive], 'EUR')
  assert.equal(h.bags_carry_on_price, 12)
  assert.equal(h.bags_checked_price, 25)
  assert.equal(h.seat_price, 8)
  assert.equal(h.bags_included, false)
})

test('buildOfferHighlights: bags_included true when carry_on === 0', () => {
  const offer = makeOffer({ bagsPrice: { carry_on: 0 } })
  const [h] = buildOfferHighlights([offer], 'EUR')
  assert.equal(h.bags_included, true)
})

test('buildOfferHighlights: refund_policy extracted when available', () => {
  const offer = makeOffer({
    conditions: { refund_before_departure: 'allowed_with_fee' },
  })
  const [h] = buildOfferHighlights([offer], 'EUR')
  assert.equal(h.refund_policy, 'allowed_with_fee')
})

test('buildOfferHighlights: best_booking_channel from source of cheapest offer', () => {
  const cheap = makeOffer({ source: 'ryanair_direct', priceNormalized: 89 })
  const [h] = buildOfferHighlights([cheap], 'EUR')
  assert.equal(h.best_booking_channel, 'Ryanair (direct)')
})

test('buildOfferHighlights: sorted by best_price ascending', () => {
  const offers = [
    makeOffer({ ownerAirline: 'W6', priceNormalized: 150, id: 'o1', airlines: ['W6'] }),
    makeOffer({ ownerAirline: 'FR', priceNormalized: 89, id: 'o2' }),
  ]
  const highlights = buildOfferHighlights(offers, 'EUR')
  assert.equal(highlights[0].carrier, 'FR')
  assert.equal(highlights[1].carrier, 'W6')
})

test('buildOfferHighlights: empty offers returns empty array', () => {
  assert.deepEqual(buildOfferHighlights([], 'EUR'), [])
})

test('buildOfferHighlights: falls back to price when priceNormalized is null', () => {
  const offer = makeOffer({ priceNormalized: null, price: 95 })
  const [h] = buildOfferHighlights([offer], 'EUR')
  assert.equal(h.best_price, 95)
})

// ─── buildAmenitySummary ──────────────────────────────────────────────────────

test('buildAmenitySummary: returns null when no offer has bag data', () => {
  const offers = [makeOffer({ bagsPrice: {} }), makeOffer({ id: 'o2', bagsPrice: undefined })]
  assert.equal(buildAmenitySummary(offers, 'EUR'), null)
})

test('buildAmenitySummary: includes carriers with fee data', () => {
  const offers = [
    makeOffer({ ownerAirline: 'FR', bagsPrice: { carry_on: 12, checked_bag: 30 } }),
    makeOffer({ ownerAirline: 'W6', id: 'o2', airlines: ['W6'], bagsPrice: { carry_on: 0, seat: 10 } }),
  ]
  const summary = buildAmenitySummary(offers, 'EUR')!
  assert.ok(summary)
  assert.equal(summary.rows.length, 2)
  const fr = summary.rows.find(r => r.carrier === 'FR')!
  assert.equal(fr.carry_on, 12)
  assert.equal(fr.checked_bag, 30)
  assert.equal(fr.seat_selection, null)
})

test('buildAmenitySummary: 0 fee treated as included (not null)', () => {
  const offer = makeOffer({ bagsPrice: { carry_on: 0 } })
  const summary = buildAmenitySummary([offer], 'EUR')!
  assert.equal(summary.rows[0].carry_on, 0)
})

test('buildAmenitySummary: uses first connector that exposed data per carrier', () => {
  const o1 = makeOffer({ ownerAirline: 'LH', bagsPrice: { carry_on: 25 }, id: 'o1', airlines: ['LH'] })
  const o2 = makeOffer({ ownerAirline: 'LH', bagsPrice: { carry_on: 30 }, id: 'o2', airlines: ['LH'],
    priceNormalized: 200 })
  // Should use the cheapest offer's data
  const summary = buildAmenitySummary([o1, o2], 'EUR')!
  const lh = summary.rows[0]
  assert.equal(lh.carry_on, 25)
})
