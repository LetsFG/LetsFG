/**
 * neon-adapter.ts — implements PfpDatabase using Neon serverless Postgres.
 *
 * Uses @neondatabase/serverless which sends SQL over HTTP — no connection
 * pooling required, compatible with Cloud Run cold starts.
 *
 * DATABASE_URL env var must be set to the Neon connection string.
 *
 * Extra methods beyond PfpDatabase (not needed by offer-ingest.ts but needed
 * by page rendering and sitemap):
 *   - getRouteDistributionSnapshot(slug): reads full_snapshot_json for a route
 *   - getPublishedRoutes():               lists published/noindex routes for sitemap
 *   - updateFullSnapshot(routeId, data):  stores computed RouteDistributionData
 */

import { neon } from '@neondatabase/serverless'
import type {
  PfpDatabase,
  RouteRecord,
  SessionInsert,
  OfferAggregateInsert,
  SnapshotData,
  AuditLogInsert,
} from '../ingest/offer-ingest.ts'
import type { RouteDistributionData, Staleness } from '../types/route-distribution.types.ts'
import type { SitemapRoute } from '../seo/sitemap-generator.ts'

// ─── Exported helper functions (tested directly) ──────────────────────────────

/**
 * Parse "gdn-bcn" → { origin: 'GDN', dest: 'BCN' }.
 * Throws when the slug format is invalid.
 */
export function parseRouteSlug(slug: string): { origin: string; dest: string } {
  if (!slug || !slug.includes('-')) {
    throw new Error(`Invalid route slug: "${slug}"`)
  }
  const dashIdx = slug.indexOf('-')
  const origin = slug.slice(0, dashIdx).toUpperCase()
  const dest = slug.slice(dashIdx + 1).toUpperCase()
  if (!origin || !dest) throw new Error(`Invalid route slug: "${slug}"`)
  return { origin, dest }
}

/**
 * Classify snapshot age into Staleness bucket.
 * fresh  < 7 days | recent 7–30 days | stale > 30 days
 */
export function computeStaleness(snapshotAt: string): Staleness {
  const ageDays = (Date.now() - new Date(snapshotAt).getTime()) / 86_400_000
  if (ageDays < 7) return 'fresh'
  if (ageDays < 30) return 'recent'
  return 'stale'
}

/** Map a raw DB route row to a RouteRecord. */
export function mapRouteRowToRecord(row: Record<string, unknown>): RouteRecord {
  return {
    id: String(row.id),
    originIata: String(row.origin_iata),
    destIata: String(row.dest_iata),
    pageStatus: String(row.page_status),
    qualityScore: typeof row.quality_score === 'number' ? row.quality_score : 0,
  }
}

/**
 * Map a row from the DB (route + snapshot joined) to RouteDistributionData.
 * Returns null when full_snapshot_json is empty or lacks required fields.
 */
export function mapSnapshotRowToDistribution(
  row: Record<string, unknown>,
): RouteDistributionData | null {
  const json = row.full_snapshot_json as Record<string, unknown> | null | undefined
  if (!json || typeof json !== 'object' || !json.price_distribution) return null
  return json as unknown as RouteDistributionData
}

// ─── NeonAdapter ─────────────────────────────────────────────────────────────

export class NeonAdapter implements PfpDatabase {
  private sql

  constructor(connectionString?: string) {
    this.sql = neon(connectionString ?? process.env.DATABASE_URL!)
  }

  // ── PfpDatabase ─────────────────────────────────────────────────────────────

  async findRouteByIata(origin: string, dest: string): Promise<RouteRecord | null> {
    const rows = await this.sql`
      SELECT id, origin_iata, dest_iata, page_status, quality_score
      FROM flight_routes
      WHERE origin_iata = ${origin.toUpperCase()}
        AND dest_iata   = ${dest.toUpperCase()}
      LIMIT 1
    `
    if (rows.length === 0) return null
    return mapRouteRowToRecord(rows[0])
  }

  async upsertRoute(data: { originIata: string; destIata: string }): Promise<RouteRecord> {
    const rows = await this.sql`
      INSERT INTO flight_routes (origin_iata, dest_iata)
      VALUES (${data.originIata.toUpperCase()}, ${data.destIata.toUpperCase()})
      ON CONFLICT (origin_iata, dest_iata) DO UPDATE
        SET last_updated_at = now()
      RETURNING id, origin_iata, dest_iata, page_status, quality_score
    `
    return mapRouteRowToRecord(rows[0])
  }

  async sessionExists(sessionId: string): Promise<boolean> {
    const rows = await this.sql`
      SELECT 1 FROM flight_search_sessions WHERE session_id = ${sessionId} LIMIT 1
    `
    return rows.length > 0
  }

  async insertSession(data: SessionInsert): Promise<string> {
    const rows = await this.sql`
      INSERT INTO flight_search_sessions (
        route_id, session_id, searched_at,
        offer_count, carrier_count, connector_count,
        price_min, price_max, price_p25, price_p50, price_p75, price_p95,
        target_currency
      ) VALUES (
        ${data.routeId}, ${data.sessionId}, ${data.searchedAt},
        ${data.offerCount}, ${data.carrierCount}, ${data.connectorCount},
        ${data.priceMin}, ${data.priceMax}, ${data.priceP25},
        ${data.priceP50}, ${data.priceP75}, ${data.priceP95},
        ${data.targetCurrency}
      )
      RETURNING id
    `
    return String(rows[0].id)
  }

