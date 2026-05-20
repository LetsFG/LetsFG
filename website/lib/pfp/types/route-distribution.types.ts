/**
 * route-distribution.types.ts — output types for the DistributionService.
 *
 * RouteDistributionData is the canonical object consumed by the flight page
 * template. It is built by getRouteDistributionData() from raw DB session data
 * and represents the full market picture for a single directional route.
 *
 * Content differentiation rationale:
 *   Competitors (Kayak, Google Flights, Expedia) show a single price or average.
 *   We show the DISTRIBUTION of the entire market as captured by our 180+
 *   connector agents — including the spread, carrier comparison, and connector
 *   comparison that no single-source tool can provide.
 */

// ─── Primitives ───────────────────────────────────────────────────────────────

/**
 * How confident we are in the data quality.
 * Determined by total_offers_analyzed:
 *   'high'   ≥ 100 offers — enough for stable percentiles and rich distribution
 *   'medium' 40–99 offers — reasonable distribution, some statistical variance
 *   'low'    < 40 offers  — thin data, show with appropriate caveats
 */
export type DataConfidence = 'high' | 'medium' | 'low'

/**
 * How fresh the snapshot is relative to now.
 *   'fresh'  < 24 h — same-day data, highly reliable
 *   'recent' 24 h–7 d — within a week, generally reliable for planning
 *   'stale'  > 7 d — older data, may not reflect current market
 */
export type Staleness = 'fresh' | 'recent' | 'stale'

/**
 * How much the hidden fee burden varies across carriers.
 * Computed from the coefficient of variation (CV) of total per-offer fees.
 *   'low'    CV < 0.2 — carriers charge similar fees (or none)
 *   'medium' CV 0.2–0.5 — moderate fee variation across carriers
 *   'high'   CV > 0.5 — significant fee variation (carriers behave very differently)
 */
export type FeeVariance = 'low' | 'medium' | 'high'

export type PageStatus = 'draft' | 'published' | 'noindex' | 'archived'

// ─── Price distribution ───────────────────────────────────────────────────────

/** One bucket in the price histogram. All counts relate to this route's offers. */
export interface HistogramBucket {
  /** Lower bound of this bucket (inclusive). */
  from: number
  /** Upper bound of this bucket (exclusive, except for the last bucket). */
  to: number
  /** Number of offers that fall in this price range. */
  count: number
  /** Percentage of total offers in this bucket (0–100, sums to ~100 across all buckets). */
  pct: number
}

export interface PriceDistribution {
  /** 10th percentile price. */
  p10: number
  /** 25th percentile price. */
  p25: number
  /** Median price (50th percentile). */
  p50: number
  /** 75th percentile price. */
  p75: number
  /** 90th percentile price. */
  p90: number
  /** 95th percentile price. */
  p95: number
  /** Cheapest offer found. */
  min: number
  /** Most expensive offer found. */
  max: number
  /** Equal-width histogram buckets (default: 10 buckets). */
  histogram: HistogramBucket[]
  /** ISO 4217 currency code for all price values in this distribution. */
  currency: string
  /**
   * Whether the price distribution shows two distinct clusters.
   * True when there are two significant histogram peaks separated by a deep valley —
   * typically indicating a budget/LCC cluster and a full-service/FSC cluster.
   */
  is_bimodal: boolean
  /**
   * Human-readable explanation of the bimodal split.
   * Only present when is_bimodal is true.
   * Example: "Two fare clusters: budget fares around EUR 850, premium fares around EUR 3100"
   */
  bimodal_insight?: string
}

// ─── Fee analysis ─────────────────────────────────────────────────────────────

/** Per-carrier fee breakdown entry. */
export interface FeeBreakdownItem {
  /** Carrier IATA code. */
  carrier: string
  /** Average total ancillary fee (bags + seat) across this carrier's offers. */
  avg_fee: number
  /** Average fee as a fraction of the carrier's median base fare (0.0–1.0+). */
  avg_fee_pct: number
}

