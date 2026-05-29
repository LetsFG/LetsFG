/**
 * Recommendation quality scoring for the growth model.
 *
 * Produces a composite 0-100 quality score for each search result set,
 * fired as a `recommendation_quality_assessed` analytics event before
 * the user sees results. This lets us measure recommendation quality
 * even when users don't select anything — the unbiased quality signal.
 *
 * Score weights (calibrated against unlock rate; revisit after 2 weeks of data):
 *   result_count  30%
 *   price_vs_google  40%
 *   carrier_diversity  20%
 *   speed  10%
 */

export interface QualityScoreInput {
  result_count: number
  carrier_diversity: number
  /** (google_price - our_best) / google_price × 100. Positive = we beat google.
   *  Null when no google price is available — treated as neutral (50%). */
  price_vs_google_pct: number | null
  search_duration_ms: number
}

export interface RecommendationQualityInput {
  search_id: string
  result_count: number
  connector_count: number
  has_direct_flight: boolean
  min_stops: number
  carrier_diversity: number
  cheapest_price: number | null
  google_flights_price: number | null
  search_duration_ms: number
}

export interface RecommendationQualityPayload {
  search_id: string
  result_count: number
  connector_count: number
  top3_present: boolean
  price_vs_google_pct: number | null
  quality_score: number
  has_direct_flight: boolean
  min_stops: number
  carrier_diversity: number
}

/**
 * Compute the composite quality score (0–100) from raw search metrics.
 */
export function computeQualityScore(input: QualityScoreInput): number {
  const { result_count, carrier_diversity, price_vs_google_pct, search_duration_ms } = input

  if (result_count === 0) return 0

  // result_count_score: 0 → 0, 10+ → 100 (linear)
  const result_count_score = Math.min(result_count / 10, 1) * 100

  // price_score: positive pct → 100, -20% or worse → 0, null → 50 (neutral)
  let price_score: number
  if (price_vs_google_pct === null) {
    price_score = 50
  } else if (price_vs_google_pct >= 0) {
    price_score = 100
  } else {
    // -20% → 0, 0% → 100, linear between
    price_score = Math.max(0, (price_vs_google_pct + 20) / 20) * 100
  }

  // diversity_score: 0 → 0, 5+ → 100 (linear)
  const diversity_score = Math.min(carrier_diversity / 5, 1) * 100

  // speed_score: < 5s → 100, > 30s → 0 (linear between 5s and 30s)
  let speed_score: number
  if (search_duration_ms < 5_000) {
    speed_score = 100
  } else if (search_duration_ms > 30_000) {
    speed_score = 0
  } else {
    speed_score = (1 - (search_duration_ms - 5_000) / 25_000) * 100
  }

  const composite =
    result_count_score * 0.3 +
    price_score * 0.4 +
    diversity_score * 0.2 +
    speed_score * 0.1

  return Math.round(Math.min(100, Math.max(0, composite)))
}

/**
 * Build the `recommendation_quality_assessed` event payload from a completed
 * search result set. Fired server-side before results are shown to the user.
 */
export function buildRecommendationQualityPayload(
  input: RecommendationQualityInput,
): RecommendationQualityPayload {
  const { cheapest_price, google_flights_price } = input

  let price_vs_google_pct: number | null = null
  if (google_flights_price != null && cheapest_price != null && google_flights_price > 0) {
    price_vs_google_pct = Math.round(
      ((google_flights_price - cheapest_price) / google_flights_price) * 100,
    )
  }

  const quality_score = computeQualityScore({
    result_count: input.result_count,
    carrier_diversity: input.carrier_diversity,
    price_vs_google_pct,
    search_duration_ms: input.search_duration_ms,
  })

  return {
    search_id: input.search_id,
    result_count: input.result_count,
    connector_count: input.connector_count,
    top3_present: input.result_count >= 3,
    price_vs_google_pct,
    quality_score,
    has_direct_flight: input.has_direct_flight,
    min_stops: input.min_stops,
    carrier_diversity: input.carrier_diversity,
  }
}
