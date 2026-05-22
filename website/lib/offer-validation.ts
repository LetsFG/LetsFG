/**
 * Pre-presentation offer validator.
 *
 * Runs synchronously on the normalized offer batch before the API response is
 * returned. Flags offers whose metadata looks suspicious so the frontend can
 * move them to the end of the list or request a recheck.
 *
 * Suspect offers are NOT removed — they are tagged and appended after valid
 * offers in the response. A `quality: 'suspect'` field is added to each one.
 */

import type { PublicOffer } from './trusted-offer'

export interface SuspectOffer {
  offer: PublicOffer
  reason: string
}

export interface OfferValidationResult {
  valid: PublicOffer[]
  suspect: SuspectOffer[]
}

/** Returns true when the ISO string carries an explicit timezone designator. */
function hasExplicitTz(ts: string): boolean {
  return /Z$|[+-]\d{2}:\d{2}$/.test(ts)
}

/**
 * Validate a batch of offers, separating clearly bad data from plausible ones.
 *
 * Rules (all produce a `quality: 'suspect'` tag, not a hard reject):
 * - Duration plausibility: < 20 min or > 1440 min (24 h)
 * - Time ordering: arrival ≤ departure
 * - Timezone drift: |duration_minutes − epoch_diff_minutes| > 120 when both
 *   timestamps carry explicit timezone info
 * - Extreme price outlier: price < 1 or price > 20 000 (EUR-normalised terms)
 * - Layover anomaly: any segment layover > 720 min on a sub-24 h itinerary
 */
export function validateOfferBatch(offers: PublicOffer[]): OfferValidationResult {
  const valid: PublicOffer[] = []
  const suspect: SuspectOffer[] = []

  for (const offer of offers) {
    const reason = detectSuspectReason(offer)
    if (reason) {
      suspect.push({ offer, reason })
    } else {
      valid.push(offer)
    }
  }

  return { valid, suspect }
}

/**
 * Returns a human-readable suspect reason string, or null when the offer looks
 * valid. Only the first matching rule is returned (most significant first).
 */
export function detectSuspectReason(offer: PublicOffer): string | null {
  const { duration_minutes, departure_time, arrival_time, price, segments, inbound } = offer

  // Rule 1 — duration plausibility
  if (duration_minutes < 20) {
    return `duration_too_short:${duration_minutes}min`
  }
  if (duration_minutes > 1440) {
    return `duration_too_long:${duration_minutes}min`
  }

  // Rule 2 — time ordering
  if (departure_time && arrival_time) {
    const depEpoch = new Date(departure_time).getTime()
    const arrEpoch = new Date(arrival_time).getTime()
    if (!isNaN(depEpoch) && !isNaN(arrEpoch) && arrEpoch <= depEpoch) {
      return `arrival_before_departure`
    }

    // Rule 3 — timezone drift (only when both timestamps have explicit tz info)
    if (hasExplicitTz(departure_time) && hasExplicitTz(arrival_time)) {
      const epochDiffMins = Math.round((arrEpoch - depEpoch) / 60000)
      if (Math.abs(duration_minutes - epochDiffMins) > 120) {
        return `timezone_drift:stored=${duration_minutes}min,computed=${epochDiffMins}min`
      }
    }
  }

  // Rule 4 — extreme price outlier
  if (price < 1 || price > 20000) {
    return `price_outlier:${price}`
  }

  // Rule 5 — layover anomaly (any segment layover > 12 h on a sub-24 h itinerary)
  if (duration_minutes < 1440) {
    const allSegments = [
      ...(segments ?? []),
      ...(inbound?.segments ?? []),
    ]
    for (const seg of allSegments) {
      const layover = (seg as { layover_minutes?: number }).layover_minutes
      if (typeof layover === 'number' && layover > 720) {
        return `layover_anomaly:${layover}min`
      }
    }
  }

  return null
}
