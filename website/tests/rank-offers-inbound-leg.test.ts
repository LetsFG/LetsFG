import assert from 'node:assert/strict'
import test from 'node:test'

import { rankOffers, type RankOffer } from '../app/lib/rankOffers.ts'

// Regression: the LON→BCN bug where a direct 2h10m outbound paired with a
// 28h-with-stop return was ranked as #1 because the scorer only inspected the
// outbound leg. The inbound's stops, duration, and layover were invisible.

const goodRoundTrip: RankOffer = {
  id: 'good-rt',
  price: 220,
  currency: 'GBP',
  airline: 'Vueling',
  origin: 'LGW',
  destination: 'BCN',
  departure_time: '2026-05-29T17:45:00+01:00',
  arrival_time: '2026-05-29T20:55:00+02:00',
  duration_minutes: 130,
  stops: 0,
  inbound: {
    origin: 'BCN',
    destination: 'LGW',
    departure_time: '2026-05-31T17:00:00+02:00',
    arrival_time: '2026-05-31T18:10:00+01:00',
    duration_minutes: 130,
    stops: 0,
  },
}

const badRoundTrip: RankOffer = {
  id: 'bad-rt',
  price: 215, // £5 cheaper — should not be enough to overcome the 28h return
  currency: 'GBP',
  airline: 'Wizz Air',
  origin: 'LGW',
  destination: 'BCN',
  departure_time: '2026-05-29T17:45:00+01:00',
  arrival_time: '2026-05-29T20:55:00+02:00',
  duration_minutes: 130,
  stops: 0,
  inbound: {
    origin: 'BCN',
    destination: 'LTN',
    departure_time: '2026-05-31T22:50:00+02:00',
    arrival_time: '2026-06-02T03:10:00+01:00',
    duration_minutes: 1700, // 28h20m
    stops: 1,
    segments: [
      { origin: 'BCN', destination: 'ALC', layover_minutes: 0 },
      { origin: 'ALC', destination: 'LTN', layover_minutes: 1200 }, // 20h layover
    ],
  },
}

// Filler offers so price normalisation reflects real market dispersion. In a
// real LON→BCN search there are 30–80 offers spanning ~£150–£400; a £5 gap is
// noise relative to that spread. Without filler the p5/p95 window collapses to
// the two test offers and a £5 delta becomes a 100% price advantage.
function priceSpread(): RankOffer[] {
  return Array.from({ length: 20 }, (_, i) => ({
    id: `filler-${i}`,
    price: 150 + i * 12, // 150, 162, 174 … 378
    currency: 'GBP',
    airline: 'Filler Air',
    origin: 'LGW',
    destination: 'BCN',
    departure_time: '2026-05-29T09:00:00+01:00',
    arrival_time: '2026-05-29T12:10:00+02:00',
    duration_minutes: 130,
    stops: i % 3 === 0 ? 0 : 1, // mix of direct and 1-stop
    inbound: {
      origin: 'BCN',
      destination: 'LGW',
      departure_time: '2026-05-31T09:00:00+02:00',
      arrival_time: '2026-05-31T10:10:00+01:00',
      duration_minutes: 130,
      stops: i % 3 === 0 ? 0 : 1,
    },
  }))
}

test('rankOffers sees the inbound leg: direct round-trip beats direct-out + 28h-return', () => {
  const pool = [...priceSpread(), badRoundTrip, goodRoundTrip]
  const ranked = rankOffers(pool, { tripContext: 'solo' })
  const goodRank = ranked.findIndex(r => r.offer.id === 'good-rt')
  const badRank = ranked.findIndex(r => r.offer.id === 'bad-rt')
  assert.ok(goodRank < badRank,
    `good direct round-trip (rank ${goodRank + 1}) must rank above 28h-return offer (rank ${badRank + 1})`)
})

test('rankOffers stops dimension reflects the worse leg', () => {
  const pool = [...priceSpread(), badRoundTrip, goodRoundTrip]
  const ranked = rankOffers(pool, { tripContext: 'solo' })
  const good = ranked.find(r => r.offer.id === 'good-rt')!
  const bad = ranked.find(r => r.offer.id === 'bad-rt')!
  assert.ok(good.breakdown.stops > bad.breakdown.stops,
    `direct round-trip stops score (${good.breakdown.stops}) must exceed mixed (${bad.breakdown.stops})`)
})

test('rankOffers layover dimension picks the worst layover across both legs', () => {
  const pool = [...priceSpread(), badRoundTrip, goodRoundTrip]
  const ranked = rankOffers(pool, { tripContext: 'solo' })
  const bad = ranked.find(r => r.offer.id === 'bad-rt')!
  // 20h layover on the return is genuinely awful: scoreLayover should be ≤ 0.20
  assert.ok(bad.breakdown.layover <= 0.20,
    `20h return-leg layover should produce a low layover score, got ${bad.breakdown.layover}`)
})

test('rankOffers duration dimension uses round-trip total, not outbound only', () => {
  // A direct round-trip with a slightly slower outbound (2h30m vs 2h10m) must
  // still beat the 28h-return offer at similar price — duration is now total.
  const slowerButDirect: RankOffer = {
    ...goodRoundTrip,
    id: 'slower-direct',
    price: 210,
    duration_minutes: 150,
    inbound: { ...goodRoundTrip.inbound!, duration_minutes: 150 },
  }
  const pool = [...priceSpread(), badRoundTrip, slowerButDirect]
  const ranked = rankOffers(pool, { tripContext: 'solo' })
  const slowerRank = ranked.findIndex(r => r.offer.id === 'slower-direct')
  const badRank = ranked.findIndex(r => r.offer.id === 'bad-rt')
  assert.ok(slowerRank < badRank,
    `slower direct round-trip (rank ${slowerRank + 1}) must beat 28h-return offer (rank ${badRank + 1})`)
})
