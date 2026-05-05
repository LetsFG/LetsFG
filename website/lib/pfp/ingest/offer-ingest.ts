/**
 * offer-ingest.ts — writes a normalized AgentSearchSession to the PFP database,
 * runs the ContentQualityGate, updates page status, triggers ISR, and emits analytics.
 *
 * IMPORTANT SAFETY GUARANTEES:
 *   - Never throws to the calling agent pipeline (all errors are caught internally).
 *   - Idempotent: second call with the same sessionId is a no-op.
 *   - All DB operations are injectable for testability.
 *   - No PII is written to the DB — the session must already be anonymized
 *     (use normalizer.normalizeSession() before calling this function).
 *
 * Execution order:
 *   1. Validate session (≥ 5 offers, ≥ 1 carrier, all prices > 0)
 *   2. Idempotency check
 *   3. Upsert flight_routes
 *   4. Insert flight_search_sessions
 *   5. Bulk insert flight_offers_aggregated
 *   6. Recompute route_distribution_snapshots
 *   7. Run ContentQualityGate
 *   8. Update page_status + audit log (only if status changes)
 *   9. Trigger ISR revalidation if publishAs in ['published', 'noindex']
 *  10. Emit typed analytics events
 */

import type { AgentSearchSession } from '../types/agent-session.types.ts'
import { ContentQualityGate } from '../quality/content-quality-gate.ts'
import { computeSessionStats } from './normalizer.ts'

// ─── DB interface (injectable for testing) ────────────────────────────────────

export interface RouteRecord {
  id: string
  originIata: string
  destIata: string
  pageStatus: string
  qualityScore: number
}

export interface SessionInsert {
  sessionId: string
  routeId: string
  searchedAt: string
  offerCount: number
  carrierCount: number
  connectorCount: number
  priceMin: number | null
  priceMax: number | null
  priceP25: number | null
  priceP50: number | null
  priceP75: number | null
  priceP95: number | null
  targetCurrency: string
}

export interface OfferAggregateInsert {
  routeId: string
  sessionId: string
  ownerAirline: string
  source: string
  cabinClass: string
  fareClassBucket: string
  priceMin: number
  priceMax: number
  priceMedian: number
  offerCount: number
  currency: string
}

export interface AuditLogInsert {
  routeId: string
  action: string
  prevStatus: string
  newStatus: string
  qualityScore: number
  triggeredBy: string
}

export interface PfpDatabase {
  findRouteByIata(origin: string, dest: string): Promise<RouteRecord | null>
  upsertRoute(data: { originIata: string; destIata: string }): Promise<RouteRecord>
  sessionExists(sessionId: string): Promise<boolean>
  insertSession(data: SessionInsert): Promise<string>
  insertOfferAggregates(data: OfferAggregateInsert[]): Promise<void>
  upsertSnapshot(routeId: string, data: SnapshotData): Promise<void>
  updateRoutePageStatus(routeId: string, status: string, qualityScore: number): Promise<void>
  getCurrentPageStatus(routeId: string): Promise<string>
  insertAuditLog(data: AuditLogInsert): Promise<void>
}

export interface SnapshotData {
  routeId: string
  currency: string
  priceMin: number | null
  priceMax: number | null
  priceP25: number | null
  priceP50: number | null
  priceP75: number | null
  priceP95: number | null
  carrierCount: number
  offerCount: number
  qualityScore: number
  computedAt: string
}

export interface IngestDeps {
  db: PfpDatabase
  /** Called when a route's page is ready to be revalidated in Next.js ISR. */
  revalidate(routeId: string): Promise<void>
  /** Typed analytics event emitter — do NOT call gtag/analytics directly. */
  emit(event: string, data: unknown): void
}

// ─── Validation ───────────────────────────────────────────────────────────────

function validateSession(session: AgentSearchSession): string | null {
  if (session.offers.length < 5) {
    return `session ${session.sessionId}: insufficient offers (${session.offers.length} < 5)`
  }
  const carriers = new Set(session.offers.map(o => o.ownerAirline).filter(Boolean))
  if (carriers.size < 1) {
    return `session ${session.sessionId}: no carriers identified`
  }
  const validPrices = session.offers.every(o => (o.priceNormalized ?? o.price) > 0)
  if (!validPrices) {
    return `session ${session.sessionId}: some offers have non-positive prices`
  }
  return null
}

// ─── Offer aggregate builder ──────────────────────────────────────────────────

