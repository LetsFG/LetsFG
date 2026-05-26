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

/** Search criteria the user actually asked for. When provided, offers whose
 *  outbound/inbound LOCAL departure date doesn't match are flagged as suspect.
 *  Without these the validator only checks intrinsic plausibility, so an offer
 *  for a totally different return date sails through as valid. */
export interface ExpectedSearchCriteria {
  /** YYYY-MM-DD prefix; matched against the local departure date of the outbound. */
  date_from?: string
  /** YYYY-MM-DD prefix; matched against the local departure date of the inbound. */
  return_date?: string
}

/** Extract YYYY-MM-DD from an ISO timestamp using LOCAL airport time (the
 *  literal date before "T") — NOT UTC. A flight departing
 *  '2026-05-31T23:50:00+02:00' is a "May 31 departure" from the airport's
 *  perspective even though UTC is already June 1. */
function isoToCalendarDate(ts: string | undefined): string | null {
  if (!ts || typeof ts !== 'string') return null
  const match = /^(\d{4}-\d{2}-\d{2})T/.exec(ts)
  return match ? match[1] : null
}

/** Returns true when the ISO string carries an explicit timezone designator. */
function hasExplicitTz(ts: string): boolean {
  return /Z$|[+-]\d{2}:\d{2}$/.test(ts)
}

/** Connectors that only know a calendar date sometimes return a timestamp
 *  with the time component set to literal midnight ("2026-06-04T00:00:00Z").
 *  That passes hasExplicitFlightTime() (the regex matches `T\d{2}:\d{2}`)
 *  so getRouteTiming doesn't blank it out — and downstream we render
 *  "00:00 → 00:00" on the card. A SINGLE leg landing at midnight is a
 *  legitimate red-eye; both dep AND arr at hour=minute=0 with a real
 *  duration is physically impossible and a tell of date-only sentinel data. */
function isMidnightSentinelTs(ts: string | undefined): boolean {
  if (!ts || typeof ts !== 'string') return false
  return /T00:00(?::00)?(?:\.0+)?(?:Z|[+-]\d{2}:\d{2})?$/.test(ts)
}

/** True when both timestamps look like midnight-fabricated stubs — see
 *  isMidnightSentinelTs for why. */
function isMidnightSentinelPair(dep: string | undefined, arr: string | undefined): boolean {
  return isMidnightSentinelTs(dep) && isMidnightSentinelTs(arr)
}

/** Reasons that mean the offer's CARD would render visibly broken (e.g.
 *  "00:00 → 00:00", empty time columns). Callers can use this set to DROP
 *  these offers from the response entirely instead of demoting them, since
 *  no amount of ranking makes a card with no times useful. */
export const RENDER_BLOCKING_SUSPECT_REASONS = new Set([
  'inbound_missing_timing',
  'inbound_midnight_sentinel',
  'outbound_midnight_sentinel',
])

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
export function validateOfferBatch(
  offers: PublicOffer[],
  expected?: ExpectedSearchCriteria,
): OfferValidationResult {
  const valid: PublicOffer[] = []
  const suspect: SuspectOffer[] = []

  for (const offer of offers) {
    const reason = detectSuspectReason(offer, expected)
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
export function detectSuspectReason(
  offer: PublicOffer,
  expected?: ExpectedSearchCriteria,
): string | null {
  const { duration_minutes, departure_time, arrival_time, price, segments, inbound } = offer

  // Rule -1 — outbound calendar date drift.
  //   The connector returned an offer for a DIFFERENT outbound date than the
  //   user requested. Real incident: search for 2026-05-29 produced offers on
  //   2026-05-30 with no warning. Compare LOCAL airport dates (before T) so
  //   late-night departures aren't mis-flagged.
  if (expected?.date_from) {
    const outboundDate = isoToCalendarDate(departure_time)
    if (outboundDate && outboundDate !== expected.date_from) {
      return `outbound_date_drift:wanted=${expected.date_from};got=${outboundDate}`
    }
  }

  // Rule 0a — inbound calendar date drift (round-trip only).
  //   THE BUG: user asked for 2026-05-31 return, connector returned offer
  //   with inbound on 2026-06-03. Validator had no concept of expected dates,
  //   so the wrong-date offer passed and was even ranked as #1.
  if (inbound && expected?.return_date) {
    const inboundDate = isoToCalendarDate(inbound.departure_time)
    if (inboundDate && inboundDate !== expected.return_date) {
      return `return_date_drift:wanted=${expected.return_date};got=${inboundDate}`
    }
  }

  // Rule 0 — inbound timing integrity (round-trip only).
  //   Origin: ws_47776b352af74a1b on 2026-05-23 rendered a return leg as
  //   "00:00 → 01:00, 1h Direct" because the connector gave us a date-only
  //   timestamp and total_duration_seconds; getRouteTiming used to fabricate
  //   a clock from the duration. Now that getRouteTiming returns empty
  //   timestamps for date-only input, flag those offers as suspect so the
  //   bad return leg never sits in the validOffers slot.
  if (inbound) {
    if (!inbound.departure_time || !inbound.arrival_time) {
      return 'inbound_missing_timing'
    }
    // Connector handed back a midnight stub on BOTH legs — same class of
    // bug as inbound_missing_timing, just disguised as a real timestamp.
    // Origin: 2026-05-26 LHR→BCN+BCN→LGW combo where the return leg
    // showed "00:00 BCN → 00:00 LGW" as the page's hero card.
    if (isMidnightSentinelPair(inbound.departure_time, inbound.arrival_time)) {
      return 'inbound_midnight_sentinel'
    }
    if (inbound.duration_minutes < 20) {
      return `inbound_duration_too_short:${inbound.duration_minutes}min`
    }
    if (inbound.duration_minutes > 1440) {
      return `inbound_duration_too_long:${inbound.duration_minutes}min`
    }
    const inboundDep = new Date(inbound.departure_time).getTime()
    const inboundArr = new Date(inbound.arrival_time).getTime()
    if (!isNaN(inboundDep) && !isNaN(inboundArr) && inboundArr <= inboundDep) {
      return 'inbound_arrival_before_departure'
    }
  }

  // Rule 0c — inbound/outbound duration symmetry (round-trip only).
  //   Same physical route reversed; durations should be comparable. A 1h
  //   BCN→LON return on a 2h20m LON→BCN outbound is a connector returning
  //   wrong/fabricated data. Tolerance ±50% absorbs legit wind/ATC asymmetry.
  //   Runs after Rule 0's hard plausibility check so the more specific
  //   "duration_too_short" error wins for absurdly short legs (<20min).
  if (inbound && duration_minutes > 0 && inbound.duration_minutes > 0) {
    const ratio = inbound.duration_minutes / duration_minutes
    if (ratio < 0.5 || ratio > 2.0) {
      return `inbound_duration_asymmetric:outbound=${duration_minutes}min;inbound=${inbound.duration_minutes}min`
    }
  }

  // Rule 0d — outbound midnight sentinel. Same defence as the inbound
  // version above but for the outbound leg.
  if (isMidnightSentinelPair(departure_time, arrival_time)) {
    return 'outbound_midnight_sentinel'
  }

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
