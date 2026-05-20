/**
 * offer-highlights.ts — extracts per-carrier offer highlight summaries and
 * amenity pricing tables from a session's normalized offers.
 *
 * These summaries are shown on the flight page instead of a bare carrier-name
 * table, giving visitors results-page-level detail (duration, stops, amenities)
 * without storing individually identifiable offer data.
 *
 * Design constraints:
 *  - No PII stored — only aggregate stats per carrier
 *  - Falls back gracefully when individual offers lack duration/stop data
 *  - Source display names come from the existing connector-display-names map
 */

import type { NormalizedOffer } from '../types/agent-session.types.ts'
import type { OfferHighlight, AmenitySummary, DepartureTimeBucket } from '../types/route-distribution.types.ts'
import { getConnectorDisplayMeta } from '../data/connector-display-names.ts'

// ─── classifyDepartureTime ────────────────────────────────────────────────────

/**
 * Classify a departure ISO datetime string into a coarse time bucket.
 * Returns 'varies' for any parsing error or empty string.
 */
export function classifyDepartureTime(departure: string): DepartureTimeBucket {
  if (!departure) return 'varies'
  try {
    const hour = new Date(departure).getHours()
    if (isNaN(hour)) return 'varies'
    if (hour < 6) return 'early_morning'
    if (hour < 12) return 'morning'
    if (hour < 18) return 'afternoon'
    if (hour < 21) return 'evening'
    return 'night'
  } catch {
    return 'varies'
  }
}

// ─── buildOfferHighlights ─────────────────────────────────────────────────────

/**
 * Build one OfferHighlight per carrier from a list of normalized offers.
 * Highlights are sorted by best_price ascending.
 *
 * @param offers    Normalized offers from an AgentSearchSession.
 * @param currency  Target currency for price normalization.
 */
export function buildOfferHighlights(
  offers: NormalizedOffer[],
  currency: string,
): OfferHighlight[] {
  if (offers.length === 0) return []

  // Group by ownerAirline
  const byCarrier = new Map<string, NormalizedOffer[]>()
  for (const offer of offers) {
    const carrier = offer.ownerAirline || offer.airlines[0] || '?'
    if (!byCarrier.has(carrier)) byCarrier.set(carrier, [])
    byCarrier.get(carrier)!.push(offer)
  }

  const highlights: OfferHighlight[] = []

  for (const [carrier, carrierOffers] of byCarrier) {
    if (carrierOffers.length === 0) continue

    // Sort by effective price ascending
    const sorted = [...carrierOffers].sort((a, b) => {
      const pa = a.priceNormalized ?? a.price
      const pb = b.priceNormalized ?? b.price
      return pa - pb
    })

    const cheapest = sorted[0]
    const cheapestPrice = cheapest.priceNormalized ?? cheapest.price

    // Duration range
    const durations = carrierOffers
      .map(o => o.outbound.totalDurationSeconds > 0
        ? Math.round(o.outbound.totalDurationSeconds / 60)
        : null)
      .filter((d): d is number => d !== null)

    const durationMin = durations.length > 0 ? Math.min(...durations) : 0
    const durationMax = durations.length > 0 ? Math.max(...durations) : 0

    // Stops
    const stopsValues = carrierOffers.map(o => o.outbound.stopovers)
    const minStops = Math.min(...stopsValues)
    const directAvailable = stopsValues.some(s => s === 0)

    // Departure time bucket from cheapest offer
    const firstSeg = cheapest.outbound.segments[0]
    const departureBucket = classifyDepartureTime(firstSeg?.departure ?? '')

    // Bags — from cheapest offer first, then fallback to any offer with data
    const bagSource = sorted.find(o => o.bagsPrice && Object.keys(o.bagsPrice).length > 0) ?? cheapest
    const bags = bagSource.bagsPrice ?? {}

    const carryOn = bags.carry_on !== undefined ? bags.carry_on : null
    const checkedBag = bags.checked_bag !== undefined ? bags.checked_bag : null
    const seatFee = bags.seat !== undefined ? bags.seat : null
    const bagsIncluded = carryOn === 0 || checkedBag === 0

    // Refund policy from cheapest offer
    const refundPolicy = (cheapest.conditions?.refund_before_departure ?? null) as
      OfferHighlight['refund_policy']

    // Carrier display name
    const carrierName = cheapest.outbound.segments[0]?.airlineName
      || cheapest.airlines[0]
      || carrier

    // Best booking channel display name
    const source = cheapest.source || ''
    const bestBookingChannel = source
      ? getConnectorDisplayMeta(source).displayName
      : source

    highlights.push({
      carrier,
      carrier_name: carrierName,
      best_price: cheapestPrice,
      currency,
      duration_min_minutes: durationMin,
      duration_max_minutes: durationMax,
      direct_available: directAvailable,
      min_stops: minStops,
      departure_time_bucket: departureBucket,
      offer_count: carrierOffers.length,
      cabin_class: firstSeg?.cabinClass ?? 'economy',
      bags_carry_on_price: carryOn,
      bags_checked_price: checkedBag,
      seat_price: seatFee,
      bags_included: bagsIncluded,
      refund_policy: refundPolicy,
      best_booking_channel: bestBookingChannel,
    })
  }

  return highlights.sort((a, b) => a.best_price - b.best_price)
}

// ─── buildAmenitySummary ──────────────────────────────────────────────────────

/**
 * Build an AmenitySummary from the offers, grouping bag/seat prices by carrier.
 * Returns null when no offer in the session exposed fee data.
 */
export function buildAmenitySummary(
  offers: NormalizedOffer[],
  currency: string,
): AmenitySummary | null {
  // Group by carrier, keep cheapest offer per carrier
  const byCarrier = new Map<string, NormalizedOffer>()
  for (const offer of offers) {
    const carrier = offer.ownerAirline || offer.airlines[0] || '?'
    const hasBagData = offer.bagsPrice && Object.keys(offer.bagsPrice).length > 0
    if (!hasBagData) continue

    const existing = byCarrier.get(carrier)
    if (!existing) {
      byCarrier.set(carrier, offer)
    } else {
      const existingPrice = existing.priceNormalized ?? existing.price
      const offerPrice = offer.priceNormalized ?? offer.price
      if (offerPrice < existingPrice) byCarrier.set(carrier, offer)
    }
  }

  if (byCarrier.size === 0) return null

  const rows = Array.from(byCarrier.entries()).map(([carrier, offer]) => {
    const bags = offer.bagsPrice ?? {}
    const carrierName = offer.outbound.segments[0]?.airlineName || offer.airlines[0] || carrier
    return {
      carrier,
      carrier_name: carrierName,
      carry_on: bags.carry_on !== undefined ? bags.carry_on : null,
      checked_bag: bags.checked_bag !== undefined ? bags.checked_bag : null,
      seat_selection: bags.seat !== undefined ? bags.seat : null,
      currency,
    }
  })

  return {
    rows,
    currency,
    captured_at: new Date().toISOString(),
  }
}
