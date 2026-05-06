import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeSession, computeSessionStats, computePercentile } from '../../lib/pfp/ingest/normalizer.ts'
import type { RawSearchPayload } from '../../lib/pfp/ingest/normalizer.ts'

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function makeMinimalRawPayload(overrides: Partial<RawSearchPayload> = {}): RawSearchPayload {
  return {
    session_id: 'test-session-001',
    origin: 'GDN',
    destination: 'BCN',
    currency: 'EUR',
    offers: [
      {
        id: 'fr_001',
        price: 89.50,
        currency: 'EUR',
        price_normalized: 89.50,
        outbound: {
          segments: [
            {
              airline: 'FR',
              airline_name: 'Ryanair',
              flight_no: 'FR1234',
              origin: 'GDN',
              destination: 'BCN',
              departure: '2026-06-15T06:30:00',
              arrival: '2026-06-15T09:00:00',
              duration_seconds: 9000,
              cabin_class: 'economy',
            },
          ],
          total_duration_seconds: 9000,
          stopovers: 0,
        },
        inbound: null,
        airlines: ['FR'],
        owner_airline: 'FR',
        bags_price: {},
        availability_seats: null,
        conditions: {},
        source: 'ryanair_direct',
        source_tier: 'free',
        is_locked: false,
        fetched_at: '2026-05-05T10:00:00',
        booking_url: 'https://www.ryanair.com/search',
      },
    ],
    total_results: 1,
    origin_city: 'Gdansk',
    dest_city: 'Barcelona',
    ...overrides,
  }
}

// ─── BASIC NORMALIZATION ──────────────────────────────────────────────────────

test('normalizes origin, destination, and cities', () => {
  const session = normalizeSession(makeMinimalRawPayload())
  assert.equal(session.originIata, 'GDN')
  assert.equal(session.destIata, 'BCN')
  assert.equal(session.originCity, 'Gdansk')
  assert.equal(session.destCity, 'Barcelona')
})

test('assigns sessionId from raw session_id', () => {
  const session = normalizeSession(makeMinimalRawPayload({ session_id: 'my-session-42' }))
  assert.equal(session.sessionId, 'my-session-42')
})

test('generates sessionId when raw session_id is absent', () => {
  const raw = makeMinimalRawPayload()
  delete (raw as any).session_id
  const session = normalizeSession(raw)
  assert.ok(typeof session.sessionId === 'string' && session.sessionId.length > 0)
})

test('maps snake_case offer fields to camelCase', () => {
  const session = normalizeSession(makeMinimalRawPayload())
  const offer = session.offers[0]
  assert.equal(offer.id, 'fr_001')
  assert.equal(offer.price, 89.50)
  assert.equal(offer.priceNormalized, 89.50)
  assert.equal(offer.ownerAirline, 'FR')
  assert.equal(offer.source, 'ryanair_direct')
  assert.equal(offer.sourceTier, 'free')
  assert.equal(offer.isLocked, false)
  assert.deepEqual(offer.airlines, ['FR'])
})

test('maps segment fields from snake_case to camelCase', () => {
  const session = normalizeSession(makeMinimalRawPayload())
  const seg = session.offers[0].outbound.segments[0]
  assert.equal(seg.airline, 'FR')
  assert.equal(seg.airlineName, 'Ryanair')
  assert.equal(seg.flightNo, 'FR1234')
  assert.equal(seg.origin, 'GDN')
  assert.equal(seg.destination, 'BCN')
  assert.equal(seg.departure, '2026-06-15T06:30:00')
  assert.equal(seg.arrival, '2026-06-15T09:00:00')
  assert.equal(seg.durationSeconds, 9000)
})

test('maps route fields correctly', () => {
  const session = normalizeSession(makeMinimalRawPayload())
  const route = session.offers[0].outbound
  assert.equal(route.totalDurationSeconds, 9000)
  assert.equal(route.stopovers, 0)
  assert.equal(route.segments.length, 1)
})

// ─── CABIN CLASS NORMALIZATION ────────────────────────────────────────────────

test('normalizes cabin_class UPPERCASE to lowercase', () => {
  const raw = makeMinimalRawPayload()
  raw.offers[0].outbound.segments[0].cabin_class = 'ECONOMY'
  const session = normalizeSession(raw)
  assert.equal(session.offers[0].outbound.segments[0].cabinClass, 'economy')
})

test('normalizes BUSINESS to business', () => {
  const raw = makeMinimalRawPayload()
  raw.offers[0].outbound.segments[0].cabin_class = 'BUSINESS'
  const session = normalizeSession(raw)
  assert.equal(session.offers[0].outbound.segments[0].cabinClass, 'business')
})

