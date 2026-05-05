/**
 * experiment-context.ts — resolves feature flags and experiment variants
 * for a Programmatic Flight Page session.
 *
 * Design goals:
 * - Deterministic: same session_id → same variant, forever.
 * - Consistent: returning users see the same variant (DB lookup first).
 * - Safe: ANY error returns default flags — never throws, never breaks a page.
 * - Fair: SHA-256 hashing ensures uniform distribution within ±5% of targets.
 *
 * Hash algorithm (bucket assignment):
 *   bucket = parseInt(SHA256(session_id + experiment_key).slice(0, 8), 16) % 100
 *   Bucket is mapped to a variant by iterating through cumulative traffic percentages.
 *
 * DB integration (stub):
 * - Reads existing assignments from `page_experiments` table on first call.
 * - Writes new assignments if none exist.
 * - In this implementation, DB calls are no-ops (stubs) — replace with real
 *   Firestore/Postgres calls when the DB layer is wired in Session 7+.
 */

import { createHash } from 'node:crypto'
import type { FlightPageFlags } from './flags.types.ts'
import { DEFAULT_FLAGS } from './flags.types.ts'
import {
  EXPERIMENT_HERO_CTA,
  EXPERIMENT_HERO_STAT,
  type ExperimentDefinition,
  type VariantDefinition,
} from './experiment-hypotheses.ts'

// ─── Exports ──────────────────────────────────────────────────────────────────

export type {
  ExperimentDefinition,
  VariantDefinition,
}

export { EXPERIMENT_HERO_CTA, EXPERIMENT_HERO_STAT }

// ─── Return type ──────────────────────────────────────────────────────────────

export interface ExperimentContext {
  /** Effective flag values for this session (merged from defaults + experiment assignments). */
  flags: FlightPageFlags
  /**
   * Maps experiment key → assigned variant key (e.g. 'ctrl', 'a', 'b').
   * Attach as variant_id when calling createTracker().
   */
  variantIds: Record<string, string>
}

// ─── DB stub ──────────────────────────────────────────────────────────────────
// Replace with real DB calls when wired. Returns null = no existing assignment.

async function readExistingAssignment(
  _sessionId: string,
  _experimentKey: string,
): Promise<string | null> {
  // Stub: no persistent storage yet. Always returns null (first visit).
  return null
}

async function writeAssignment(
  _sessionId: string,
  _experimentKey: string,
  _variantKey: string,
): Promise<void> {
  // Stub: no persistent storage yet.
}

// ─── Exported helpers ─────────────────────────────────────────────────────────

/**
 * Compute a deterministic bucket (0–99) for a session+experiment pair.
 * Uses SHA-256 so the distribution is uniform across the full bucket space.
 */
export function hashToBucket(sessionId: string, experimentKey: string): number {
  const hash = createHash('sha256')
    .update(`${sessionId}${experimentKey}`)
    .digest('hex')
  // Parse the first 8 hex chars as a 32-bit unsigned integer, mod 100
  const value = parseInt(hash.slice(0, 8), 16)
  return value % 100
}

/**
 * Select the variant for a session based on its bucket assignment.
 * Variants must have traffic_pct values that sum to 100.
 */
export function selectVariant<T>(
  sessionId: string,
  experiment: ExperimentDefinition<never>,
): VariantDefinition<T> {
  const bucket = hashToBucket(sessionId, experiment.key)
  let cumulative = 0
  for (const variant of experiment.variants) {
    cumulative += variant.traffic_pct
    if (bucket < cumulative) {
      return variant as VariantDefinition<T>
    }
  }
  // Fallback to the first variant (should never happen if pcts sum to 100)
  return experiment.variants[0] as VariantDefinition<T>
}

// ─── All active experiments ───────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ALL_EXPERIMENTS: ExperimentDefinition<any>[] = [
  EXPERIMENT_HERO_CTA,
  EXPERIMENT_HERO_STAT,
]

// ─── Main resolver ────────────────────────────────────────────────────────────

/**
 * Resolve the effective feature flags and variant IDs for a session.
 *
 * Call this in your App Router page component / layout for every PFP request.
 * The result is safe to pass directly to createTracker() as variant_id and
 * to your page component as feature flags.
 *
 * @param sessionId - Anonymized session identifier (e.g. from cookies or X-Session-Id header)
 * @param routeId   - Route identifier, e.g. "GDN-BCN" (currently unused — reserved for
 *                    route-specific holdouts in future sessions)
 * @returns ExperimentContext with flags and variantIds, or defaults on any error
 */
export async function resolveExperimentContext(
  sessionId: string,
  _routeId: string,
): Promise<ExperimentContext> {
  try {
    // Start with all flags at defaults
    const flags: FlightPageFlags = { ...DEFAULT_FLAGS }
    const variantIds: Record<string, string> = {}

    // Resolve each experiment
    for (const experiment of ALL_EXPERIMENTS) {
      // 1. Check for existing DB assignment (returning user consistency)
      let variantKey: string | null = null
      try {
        variantKey = await readExistingAssignment(sessionId, experiment.key)
      } catch {
        // DB read failed — fall through to hash assignment
      }

      if (variantKey === null) {
        // 2. Assign via deterministic hash
        const variant = selectVariant(sessionId, experiment)
        variantKey = variant.key

        // 3. Persist the new assignment (fire-and-forget, non-blocking)
        writeAssignment(sessionId, experiment.key, variantKey).catch(() => {
          // Persistence failed — the session will be re-assigned on next request
          // (still deterministic via hash, so the user sees the same variant)
        })

        // Apply the flag value from the variant
        ;(flags as Record<string, unknown>)[experiment.key] = variant.value
      } else {
        // Existing assignment: find the matching variant to get its flag value
        const existing = experiment.variants.find((v) => v.key === variantKey)
        if (existing) {
          ;(flags as Record<string, unknown>)[experiment.key] = existing.value
        }
      }

      variantIds[experiment.key] = variantKey
    }

    return { flags, variantIds }
  } catch {
    // Safety net: ANY error at all → return defaults, never throw
    const safeVariantIds: Record<string, string> = {}
    for (const exp of ALL_EXPERIMENTS) {
      safeVariantIds[exp.key] = 'ctrl'
    }
    return { flags: { ...DEFAULT_FLAGS }, variantIds: safeVariantIds }
  }
}
