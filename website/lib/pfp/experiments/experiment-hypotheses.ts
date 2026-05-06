/**
 * experiment-hypotheses.ts — experiment definitions for Programmatic Flight Pages.
 *
 * Each experiment defines:
 * - Which feature flag it controls
 * - The variants and their traffic allocation (must sum to 100)
 * - The scientific hypothesis
 * - Guardrail metrics that MUST NOT regress
 * - Minimum sample size and duration
 *
 * How to ship a winner:
 * 1. Let the experiment run to min_sample and duration.
 * 2. Validate primary metric improvement + no guardrail regressions.
 * 3. Update DEFAULT_FLAGS[experiment.key] to the winning variant's value.
 * 4. Delete the ExperimentHypothesis or mark it complete.
 *
 * No code change to flight pages is needed to ship the winner.
 */

import type { FlightPageFlags } from './flags.types.ts'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VariantDefinition<T = string | number | boolean> {
  /** Unique variant key (used in variant_id field on analytics events). */
  key: string
  /** The flag value applied to sessions in this variant. */
  value: T
  /** Traffic allocation as integer percentage (0–100). All variants must sum to 100. */
  traffic_pct: number
  /** Human label for reporting dashboards. */
  label: string
}

export interface ExperimentDefinition<K extends keyof FlightPageFlags = keyof FlightPageFlags> {
  /** The feature flag key this experiment controls. */
  key: K
  /** Human-readable experiment name. */
  name: string
  /** Falsifiable hypothesis statement. */
  hypothesis: string
  /** Variants. Traffic allocations must sum to 100. */
  variants: VariantDefinition<FlightPageFlags[K]>[]
  /**
   * Minimum sample per variant before declaring a result.
   * Size estimates from power analysis (80% power, α=0.05, ΔMDE=5%).
   */
  min_sample_per_variant: number
  /** Minimum calendar days to run before declaring a result. */
  duration_days: number
  /** Primary success metric — what we're trying to improve. */
  primary_metric: string
  /**
   * Guardrail metrics — if ANY regress by more than their allowed_regression_pct,
   * the experiment is considered a regression even if the primary metric improves.
   */
  guardrail_metrics: Array<{
    metric: string
    allowed_regression_pct: number
  }>
}

// ─── Experiment: hero CTA copy ────────────────────────────────────────────────

export const EXPERIMENT_HERO_CTA: ExperimentDefinition<'flight_pages.hero_cta_copy'> = {
  key: 'flight_pages.hero_cta_copy',
  name: 'Hero CTA Copy Test',
  hypothesis:
    'Showing "expose_hidden_fees" framing in the hero CTA will increase CTR compared to ' +
    'the generic "search_now" copy by surfacing a concrete value proposition (price transparency).',
  variants: [
    {
      key: 'ctrl',
      value: 'search_now',
      traffic_pct: 34,
      label: 'Control — Search Now',
    },
    {
      key: 'a',
      value: 'expose_hidden_fees',
      traffic_pct: 33,
      label: 'A — Expose Hidden Fees',
    },
    {
      key: 'b',
      value: 'search_all_carriers',
      traffic_pct: 33,
      label: 'B — Search All Carriers',
    },
  ],
  min_sample_per_variant: 1000,
  duration_days: 14,
  primary_metric: 'flight_page_cta_clicked rate',
  guardrail_metrics: [
    { metric: 'bounce_rate', allowed_regression_pct: 10 },
    { metric: 'flight_page_viewed p50_time_on_page_ms', allowed_regression_pct: 15 },
  ],
}

// ─── Experiment: hero primary stat ───────────────────────────────────────────

export const EXPERIMENT_HERO_STAT: ExperimentDefinition<'flight_pages.hero_primary_stat'> = {
  key: 'flight_pages.hero_primary_stat',
  name: 'Hero Primary Stat Test',
  hypothesis:
    'Showing "hidden_fees_pct" as the primary hero stat will increase CTR vs "price_range" ' +
    'by anchoring users on a concrete saving percentage rather than an absolute price range.',
  variants: [
    {
      key: 'ctrl',
      value: 'price_range',
      traffic_pct: 34,
      label: 'Control — Price Range',
    },
    {
      key: 'a',
      value: 'hidden_fees_pct',
      traffic_pct: 33,
      label: 'A — Hidden Fees %',
    },
    {
      key: 'b',
      value: 'carrier_count',
      traffic_pct: 33,
      label: 'B — Carrier Count',
    },
  ],
  min_sample_per_variant: 1500,
  duration_days: 14,
  primary_metric: 'flight_page_cta_clicked rate',
  guardrail_metrics: [
    { metric: 'flight_page_section_viewed / flight_page_viewed (depth ratio)', allowed_regression_pct: 10 },
  ],
}
