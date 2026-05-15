/**
 * trigger.ts — fire-and-forget PFP ingest after a search completes.
 *
 * Called from app/api/results/[searchId]/route.ts once FSW reports `completed`.
 * Normalizes raw FSW offers, computes the RouteDistributionData distribution,
 * runs the ContentQualityGate, and POSTs the result to the backend API where
 * it is persisted in Firestore for ISR page rendering.
 *
 * SAFETY GUARANTEES:
 *   - Never throws (all errors caught internally, logged as warnings).
 *   - Non-blocking: caller wraps in .catch(() => {}).
 *   - Minimum quality floor: silently skips if <15 offers or <2 carriers.
 */

import { normalizeSession, computeSessionStats } from './normalizer.ts'
import type { RawSearchPayload } from './normalizer.ts'
import { getRouteDistributionData } from '../distribution/distribution-service.ts'
import { ContentQualityGate } from '../quality/content-quality-gate.ts'
import { getLetsfgAnalyticsApiBase } from '../../letsfg-api'

const API_BASE = getLetsfgAnalyticsApiBase()

export interface PfpTriggerInput {
  /** FSW search ID (used as session_id). */
  searchId: string
  /** IATA origin code (e.g. 'GDN'). */
  origin: string
  /** IATA destination code (e.g. 'BCN'). */
  destination: string
  /** Human-readable origin city name. */
  originName: string
  /** Human-readable destination city name. */
  destName: string
  /** Currency returned by FSW (e.g. 'EUR'). */
  currency: string
  /** Raw offer array from FSW (Python SDK format). */
  rawOffers: unknown[]
}

export async function triggerPfpIngest(input: PfpTriggerInput): Promise<void> {
  try {
    const { searchId, origin, destination, originName, destName, currency, rawOffers } = input

    if (!rawOffers || rawOffers.length < 15) return

    const routeSlug = `${origin.toLowerCase()}-${destination.toLowerCase()}`

    // ── 1. Normalize via existing normalizer ──────────────────────────────────
    const rawPayload: RawSearchPayload = {
      session_id: searchId,
      origin: origin.toUpperCase(),
      destination: destination.toUpperCase(),
      origin_city: originName,
      dest_city: destName,
      currency,
      offers: rawOffers as RawSearchPayload['offers'],
      total_results: rawOffers.length,
      searched_at: new Date().toISOString(),
    }

    const session = normalizeSession(rawPayload)
    const computedStats = computeSessionStats(session.offers)

    // ── 2. Quality gate check ─────────────────────────────────────────────────
    const gate = new ContentQualityGate()
    const gateResult = gate.evaluate({
      offerCount: session.stats.offerCount,
      carrierCount: session.stats.carrierCount,
      connectorCount: session.stats.connectorCount,
      priceCV: computedStats.priceCV,
    })

    // Draft pages are never published — skip ingesting them to avoid noise
    if (gateResult.publishAs === 'draft') return

    // ── 3. Compute distribution ───────────────────────────────────────────────
    const snapshot = getRouteDistributionData(
      [session],
      {
        originIata: origin.toUpperCase(),
        destIata: destination.toUpperCase(),
        originCity: originName,
        destCity: destName,
        pageStatus: gateResult.publishAs,
        sessionCount: 1,
        snapshotComputedAt: new Date().toISOString(),
      },
    )

    // ── 4. POST to backend ────────────────────────────────────────────────────
    const websiteApiKey = process.env.LETSFG_WEBSITE_API_KEY || ''
    await fetch(`${API_BASE}/api/v1/flights/pfp/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://letsfg.co',
        ...(websiteApiKey ? { 'X-API-Key': websiteApiKey } : {}),
      },
      body: JSON.stringify({
        route_slug: routeSlug,
        origin_iata: origin.toUpperCase(),
        dest_iata: destination.toUpperCase(),
        origin_city: originName,
        dest_city: destName,
        page_status: gateResult.publishAs,
        quality_score: gateResult.score,
        session_id: searchId,
        snapshot,
      }),
      signal: AbortSignal.timeout(5_000),
    })
  } catch (err) {
    // Never surface errors to the caller — this is a background operation
    console.warn('[pfp-ingest] Failed to ingest session:', err instanceof Error ? err.message : err)
  }
}
