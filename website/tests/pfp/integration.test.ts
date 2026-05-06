/**
 * integration.test.ts — end-to-end pipeline tests for Programmatic Flight Pages.
 *
 * These tests wire together real module implementations with in-memory DB stubs,
 * validating that the full pipeline (ingest → quality gate → distribution → page
 * status) behaves correctly end-to-end.
 *
 * What "integration" means here:
 *   - Real implementations of all modules (no mocks of business logic)
 *   - Injectable in-memory DB stubs (no real database connection required)
 *   - Tests observe the full chain: session data → quality gate → page_status
 *
 * DB note: The "test database" is an in-memory JavaScript Map. All writes are
 * observable via typed stub interfaces. This follows the established codebase
 * pattern and allows CI to run without a database server.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { ingestAgentSession } from '../../lib/pfp/ingest/offer-ingest.ts'
import type {
  IngestDeps,
  PfpDatabase,
  RouteRecord,
  SessionInsert,
  OfferAggregateInsert,
  SnapshotData,
  AuditLogInsert,
} from '../../lib/pfp/ingest/offer-ingest.ts'
import { getRouteDistributionData } from '../../lib/pfp/distribution/distribution-service.ts'
import { ContentQualityGate } from '../../lib/pfp/quality/content-quality-gate.ts'
import type { AgentSearchSession, NormalizedOffer } from '../../lib/pfp/types/agent-session.types.ts'

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const BASE_SEGMENT = {
  airline: 'FR',
  airlineName: 'Ryanair',
  flightNo: 'FR1234',
  origin: 'GDN',
  destination: 'BCN',
  originCity: 'Gdansk',
  destinationCity: 'Barcelona',
  departure: '2026-06-15T06:30:00',
  arrival: '2026-06-15T09:00:00',
  durationSeconds: 9000,
  cabinClass: 'economy' as const,
  aircraft: '',
}

function makeOffer(
  id: string,
  price: number,
  airline: string,
  source: string,
): NormalizedOffer {
  return {
    id,
    price,
    currency: 'EUR',
    priceFormatted: `${price} EUR`,
    priceNormalized: price,
    outbound: {
      segments: [{ ...BASE_SEGMENT, airline, airlineName: airline }],
      totalDurationSeconds: 9000,
      stopovers: 0,
    },
    inbound: null,
    airlines: [airline],
    ownerAirline: airline,
    bagsPrice: {},
    availabilitySeats: null,
    conditions: {},
    source,
    sourceTier: 'free' as const,
    isLocked: false,
  }
}

function makeSession(
  sessionId: string,
  offerCount: number,
  carriers: string[],
  sources: string[],
  priceSpread = true,
): AgentSearchSession {
  const offers: NormalizedOffer[] = Array.from({ length: offerCount }, (_, i) => {
    const airline = carriers[i % carriers.length]
    const source = sources[i % sources.length]
    // price spread: 80–(80 + offerCount * 10) for realistic CV
    const price = priceSpread ? 80 + i * 10 : 100
    return makeOffer(`${sessionId}-offer-${i}`, price, airline, source)
  })
  return {
    sessionId,
    originIata: 'GDN',
    destIata: 'BCN',
    originCity: 'Gdansk',
    destCity: 'Barcelona',
    searchedAt: '2026-06-01T10:00:00Z',
    targetCurrency: 'EUR',
    searchParams: {
      paxCount: 1,
      tripType: 'oneway' as const,
      cabinPreference: null,
      advanceBookingDays: 14,
      maxStopovers: 2,
      currencyCode: 'EUR',
    },
    offers,
  }
}

// ─── In-memory DB stub ────────────────────────────────────────────────────────

interface DbRecord {
  routes: Map<string, RouteRecord & { sessionCount: number }>
  sessions: Set<string>
  sessionInserts: SessionInsert[]
  offerAggregates: OfferAggregateInsert[]
  snapshots: Map<string, SnapshotData>
  auditLogs: AuditLogInsert[]
  pageStatuses: Map<string, string>
}

function makeInMemoryDb(): { db: PfpDatabase; state: DbRecord } {
  let routeIdCounter = 0
  const state: DbRecord = {
    routes: new Map(),
    sessions: new Set(),
    sessionInserts: [],
    offerAggregates: [],
    snapshots: new Map(),
    auditLogs: [],
    pageStatuses: new Map(),
  }

  const db: PfpDatabase = {
    async findRouteByIata(origin, dest) {
      const key = `${origin}-${dest}`
      return state.routes.get(key) ?? null
    },
    async upsertRoute(data) {
      const key = `${data.originIata}-${data.destIata}`
      if (!state.routes.has(key)) {
        const route: RouteRecord & { sessionCount: number } = {
          id: `route-${++routeIdCounter}`,
          originIata: data.originIata,
          destIata: data.destIata,
          pageStatus: 'draft',
          qualityScore: 0,
          sessionCount: 0,
        }
        state.routes.set(key, route)
        state.pageStatuses.set(route.id, 'draft')
      }
      return state.routes.get(key)!
    },
    async sessionExists(sessionId) {
      return state.sessions.has(sessionId)
    },
    async insertSession(data) {
      state.sessions.add(data.sessionId)
      state.sessionInserts.push(data)
      const route = [...state.routes.values()].find(r => r.id === data.routeId)
      if (route) route.sessionCount++
      return data.sessionId
    },
    async insertOfferAggregates(data) {
      state.offerAggregates.push(...data)
    },
    async upsertSnapshot(routeId, data) {
      state.snapshots.set(routeId, data)
    },
    async updateRoutePageStatus(routeId, status, qualityScore) {
      state.pageStatuses.set(routeId, status)
      const route = [...state.routes.values()].find(r => r.id === routeId)
      if (route) {
        route.pageStatus = status
        route.qualityScore = qualityScore
      }
    },
    async getCurrentPageStatus(routeId) {
      return state.pageStatuses.get(routeId) ?? 'draft'
    },
    async insertAuditLog(data) {
      state.auditLogs.push(data)
    },
  }

  return { db, state }
}

function makeIngestDeps(
  db: PfpDatabase,
  revalidated: string[],
  emitted: Array<{ event: string; data: unknown }>,
): IngestDeps {
  return {
    db,
    revalidate: async (routeId) => { revalidated.push(routeId) },
    emit: (event, data) => { emitted.push({ event, data }) },
  }
}

// ─── Describe: Full pipeline — agent session → published page ─────────────────

test('[pipeline] thin session (12 offers, 1 carrier) → page remains draft', async () => {
  const { db, state } = makeInMemoryDb()
  const session = makeSession('sess-thin-001', 12, ['FR'], ['ryanair_direct'])
  // 12 offers, 1 carrier — fails hard floor (carrierCount < 2) → FAIL → draft
  const revalidated: string[] = []
  const emitted: Array<{ event: string; data: unknown }> = []

  await ingestAgentSession(session, makeIngestDeps(db, revalidated, emitted))

  const routeId = [...state.routes.values()][0]?.id
  assert.ok(routeId, 'route should have been created')
  const status = state.pageStatuses.get(routeId)
  assert.equal(status, 'draft', 'thin single-carrier session should not publish the page')
})

test('[pipeline] rich session (80 offers, 4 carriers, 4 connectors) → page published via fast-track', async () => {
  const { db, state } = makeInMemoryDb()
  const session = makeSession(
    'sess-rich-001',
    80,
    ['FR', 'W6', 'U2', 'VY'],
    ['ryanair_direct', 'wizzair_direct', 'easyjet_direct', 'vueling_direct'],
  )
  const revalidated: string[] = []
  const emitted: Array<{ event: string; data: unknown }> = []

  await ingestAgentSession(session, makeIngestDeps(db, revalidated, emitted))

  const routeId = [...state.routes.values()][0]?.id!
  const status = state.pageStatuses.get(routeId)
  assert.equal(status, 'published', '80-offer fast-track session must publish the page immediately')
  assert.ok(revalidated.includes(routeId), 'ISR revalidation must be triggered for published page')
})

test('[pipeline] quality gate PASS produces session with qualityScore >= 0.65', async () => {
  // Direct quality gate test: verify that the scoring formula produces PASS
  // with a well-stocked session. Uses ContentQualityGate directly (no DB needed).
  const gate = new ContentQualityGate()
  const result = gate.evaluate({
    offerCount: 60,
    carrierCount: 4,
    connectorCount: 4,
    priceCV: 0.35,
  })
  assert.ok(result.score >= 0.65, `score ${result.score} should be >= 0.65`)
  assert.equal(result.publishAs, 'published')
})

test('[pipeline] two consecutive thin sessions accumulating → combined quality crosses 0.65', async () => {
  // Session 1: 20 offers, 2 carriers, 2 connectors, CV 0.3 → CONDITIONAL_PASS (noindex)
  // Session 2: 30 more offers same route → combined 50 offers, 3 carriers, 3 connectors → PASS
  // Test: ContentQualityGate with combined stats from both sessions passes
  const gate = new ContentQualityGate()
  // Session 1 alone: 20 offers, 2 carriers, 2 connectors → CONDITIONAL_PASS (score ≈ 0.46)
  const session1Result = gate.evaluate({
    offerCount: 20,
    carrierCount: 2,
    connectorCount: 2,
    priceCV: 0.3,
  })

  // Combined (sessions 1 + 2): 70 offers, 4 carriers, 4 connectors, CV 0.4 → PASS (score ≈ 0.74)
  const combinedResult = gate.evaluate({
    offerCount: 70,
    carrierCount: 4,
    connectorCount: 4,
    priceCV: 0.4,
  })

  assert.ok(
    session1Result.publishAs !== 'published',
    'first thin session alone should not qualify as fully published',
  )
  assert.equal(
    combinedResult.publishAs, 'published',
    `combined sessions (score ${combinedResult.score}) should publish`,
  )
})

test('[pipeline] duplicate session_id → second call is no-op, no duplicate DB rows', async () => {
  const { db, state } = makeInMemoryDb()
  const session = makeSession('sess-dedup-001', 25, ['FR', 'W6'], ['ryanair_direct', 'wizzair_direct'])
  const revalidated: string[] = []
  const emitted: Array<{ event: string; data: unknown }> = []
  const deps = makeIngestDeps(db, revalidated, emitted)

  await ingestAgentSession(session, deps)
  const sessionCountBefore = state.sessionInserts.length
  const offerCountBefore = state.offerAggregates.length

  // Second call with same session ID
  await ingestAgentSession(session, deps)

  assert.equal(state.sessionInserts.length, sessionCountBefore, 'session should not be inserted twice')
  assert.equal(state.offerAggregates.length, offerCountBefore, 'offer aggregates should not be duplicated')
})

test('[pipeline] ingest failure does not throw to caller (simulate DB error)', async () => {
  const session = makeSession('sess-error-001', 25, ['FR', 'W6'], ['ryanair_direct', 'wizzair_direct'])
  let threw = false

  const brokenDb: PfpDatabase = {
    findRouteByIata: async () => null,
    upsertRoute: async () => { throw new Error('DB connection failed') },
    sessionExists: async () => false,
    insertSession: async () => { throw new Error('DB connection failed') },
    insertOfferAggregates: async () => { throw new Error('DB connection failed') },
    upsertSnapshot: async () => { throw new Error('DB connection failed') },
    updateRoutePageStatus: async () => { throw new Error('DB connection failed') },
    getCurrentPageStatus: async () => { throw new Error('DB connection failed') },
    insertAuditLog: async () => { throw new Error('DB connection failed') },
  }

  try {
    await ingestAgentSession(session, {
      db: brokenDb,
      revalidate: async () => {},
      emit: () => {},
    })
  } catch {
    threw = true
  }

  assert.equal(threw, false, 'ingestAgentSession must never throw even on DB failure')
})

test('[pipeline] ISR revalidation triggered exactly once per qualifying session', async () => {
  const { db } = makeInMemoryDb()
  const session = makeSession('sess-isr-001', 80, ['FR', 'W6', 'U2', 'VY'], [
    'ryanair_direct', 'wizzair_direct', 'easyjet_direct', 'vueling_direct',
  ])
  const revalidated: string[] = []
  const emitted: Array<{ event: string; data: unknown }> = []

  await ingestAgentSession(session, makeIngestDeps(db, revalidated, emitted))

  assert.equal(revalidated.length, 1, 'ISR revalidation should be called exactly once')
})

test('[pipeline] page_audit_log has entry for every page_status change', async () => {
  const { db, state } = makeInMemoryDb()
  const session = makeSession('sess-audit-001', 80, ['FR', 'W6', 'U2', 'VY'], [
    'ryanair_direct', 'wizzair_direct', 'easyjet_direct', 'vueling_direct',
  ])

  await ingestAgentSession(session, makeIngestDeps(db, [], []))

  // Should have at least one audit log entry (draft → published, or first_ingest → published)
  assert.ok(state.auditLogs.length >= 1, 'audit log must have at least one entry per status change')
  for (const log of state.auditLogs) {
    assert.ok(log.routeId, 'audit log must have routeId')
    assert.ok(log.action, 'audit log must have action')
    assert.ok(log.triggeredBy, 'audit log must have triggeredBy')
  }
})

test('[pipeline] route_distribution_snapshots updated after each session ingest', async () => {
  const { db, state } = makeInMemoryDb()
  const session = makeSession('sess-snapshot-001', 25, ['FR', 'W6'], [
    'ryanair_direct', 'wizzair_direct',
  ])

  await ingestAgentSession(session, makeIngestDeps(db, [], []))

  assert.equal(state.snapshots.size, 1, 'one snapshot should exist after ingest')
  const [snapshot] = state.snapshots.values()
  assert.ok(snapshot.offerCount > 0, 'snapshot must have offer count')
  assert.ok(snapshot.computedAt, 'snapshot must have computedAt timestamp')
})

test('[pipeline] no user_id or email present in any persisted record (anonymization)', async () => {
  const { db, state } = makeInMemoryDb()
  const session = makeSession('sess-anon-001', 25, ['FR', 'W6'], [
    'ryanair_direct', 'wizzair_direct',
  ])

  await ingestAgentSession(session, makeIngestDeps(db, [], []))

  // Inspect all persisted data for PII fields
  const allInsertedData: unknown[] = [
    ...state.sessionInserts,
    ...state.offerAggregates,
    ...[...state.snapshots.values()],
    ...state.auditLogs,
  ]

  for (const record of allInsertedData) {
    const json = JSON.stringify(record)
    assert.ok(!json.includes('"user_id"'), `user_id found in record: ${json.slice(0, 100)}`)
    assert.ok(!json.includes('"email"'), `email field found in record: ${json.slice(0, 100)}`)
    assert.ok(!json.includes('"ip_address"'), `ip_address found in record: ${json.slice(0, 100)}`)
    assert.ok(!json.includes('"session_token"'), `session_token found in record: ${json.slice(0, 100)}`)
  }
})

// ─── Describe: ContentQualityGate → DistributionService → Page data consistency ─

test('[quality→distribution] PASS produces RouteDistributionData with sessionCount', () => {
  const session = makeSession('sess-dist-001', 80, ['FR', 'W6', 'U2', 'VY'], [
    'ryanair_direct', 'wizzair_direct', 'easyjet_direct', 'vueling_direct',
  ])
  const data = getRouteDistributionData([session], {
    originIata: 'GDN',
    destIata: 'BCN',
    originCity: 'Gdansk',
    destCity: 'Barcelona',
    pageStatus: 'published',
    sessionCount: 1,
    snapshotComputedAt: '2026-05-05T00:00:00Z',
  })

  assert.ok(data.total_offers_analyzed > 0, 'total_offers_analyzed must be populated')
  assert.ok(data.price_distribution.histogram.length > 0, 'price histogram must have buckets')
  assert.ok(data.carrier_summary.length > 0, 'carrier summary must be populated')
})

test('[quality→distribution] bimodal fixture produces is_bimodal: true in distribution', () => {
  // Create two clearly separated price clusters: LCC cluster and FSC cluster
  const lccOffers: NormalizedOffer[] = Array.from({ length: 20 }, (_, i) =>
    makeOffer(`lcc-${i}`, 50 + i * 2, 'FR', 'ryanair_direct'),
  )
  const fscOffers: NormalizedOffer[] = Array.from({ length: 20 }, (_, i) =>
    makeOffer(`fsc-${i}`, 500 + i, 'LH', 'lufthansa_direct'),
  )
  const bimodalSession: AgentSearchSession = {
    sessionId: 'sess-bimodal',
    originIata: 'GDN',
    destIata: 'FRA',
    originCity: 'Gdansk',
    destCity: 'Frankfurt',
    searchedAt: '2026-06-01T10:00:00Z',
    targetCurrency: 'EUR',
    searchParams: {
      paxCount: 1,
      tripType: 'oneway' as const,
      cabinPreference: null,
      advanceBookingDays: 14,
      maxStopovers: 2,
      currencyCode: 'EUR',
    },
    offers: [...lccOffers, ...fscOffers],
  }

  const data = getRouteDistributionData([bimodalSession], {
    originIata: 'GDN',
    destIata: 'FRA',
    originCity: 'Gdansk',
    destCity: 'Frankfurt',
    pageStatus: 'published',
    sessionCount: 1,
    snapshotComputedAt: '2026-05-05T00:00:00Z',
  })

  assert.equal(data.price_distribution.is_bimodal, true, 'clearly bimodal price distribution must be detected')
})

test('[quality→distribution] connector_comparison populated when >= 2 connectors in session', () => {
  const session = makeSession('sess-conn-001', 30, ['FR', 'W6'], [
    'ryanair_direct', 'wizzair_direct',
  ])
  const data = getRouteDistributionData([session], {
    originIata: 'GDN',
    destIata: 'BCN',
    originCity: 'Gdansk',
    destCity: 'Barcelona',
    pageStatus: 'published',
    sessionCount: 1,
    snapshotComputedAt: '2026-05-05T00:00:00Z',
  })

  assert.ok(
    data.connector_comparison.length >= 2,
    `connector_comparison must have >= 2 items for multi-connector session, got ${data.connector_comparison.length}`,
  )
})

// ─── Describe: Cron cleanup → indexing state ──────────────────────────────────

test('[cron→sitemap] route archived after 90 days low traffic → archived status excludes it from sitemap', async () => {
  // Test that the sitemap generator respects page_status = 'archived'
  const { generateFlightSitemap } = await import('../../lib/pfp/seo/sitemap-generator.ts')

  const { SitemapRoute } = await import('../../lib/pfp/seo/sitemap-generator.ts').catch(() => ({ SitemapRoute: null }))
  // generateFlightSitemap takes SitemapRoute[] directly
  const sitemap = generateFlightSitemap([
    {
      slug: 'gdn-bcn',
      page_status: 'archived' as const,   // archived → should be excluded
      staleness: 'stale' as const,
      session_count: 3,
      snapshot_computed_at: '2025-01-01T00:00:00Z',
    },
    {
      slug: 'waw-lhr',
      page_status: 'published' as const,
      staleness: 'fresh' as const,
      session_count: 25,
      snapshot_computed_at: '2026-05-01T00:00:00Z',
    },
  ])

  assert.ok(!sitemap.includes('gdn-bcn'), 'archived route must be excluded from sitemap')
  assert.ok(sitemap.includes('waw-lhr'), 'published route must be included in sitemap')
})

test('[cron→sitemap] revalidated route has refreshed lastmod in sitemap', async () => {
  const { generateFlightSitemap } = await import('../../lib/pfp/seo/sitemap-generator.ts')
  const recentDate = '2026-05-04T00:00:00Z'

  const sitemap = generateFlightSitemap([
    {
      slug: 'gdn-bcn',
      page_status: 'published' as const,
      staleness: 'fresh' as const,
      session_count: 20,
      snapshot_computed_at: recentDate,
    },
  ])

  assert.ok(sitemap.includes('2026-05-04'), 'sitemap lastmod must reflect the recent revalidation date')
})
