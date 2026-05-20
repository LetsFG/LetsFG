/**
 * trigger.ts — glue between the search results API and the PFP ingest pipeline.
 *
 * Called fire-and-forget from /api/results/[searchId]/route.ts after a search
 * completes. Never throws — all errors are swallowed so the search response
 * is never delayed or broken.
 *
 * Flow:
 *  1. normalizeSession() — converts FSW raw offers to AgentSearchSession
 *  2. ingestAgentSession() — writes session/offers/basic snapshot to DB,
 *     runs quality gate, updates page_status
 *  3. buildOfferHighlights() — per-carrier offer detail cards
 *  4. buildAmenitySummary() — per-carrier bags/seat pricing
 *  5. generateLlmRationale() — Claude-generated route context (optional)
 *  6. getRouteDistributionData() — full distribution with all computed fields
 *  7. db.updateFullSnapshot() — stores RouteDistributionData JSONB blob
 *  8. revalidate() — flushes ISR cache for this route when page is visible
 *
 * The no-op revalidate is passed to ingestAgentSession() so that revalidation
 * happens AFTER the full snapshot is stored (not with empty JSONB).
 */

import { normalizeSession, type RawSearchPayload } from './normalizer.ts'
import { ingestAgentSession } from './offer-ingest.ts'
import { getRouteDistributionData } from '../distribution/distribution-service.ts'
import { buildOfferHighlights, buildAmenitySummary } from './offer-highlights.ts'
import { generateLlmRationale } from './llm-rationale.ts'
import type { NeonAdapter } from '../db/neon-adapter.ts'
import type { PageStatus } from '../types/route-distribution.types.ts'

/** Revalidation function injected for testability. */
export type RevalidateFn = (routeSlug: string) => Promise<void>

/**
 * Trigger the PFP ingest pipeline for a completed search session.
 *
 * @param raw        Raw FSW payload (Python SDK format).
 * @param db         Neon adapter instance.
 * @param revalidate Optional revalidate function override (defaults to real ISR call).
 */
export async function triggerPfpIngest(
  raw: RawSearchPayload,
  db: NeonAdapter,
  revalidate?: RevalidateFn,
): Promise<void> {
  try {
    // 1. Normalize
    const session = normalizeSession(raw)

    // 2. Core ingest (no-op revalidate — we revalidate after full snapshot is stored)
    await ingestAgentSession(session, {
      db,
      revalidate: async () => {},
      emit: () => {},
    })

    // 3. Look up the route to get its ID and current status
    const route = await db.findRouteByIata(session.originIata, session.destIata)
    if (!route) return

    const routeSlug = `${session.originIata.toLowerCase()}-${session.destIata.toLowerCase()}`

    // 4. Build offer highlights and amenity summary from session offers
    const currency = session.targetCurrency || 'EUR'
    const offerHighlights = buildOfferHighlights(session.offers, currency)
    const amenitySummary = buildAmenitySummary(session.offers, currency)

    // 5. Compute full RouteDistributionData
    const routeMeta = {
      originIata: session.originIata,
      destIata: session.destIata,
      originCity: session.originCity,
      destCity: session.destCity,
      pageStatus: route.pageStatus as PageStatus,
      sessionCount: 1,
      snapshotComputedAt: new Date().toISOString(),
    }
    const distribution = getRouteDistributionData([session], routeMeta)

    // 6. Generate LLM rationale (fire-and-forget failure is fine)
    const llmRationale = await generateLlmRationale(distribution)

    // 7. Attach rich fields to distribution before storing
    const enrichedDistribution = {
      ...distribution,
      offer_highlights: offerHighlights.length > 0 ? offerHighlights : undefined,
      llm_rationale: llmRationale ?? undefined,
      amenity_summary: amenitySummary ?? undefined,
    }

    // 8. Store the full snapshot
    await db.updateFullSnapshot(route.id, enrichedDistribution)

    // 9. Revalidate ISR if page is visible to crawlers
    const currentStatus = await db.getCurrentPageStatus(route.id)
    if (currentStatus === 'published' || currentStatus === 'noindex') {
      if (revalidate) {
        await revalidate(routeSlug)
      } else {
        // Lazy import so the module isn't loaded in test/non-server contexts
        const { revalidateFlightRoute } = await import('../revalidate.ts')
        await revalidateFlightRoute(routeSlug)
      }
    }
  } catch {
    // Never propagate — ingest is best-effort, never blocks search results
  }
}
