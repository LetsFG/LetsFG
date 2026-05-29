/**
 * Derives RecommendationQualityInput from the normalized offer array.
 *
 * Kept separate from the results API route to stay unit-testable without
 * spinning up Next.js. All derived fields are computed in pure functions.
 */

import type { RecommendationQualityInput } from './recommendation-quality.ts'

export interface OfferForQuality {
  price: number
  airline_code: string
  stops: number
}

export interface QualityInputContext {
  searchId: string
  googleFlightsPrice: number | null | undefined
  searchDurationMs: number
  /** Number of distinct connector/source feeds in the raw offer set. */
  connectorCount: number
}

/**
 * Derives a RecommendationQualityInput from a normalized offer slice.
 * Pass the context (search ID, google price, duration, connector count)
 * separately — those aren't derivable from individual offers.
 */
export function deriveQualityInput(
  offers: OfferForQuality[],
  ctx: QualityInputContext,
): RecommendationQualityInput {
  if (offers.length === 0) {
    return {
      search_id: ctx.searchId,
      result_count: 0,
      connector_count: ctx.connectorCount,
      has_direct_flight: false,
      min_stops: 0,
      carrier_diversity: 0,
      cheapest_price: null,
      google_flights_price: ctx.googleFlightsPrice ?? null,
      search_duration_ms: ctx.searchDurationMs,
    }
  }

  const airlineCodes = new Set(offers.map(o => o.airline_code).filter(Boolean))
  const stopsArr = offers.map(o => o.stops ?? 0)

  return {
    search_id: ctx.searchId,
    result_count: offers.length,
    connector_count: ctx.connectorCount,
    has_direct_flight: stopsArr.some(s => s === 0),
    min_stops: Math.min(...stopsArr),
    carrier_diversity: airlineCodes.size,
    cheapest_price: Math.min(...offers.map(o => o.price)),
    google_flights_price: ctx.googleFlightsPrice ?? null,
    search_duration_ms: ctx.searchDurationMs,
  }
}
