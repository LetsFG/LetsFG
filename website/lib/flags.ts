/**
 * Feature flags for the website, controlled via environment variables.
 * All flags are read once at module load time so they are stable within a request.
 *
 * Non-negotiable: all new features must be gated here rather than with
 * direct process.env reads in feature code.
 */

/**
 * Sample rate for `recommendation_quality_assessed` events (0.0–1.0).
 * Default 1.0 (100% sampled). Dial down without redeploy by setting
 * PFP_Q1_SAMPLE_RATE in the Cloud Run environment.
 */
export const Q1_SAMPLE_RATE = (() => {
  const raw = process.env.PFP_Q1_SAMPLE_RATE
  if (!raw) return 1.0
  const v = parseFloat(raw)
  return isNaN(v) ? 1.0 : Math.min(1.0, Math.max(0.0, v))
})()

/**
 * Returns true with the given probability.
 * rate=1.0 → always true; rate=0.0 → always false.
 */
export function shouldSample(rate: number): boolean {
  if (rate >= 1.0) return true
  if (rate <= 0.0) return false
  return Math.random() < rate
}