export interface FeeAnalysis {
  /**
   * Average total ancillary fee per offer across all carriers that reported fee data.
   * null when no connector in this session exposed fee data.
   */
  avg_hidden_fees_amount: number | null
  /**
   * Average fee as a fraction of base price (0.0–1.0+).
   * null when avg_hidden_fees_amount is null.
   */
  avg_hidden_fees_pct: number | null
  /**
   * How much hidden fee levels vary across carriers.
   * 'low' when no fee data is available (nothing to vary about).
   */
  fee_variance: FeeVariance
  /**
   * Whether any connector returned detailed bag/ancillary pricing data.
   * When false, breakdown is absent and hidden fee values are null.
   * Only ~15-20 of our 180+ connectors expose this data.
   */
  fee_breakdown_available: boolean
  /** Per-carrier breakdown. Present only when fee_breakdown_available is true. */
  breakdown?: FeeBreakdownItem[]
}

// ─── Carrier summary ──────────────────────────────────────────────────────────

/** Summary stats for one airline on this route. */
export interface CarrierSummaryItem {
  /** Airline IATA code. */
  carrier: string
  /** Number of offers from this carrier across all indexed sessions. */
  offer_count: number
  /** Median price for this carrier's offers (in distribution currency). */
  price_p50: number
  /**
   * Average total ancillary fee for this carrier's offers.
   * null when the carrier's connector(s) don't expose fee data.
   */
  hidden_fees_avg: number | null
  /**
   * Average fee as fraction of base fare (0.0–1.0+).
   * null when hidden_fees_avg is null.
   */
  hidden_fees_pct: number | null
}

// ─── Connector comparison ─────────────────────────────────────────────────────

/**
 * Price comparison across different connectors (booking channels) for this route.
 *
 * This is unique editorial value: users learn which search channel tends to
 * surface the cheapest fares — e.g., "direct airline site is 12% cheaper than
 * OTAs on this route". No single-source tool can provide this insight.
 */
export interface ConnectorComparisonItem {
  /**
   * Connector identifier.
   * Suffix conventions: _direct = airline website, _ota = OTA, _meta = meta-search
   * Examples: 'ryanair_direct', 'skyscanner_meta', 'kiwi_connector'
   */
  connector_name: string
  /**
   * Human-readable display name for this connector.
   * Never contains underscores. Examples: 'Ryanair (direct)', 'Kiwi.com', 'Skyscanner'
   */
  display_name: string
  /**
   * What types of carriers this connector tends to cover.
   * 'budget_only' — mostly LCCs; 'premium_only' — mostly FSCs; 'mixed' — both
   */
  carrier_coverage_type: 'budget_only' | 'premium_only' | 'mixed'
  /** Number of offers from this connector across all indexed sessions. */
  offer_count: number
  /** Median price for offers sourced from this connector. */
  price_p50: number
  /**
   * How this connector's median compares to the average across all connectors.
   * delta = (this_connector_p50 - avg_of_all_connector_p50s) / avg_of_all_connector_p50s * 100
   * Negative = cheaper than average; Positive = more expensive than average.
   * Example: -12.3 means "12% cheaper than average across all connectors searched"
   */
  delta_vs_avg_pct: number
}

// ─── TLDR ─────────────────────────────────────────────────────────────────────

export interface TldrSection {
  /**
   * One-sentence summary of the route's fare landscape.
   * Must contain: route identifiers (IATA codes or city names), cheapest price,
   * median price, and total offer count.
   * Example: "GDN → BCN: from EUR 100, median EUR 369, 180 offers analyzed"
   */
  summary: string
  /**
   * Exactly 3 human-readable facts about the route.
   * Each fact MUST contain at least one number and at least one date (YYYY-MM-DD).
   * Used for the page's "key facts" section — scannable at a glance.
   */
  key_facts: [string, string, string]
}

// ─── Root type ────────────────────────────────────────────────────────────────

/**
 * The full distribution dataset for one directional route's flight page.
 *
 * Built by getRouteDistributionData() from indexed agent session data.
 * Consumed by the page template (Session 4).
 */
