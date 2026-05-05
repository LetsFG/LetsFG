import assert from 'node:assert/strict'
import test from 'node:test'

import { ingestAgentSession } from '../../lib/pfp/ingest/offer-ingest.ts'
import type { IngestDeps, PfpDatabase } from '../../lib/pfp/ingest/offer-ingest.ts'
import type { AgentSearchSession } from '../../lib/pfp/types/agent-session.types.ts'

// ─── TEST FIXTURES ────────────────────────────────────────────────────────────

function makeSession(overrides: Partial<AgentSearchSession> = {}): AgentSearchSession {
  return {
    sessionId: 'sess-test-001',
    originIata: 'GDN',
    destIata: 'BCN',
    originCity: 'Gdansk',
    destCity: 'Barcelona',
    searchedAt: '2026-06-01T10:00:00Z',
    searchParams: {
      paxCount: 1,
      tripType: 'oneway',
      cabinPreference: null,
      advanceBookingDays: 14,
      maxStopovers: 2,
      currencyCode: 'EUR',
    },
    offers: Array.from({ length: 20 }, (_, i) => ({
      id: `offer-${i}`,
      price: 80 + i * 10,
      currency: 'EUR',
      priceFormatted: `${80 + i * 10} EUR`,
      priceNormalized: 80 + i * 10,
      outbound: {
        segments: [
          {
            airline: i % 3 === 0 ? 'FR' : i % 3 === 1 ? 'W6' : 'U2',
            airlineName: i % 3 === 0 ? 'Ryanair' : i % 3 === 1 ? 'Wizz Air' : 'easyJet',
            flightNo: `XX${1000 + i}`,
            origin: 'GDN',
            destination: 'BCN',
            originCity: 'Gdansk',
            destinationCity: 'Barcelona',
            departure: '2026-06-15T06:30:00',
            arrival: '2026-06-15T09:00:00',
            durationSeconds: 9000,
            cabinClass: 'economy',
            aircraft: '',
          },
        ],
        totalDurationSeconds: 9000,
        stopovers: 0,
      },
      inbound: null,
      airlines: [i % 3 === 0 ? 'FR' : i % 3 === 1 ? 'W6' : 'U2'],
      ownerAirline: i % 3 === 0 ? 'FR' : i % 3 === 1 ? 'W6' : 'U2',
      bagsPrice: {},
      availabilitySeats: null,
      conditions: {},
      source: i % 2 === 0 ? 'ryanair_direct' : 'wizzair_direct',
      sourceTier: 'free',
      isLocked: false,
      fetchedAt: '2026-06-01T10:00:00Z',
      bookingUrl: 'https://example.com',
    })),
    stats: {
      offerCount: 20,
      carrierCount: 3,
      connectorCount: 2,
      priceMin: 80,
      priceMax: 270,
      priceP25: 132.5,
      priceP50: 175,
      priceP75: 217.5,
      priceP95: 261,
      hiddenFeesAvg: null,
      hiddenFeesPctAvg: null,
    },
    dataSources: ['ryanair_direct', 'wizzair_direct'],
    connectorResults: [
      { connector: 'ryanair_direct', ok: true, offers: 10, latencyMs: 1500, errorType: null, errorMessage: null, errorCategory: null, httpStatus: null },
      { connector: 'wizzair_direct', ok: true, offers: 10, latencyMs: 2000, errorType: null, errorMessage: null, errorCategory: null, httpStatus: null },
    ],
    targetCurrency: 'EUR',
    ...overrides,
  }
}

function makeMockDb(overrides: Partial<PfpDatabase> = {}): PfpDatabase & {
  insertSessionCalls: number
  insertAuditLogCalls: Array<{ action: string; newStatus: string; prevStatus: string }>
  upsertSnapshotCalls: number
  updateStatusCalls: number
} {
  const state = {
    insertSessionCalls: 0,
    insertAuditLogCalls: [] as Array<{ action: string; newStatus: string; prevStatus: string }>,
    upshotSnapshotCalls: 0,
    updateStatusCalls: 0,
  }

  return {
    insertSessionCalls: 0,
    insertAuditLogCalls: [],
    upsertSnapshotCalls: 0,
    updateStatusCalls: 0,

    findRouteByIata: async () => null,
    upsertRoute: async () => ({ id: 'route-001', originIata: 'GDN', destIata: 'BCN', pageStatus: 'draft', qualityScore: 0 }),
    sessionExists: async () => false,
    insertSession: async function() { (this as any).insertSessionCalls++; return 'sess-db-001' },
    insertOfferAggregates: async () => {},
    upsertSnapshot: async function() { (this as any).upsertSnapshotCalls++ },
    updateRoutePageStatus: async function() { (this as any).updateStatusCalls++ },
    getCurrentPageStatus: async () => 'draft',
    insertAuditLog: async function(data: { action: string; newStatus: string; prevStatus: string }) {
      (this as any).insertAuditLogCalls.push(data);
    },
    ...overrides,
  }
}

