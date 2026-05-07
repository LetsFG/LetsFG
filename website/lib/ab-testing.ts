/**
 * Lightweight client-side A/B testing.
 *
 * Variant assignment is deterministic and stable per user per experiment:
 *   bucket = hash(experimentId + ":" + userId) → [0, 1)
 *
 * User ID resolution order (browser only):
 *   1. Cookie `__session`
 *   2. Cookie `lfg_uid`
 *   3. localStorage `lfg_ab_uid` (auto-created UUID on first visit)
 *
 * Usage:
 *   // Define once at module level (stable reference, no recreations)
 *   const MY_EXPERIMENT: ExperimentConfig<'control' | 'treatment'> = {
 *     id: 'my-experiment-v1',
 *     variants: { control: 0.5, treatment: 0.5 },
 *   }
 *
 *   // Inside a component
 *   const { variant } = useExperiment(MY_EXPERIMENT, searchId)
 *   if (variant === 'treatment') { ... }
 */

'use client'

import { useState, useEffect, useRef } from 'react'
import { trackSearchSessionEvent } from './search-session-analytics'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ExperimentConfig<Variants extends string> {
  /**
   * Unique experiment ID — should match the ExperimentCard id in growth-ops
   * (e.g. 'checkout-objection-survey-v1').
   */
  id: string
  /**
   * Variant name → traffic fraction. Must sum to 1.0.
   * The first key (declaration order) is the control variant.
   *
   * @example { control: 0.5, survey: 0.5 }
   */
  variants: Record<Variants, number>
}

export interface UseExperimentResult<Variants extends string> {
  /**
   * The assigned variant name, or `null` before first render (SSR / hydration).
   * Guard with `if (variant === null) return null` when rendering variant-specific UI.
   */
  variant: Variants | null
  /** True when the user is in the first-declared (control) variant, or before mount. */
  isControl: boolean
}

// ── Internal helpers ───────────────────────────────────────────────────────────

/** djb2-inspired hash → deterministic float in [0, 1). */
function hashToFloat(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  }
  return (h >>> 0) / 4294967296
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${encodeURIComponent(name)}=([^;]*)`))
  return match ? decodeURIComponent(match[1] ?? '') : null
}

const AB_UID_KEY = 'lfg_ab_uid'

/**
 * Returns a stable user ID for bucketing.
 * Tries cookies first (so server-set IDs are respected), then localStorage.
 */
function getOrCreateAbUid(): string {
  try {
    const fromCookie = readCookie('__session') ?? readCookie('lfg_uid')
    if (fromCookie && fromCookie.length > 0) return fromCookie

    const stored = localStorage.getItem(AB_UID_KEY)
    if (stored && stored.length > 0) return stored

    const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36)

    try { localStorage.setItem(AB_UID_KEY, id) } catch { /* quota / private mode */ }
    return id
  } catch {
    // Private mode, storage blocked, etc. — non-persistent random value.
    return Math.random().toString(36).slice(2)
  }
}

// ── Core bucketing ─────────────────────────────────────────────────────────────

/**
 * Assigns a variant for `userId` given the experiment config.
 * Deterministic: same (experimentId, userId) always returns the same variant.
 */
export function assignVariant<Variants extends string>(
  config: ExperimentConfig<Variants>,
  userId: string,
): Variants {
  const bucket = hashToFloat(`${config.id}:${userId}`)
  let cumulative = 0
  for (const [variant, allocation] of Object.entries(config.variants) as [Variants, number][]) {
    cumulative += allocation
    if (bucket < cumulative) return variant
  }
  // Rounding safety: fall back to first variant
  return Object.keys(config.variants)[0] as Variants
}

// ── Cross-experiment combo tracking ───────────────────────────────────────────

/**
 * Module-level registry: experimentId → variant.
 * Populated by every useExperiment call on this page load.
 * Used to fire `experiments_combo` so we can see which users are in multiple
 * experiments simultaneously and avoid confounded conclusions.
 */
const _activeAssignments = new Map<string, string>()
let _comboSearchId: string | null | undefined = null

function _fireComboEvent() {
  if (_activeAssignments.size < 1) return
  const combo = Object.fromEntries(_activeAssignments)
  trackSearchSessionEvent(_comboSearchId, 'experiments_combo', {
    active_experiments: combo,
    count: _activeAssignments.size,
  })
}

// ── React hook ─────────────────────────────────────────────────────────────────

/**
 * Stable, per-user variant assignment for a React component.
 *
 * - Returns `null` on the server / first render to avoid hydration mismatches.
 * - Fires a single `experiment_assigned` analytics event on first exposure.
 * - Also fires/refreshes `experiments_combo` with ALL active assignments so
 *   cross-experiment overlap is queryable.
 *
 * @param config  Module-level constant (defined outside the component).
 * @param searchId  Current search session ID for analytics attribution.
 */
export function useExperiment<Variants extends string>(
  config: ExperimentConfig<Variants>,
  searchId: string | null | undefined,
): UseExperimentResult<Variants> {
  const [variant, setVariant] = useState<Variants | null>(null)
  const trackedRef = useRef(false)
  const experimentId = config.id
  const controlVariant = Object.keys(config.variants)[0] as Variants

  useEffect(() => {
    const uid = getOrCreateAbUid()
    // localStorage force-variant for QA/preview: localStorage.setItem('fv_<id>', '<variant>')
    const forced = window.localStorage.getItem(`fv_${experimentId}`)
    const validVariants = Object.keys(config.variants)
    const assigned = (forced && validVariants.includes(forced))
      ? (forced as Variants)
      : assignVariant(config, uid)
    setVariant(assigned)

    if (!trackedRef.current) {
      trackedRef.current = true
      trackSearchSessionEvent(searchId, 'experiment_assigned', {
        experiment_id: experimentId,
        variant: assigned,
      })
      // Register in global combo map and re-fire the combo event
      _activeAssignments.set(experimentId, assigned)
      _comboSearchId = searchId
      _fireComboEvent()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [experimentId, searchId])

  return {
    variant,
    isControl: variant === null || variant === controlVariant,
  }
}