test('handles already-lowercase cabin_class', () => {
  const raw = makeMinimalRawPayload()
  raw.offers[0].outbound.segments[0].cabin_class = 'economy'
  const session = normalizeSession(raw)
  assert.equal(session.offers[0].outbound.segments[0].cabinClass, 'economy')
})

// ─── DEFAULTS FOR MISSING FIELDS ─────────────────────────────────────────────

test('defaults missing airline_name to empty string', () => {
  const raw = makeMinimalRawPayload()
  delete (raw.offers[0].outbound.segments[0] as any).airline_name
  const session = normalizeSession(raw)
  assert.equal(session.offers[0].outbound.segments[0].airlineName, '')
})

test('defaults missing flight_no to empty string', () => {
  const raw = makeMinimalRawPayload()
  delete (raw.offers[0].outbound.segments[0] as any).flight_no
  const session = normalizeSession(raw)
  assert.equal(session.offers[0].outbound.segments[0].flightNo, '')
})

test('defaults missing aircraft to empty string', () => {
  const raw = makeMinimalRawPayload()
  const session = normalizeSession(raw)
  assert.equal(session.offers[0].outbound.segments[0].aircraft, '')
})

test('defaults missing price_normalized to null', () => {
  const raw = makeMinimalRawPayload()
  delete (raw.offers[0] as any).price_normalized
  const session = normalizeSession(raw)
  assert.equal(session.offers[0].priceNormalized, null)
})

test('defaults missing bags_price to empty object', () => {
  const raw = makeMinimalRawPayload()
  delete (raw.offers[0] as any).bags_price
  const session = normalizeSession(raw)
  assert.deepEqual(session.offers[0].bagsPrice, {})
})

test('defaults missing availability_seats to null', () => {
  const raw = makeMinimalRawPayload()
  const session = normalizeSession(raw)
  assert.equal(session.offers[0].availabilitySeats, null)
})

test('defaults missing inbound to null', () => {
  const raw = makeMinimalRawPayload()
  const session = normalizeSession(raw)
  assert.equal(session.offers[0].inbound, null)
})

test('defaults missing origin_city / dest_city to empty string', () => {
  const raw = makeMinimalRawPayload()
  delete (raw as any).origin_city
  delete (raw as any).dest_city
  const session = normalizeSession(raw)
  assert.equal(session.originCity, '')
  assert.equal(session.destCity, '')
})

// ─── ANONYMIZATION ────────────────────────────────────────────────────────────

test('strips PII from agent context before normalization', () => {
  const raw: RawSearchPayload = {
    ...makeMinimalRawPayload(),
    agent_context: {
      user_id: 'user-12345',
      email: 'user@example.com',
      session_token: 'tok_abc',
      ip_address: '1.2.3.4',
      pax_count: 2,
      trip_type: 'oneway',
      advance_booking_days: 30,
    },
  }
  const session = normalizeSession(raw)
  // PII fields must not appear anywhere in the session
  const serialized = JSON.stringify(session)
  assert.ok(!serialized.includes('user-12345'), 'user_id leaked')
  assert.ok(!serialized.includes('user@example.com'), 'email leaked')
  assert.ok(!serialized.includes('tok_abc'), 'session_token leaked')
  assert.ok(!serialized.includes('1.2.3.4'), 'ip_address leaked')
  // Non-PII fields should be carried over to searchParams
  assert.equal(session.searchParams.paxCount, 2)
  assert.equal(session.searchParams.tripType, 'oneway')
  assert.equal(session.searchParams.advanceBookingDays, 30)
})

// ─── STATS COMPUTATION ───────────────────────────────────────────────────────

test('computePercentile: returns null for empty array', () => {
  assert.equal(computePercentile([], 50), null)
})

test('computePercentile: p50 of single-element array is that element', () => {
  assert.equal(computePercentile([42], 50), 42)
})

test('computePercentile: correct percentiles for [10,20,30,40,50]', () => {
  const sorted = [10, 20, 30, 40, 50]
  // p25 = idx 1 → 20
  assert.equal(computePercentile(sorted, 25), 20)
  // p50 = idx 2 → 30
  assert.equal(computePercentile(sorted, 50), 30)
  // p75 = idx 3 → 40
  assert.equal(computePercentile(sorted, 75), 40)
  // p10 = idx 0.4 → 10 + 0.4*(20-10) = 14
  assert.equal(computePercentile(sorted, 10), 14)
  // p90 = idx 3.6 → 40 + 0.6*10 = 46
  assert.equal(computePercentile(sorted, 90), 46)
  // p95 = idx 3.8 → 40 + 0.8*10 = 48
  assert.equal(computePercentile(sorted, 95), 48)
})

