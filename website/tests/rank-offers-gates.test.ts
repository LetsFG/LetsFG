import assert from 'node:assert/strict'
import test from 'node:test'

import { rankOffers, type RankOffer } from '../app/lib/rankOffers.ts'

// User stated criteria are HARD GATES on the hero. When no offer satisfies all
// stated criteria, gates are relaxed in order: refund → bag → time → direct
// (refund is most relaxable, direct is sacred). When a gate is relaxed for the
// hero, the relaxedGates field surfaces it so the UI can banner the mismatch.

function offer(overrides: Partial<RankOffer> & { id: string }): RankOffer {
  return {
    id: overrides.id,
    price: overrides.price ?? 200,
    currency: 'GBP',
    airline: 'Test Air',
    origin: 'LON',
    destination: 'BCN',
    departure_time: '2026-06-15T09:00:00+01:00',
    arrival_time: '2026-06-15T12:10:00+02:00',
    duration_minutes: 130,
    stops: 0,
    ...overrides,
  }
}

test('preferDirect hard-gates the hero when directs exist (cheaper 1-stop must not win)', () => {
  const cheap1Stop = offer({ id: 'cheap-1stop', price: 80, stops: 1 })
  const directExpensive = offer({ id: 'direct-pricier', price: 150, stops: 0 })
  // Filler offers are all 1-stop, so only `direct-pricier` passes the direct gate.
  const filler = Array.from({ length: 10 }, (_, i) =>
    offer({ id: `f-${i}`, price: 90 + i * 15, stops: 1 })
  )
  const ranked = rankOffers([cheap1Stop, directExpensive, ...filler], { preferDirect: true })
  assert.equal(ranked[0].offer.id, 'direct-pricier',
    'When user asked for direct, top-1 must be direct even when 1-stops are cheaper')
  assert.equal(ranked[0].offer.stops, 0)
})

test('preferDirect relaxes when no directs exist; hero declares relaxedGates', () => {
  const oneStops = Array.from({ length: 5 }, (_, i) =>
    offer({ id: `1s-${i}`, price: 100 + i * 20, stops: 1 })
  )
  const ranked = rankOffers(oneStops, { preferDirect: true })
  assert.equal(ranked[0].offer.stops, 1, 'fallback hero is best 1-stop since no directs')
  assert.ok(
    ranked[0].relaxedGates?.includes('direct'),
    `hero must declare "direct" was relaxed, got ${JSON.stringify(ranked[0].relaxedGates)}`,
  )
})

test('preferDirect on round-trip requires BOTH legs direct', () => {
  const out0in1 = offer({
    id: 'out0-in1',
    price: 200,
    stops: 0,
    inbound: { stops: 1, departure_time: '2026-06-18T14:00:00+02:00', arrival_time: '2026-06-18T20:00:00+01:00', duration_minutes: 300 },
  })
  const both0 = offer({
    id: 'both0',
    price: 230,
    stops: 0,
    inbound: { stops: 0, departure_time: '2026-06-18T14:00:00+02:00', arrival_time: '2026-06-18T15:10:00+01:00', duration_minutes: 130 },
  })
  // Filler offers are all 1-stop on at least one leg so only `both0` passes
  // the direct gate (which requires BOTH legs direct).
  const filler = Array.from({ length: 10 }, (_, i) =>
    offer({
      id: `f-${i}`,
      price: 150 + i * 20,
      stops: i % 2 === 0 ? 1 : 0,
      inbound: { stops: i % 2 === 0 ? 0 : 1, departure_time: '2026-06-18T14:00:00+02:00', arrival_time: '2026-06-18T15:10:00+01:00', duration_minutes: 130 },
    })
  )
  const ranked = rankOffers([out0in1, both0, ...filler], { preferDirect: true })
  assert.equal(ranked[0].offer.id, 'both0',
    'preferDirect with round-trip requires both legs direct; mixed must not win')
})

