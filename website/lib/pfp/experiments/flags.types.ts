/**
 * flags.types.ts — feature flag type definitions for Programmatic Flight Pages.
 *
 * All PFP feature flags are defined here with their default values.
 * Use resolveExperimentContext() to get the effective flag values for a session.
 *
 * Growth Ops Checklist:
 * - [ ] Feature is behind a flag in FlightPageFlags
 * - [ ] Flag has ExperimentHypothesis OR comment // ROLLOUT_ONLY: {reason}
 * - [ ] All user interactions use trackEvent() — no raw gtag() anywhere
 * - [ ] variant_id attached to every analytics event
 * - [ ] Guardrail metrics defined before experiment starts
 * - [ ] Winning variant ships by changing flag default only — no code change required
 */

// ─── Flag map ─────────────────────────────────────────────────────────────────

export type FlightPageFlags = {
  /**
   * Master kill switch for the entire PFP feature.
   * ROLLOUT_ONLY: gradual rollout guard — set to false to disable all PFP pages.
   */
  'flight_pages.enabled': boolean

  /**
   * Whether the ingest pipeline should index new agent search sessions.
   * ROLLOUT_ONLY: set to false to pause indexing without unpublishing pages.
   */
  'flight_pages.ingest_enabled': boolean

  /**
   * Minimum offer count required to pass the ContentQualityGate.
   * ROLLOUT_ONLY: tunable without code change.
   */
  'flight_pages.min_offers_threshold': number

  /**
   * Offer count threshold for fast-tracking to 'published' status.
   * Routes meeting this AND carrier/connector thresholds skip the CONDITIONAL_PASS step.
   */
  'flight_pages.fast_track_offer_count': number

  /** Carrier count threshold for fast-track publishing. */
  'flight_pages.fast_track_carrier_count': number

  /** Connector count threshold for fast-track publishing. */
  'flight_pages.fast_track_connector_count': number

  /**
   * Experiment: hero CTA copy variant.
   * See EXPERIMENT_HERO_CTA in experiment-hypotheses.ts.
   */
  'flight_pages.hero_cta_copy': 'search_now' | 'expose_hidden_fees' | 'search_all_carriers'

  /**
   * Experiment: primary stat shown in the hero stats row.
   * See EXPERIMENT_HERO_STAT in experiment-hypotheses.ts.
   */
  'flight_pages.hero_primary_stat': 'price_range' | 'hidden_fees_pct' | 'carrier_count'

  /**
   * Whether to show the full price histogram (high/medium confidence).
   * ROLLOUT_ONLY: set to false to hide histogram for A/B comparison if needed.
   */
  'flight_pages.show_histogram': boolean

  /**
   * Whether to show the connector comparison section.
   * ROLLOUT_ONLY: disable if connector data quality is insufficient.
   */
  'flight_pages.show_connector_comparison': boolean

  /**
   * Whether to show the "X community members searched this route" social proof counter.
   * ROLLOUT_ONLY: disable if session_count is too low to look credible.
   */
  'flight_pages.social_proof_counter': boolean

  /**
   * Number of FAQ items to render.
   * ROLLOUT_ONLY: test whether more FAQs improve SEO without hurting conversion.
   */
  'flight_pages.faq_count': 4 | 5 | 6 | 8

  /**
   * Whether the snapshot history <details> element is open by default.
   * ROLLOUT_ONLY: test whether transparent data provenance builds trust.
   */
  'flight_pages.history_default_open': boolean
}

// ─── Default values ───────────────────────────────────────────────────────────

export const DEFAULT_FLAGS: FlightPageFlags = {
  'flight_pages.enabled': true,
  'flight_pages.ingest_enabled': true,
  'flight_pages.min_offers_threshold': 15,
  'flight_pages.fast_track_offer_count': 40,
  'flight_pages.fast_track_carrier_count': 3,
  'flight_pages.fast_track_connector_count': 4,
  'flight_pages.hero_cta_copy': 'search_now',
  'flight_pages.hero_primary_stat': 'price_range',
  'flight_pages.show_histogram': true,
  'flight_pages.show_connector_comparison': true,
  'flight_pages.social_proof_counter': true,
  'flight_pages.faq_count': 5,
  'flight_pages.history_default_open': false,
}