  async insertOfferAggregates(data: OfferAggregateInsert[]): Promise<void> {
    if (data.length === 0) return
    for (const agg of data) {
      await this.sql`
        INSERT INTO flight_offers_aggregated (
          route_id, session_id, carrier, cabin_class, fare_class_bucket,
          price_min, price_max, price_p50, offer_count_in_bucket, connector_name, currency
        ) VALUES (
          ${agg.routeId}, ${agg.sessionId}, ${agg.ownerAirline},
          ${agg.cabinClass}, ${agg.fareClassBucket},
          ${agg.priceMin}, ${agg.priceMax}, ${agg.priceMedian},
          ${agg.offerCount}, ${agg.source}, ${agg.currency}
        )
      `
    }
  }

  async upsertSnapshot(routeId: string, data: SnapshotData): Promise<void> {
    await this.sql`
      INSERT INTO route_distribution_snapshots (
        route_id, snapshot_computed_at,
        total_offers_in_snapshot, session_count_contributing,
        data_confidence
      ) VALUES (
        ${routeId}, ${data.computedAt},
        ${data.offerCount}, 1, 'low'
      )
      ON CONFLICT (route_id) DO UPDATE SET
        snapshot_computed_at         = ${data.computedAt},
        total_offers_in_snapshot     = EXCLUDED.total_offers_in_snapshot,
        session_count_contributing   = route_distribution_snapshots.session_count_contributing + 1
    `

    // Also update route session counter
    await this.sql`
      UPDATE flight_routes
      SET session_count          = session_count + 1,
          total_offers_indexed   = total_offers_indexed + ${data.offerCount},
          last_updated_at        = now()
      WHERE id = ${routeId}
    `
  }

  async updateRoutePageStatus(
    routeId: string,
    status: string,
    qualityScore: number,
  ): Promise<void> {
    await this.sql`
      UPDATE flight_routes
      SET page_status               = ${status}::page_status,
          quality_score             = ${qualityScore},
          last_quality_evaluated_at = now()
      WHERE id = ${routeId}
    `
  }

  async getCurrentPageStatus(routeId: string): Promise<string> {
    const rows = await this.sql`
      SELECT page_status FROM flight_routes WHERE id = ${routeId} LIMIT 1
    `
    return rows.length > 0 ? String(rows[0].page_status) : 'draft'
  }

  async insertAuditLog(data: AuditLogInsert): Promise<void> {
    await this.sql`
      INSERT INTO page_audit_log (
        route_id, action, previous_status, new_status,
        reason, triggered_by
      ) VALUES (
        ${data.routeId}, ${data.action}, ${data.prevStatus}, ${data.newStatus},
        ${`quality_score=${data.qualityScore.toFixed(3)}`}, ${data.triggeredBy}
      )
    `
  }

  // ── Rendering / sitemap extras ──────────────────────────────────────────────

  /**
   * Returns the full RouteDistributionData for a route slug (e.g. 'gdn-bcn').
   * Null when not found, not visible (draft/archived), or snapshot is empty.
   */
  async getRouteDistributionSnapshot(routeSlug: string): Promise<RouteDistributionData | null> {
    let origin: string, dest: string
    try {
      ;({ origin, dest } = parseRouteSlug(routeSlug))
    } catch {
      return null
    }

    const rows = await this.sql`
      SELECT fr.page_status, fr.origin_iata, fr.dest_iata,
             rds.full_snapshot_json
      FROM flight_routes fr
      JOIN route_distribution_snapshots rds ON rds.route_id = fr.id
      WHERE fr.origin_iata = ${origin}
        AND fr.dest_iata   = ${dest}
        AND fr.page_status IN ('published', 'noindex')
      LIMIT 1
    `
    if (rows.length === 0) return null
    return mapSnapshotRowToDistribution(rows[0] as Record<string, unknown>)
  }

  /** Returns all published/noindex routes for the flights sitemap. */
  async getPublishedRoutes(): Promise<SitemapRoute[]> {
    const rows = await this.sql`
      SELECT fr.origin_iata, fr.dest_iata, fr.page_status,
             fr.session_count, rds.snapshot_computed_at
      FROM flight_routes fr
      JOIN route_distribution_snapshots rds ON rds.route_id = fr.id
      WHERE fr.page_status IN ('published', 'noindex')
      ORDER BY fr.session_count DESC, fr.last_updated_at DESC
    `

    return rows.map(row => ({
      slug: `${String(row.origin_iata).toLowerCase()}-${String(row.dest_iata).toLowerCase()}`,
      page_status: String(row.page_status) as SitemapRoute['page_status'],
      staleness: computeStaleness(String(row.snapshot_computed_at)),
      session_count: Number(row.session_count),
      snapshot_computed_at: String(row.snapshot_computed_at),
    }))
  }

  /** Store the full pre-computed RouteDistributionData as JSONB. */
  async updateFullSnapshot(routeId: string, data: RouteDistributionData): Promise<void> {
    await this.sql`
      UPDATE route_distribution_snapshots
      SET full_snapshot_json = ${JSON.stringify(data)}::jsonb
      WHERE route_id = ${routeId}
    `
  }
}

// ─── Singleton factory ────────────────────────────────────────────────────────

let _adapter: NeonAdapter | null = null

export function getNeonAdapter(): NeonAdapter {
  if (!_adapter) _adapter = new NeonAdapter()
  return _adapter
}