function buildOfferAggregates(
  session: AgentSearchSession,
  routeId: string
): OfferAggregateInsert[] {
  // Group offers by (ownerAirline, source, cabinClass)
  type GroupKey = string
  const groups = new Map<GroupKey, { prices: number[]; currency: string; cabinClass: string }>()

  for (const offer of session.offers) {
    const cabinClass = offer.outbound.segments[0]?.cabinClass ?? 'economy'
    const key: GroupKey = `${offer.ownerAirline}::${offer.source}::${cabinClass}`
    if (!groups.has(key)) {
      groups.set(key, { prices: [], currency: offer.currency, cabinClass })
    }
    const price = offer.priceNormalized ?? offer.price
    if (price > 0) {
      groups.get(key)!.prices.push(price)
    }
  }

  const aggregates: OfferAggregateInsert[] = []
  for (const [key, { prices, currency, cabinClass }] of groups) {
    if (prices.length === 0) continue
    const [ownerAirline, source] = key.split('::')
    const sorted = [...prices].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    aggregates.push({
      routeId,
      sessionId: session.sessionId,
      ownerAirline,
      source,
      cabinClass,
      // Basic fare bucket — full bucketing in Session 3 DistributionService
      fareClassBucket: cabinClass === 'economy' ? 'M' : cabinClass === 'business' ? 'Y' : 'other',
      priceMin: sorted[0],
      priceMax: sorted[sorted.length - 1],
      priceMedian: median,
      offerCount: prices.length,
      currency,
    })
  }

  return aggregates
}

// ─── ingestAgentSession ───────────────────────────────────────────────────────

const gate = new ContentQualityGate()

/**
 * Ingest a normalized AgentSearchSession into the PFP database.
 *
 * @param session  Fully-normalized, anonymized session (use normalizer.ts).
 * @param deps     Injectable dependencies (DB, ISR revalidate, analytics emit).
 *
 * @returns void — never throws; all errors are caught and swallowed.
 */
export async function ingestAgentSession(
  session: AgentSearchSession,
  deps: IngestDeps
): Promise<void> {
  try {
    // 1. Validate
    const validationError = validateSession(session)
    if (validationError) {
      deps.emit('flight_page_ingest_rejected', { sessionId: session.sessionId, reason: validationError })
      return
    }

    // 2. Idempotency check
    const exists = await deps.db.sessionExists(session.sessionId)
    if (exists) {
      deps.emit('flight_page_ingest_skipped', { sessionId: session.sessionId, reason: 'duplicate' })
      return
    }

    // 3. Upsert route
    const route = await deps.db.upsertRoute({
      originIata: session.originIata,
      destIata: session.destIata,
    })

    // 4. Compute session stats (includes priceCV for quality gate)
    const stats = computeSessionStats(session.offers)

    // 5. Insert session record
    await deps.db.insertSession({
      sessionId: session.sessionId,
      routeId: route.id,
      searchedAt: session.searchedAt,
      offerCount: stats.offerCount,
      carrierCount: stats.carrierCount,
      connectorCount: stats.connectorCount,
      priceMin: stats.priceMin,
      priceMax: stats.priceMax,
      priceP25: stats.priceP25,
      priceP50: stats.priceP50,
      priceP75: stats.priceP75,
      priceP95: stats.priceP95,
      targetCurrency: session.targetCurrency,
    })

    // 6. Bulk insert offer aggregates
    const aggregates = buildOfferAggregates(session, route.id)
    await deps.db.insertOfferAggregates(aggregates)

    // 7. Recompute route snapshot
    const snapshotData: SnapshotData = {
      routeId: route.id,
      currency: session.targetCurrency,
      priceMin: stats.priceMin,
      priceMax: stats.priceMax,
      priceP25: stats.priceP25,
      priceP50: stats.priceP50,
      priceP75: stats.priceP75,
      priceP95: stats.priceP95,
      carrierCount: stats.carrierCount,
      offerCount: stats.offerCount,
      qualityScore: 0, // updated below after gate evaluation
      computedAt: new Date().toISOString(),
    }
    await deps.db.upsertSnapshot(route.id, snapshotData)

    // 8. Run quality gate
    const gateInput = {
      offerCount: stats.offerCount,
      carrierCount: stats.carrierCount,
      connectorCount: stats.connectorCount,
      priceCV: stats.priceCV,
    }
    const gateResult = gate.evaluate(gateInput)

    deps.emit('flight_page_quality_gate_result', {
      sessionId: session.sessionId,
      routeId: route.id,
      origin: session.originIata,
      dest: session.destIata,
      decision: gateResult.decision,
      publishAs: gateResult.publishAs,
      score: gateResult.score,
      scores: gateResult.scores,
      reasons: gateResult.reasons,
    })

    // 9. Update page status + audit log (only when status changes)
    const prevStatus = await deps.db.getCurrentPageStatus(route.id)
    const newStatus = gateResult.publishAs

    await deps.db.updateRoutePageStatus(route.id, newStatus, gateResult.score)

    if (prevStatus !== newStatus) {
      await deps.db.insertAuditLog({
        routeId: route.id,
        action: newStatus === 'published' ? 'publish'
          : newStatus === 'noindex' ? 'noindex'
          : 'draft_downgrade',
        prevStatus,
        newStatus,
        qualityScore: gateResult.score,
        triggeredBy: 'ingest_pipeline',
      })
    }

    // 10. ISR revalidation — only when page will be visible (published or noindex)
    if (newStatus === 'published' || newStatus === 'noindex') {
      await deps.revalidate(route.id)
    }

  } catch (err) {
    // Never propagate errors to the calling agent pipeline
    // Log only — in production, forward to error monitoring
    if (process.env.NODE_ENV !== 'test') {
      console.error('[pfp/ingest] ingestAgentSession error:', err)
    }
  }
}