test('refundability gate is dropped FIRST when no offer satisfies all criteria', () => {
  // User wants direct + bag included + refundable. Only direct+bag exists, no refundable.
  const directBagNoRefund = offer({
    id: 'direct-bag-norefund',
    price: 200,
    stops: 0,
    ancillaries: { checked_bag: { included: true } },
    conditions: { refund_before_departure: 'not_allowed' },
  })
  const cheapRefundableButStops = offer({
    id: 'cheap-refundable-1stop',
    price: 90,
    stops: 1,
    ancillaries: { checked_bag: { included: true } },
    conditions: { refund_before_departure: 'allowed' },
  })
  const filler = Array.from({ length: 8 }, (_, i) =>
    offer({ id: `f-${i}`, price: 110 + i * 18, stops: i % 2 })
  )
  const ranked = rankOffers([directBagNoRefund, cheapRefundableButStops, ...filler], {
    preferDirect: true,
    requireBag: true,
    requireCancellation: true,
  })
  // refund is the most relaxable — direct + bag (sacred + next) must win over refundable-1stop
  assert.equal(ranked[0].offer.id, 'direct-bag-norefund',
    'refund must relax before bag/direct; hero should be direct-with-bag-no-refund')
  assert.ok(
    ranked[0].relaxedGates?.includes('refund'),
    `hero must declare "refund" was relaxed, got ${JSON.stringify(ranked[0].relaxedGates)}`,
  )
})

test('bag gate is dropped before time/direct when no offer has bag included', () => {
  const directNoBag = offer({
    id: 'direct-nobag',
    price: 200,
    stops: 0,
    ancillaries: { checked_bag: { included: false, price: 30, currency: 'GBP' } },
  })
  const filler1Stop = Array.from({ length: 8 }, (_, i) =>
    offer({ id: `f-${i}`, price: 100 + i * 18, stops: 1 })
  )
  const ranked = rankOffers([directNoBag, ...filler1Stop], {
    preferDirect: true,
    requireBag: true,
  })
  assert.equal(ranked[0].offer.id, 'direct-nobag',
    'bag relaxes before direct; hero is the only direct (bag not included)')
  assert.ok(ranked[0].relaxedGates?.includes('bag'))
  assert.ok(!ranked[0].relaxedGates?.includes('direct'),
    'direct must NOT be relaxed when a direct existed')
})

test('depTimePref relaxes before direct when no morning direct exists', () => {
  const afternoonDirect = offer({
    id: 'pm-direct',
    price: 200,
    stops: 0,
    departure_time: '2026-06-15T14:00:00+01:00',
  })
  const morning1Stop = offer({
    id: 'am-1stop',
    price: 150,
    stops: 1,
    departure_time: '2026-06-15T08:00:00+01:00',
  })
  const filler = Array.from({ length: 8 }, (_, i) =>
    offer({ id: `f-${i}`, price: 120 + i * 18, stops: 1, departure_time: '2026-06-15T13:00:00+01:00' })
  )
  const ranked = rankOffers([afternoonDirect, morning1Stop, ...filler], {
    preferDirect: true,
    depTimePref: 'morning',
  })
  assert.equal(ranked[0].offer.id, 'pm-direct',
    'time relaxes before direct; afternoon direct beats morning 1-stop')
  assert.ok(ranked[0].relaxedGates?.includes('time'))
})

