/**
 * tracker.ts — typed event tracking wrapper for Programmatic Flight Pages.
 *
 * All interactions on flight pages MUST use createTracker().trackEvent().
 * Never call gtag() directly — use this wrapper to:
 *   1. Enforce type safety on event names and properties.
 *   2. Automatically attach shared context (route, variant_id, session_id).
 *   3. Route events to both GA4 and our internal pipeline.
 *   4. Support server-side tracking via Measurement Protocol.
 *
 * Usage (browser):
 *   const tracker = createTracker({ route, variant_id, session_id })
 *   tracker.trackEvent('flight_page_cta_clicked', { cta_position: 'hero_primary', ... })
 *
 * Usage (server / RSC):
 *   const tracker = createTracker({ route, variant_id, session_id, send: serverSend })
 *   tracker.trackEvent('flight_page_generated', { trigger: 'new_route', ... })
 */

import type { FlightPageEvents, FlightPageEventName } from './events.types.ts'

// ─── Re-exports for convenience ───────────────────────────────────────────────

export type { FlightPageEvents, FlightPageEventName }

// ─── Context + types ──────────────────────────────────────────────────────────

/** Shared context attached to every event — injected by the wrapper, not per-call. */
export interface TrackerContext {
  /** Route identifier, e.g. "GDN-BCN". */
  route: string
  /** Experiment variant ID for the current session. */
  variant_id: string
  /** Anonymized session identifier. */
  session_id: string
  /**
   * Custom send function. Defaults to the browser GA4 gtag() + internal pipeline.
   * Override in tests or server-side contexts.
   */
  send?: (event: string, properties: Record<string, unknown>) => void
}

export interface FlightPageTracker {
  trackEvent<T extends FlightPageEventName>(
    event: T,
    properties: FlightPageEvents[T],
  ): void
}

// ─── Internal: default browser send ──────────────────────────────────────────

/**
 * Default send function used in the browser.
 * Sends to both GA4 (via window.gtag if available) and our internal API.
 *
 * NOTE: This function is the ONLY place in the codebase allowed to call gtag().
 * All feature code must go through createTracker().trackEvent().
 */
function defaultBrowserSend(event: string, properties: Record<string, unknown>): void {
  // GA4 — only in browser context
  if (typeof window !== 'undefined') {
    const g = (window as unknown as Record<string, unknown>)['gtag']
    if (typeof g === 'function') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(g as (...args: unknown[]) => void)('event', event, properties)
    }
  }

  // Internal pipeline — fire-and-forget, never throw
  if (typeof fetch !== 'undefined') {
    fetch('/api/analytics/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, properties }),
    }).catch(() => {
      // Silently suppress — analytics must never break the page
    })
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a tracker instance for a specific page context.
 * The route, variant_id, and session_id are attached to every event automatically.
 */
export function createTracker(context: TrackerContext): FlightPageTracker {
  const { route, variant_id, session_id, send = defaultBrowserSend } = context

  return {
    trackEvent<T extends FlightPageEventName>(
      event: T,
      properties: FlightPageEvents[T],
    ): void {
      const fullProperties: Record<string, unknown> = {
        // Shared context injected here — callers don't need to pass these
        route,
        variant_id,
        session_id,
        // Per-event properties
        ...(properties as Record<string, unknown>),
      }

      try {
        send(event, fullProperties)
      } catch {
        // Silently suppress — analytics must never break the page
      }
    },
  }
}
