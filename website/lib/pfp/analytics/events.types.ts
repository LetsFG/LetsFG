/**
 * events.types.ts — typed flight page event taxonomy.
 *
 * All user-facing interactions and server-side lifecycle events are typed here.
 * Use trackEvent() from tracker.ts — never call gtag() directly.
 *
 * GA4 custom dimensions that need manual setup in GA4 console
 * (NOT auto-collected — must be registered as custom dimensions):
 *   - route             (event-scoped)
 *   - variant_id        (event-scoped)
 *   - data_confidence   (event-scoped)
 *   - staleness         (event-scoped)
 *   - is_bimodal        (event-scoped)
 *   - carrier_count     (event-scoped)
 *   - connector_count   (event-scoped)
 */

import type { DataConfidence, Staleness } from '../types/route-distribution.types.ts'

// ─── Event taxonomy ───────────────────────────────────────────────────────────

/**
 * All typed flight page events.
 *
 * Context fields (route, variant_id, session_id) are injected by the tracker
 * wrapper at call time — callers do NOT need to pass them per-call.
 */
export type FlightPageEvents = {
  /**
   * Fired once when the flight page component mounts.
   * Server-side: also sent via Measurement Protocol.
   */
  'flight_page_viewed': {
    data_confidence: DataConfidence
    staleness: Staleness
    offer_count: number
    carrier_count: number
    connector_count: number
    session_count: number
    is_bimodal: boolean
    page_status: string
    referrer_type: 'organic' | 'share' | 'direct' | 'paid' | 'internal'
  }

  /**
   * Fired when any CTA link/button is clicked.
   */
  'flight_page_cta_clicked': {
    cta_position: 'hero_primary' | 'secondary' | 'customize'
    cta_copy_variant: string
    scroll_depth_pct: number
    time_on_page_ms: number
    sections_viewed: string[]
  }

  /**
   * Fired when the share button is clicked.
   */
  'flight_page_share_clicked': {
    time_on_page_ms: number
  }

  /**
   * Fired when a page section enters the viewport.
   * Powered by IntersectionObserver in the browser component.
   */
  'flight_page_section_viewed': {
    section: string
    time_to_section_ms: number
  }

  /**
   * Fired when a FAQ item is expanded.
   */
  'flight_page_faq_expanded': {
    question_index: number
    question_slug: string
  }

  /**
   * Server-side: fired when a new flight page is generated or first published.
   */
  'flight_page_generated': {
    trigger: 'new_route' | 'quality_threshold_met' | 'manual'
    quality_score: number
    offer_count: number
    carrier_count: number
    connector_count: number
    publish_status: string
  }

  /**
   * Server-side: fired when the ContentQualityGate evaluates a session.
   */
  'flight_page_quality_gate_result': {
    result: 'PASS' | 'CONDITIONAL_PASS' | 'FAIL'
    score: number
    reason: string
    offer_richness_score: number
    carrier_diversity_score: number
    connector_diversity_score: number
  }

  /**
   * Server-side: fired when a route snapshot is revalidated.
   */
  'flight_page_revalidated': {
    trigger: 'new_session' | 'cron' | 'manual'
    previous_staleness: string
    offer_count_delta: number
  }
}

export type FlightPageEventName = keyof FlightPageEvents