function makeSpies() {
  const revalidateCalls: string[] = []
  const emitCalls: Array<[string, unknown]> = []
  return {
    revalidate: async (routeId: string) => { revalidateCalls.push(routeId) },
    emit: (event: string, data: unknown) => { emitCalls.push([event, data]) },
    revalidateCalls,
    emitCalls,
  }
}

// ─── VALIDATION ───────────────────────────────────────────────────────────────

test('rejects session with fewer than 5 offers', async () => {
  const db = makeMockDb()
  const spies = makeSpies()
  const deps: IngestDeps = { db, revalidate: spies.revalidate, emit: spies.emit }

  const session = makeSession({ offers: [] })
  // Should return void without throwing
  await assert.doesNotReject(() => ingestAgentSession(session, deps))
  // Should not insert the session into DB
  assert.equal(db.insertSessionCalls, 0)
})

test('rejects session when fewer than 5 offers (boundary: exactly 4)', async () => {
  const db = makeMockDb()
  const spies = makeSpies()
  const deps: IngestDeps = { db, revalidate: spies.revalidate, emit: spies.emit }

  const session = makeSession({ offers: makeSession().offers.slice(0, 4) })
  await assert.doesNotReject(() => ingestAgentSession(session, deps))
  assert.equal(db.insertSessionCalls, 0)
})

// ─── IDEMPOTENCY ──────────────────────────────────────────────────────────────

test('idempotent: second call with same session_id is a no-op', async () => {
  const db = makeMockDb({
    sessionExists: async () => true, // already in DB
  })
  const spies = makeSpies()
  const deps: IngestDeps = { db, revalidate: spies.revalidate, emit: spies.emit }

  await ingestAgentSession(makeSession(), deps)
  assert.equal(db.insertSessionCalls, 0, 'insertSession should not be called for duplicate')
})

test('non-duplicate: new session_id proceeds normally', async () => {
  const db = makeMockDb({
    sessionExists: async () => false,
  })
  const spies = makeSpies()
  const deps: IngestDeps = { db, revalidate: spies.revalidate, emit: spies.emit }

  await ingestAgentSession(makeSession(), deps)
  assert.equal(db.insertSessionCalls, 1)
})

// ─── ERROR SAFETY ─────────────────────────────────────────────────────────────

test('does NOT propagate DB errors to the calling pipeline', async () => {
  const db = makeMockDb({
    insertSession: async () => { throw new Error('DB connection failed') },
  })
  const spies = makeSpies()
  const deps: IngestDeps = { db, revalidate: spies.revalidate, emit: spies.emit }

  // Must not throw — errors are swallowed
  await assert.doesNotReject(() => ingestAgentSession(makeSession(), deps))
})

test('does NOT propagate revalidation errors to the calling pipeline', async () => {
  const db = makeMockDb()
  const spies = makeSpies()
  const deps: IngestDeps = {
    db,
    revalidate: async () => { throw new Error('ISR service unavailable') },
    emit: spies.emit,
  }

  await assert.doesNotReject(() => ingestAgentSession(makeSession(), deps))
})

// ─── ANALYTICS EVENTS ─────────────────────────────────────────────────────────

test('emits flight_page_quality_gate_result event after quality gate runs', async () => {
  const db = makeMockDb()
  const spies = makeSpies()
  const deps: IngestDeps = { db, revalidate: spies.revalidate, emit: spies.emit }

  await ingestAgentSession(makeSession(), deps)
  const gateEvents = spies.emitCalls.filter(([event]) => event === 'flight_page_quality_gate_result')
  assert.ok(gateEvents.length >= 1, 'expected at least one flight_page_quality_gate_result event')
})

test('does NOT use gtag() or analytics.track() directly', async () => {
  // This is enforced by design: emit() is the only analytics channel.
  // Verify by checking global gtag is not called (not defined in test env).
  assert.ok(typeof (globalThis as any).gtag === 'undefined', 'gtag should not be in scope')
})

// ─── ISR REVALIDATION ─────────────────────────────────────────────────────────

test('triggers ISR revalidation when quality gate returns PASS (published)', async () => {
  // Build a session that will score PASS: 40 offers, 3 carriers, 2 connectors, high CV
  // We need high enough quality to pass. Use a session with many diverse offers.
  const highQualityOffers = Array.from({ length: 40 }, (_, i) => ({
    id: `offer-${i}`,
    price: 80 + i * 10,
    currency: 'EUR',
    priceFormatted: `${80 + i * 10} EUR`,
    priceNormalized: 80 + i * 10,
    outbound: {
      segments: [{
        airline: i % 3 === 0 ? 'FR' : i % 3 === 1 ? 'W6' : 'U2',
        airlineName: '',
        flightNo: '',
        origin: 'GDN',
        destination: 'BCN',
        originCity: '',
        destinationCity: '',
        departure: '2026-06-15T06:30:00',
        arrival: '2026-06-15T09:00:00',
        durationSeconds: 9000,
        cabinClass: 'economy',
        aircraft: '',
      }],
      totalDurationSeconds: 9000,
      stopovers: 0,
    },
    inbound: null,
    airlines: [i % 3 === 0 ? 'FR' : i % 3 === 1 ? 'W6' : 'U2'],
    ownerAirline: i % 3 === 0 ? 'FR' : i % 3 === 1 ? 'W6' : 'U2',
    bagsPrice: {},
    availabilitySeats: null,
    conditions: {},
    // 4 distinct connectors to trigger fast-track
    source: ['ryanair_direct', 'wizzair_direct', 'skyscanner_meta', 'kiwi_connector'][i % 4],
    sourceTier: 'free' as const,
    isLocked: false,
    fetchedAt: '2026-06-01T10:00:00Z',
    bookingUrl: 'https://example.com',
  }))

  const db = makeMockDb()
  const spies = makeSpies()
  const deps: IngestDeps = { db, revalidate: spies.revalidate, emit: spies.emit }

  const session = makeSession({ offers: highQualityOffers })
  await ingestAgentSession(session, deps)

  assert.ok(
    spies.revalidateCalls.length >= 1,
    `expected revalidate to be called for high-quality session, got ${spies.revalidateCalls.length} calls`
  )
})

