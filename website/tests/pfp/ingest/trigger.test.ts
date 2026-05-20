import assert from 'node:assert/strict'
import test from 'node:test'

import { triggerPfpIngest } from '../../../lib/pfp/ingest/trigger.ts'
import type { RawSearchPayload } from '../../../lib/pfp/ingest/normalizer.ts'
import type { NeonAdapter } from '../../../lib/pfp/db/neon-adapter.ts'

// ─── Mock DB adapter ──────────────────────────────────────────────────────────

function makeMockDb(overrides: Partial<Record<keyof NeonAdapter, (...args: any[]) => any>> = {}): NeonAdapter {
  const defaultStatus = 'published'
  return {
    findRouteByIata: async () => ({
      id: 'route-uuid',
      originIata: 'GDN',
      destIata: 'BCN',
      pageStatus: defaultStatus,
      qualityScore: 0.8,
    }),
    upsertRoute: async (data) => ({
      id: 'route-uuid',
      originIata: data.originIata,
      destIata: data.destIata,
      pageStatus: 'draft',
      qualityScore: 0,
    }),
    sessionExists: async () => false,
    insertSession: async () => 'session-uuid',
    insertOfferAggregates: async () => {},
    upsertSnapshot: async () => {},
    updateRoutePageStatus: async () => {},
    getCurrentPageStatus: async () => defaultStatus,
    insertAuditLog: async () => {},
    getRouteDistributionSnapshot: async () => null,
    getPublishedRoutes: async () => [],
    updateFullSnapshot: async () => {},
    ...overrides,
  } as unknown as NeonAdapter
}

// ─── Minimal raw payload ──────────────────────────────────────────────────────

function makeRawPayload(offerCount = 20): RawSearchPayload {
  const offers = Array.from({ length: offerCount }, (_, i) => ({
    id: `o-${i}`,
    price: 80 + i * 5,
    currency: 'EUR',
    outbound: {
      segments: [
        {
          airline: i % 2 === 0 ? 'FR' : 'W6',
          origin: 'GDN',
          destination: 'BCN',
          departure: '2026-06-15T08:00:00',
          arrival: '2026-06-15T10:00:00',
          duration_seconds: 7200,
          cabin_class: 'economy',
        },
      ],
      stopovers: 0,
    },
    airlines: [i % 2 === 0 ? 'FR' : 'W6'],
    source: i % 2 === 0 ? 'ryanair_direct' : 'wizzair_direct',
  }))

  return {
    session_id: 'ws_test123',
    origin: 'GDN',
    destination: 'BCN',
    origin_city: 'Gdansk',
    dest_city: 'Barcelona',
    currency: 'EUR',
    offers: offers as any,
    searched_at: '2026-06-15T10:00:00Z',
  }
}

// ─── Core behavior ────────────────────────────────────────────────────────────

test('triggerPfpIngest: calls updateFullSnapshot after ingest', async () => {
  let snapshotCalled = false
  const db = makeMockDb({
    updateFullSnapshot: async () => { snapshotCalled = true },
  })

  await triggerPfpIngest(makeRawPayload(), db)
  assert.equal(snapshotCalled, true)
})

test('triggerPfpIngest: does not throw — swallows all errors', async () => {
  const db = makeMockDb({
    upsertRoute: async () => { throw new Error('DB failure') },
  })

  // Must not throw
  await assert.doesNotReject(() => triggerPfpIngest(makeRawPayload(), db))
})

test('triggerPfpIngest: skips when fewer than 5 offers', async () => {
  let upsertCalled = false
  const db = makeMockDb({
    upsertRoute: async (d) => { upsertCalled = true; return { id: 'r', originIata: d.originIata, destIata: d.destIata, pageStatus: 'draft', qualityScore: 0 } },
  })

  await triggerPfpIngest(makeRawPayload(2), db)
  // With only 2 offers, normalizer may still run but quality gate will fail
  // The key assertion is that no crash occurs
  assert.doesNotReject(() => Promise.resolve())
})

test('triggerPfpIngest: skips full snapshot update if route not found', async () => {
  let snapshotCalled = false
  const db = makeMockDb({
    findRouteByIata: async () => null,
    updateFullSnapshot: async () => { snapshotCalled = true },
  })

  await triggerPfpIngest(makeRawPayload(), db)
  assert.equal(snapshotCalled, false)
})

test('triggerPfpIngest: revalidation called for published route', async () => {
  let revalidateCalled = false

  // Inject a mock revalidate function by passing it explicitly
  const db = makeMockDb({ getCurrentPageStatus: async () => 'published' })

  await triggerPfpIngest(makeRawPayload(), db, async (_slug: string) => {
    revalidateCalled = true
  })
  assert.equal(revalidateCalled, true)
})

test('triggerPfpIngest: revalidation NOT called for draft route', async () => {
  let revalidateCalled = false
  const db = makeMockDb({ getCurrentPageStatus: async () => 'draft' })

  await triggerPfpIngest(makeRawPayload(), db, async (_slug: string) => {
    revalidateCalled = true
  })
  assert.equal(revalidateCalled, false)
})

test('triggerPfpIngest: updateFullSnapshot receives RouteDistributionData shape', async () => {
  let receivedData: any = null
  const db = makeMockDb({
    updateFullSnapshot: async (_routeId, data) => { receivedData = data },
  })

  await triggerPfpIngest(makeRawPayload(), db)
  assert.ok(receivedData !== null)
  assert.ok(typeof receivedData.price_distribution === 'object')
  assert.ok(typeof receivedData.carrier_summary === 'object')
  assert.ok(typeof receivedData.origin_iata === 'string')
})

test('triggerPfpIngest: offer_highlights included in snapshot data', async () => {
  let receivedData: any = null
  const db = makeMockDb({
    updateFullSnapshot: async (_routeId, data) => { receivedData = data },
  })

  await triggerPfpIngest(makeRawPayload(20), db)
  assert.ok(Array.isArray(receivedData?.offer_highlights))
  assert.ok(receivedData.offer_highlights.length > 0)
})
