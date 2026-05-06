/**
 * cleanup.test.ts — tests for cleanupStaleRoutePages() cron job.
 *
 * Archive condition:  last_updated_at < NOW - 90d  AND  session_count < 10
 * Revalidate condition: last_updated_at >= NOW - 7d
 *
 * All tests use the injectable CronDeps pattern. `now` is frozen to
 * 2026-05-05T00:00:00Z so date arithmetic is deterministic.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  cleanupStaleRoutePages,
  type CronDatabase,
  type CronDeps,
  type CronRouteRecord,
  type CronAuditLogInsert,
} from '../../../lib/pfp/cron/cleanup.ts'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const FROZEN_NOW = new Date('2026-05-05T00:00:00Z')

function daysAgo(n: number): string {
  const d = new Date(FROZEN_NOW)
  d.setDate(d.getDate() - n)
  return d.toISOString()
}

function makeRoute(overrides: Partial<CronRouteRecord> = {}): CronRouteRecord {
  return {
    id: 'route-1',
    originIata: 'GDN',
    destIata: 'BCN',
    pageStatus: 'published',
    qualityScore: 0.5,
    sessionCount: 5,
    lastUpdatedAt: daysAgo(95), // stale by default (> 90 days old)
    ...overrides,
  }
}

interface DbState {
  db: CronDatabase
  auditLogs: CronAuditLogInsert[]
  statusMap: Map<string, string>
}

function makeDb(routes: CronRouteRecord[]): DbState {
  const auditLogs: CronAuditLogInsert[] = []
  const statusMap = new Map(routes.map(r => [r.id, r.pageStatus]))

  const db: CronDatabase = {
    getRoutesForCleanup: async () => {
      return routes
        .filter(r => {
          const s = statusMap.get(r.id) ?? r.pageStatus
          return s === 'published' || s === 'noindex'
        })
        .map(r => ({ ...r, pageStatus: statusMap.get(r.id) ?? r.pageStatus }))
    },
    updateRoutePageStatus: async (routeId, status) => {
      statusMap.set(routeId, status)
    },
    insertAuditLog: async (data) => {
      auditLogs.push(data)
    },
  }

  return { db, auditLogs, statusMap }
}

function makeDeps(
  db: CronDatabase,
  captured: { emitted: Array<{ event: string; data: unknown }>; revalidated: string[] },
): CronDeps {
  return {
    db,
    revalidate: async (routeId) => { captured.revalidated.push(routeId) },
    emit: (event, data) => { captured.emitted.push({ event, data }) },
    now: () => FROZEN_NOW,
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test('archives route when last_updated > 90 days AND session_count < 10', async () => {
  const route = makeRoute({ sessionCount: 5, lastUpdatedAt: daysAgo(95) })
  const { db, statusMap } = makeDb([route])
  const captured = { emitted: [], revalidated: [] } as { emitted: Array<{ event: string; data: unknown }>; revalidated: string[] }

  await cleanupStaleRoutePages(makeDeps(db, captured))

  assert.equal(statusMap.get('route-1'), 'archived')
})

test('does NOT archive when session_count >= 10 regardless of age', async () => {
  const route = makeRoute({ sessionCount: 10, lastUpdatedAt: daysAgo(95) })
  const { db, statusMap } = makeDb([route])
  const captured = { emitted: [], revalidated: [] } as { emitted: Array<{ event: string; data: unknown }>; revalidated: string[] }

  await cleanupStaleRoutePages(makeDeps(db, captured))

  assert.equal(statusMap.get('route-1'), 'published', 'high-traffic route should stay published')
})

test('does NOT archive when last_updated < 90 days regardless of session_count', async () => {
  const route = makeRoute({ sessionCount: 2, lastUpdatedAt: daysAgo(45) })
  const { db, statusMap } = makeDb([route])
  const captured = { emitted: [], revalidated: [] } as { emitted: Array<{ event: string; data: unknown }>; revalidated: string[] }

  await cleanupStaleRoutePages(makeDeps(db, captured))

  assert.equal(statusMap.get('route-1'), 'published', 'fresh route should stay published')
})

test('sets page_status=archived — does NOT delete the route (noindex only)', async () => {
  const route = makeRoute({ sessionCount: 3, lastUpdatedAt: daysAgo(100) })
  const { db, statusMap } = makeDb([route])
  const captured = { emitted: [], revalidated: [] } as { emitted: Array<{ event: string; data: unknown }>; revalidated: string[] }

  await cleanupStaleRoutePages(makeDeps(db, captured))

  // Status is 'archived' (noindex), not deleted
  assert.equal(statusMap.get('route-1'), 'archived')
  // Route ID still exists in the status map (URL not deleted)
  assert.ok(statusMap.has('route-1'), 'route record must still exist after archival')
})

test('creates audit_log entry for every state change with correct fields', async () => {
  const route = makeRoute({ sessionCount: 3, lastUpdatedAt: daysAgo(100) })
  const { db, auditLogs } = makeDb([route])
  const captured = { emitted: [], revalidated: [] } as { emitted: Array<{ event: string; data: unknown }>; revalidated: string[] }

  await cleanupStaleRoutePages(makeDeps(db, captured))

  assert.equal(auditLogs.length, 1)
  const log = auditLogs[0]
  assert.equal(log.routeId, 'route-1')
  assert.equal(log.action, 'archived')
  assert.equal(log.prevStatus, 'published')
  assert.equal(log.newStatus, 'archived')
  assert.equal(log.triggeredBy, 'cron')
  assert.equal(log.reason, 'stale_low_traffic')
  assert.ok(typeof log.qualityScore === 'number')
})

test('triggers ISR revalidation for routes updated in last 7 days', async () => {
  const route = makeRoute({
    sessionCount: 15,           // high traffic
    lastUpdatedAt: daysAgo(3),  // updated 3 days ago → within 7-day window
  })
  const { db } = makeDb([route])
  const captured = { emitted: [], revalidated: [] } as { emitted: Array<{ event: string; data: unknown }>; revalidated: string[] }

  await cleanupStaleRoutePages(makeDeps(db, captured))

  assert.ok(captured.revalidated.includes('route-1'), 'ISR revalidation should be triggered')
})

test('emits flight_page_revalidated event for each revalidated route', async () => {
  const route = makeRoute({ sessionCount: 20, lastUpdatedAt: daysAgo(2) })
  const { db } = makeDb([route])
  const captured = { emitted: [], revalidated: [] } as { emitted: Array<{ event: string; data: unknown }>; revalidated: string[] }

  await cleanupStaleRoutePages(makeDeps(db, captured))

  const revalidatedEvents = captured.emitted.filter(e => e.event === 'flight_page_revalidated')
  assert.equal(revalidatedEvents.length, 1)
  const payload = revalidatedEvents[0].data as Record<string, unknown>
  assert.equal(payload['trigger'], 'cron')
  assert.equal(payload['route_id'], 'route-1')
})

test('is idempotent — running twice creates no duplicate audit entries', async () => {
  const route = makeRoute({ sessionCount: 4, lastUpdatedAt: daysAgo(95) })
  const { db, auditLogs } = makeDb([route])
  const captured = { emitted: [], revalidated: [] } as { emitted: Array<{ event: string; data: unknown }>; revalidated: string[] }
  const deps = makeDeps(db, captured)

  // Run twice
  await cleanupStaleRoutePages(deps)
  await cleanupStaleRoutePages(deps)

  assert.equal(auditLogs.length, 1, 'second run must not create a duplicate audit entry')
})

test('sends GrowthOps monitoring event with aggregate counts', async () => {
  // 2 routes to archive, 1 to revalidate, 1 unchanged
  const routes: CronRouteRecord[] = [
    makeRoute({ id: 'r1', sessionCount: 3, lastUpdatedAt: daysAgo(100) }),
    makeRoute({ id: 'r2', sessionCount: 5, lastUpdatedAt: daysAgo(92) }),
    makeRoute({ id: 'r3', sessionCount: 20, lastUpdatedAt: daysAgo(4) }),   // revalidate
    makeRoute({ id: 'r4', sessionCount: 15, lastUpdatedAt: daysAgo(30) }),  // unchanged (not stale enough, not fresh enough for revalidation)
  ]
  const { db } = makeDb(routes)
  const captured = { emitted: [], revalidated: [] } as { emitted: Array<{ event: string; data: unknown }>; revalidated: string[] }

  await cleanupStaleRoutePages(makeDeps(db, captured))

  const monitorEvent = captured.emitted.find(e => e.event === 'growth_ops_cron_summary')
  assert.ok(monitorEvent, 'growth_ops_cron_summary event must be emitted')

  const summary = monitorEvent!.data as Record<string, unknown>
  assert.equal(typeof summary['archived_count'], 'number')
  assert.equal(typeof summary['revalidated_count'], 'number')
  assert.equal(typeof summary['unchanged_count'], 'number')
  assert.equal(summary['archived_count'], 2)
  assert.equal(summary['revalidated_count'], 1)
  assert.equal(summary['unchanged_count'], 1)
})

test('mixed: routes with noindex status are also eligible for archival', async () => {
  const route = makeRoute({
    pageStatus: 'noindex',
    sessionCount: 2,
    lastUpdatedAt: daysAgo(100),
  })
  const { db, statusMap } = makeDb([route])
  const captured = { emitted: [], revalidated: [] } as { emitted: Array<{ event: string; data: unknown }>; revalidated: string[] }

  await cleanupStaleRoutePages(makeDeps(db, captured))

  assert.equal(statusMap.get('route-1'), 'archived')
})