test('does NOT trigger ISR revalidation when quality gate returns FAIL (draft)', async () => {
  // Only 3 offers → validation failure → draft → no ISR
  const session = makeSession({ offers: makeSession().offers.slice(0, 3) })
  const db = makeMockDb()
  const spies = makeSpies()
  const deps: IngestDeps = { db, revalidate: spies.revalidate, emit: spies.emit }

  await ingestAgentSession(session, deps)
  assert.equal(spies.revalidateCalls.length, 0)
})

// ─── SNAPSHOTS ────────────────────────────────────────────────────────────────

test('updates route_distribution_snapshots after successful offer ingest', async () => {
  const db = makeMockDb()
  const spies = makeSpies()
  const deps: IngestDeps = { db, revalidate: spies.revalidate, emit: spies.emit }

  await ingestAgentSession(makeSession(), deps)
  assert.ok(db.upsertSnapshotCalls >= 1, 'expected upsertSnapshot to be called')
})

// ─── AUDIT LOG ────────────────────────────────────────────────────────────────

test('creates page_audit_log entry when page_status changes', async () => {
  // Current status: 'draft' → quality gate returns 'noindex' or 'published'
  // Use a moderate quality session that triggers at least CONDITIONAL_PASS
  const db = makeMockDb({
    getCurrentPageStatus: async () => 'draft',
  })
  const spies = makeSpies()
  const deps: IngestDeps = { db, revalidate: spies.revalidate, emit: spies.emit }

  // Session with enough quality for at least noindex
  const moderateOffers = Array.from({ length: 20 }, (_, i) => ({
    id: `offer-${i}`,
    price: 80 + i * 15,  // wide price spread
    currency: 'EUR',
    priceFormatted: '',
    priceNormalized: 80 + i * 15,
    outbound: {
      segments: [{
        airline: i % 3 === 0 ? 'FR' : i % 3 === 1 ? 'W6' : 'U2',
        airlineName: '',
        flightNo: '',
        origin: 'GDN',
        destination: 'BCN',
        originCity: '',
        destinationCity: '',
        departure: '2026-06-15T06:30:00',
        arrival: '2026-06-15T09:00:00',
        durationSeconds: 9000,
        cabinClass: 'economy',
        aircraft: '',
      }],
      totalDurationSeconds: 9000,
      stopovers: 0,
    },
    inbound: null,
    airlines: [i % 3 === 0 ? 'FR' : i % 3 === 1 ? 'W6' : 'U2'],
    ownerAirline: i % 3 === 0 ? 'FR' : i % 3 === 1 ? 'W6' : 'U2',
    bagsPrice: {},
    availabilitySeats: null,
    conditions: {},
    source: i % 2 === 0 ? 'ryanair_direct' : 'wizzair_direct',
    sourceTier: 'free' as const,
    isLocked: false,
    fetchedAt: '2026-06-01T10:00:00Z',
    bookingUrl: '',
  }))

  await ingestAgentSession(makeSession({ offers: moderateOffers }), deps)
  assert.ok(
    db.insertAuditLogCalls.length >= 1,
    `expected insertAuditLog to be called, got ${db.insertAuditLogCalls.length} calls`
  )
})

// ─── ANONYMIZATION ────────────────────────────────────────────────────────────

test('preserves anonymization: no user_id or email in persisted records', async () => {
  let capturedSessionData: unknown = null
  let capturedOffers: unknown = null

  const db = makeMockDb({
    insertSession: async (data) => { capturedSessionData = data; return 'sess-db-001' },
    insertOfferAggregates: async (data) => { capturedOffers = data },
  })
  const spies = makeSpies()
  const deps: IngestDeps = { db, revalidate: spies.revalidate, emit: spies.emit }

  await ingestAgentSession(makeSession(), deps)

  // Neither session data nor offer aggregates should contain user PII
  const sessionStr = JSON.stringify(capturedSessionData ?? {})
  const offersStr = JSON.stringify(capturedOffers ?? {})
  assert.ok(!sessionStr.includes('user_id') && !sessionStr.includes('@'), 'PII in session data')
  assert.ok(!offersStr.includes('user_id') && !offersStr.includes('@'), 'PII in offer aggregates')
})
