/**
 * cleanup.ts — daily cron job for staleness management and ISR revalidation
 * of Programmatic Flight Pages.
 *
 * Archive condition (both must be true):
 *   • last_updated_at is more than 90 days ago
 *   • session_count < 10 (low-traffic route — not worth keeping live)
 *
 * Revalidate condition:
 *   • last_updated_at is within the last 7 days
 *   (fresh routes get their Next.js ISR cache invalidated to pick up new snapshots)
 *
 * Archival semantics:
 *   • page_status = 'archived' (URL stays live, noindex applied by page template)
 *   • No URL deletion — canonical URL preserved for backlink equity
 *   • audit_log entry written with action='archived', reason='stale_low_traffic'
 *
 * Idempotency:
 *   • getRoutesForCleanup() only returns routes with status 'published' or 'noindex'
 *   • On second run, archived routes are not returned → no duplicate mutations
 *
 * Transaction safety:
 *   In production, wrap DB mutations in a single transaction.
 *   The injectable interface is flat for testability — the real DB adapter
 *   handles transaction semantics internally.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CronRouteRecord {
  id: string
  originIata: string
  destIata: string
  /** Current status — only 'published' and 'noindex' are returned by getRoutesForCleanup(). */
  pageStatus: string
  qualityScore: number
  /** Total number of anonymized search sessions ingested for this route. */
  sessionCount: number
  /** ISO 8601 timestamp of the most recent snapshot update. */
  lastUpdatedAt: string
}

export interface CronAuditLogInsert {
  routeId: string
  action: string
  prevStatus: string
  newStatus: string
  qualityScore: number
  triggeredBy: string
  reason?: string
}

export interface CronDatabase {
  /**
   * Returns all routes with page_status in ['published', 'noindex'].
   * Routes already archived are excluded (idempotency guarantee).
   */
  getRoutesForCleanup(): Promise<CronRouteRecord[]>

  /**
   * Updates page_status for a route.
   * In production: wrapped in a DB transaction together with insertAuditLog.
   */
  updateRoutePageStatus(routeId: string, status: string): Promise<void>

  /** Writes an immutable audit log entry for the status change. */
  insertAuditLog(data: CronAuditLogInsert): Promise<void>
}

export interface CronDeps {
  db: CronDatabase
  /** Triggers Next.js ISR revalidation for a route. */
  revalidate(routeId: string): Promise<void>
  /** Typed analytics/monitoring event emitter — do not call analytics APIs directly. */
  emit(event: string, data: unknown): void
  /** Override current time (for deterministic tests). Defaults to new Date(). */
  now?: () => Date
}

export interface CronSummary {
  archived_count: number
  revalidated_count: number
  unchanged_count: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Route is stale if it has not been updated in this many days. */
const ARCHIVE_AGE_DAYS = 90

/** Only archive routes with fewer than this many sessions (low-traffic guard). */
const ARCHIVE_MIN_SESSION_COUNT = 10

/** Trigger ISR revalidation for routes updated within this many days. */
const REVALIDATE_AGE_DAYS = 7

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * Evaluate all active flight page routes and:
 * 1. Archive routes that are stale (> 90 days) AND low-traffic (< 10 sessions).
 * 2. Trigger ISR revalidation for routes updated within the last 7 days.
 * 3. Emit a GrowthOps monitoring event with aggregate counts.
 *
 * @returns CronSummary with counts of archived, revalidated, and unchanged routes.
 */
export async function cleanupStaleRoutePages(deps: CronDeps): Promise<CronSummary> {
  const now = deps.now ? deps.now() : new Date()
  const archiveCutoff = new Date(now.getTime() - ARCHIVE_AGE_DAYS * 24 * 60 * 60 * 1000)
  const revalidateCutoff = new Date(now.getTime() - REVALIDATE_AGE_DAYS * 24 * 60 * 60 * 1000)

  const summary: CronSummary = {
    archived_count: 0,
    revalidated_count: 0,
    unchanged_count: 0,
  }

  const routes = await deps.db.getRoutesForCleanup()

  for (const route of routes) {
    const lastUpdated = new Date(route.lastUpdatedAt)

    const isStale = lastUpdated < archiveCutoff
    const isLowTraffic = route.sessionCount < ARCHIVE_MIN_SESSION_COUNT
    const isFresh = lastUpdated >= revalidateCutoff

    if (isStale && isLowTraffic) {
      // ── Archive ──────────────────────────────────────────────────────────────
      // Update status to 'archived' (noindex applied by page template; URL kept)
      await deps.db.updateRoutePageStatus(route.id, 'archived')

      // Write audit log for every state change
      await deps.db.insertAuditLog({
        routeId: route.id,
        action: 'archived',
        prevStatus: route.pageStatus,
        newStatus: 'archived',
        qualityScore: route.qualityScore,
        triggeredBy: 'cron',
        reason: 'stale_low_traffic',
      })

      summary.archived_count++
    } else if (isFresh) {
      // ── Revalidate ───────────────────────────────────────────────────────────
      // Trigger Next.js ISR cache invalidation so the page picks up new snapshot data
      await deps.revalidate(route.id)

      deps.emit('flight_page_revalidated', {
        trigger: 'cron',
        route_id: route.id,
      })

      summary.revalidated_count++
    } else {
      // ── Unchanged ────────────────────────────────────────────────────────────
      summary.unchanged_count++
    }
  }

  // Emit aggregate summary to GrowthOps monitoring
  deps.emit('growth_ops_cron_summary', summary)

  return summary
}