test('suspect-quality offers are never picked as hero when valid offers exist', () => {
  // The LHR->BCN bug: a connector returned a return leg on the wrong date
  // with a fake 1h duration. validateOfferBatch tags it quality:'suspect'.
  // The ranker must NOT pick it even though direct-both-ways scores highest.
  const suspectButHighScore: RankOffer = {
    id: 'suspect-direct',
    price: 200,
    quality: 'suspect',
    currency: 'GBP',
    airline: 'Sketchy Air',
    origin: 'LHR',
    destination: 'BCN',
    departure_time: '2026-05-29T20:50:00+01:00',
    arrival_time: '2026-05-29T23:10:00+02:00',
    duration_minutes: 140,
    stops: 0,
    inbound: {
      origin: 'BCN',
      destination: 'LHR',
      departure_time: '2026-06-03T00:00:00+02:00',
      arrival_time: '2026-06-03T01:00:00+01:00',
      duration_minutes: 60,
      stops: 0,
    },
  } as RankOffer & { quality: 'suspect' }

  const valid: RankOffer = {
    id: 'valid-1stop',
    price: 240,
    currency: 'GBP',
    airline: 'Real Air',
    origin: 'LHR',
    destination: 'BCN',
    departure_time: '2026-05-29T08:00:00+01:00',
    arrival_time: '2026-05-29T13:30:00+02:00',
    duration_minutes: 270,
    stops: 1,
    inbound: {
      origin: 'BCN',
      destination: 'LHR',
      departure_time: '2026-05-31T18:00:00+02:00',
      arrival_time: '2026-05-31T22:00:00+01:00',
      duration_minutes: 240,
      stops: 1,
    },
  }
  const ranked = rankOffers([suspectButHighScore, valid], {})
  assert.equal(ranked[0].offer.id, 'valid-1stop',
    'valid 1-stop must win over suspect-quality direct (rank-not-filter: suspect stays in array but not as hero)')
  // Suspect offer still appears in results
  assert.ok(ranked.some(r => r.offer.id === 'suspect-direct'), 'suspect offer must remain in ranked array')
})

test('preferCheapest + preferDirect: gate still fires (cheapest direct wins, not cheapest overall)', () => {
  const cheapest1Stop = offer({ id: 'cheapest-1s', price: 60, stops: 1 })
  const cheapestDirect = offer({ id: 'cheapest-direct', price: 110, stops: 0 })
  // All filler are 1-stop so only `cheapest-direct` passes the direct gate.
  const filler = Array.from({ length: 8 }, (_, i) =>
    offer({ id: `f-${i}`, price: 65 + i * 12, stops: 1 })
  )
  const ranked = rankOffers([cheapest1Stop, cheapestDirect, ...filler], {
    preferCheapest: true,
    preferDirect: true,
  })
  assert.equal(ranked[0].offer.id, 'cheapest-direct',
    'preferCheapest+preferDirect must pick cheapest DIRECT (gate fires), not cheapest overall')
})

test('arrivalTimePref gates the hero by arrival window', () => {
  // User wants morning arrival. Make every filler arrive in the evening so
  // only the named morning-arrival offer satisfies the time gate.
  const morningArrival = offer({
    id: 'morning-arr',
    price: 200,
    departure_time: '2026-06-15T06:00:00+01:00',
    arrival_time: '2026-06-15T09:10:00+02:00',
    duration_minutes: 130,
  })
  const filler = Array.from({ length: 8 }, (_, i) =>
    offer({
      id: `f-${i}`,
      price: 120 + i * 15,
      departure_time: '2026-06-15T17:00:00+01:00',
      arrival_time: '2026-06-15T20:10:00+02:00',
      duration_minutes: 130,
    })
  )
  const ranked = rankOffers([morningArrival, ...filler], { arrivalTimePref: 'morning' })
  assert.equal(ranked[0].offer.id, 'morning-arr',
    'arrivalTimePref must gate the hero: only morning-arrival offer should win')
})

test('no gates relaxed when an offer satisfies all stated criteria', () => {
  const perfect = offer({
    id: 'perfect',
    price: 200,
    stops: 0,
    departure_time: '2026-06-15T08:00:00+01:00',
    ancillaries: { checked_bag: { included: true } },
    conditions: { refund_before_departure: 'allowed' },
  })
  const filler = Array.from({ length: 8 }, (_, i) =>
    offer({ id: `f-${i}`, price: 80 + i * 15, stops: i % 2 })
  )
  const ranked = rankOffers([perfect, ...filler], {
    preferDirect: true,
    depTimePref: 'morning',
    requireBag: true,
    requireCancellation: true,
  })
  assert.equal(ranked[0].offer.id, 'perfect')
  assert.ok(
    !ranked[0].relaxedGates || ranked[0].relaxedGates.length === 0,
    `hero satisfied all gates; relaxedGates should be empty, got ${JSON.stringify(ranked[0].relaxedGates)}`,
  )
})