export interface RouteDistributionData {
  // ── Route metadata ──────────────────────────────────────────────────────────
  origin_iata: string
  dest_iata: string
  origin_city: string
  dest_city: string

  // ── Snapshot metadata ───────────────────────────────────────────────────────
  /** ISO 8601 datetime when this snapshot was last computed. */
  snapshot_computed_at: string
  /** How old the snapshot is relative to now. */
  staleness: Staleness

  // ── Data quality ────────────────────────────────────────────────────────────
  data_confidence: DataConfidence
  /** Total number of individual offers analyzed to build this snapshot. */
  total_offers_analyzed: number
  /** Number of agent search sessions that contributed to this snapshot. */
  session_count: number

  // ── Distributions ───────────────────────────────────────────────────────────
  price_distribution: PriceDistribution
  fee_analysis: FeeAnalysis
  /** Per-carrier price summary, sorted by price_p50 ascending. */
  carrier_summary: CarrierSummaryItem[]
  /** Per-connector price comparison, sorted by price_p50 ascending. */
  connector_comparison: ConnectorComparisonItem[]

  // ── Editorial summary ───────────────────────────────────────────────────────
  tldr: TldrSection

  // ── Page metadata ───────────────────────────────────────────────────────────
  page_status: PageStatus
  /**
   * Always true — indicates this data is preview-quality.
   * The page template should show a "data is continuously updated" notice.
   */
  is_preview: true

  // ── Session history ─────────────────────────────────────────────────────────
  /** Optional chronological history of search sessions for this route. */
  session_history?: SessionSnapshot[]
  /** ISO 8601 datetime of the very first session captured for this route. */
  first_session_at?: string
  /**
   * Optional list of related routes for internal linking.
   * Populated by the ingest pipeline from top co-searched routes.
   */
  related_routes?: RelatedRoute[]

  // ── Rich offer data (Session 8+) ─────────────────────────────────────────────
  /**
   * Representative best offers per carrier — shown as offer cards on the page,
   * giving visitors results-page-level detail without storing individual offers.
   * Absent when offers lacked duration/stops data (rare edge case).
   */
  offer_highlights?: OfferHighlight[]

  /**
   * AI-generated route analysis framed for general visitors (not the specific
   * searcher who triggered page creation). Absent when ANTHROPIC_API_KEY is
   * not configured or the API call failed.
   */
  llm_rationale?: LlmRationale

  /**
   * Per-carrier amenity pricing table.
   * Absent when no connector in the session exposed bag/seat pricing.
   */
  amenity_summary?: AmenitySummary

  /** PFP acquisition analytics. Populated by growth-ops cron, absent on first publish. */
  acquisition_meta?: PfpAcquisitionMeta
}

export interface SessionSnapshot {
  session_id: string
  captured_at: string
  total_offers: number
  median_price: number
  currency: string
  airline_count?: number
  connector_count?: number
}

export interface RelatedRoute {
  origin_iata: string
  dest_iata: string
  origin_city: string
  dest_city: string
  /** Median price from the related route's snapshot, if available. */
  median_price?: number
  currency?: string
}

// ─── Offer highlights ─────────────────────────────────────────────────────────

/**
 * Departure time bucket — coarse classification so pages aren't tied to a
 * specific departure time from one search session.
 */
export type DepartureTimeBucket = 'early_morning' | 'morning' | 'afternoon' | 'evening' | 'night' | 'varies'

/**
 * Representative best-offer data for one carrier on this route.
 *
 * Built from the raw offers at ingest time and stored in full_snapshot_json.
 * Shown on the flight page instead of a bare carrier-name table, giving
 * visitors offer-level detail (duration, stops, amenities) without storing
 * individually identifiable offer data.
 */