test('computeSessionStats: computes all required percentiles (p10, p25, p50, p75, p90, p95)', () => {
  const offers = [10, 20, 30, 40, 50].map((price, i) => ({
    id: `offer-${i}`,
    price,
    priceNormalized: price,
    ownerAirline: `AIRLINE_${i % 3}`,
    source: `connector_${i % 2}`,
    currency: 'EUR',
    priceFormatted: `${price} EUR`,
    outbound: { segments: [], totalDurationSeconds: 3600, stopovers: 0 },
    inbound: null,
    airlines: [`AIRLINE_${i % 3}`],
    bagsPrice: {},
    availabilitySeats: null,
    conditions: {},
    sourceTier: 'free' as const,
    isLocked: false,
    fetchedAt: '2026-05-05T10:00:00',
    bookingUrl: '',
  }))
  const stats = computeSessionStats(offers)
  assert.equal(stats.priceMin, 10)
  assert.equal(stats.priceMax, 50)
  assert.equal(stats.priceP25, 20)
  assert.equal(stats.priceP50, 30)
  assert.equal(stats.priceP75, 40)
  assert.equal(stats.priceP95, 48)
  assert.equal(stats.priceP10, 14)
  assert.equal(stats.priceP90, 46)
})

test('computeSessionStats: computes correct CV for [10,20,30,40,50]', () => {
  // mean=30, stddev=sqrt(200)≈14.142, CV≈0.4714
  const offers = [10, 20, 30, 40, 50].map((price, i) => ({
    id: `offer-${i}`,
    price,
    priceNormalized: price,
    ownerAirline: 'FR',
    source: 'ryanair_direct',
    currency: 'EUR',
    priceFormatted: '',
    outbound: { segments: [], totalDurationSeconds: 3600, stopovers: 0 },
    inbound: null,
    airlines: ['FR'],
    bagsPrice: {},
    availabilitySeats: null,
    conditions: {},
    sourceTier: 'free' as const,
    isLocked: false,
    fetchedAt: '2026-05-05T10:00:00',
    bookingUrl: '',
  }))
  const stats = computeSessionStats(offers)
  assert.ok(
    Math.abs(stats.priceCV - 0.4714) < 0.001,
    `expected CV≈0.4714, got ${stats.priceCV}`
  )
})

test('computeSessionStats: counts unique carriers and connectors', () => {
  const offers = [
    { ownerAirline: 'FR', source: 'ryanair_direct', price: 100, priceNormalized: 100 },
    { ownerAirline: 'W6', source: 'wizzair_direct', price: 120, priceNormalized: 120 },
    { ownerAirline: 'FR', source: 'skyscanner_meta', price: 90, priceNormalized: 90 },
  ].map((o, i) => ({
    id: `offer-${i}`,
    price: o.price,
    priceNormalized: o.priceNormalized,
    ownerAirline: o.ownerAirline,
    source: o.source,
    currency: 'EUR',
    priceFormatted: '',
    outbound: { segments: [], totalDurationSeconds: 3600, stopovers: 0 },
    inbound: null,
    airlines: [o.ownerAirline],
    bagsPrice: {},
    availabilitySeats: null,
    conditions: {},
    sourceTier: 'free' as const,
    isLocked: false,
    fetchedAt: '2026-05-05T10:00:00',
    bookingUrl: '',
  }))
  const stats = computeSessionStats(offers)
  assert.equal(stats.carrierCount, 2) // FR and W6
  assert.equal(stats.connectorCount, 3) // ryanair_direct, wizzair_direct, skyscanner_meta
})

test('computeSessionStats: uses priceNormalized when available, falls back to price', () => {
  const offers = [
    { price: 100, priceNormalized: 95 },
    { price: 200, priceNormalized: null },
  ].map((o, i) => ({
    id: `offer-${i}`,
    price: o.price,
    priceNormalized: o.priceNormalized as number | null,
    ownerAirline: 'FR',
    source: 'ryanair_direct',
    currency: 'EUR',
    priceFormatted: '',
    outbound: { segments: [], totalDurationSeconds: 3600, stopovers: 0 },
    inbound: null,
    airlines: ['FR'],
    bagsPrice: {},
    availabilitySeats: null,
    conditions: {},
    sourceTier: 'free' as const,
    isLocked: false,
    fetchedAt: '2026-05-05T10:00:00',
    bookingUrl: '',
  }))
  const stats = computeSessionStats(offers)
  // Should use 95 (normalized) and 200 (fallback) → min=95, max=200
  assert.equal(stats.priceMin, 95)
  assert.equal(stats.priceMax, 200)
})