export interface OfferHighlight {
  /** Carrier IATA code, e.g. 'FR'. */
  carrier: string
  /** Human-readable airline name, e.g. 'Ryanair'. */
  carrier_name: string
  /** Lowest price seen for this carrier (normalized to page currency). */
  best_price: number
  /** ISO 4217 currency code matching best_price. */
  currency: string
  /** Minimum outbound duration in minutes across this carrier's offers. */
  duration_min_minutes: number
  /** Maximum outbound duration in minutes across this carrier's offers. */
  duration_max_minutes: number
  /** Whether any of this carrier's offers are direct (0 stops). */
  direct_available: boolean
  /** Minimum number of stops seen across this carrier's offers. */
  min_stops: number
  /** Coarse departure time classification for the cheapest offer. */
  departure_time_bucket: DepartureTimeBucket
  /** Number of offers analyzed for this carrier. */
  offer_count: number
  /** Cabin class of the best-price offer. */
  cabin_class: string
  /** Carry-on / cabin bag fee. null = not available from this carrier's connectors. */
  bags_carry_on_price: number | null
  /** First checked-bag fee. null = not available. */
  bags_checked_price: number | null
  /** Seat selection fee. null = not available. */
  seat_price: number | null
  /**
   * True when bags_carry_on_price === 0 or bags_checked_price === 0,
   * meaning the connector explicitly reported the fee as included.
   */
  bags_included: boolean
  /** Refund policy. null = connector didn't expose this. */
  refund_policy: 'allowed' | 'not_allowed' | 'allowed_with_fee' | 'unknown' | null
  /** Best connector to book through for this carrier (display name). */
  best_booking_channel: string
}

// ─── LLM rationale ───────────────────────────────────────────────────────────

/**
 * AI-generated contextual analysis of the route's fare landscape.
 *
 * Written once at ingest time, stored in full_snapshot_json. Framed for a
 * general visitor — NOT personalized to the specific searcher who triggered
 * the page creation.
 */
export interface LlmRationale {
  /**
   * 1–2 sentence value proposition for the route.
   * Example: "GDN → BCN is a budget-friendly short-haul route dominated by
   * Ryanair and Wizz Air, typically pricing 30–50% below European average."
   */
  value_proposition: string
  /**
   * 2–3 traveler profiles that will find this route most useful.
   * Example: ["Weekend city-breakers", "Price-sensitive leisure travelers"]
   */
  best_for: string[]
  /**
   * 1–2 sentence actionable booking tips derived from the distribution data.
   * Must reference actual price points or patterns in the data.
   */
  booking_tips: string
  /**
   * 1 sentence comparing this route's price level to broader market context.
   * Must be data-grounded (reference p50 or range).
   */
  price_context: string
  /** Model that generated this rationale, e.g. 'claude-haiku-4-5'. */
  model: string
  /** ISO 8601 timestamp when this rationale was generated. */
  generated_at: string
}

// ─── Amenity summary ─────────────────────────────────────────────────────────

/** Per-carrier amenity pricing row for the amenities table. */
export interface AmenityRow {
  carrier: string
  carrier_name: string
  /** Carry-on price. null = connector didn't expose. 0 = included in fare. */
  carry_on: number | null
  /** Checked bag price. null = not available. 0 = included. */
  checked_bag: number | null
  /** Seat selection price. null = not available. 0 = included. */
  seat_selection: number | null
  /** ISO 4217 currency for the prices. */
  currency: string
}

/**
 * Structured amenity pricing across all carriers that reported fee data.
 * Only present when at least one carrier exposed bag/seat pricing.
 */
export interface AmenitySummary {
  rows: AmenityRow[]
  currency: string
  /** ISO 8601 timestamp of the session this data comes from. */
  captured_at: string
}

// ─── Acquisition metadata ────────────────────────────────────────────────────

/**
 * Analytics metadata added to RouteDistributionData for tracking PFP as an
 * acquisition channel. Populated from the growth model and analytics pipeline.
 * Optional — absent on first publish, updated by growth-ops cron.
 */
export interface PfpAcquisitionMeta {
  /** Total searches that were triggered by clicking the CTA on this page. */
  total_searches_from_page: number
  /** Click-through rate: searches / page_views (0.0–1.0). */
  search_ctr: number
  /** ISO 8601 date of the last time these stats were computed. */
  last_computed_at: string
}
