/**
 * distribution-service.ts — transforms raw AgentSearchSession[] data into the
 * RouteDistributionData object consumed by the flight page template.
 *
 * All price arithmetic uses priceNormalized (already converted to the session's
 * targetCurrency) falling back to price when priceNormalized is absent.
 */

import type { AgentSearchSession, NormalizedOffer } from '../types/agent-session.types.ts'
import type {
  RouteDistributionData,
  PriceDistribution,
  HistogramBucket,
  CarrierSummaryItem,
  ConnectorComparisonItem,
  FeeAnalysis,
  FeeBreakdownItem,
  TldrSection,
  DataConfidence,
  Staleness,
  PageStatus,
} from '../types/route-distribution.types.ts'
import { computePercentile } from '../ingest/normalizer.ts'
import { getConnectorDisplayMeta } from '../data/connector-display-names.ts'

// ─── Public interface ─────────────────────────────────────────────────────────

export interface RouteMeta {
  originIata: string
  destIata: string
  originCity: string
  destCity: string
  pageStatus: PageStatus
  sessionCount: number
  snapshotComputedAt: string
}

export function getRouteDistributionData(
  sessions: AgentSearchSession[],
  routeMeta: RouteMeta,
): RouteDistributionData {
  // Merge all offers across sessions
  const allOffers = sessions.flatMap(s => s.offers)

  // Infer currency from first session that has one
  const currency = sessions.find(s => s.targetCurrency)?.targetCurrency ?? 'EUR'

  // Extract normalized prices (positive only) and sort ascending
  const sortedPrices = extractPrices(allOffers)

  const totalOffers = allOffers.length

  const priceDistribution = computePriceDistribution(sortedPrices, currency)
  const feeAnalysis = computeFeeAnalysis(allOffers)
  const carrierSummary = computeCarrierSummary(allOffers)
  const connectorComparison = computeConnectorComparison(allOffers)

  // For departure date in TLDR, use first offer's departure if available
  const snapshotDate = routeMeta.snapshotComputedAt.slice(0, 10)

  const tldr = buildTldr(
    routeMeta,
    priceDistribution,
    totalOffers,
    snapshotDate,
    carrierSummary,
    connectorComparison.length,
  )

  return {
    origin_iata: routeMeta.originIata,
    dest_iata: routeMeta.destIata,
    origin_city: routeMeta.originCity,
    dest_city: routeMeta.destCity,
    snapshot_computed_at: routeMeta.snapshotComputedAt,
    staleness: computeStaleness(routeMeta.snapshotComputedAt),
    data_confidence: computeConfidence(totalOffers),
    total_offers_analyzed: totalOffers,
    session_count: sessions.length,
    price_distribution: priceDistribution,
    fee_analysis: feeAnalysis,
    carrier_summary: carrierSummary,
    connector_comparison: connectorComparison,
    tldr,
    page_status: routeMeta.pageStatus,
    is_preview: true,
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Extract and sort normalized prices, filtering out non-positive values. */
function extractPrices(offers: NormalizedOffer[]): number[] {
  return offers
    .map(o => o.priceNormalized ?? o.price)
    .filter(p => p > 0)
    .sort((a, b) => a - b)
}

/** Build equal-width histogram from a sorted price array. */
function computeHistogram(sortedPrices: number[], numBuckets = 10): HistogramBucket[] {
  if (sortedPrices.length === 0) return []

  const min = sortedPrices[0]
  const max = sortedPrices[sortedPrices.length - 1]
  const total = sortedPrices.length

  // Handle degenerate case: all prices identical
  if (min === max) {
    return [{ from: min, to: max, count: total, pct: 100 }]
  }

  const width = (max - min) / numBuckets
  const buckets: HistogramBucket[] = Array.from({ length: numBuckets }, (_, i) => ({
    from: min + i * width,
    to: min + (i + 1) * width,
    count: 0,
    pct: 0,
  }))

  for (const price of sortedPrices) {
    // clamp last bucket to include max
    let idx = Math.floor((price - min) / width)
    if (idx >= numBuckets) idx = numBuckets - 1
    buckets[idx].count++
  }

  for (const bucket of buckets) {
    bucket.pct = (bucket.count / total) * 100
  }

  return buckets
}

/**
 * Detect bimodal distribution from a histogram.
 *
 * Algorithm:
 *   1. Find significant peaks: bucket count / total >= 5%
 *   2. Need at least 2 peaks separated by at least one valley bucket
 *   3. Valley test: valleyMin / smallerPeak < 0.30 → bimodal
 *
 * Edge treatment: sentinel value -1 is used for the imaginary buckets
 * outside the array boundaries, ensuring leftmost and rightmost buckets
 * can always be peaks.
 */
function detectBimodal(histogram: HistogramBucket[], totalOffers: number): {
  is_bimodal: boolean
  bimodal_insight?: string
} {
  if (totalOffers === 0 || histogram.length < 3) {
    return { is_bimodal: false }
  }

  const counts = histogram.map(b => b.count)
  const n = counts.length
  const PEAK_THRESHOLD = totalOffers * 0.05

  // Find peaks: local maxima above threshold (sentinel -1 for out-of-bounds)
  const peakIndices: number[] = []
  for (let i = 0; i < n; i++) {
    const left = i === 0 ? -1 : counts[i - 1]
    const right = i === n - 1 ? -1 : counts[i + 1]
    if (counts[i] > left && counts[i] > right && counts[i] >= PEAK_THRESHOLD) {
      peakIndices.push(i)
    }
  }

  if (peakIndices.length < 2) return { is_bimodal: false }

  // For each pair of adjacent peaks, test the valley between them
  for (let pi = 0; pi < peakIndices.length - 1; pi++) {
    const leftPeak = peakIndices[pi]
    const rightPeak = peakIndices[pi + 1]
    const smallerPeak = Math.min(counts[leftPeak], counts[rightPeak])

    // Find min count in the valley between these two peaks
    let valleyMin = Infinity
    for (let j = leftPeak + 1; j < rightPeak; j++) {
      if (counts[j] < valleyMin) valleyMin = counts[j]
    }

    if (valleyMin / smallerPeak < 0.30) {
      // Bimodal confirmed — build insight
      const leftCenter = (histogram[leftPeak].from + histogram[leftPeak].to) / 2
      const rightCenter = (histogram[rightPeak].from + histogram[rightPeak].to) / 2
      const currency = histogram[0].from.toString() // will be overridden by caller
      const insight =
        `Two fare clusters detected: budget fares around ${Math.round(leftCenter)} and premium fares around ${Math.round(rightCenter)}`
      return { is_bimodal: true, bimodal_insight: insight }
    }
  }

  return { is_bimodal: false }
}

function computePriceDistribution(sortedPrices: number[], currency: string): PriceDistribution {
  if (sortedPrices.length === 0) {
    return {
      p10: 0, p25: 0, p50: 0, p75: 0, p90: 0, p95: 0,
      min: 0, max: 0,
      histogram: [],
      currency,
      is_bimodal: false,
    }
  }

  const min = sortedPrices[0]
  const max = sortedPrices[sortedPrices.length - 1]

  const p10 = computePercentile(sortedPrices, 10) ?? 0
  const p25 = computePercentile(sortedPrices, 25) ?? 0
  const p50 = computePercentile(sortedPrices, 50) ?? 0
  const p75 = computePercentile(sortedPrices, 75) ?? 0
  const p90 = computePercentile(sortedPrices, 90) ?? 0
  const p95 = computePercentile(sortedPrices, 95) ?? 0

  const histogram = computeHistogram(sortedPrices)
  const bimodal = detectBimodal(histogram, sortedPrices.length)

  return {
    p10, p25, p50, p75, p90, p95,
    min, max,
    histogram,
    currency,
    is_bimodal: bimodal.is_bimodal,
    ...(bimodal.bimodal_insight !== undefined
      ? { bimodal_insight: bimodal.bimodal_insight }
      : {}),
  }
}

/** Compute per-carrier summary, sorted by price_p50 ascending. */
function computeCarrierSummary(offers: NormalizedOffer[]): CarrierSummaryItem[] {
  const groups = new Map<string, NormalizedOffer[]>()
  for (const offer of offers) {
    const carrier = offer.ownerAirline ?? 'unknown'
    const existing = groups.get(carrier)
    if (existing) existing.push(offer)
    else groups.set(carrier, [offer])
  }

  const result: CarrierSummaryItem[] = []
  for (const [carrier, carrierOffers] of groups) {
    const prices = carrierOffers
      .map(o => o.priceNormalized ?? o.price)
      .filter(p => p > 0)
      .sort((a, b) => a - b)

    const price_p50 = computePercentile(prices, 50) ?? 0

    // Hidden fees: offers where bagsPrice has at least one fee entry
    const offersWithFees = carrierOffers.filter(
      o => o.bagsPrice && Object.keys(o.bagsPrice).length > 0
    )
    let hidden_fees_avg: number | null = null
    let hidden_fees_pct: number | null = null

    if (offersWithFees.length > 0) {
      const totalFees = offersWithFees.map(o =>
        Object.values(o.bagsPrice as Record<string, number>).reduce((s, v) => s + v, 0)
      )
      hidden_fees_avg = totalFees.reduce((s, v) => s + v, 0) / totalFees.length
      hidden_fees_pct = price_p50 > 0 ? hidden_fees_avg / price_p50 : null
    }

    result.push({
      carrier,
      offer_count: carrierOffers.length,
      price_p50,
      hidden_fees_avg,
      hidden_fees_pct,
    })
  }

  return result.sort((a, b) => a.price_p50 - b.price_p50)
}

/** Compute per-connector comparison, sorted by price_p50 ascending. */
function computeConnectorComparison(offers: NormalizedOffer[]): ConnectorComparisonItem[] {
  const groups = new Map<string, NormalizedOffer[]>()
  for (const offer of offers) {
    const connector = offer.source ?? 'unknown'
    const existing = groups.get(connector)
    if (existing) existing.push(offer)
    else groups.set(connector, [offer])
  }

  // First pass: compute p50 per connector
  const connectorP50s: { connector_name: string; offer_count: number; price_p50: number }[] = []

  for (const [connector_name, connOffers] of groups) {
    const prices = connOffers
      .map(o => o.priceNormalized ?? o.price)
      .filter(p => p > 0)
      .sort((a, b) => a - b)

    const price_p50 = computePercentile(prices, 50) ?? 0
    connectorP50s.push({ connector_name, offer_count: connOffers.length, price_p50 })
  }

  if (connectorP50s.length === 0) return []

  // Compute per-group avg p50 (group = carrier_coverage_type)
  const groupAvgs = new Map<string, number>()
  const groupMembers = new Map<string, typeof connectorP50s>()
  for (const c of connectorP50s) {
    const meta = getConnectorDisplayMeta(c.connector_name)
    const group = meta.type ?? 'mixed'
    const members = groupMembers.get(group) ?? []
    members.push(c)
    groupMembers.set(group, members)
  }
  for (const [group, members] of groupMembers) {
    const avg = members.reduce((s, c) => s + c.price_p50, 0) / members.length
    groupAvgs.set(group, avg)
  }

  const result: ConnectorComparisonItem[] = connectorP50s.map(c => {
    const meta = getConnectorDisplayMeta(c.connector_name)
    const group = meta.type ?? 'mixed'
    const groupAvg = groupAvgs.get(group) ?? 0
    // Single-member group: delta = 0 (no meaningful comparison within group)
    const members = groupMembers.get(group)!
    const delta = members.length > 1 && groupAvg > 0
      ? (c.price_p50 - groupAvg) / groupAvg * 100
      : 0
    return {
      connector_name: c.connector_name,
      display_name: meta.displayName,
      carrier_coverage_type: meta.type,
      offer_count: c.offer_count,
      price_p50: c.price_p50,
      delta_vs_avg_pct: delta,
    }
  })

  return result.sort((a, b) => a.price_p50 - b.price_p50)
}

/** Compute fee analysis across all offers. */
function computeFeeAnalysis(offers: NormalizedOffer[]): FeeAnalysis {
  const offersWithFees = offers.filter(
    o => o.bagsPrice && Object.keys(o.bagsPrice).length > 0
  )

  if (offersWithFees.length === 0) {
    return {
      avg_hidden_fees_amount: null,
      avg_hidden_fees_pct: null,
      fee_variance: 'low',
      fee_breakdown_available: false,
    }
  }

  // Per-offer total fee (sum of all bag/seat fees)
  const perOfferFees = offersWithFees.map(o => ({
    offer: o,
    totalFee: Object.values(o.bagsPrice as Record<string, number>).reduce((s, v) => s + v, 0),
  }))

  const allFees = perOfferFees.map(f => f.totalFee)
  const avg_hidden_fees_amount = allFees.reduce((s, v) => s + v, 0) / allFees.length

  // avg base price of offers with fee data
  const avgBase = offersWithFees.reduce((s, o) => s + (o.priceNormalized ?? o.price), 0) / offersWithFees.length
  const avg_hidden_fees_pct = avgBase > 0 ? avg_hidden_fees_amount / avgBase : null

  // Coefficient of variation for fee_variance
  const mean = avg_hidden_fees_amount
  let fee_variance: 'low' | 'medium' | 'high' = 'low'
  if (allFees.length > 1 && mean > 0) {
    const variance = allFees.reduce((s, f) => s + (f - mean) ** 2, 0) / allFees.length
    const cv = Math.sqrt(variance) / mean
    if (cv > 0.5) fee_variance = 'high'
    else if (cv >= 0.2) fee_variance = 'medium'
    else fee_variance = 'low'
  }

  // Per-carrier breakdown
  const carrierGroups = new Map<string, { fees: number[]; prices: number[] }>()
  for (const { offer, totalFee } of perOfferFees) {
    const carrier = offer.ownerAirline ?? 'unknown'
    const entry = carrierGroups.get(carrier) ?? { fees: [], prices: [] }
    entry.fees.push(totalFee)
    entry.prices.push(offer.priceNormalized ?? offer.price)
    carrierGroups.set(carrier, entry)
  }

  const breakdown: FeeBreakdownItem[] = []
  for (const [carrier, { fees, prices }] of carrierGroups) {
    const avg_fee = fees.reduce((s, v) => s + v, 0) / fees.length
    const avgCarrierPrice = prices.reduce((s, v) => s + v, 0) / prices.length
    breakdown.push({
      carrier,
      avg_fee,
      avg_fee_pct: avgCarrierPrice > 0 ? avg_fee / avgCarrierPrice : 0,
    })
  }

  return {
    avg_hidden_fees_amount,
    avg_hidden_fees_pct,
    fee_variance,
    fee_breakdown_available: true,
    breakdown,
  }
}

/** Determine staleness of the snapshot relative to now. */
function computeStaleness(snapshotComputedAt: string): Staleness {
  const ageMs = Date.now() - new Date(snapshotComputedAt).getTime()
  const DAY_MS = 24 * 60 * 60 * 1000
  if (ageMs < DAY_MS) return 'fresh'
  if (ageMs < 7 * DAY_MS) return 'recent'
  return 'stale'
}

/** Determine data confidence from total offer count. */
function computeConfidence(totalOffers: number): DataConfidence {
  if (totalOffers >= 100) return 'high'
  if (totalOffers >= 40) return 'medium'
  return 'low'
}

/** Build the TLDR section from distribution data. */
function buildTldr(
  routeMeta: RouteMeta,
  dist: PriceDistribution,
  totalOffers: number,
  snapshotDate: string,
  carrierSummary: CarrierSummaryItem[],
  connectorCount: number,
): TldrSection {
  const { originCity, destCity } = routeMeta
  const currency = dist.currency
  const p10 = Math.round(dist.p10)
  const p25 = Math.round(dist.p25)
  const p50 = Math.round(dist.p50)
  const p75 = Math.round(dist.p75)
  const p90 = Math.round(dist.p90)
  const min = Math.round(dist.min)
  const carrierCount = carrierSummary.length

  const monthYear = _formatMonthYear(snapshotDate)

  // Split carriers by price_p50 relative to overall median
  const lccCarriers = carrierSummary.filter(c => c.price_p50 < p50)
  const fscCarriers = carrierSummary.filter(c => c.price_p50 >= p50)
  const lccOfferCount = lccCarriers.reduce((s, c) => s + c.offer_count, 0)
  const lccPct = totalOffers > 0 ? Math.round(lccOfferCount / totalOffers * 100) : 0

  // Build summary paragraph
  let summary: string
  if (dist.is_bimodal && lccCarriers.length > 0 && fscCarriers.length > 0) {
    const lccMed = Math.round(lccCarriers[lccCarriers.length - 1]!.price_p50)
    const fscMed = Math.round(fscCarriers[0]!.price_p50)
    summary = `As of ${monthYear}, economy flights from ${originCity} to ${destCity} range from ${currency} ${p10} to ${currency} ${p90}, with a median total price of ${currency} ${p50}. Our AI agents analyzed ${totalOffers} offers — ${lccPct}% from budget carriers (around ${currency} ${lccMed}) and ${100 - lccPct}% from full-service carriers (around ${currency} ${fscMed}) in a single search session.`
  } else {
    summary = `As of ${monthYear}, economy flights from ${originCity} to ${destCity} range from ${currency} ${p10} to ${currency} ${p90}, with a median total price of ${currency} ${p50}. Our AI agents analyzed ${totalOffers} offers from ${carrierCount} airline${carrierCount !== 1 ? 's' : ''} in a single search session covering this route.`
  }

  // Build key facts — each >= 60 chars, each contains month+year, each contains a number
  let fact0: string
  if (dist.is_bimodal && lccCarriers.length > 0 && fscCarriers.length > 0) {
    const lccMed = Math.round(_carrierGroupMedian(lccCarriers))
    const fscMed = Math.round(_carrierGroupMedian(fscCarriers))
    const ratio = fscMed > 0 && lccMed > 0 ? (fscMed / lccMed).toFixed(1) : '2.0'
    const lccIataList = lccCarriers.map(c => c.carrier).join(', ')
    fact0 = `${lccPct}% of ${originCity}–${destCity} flights in our ${monthYear} analysis were budget carriers (${lccIataList}), median fare ${currency} ${lccMed} — ${ratio}x lower than full-service carriers on this route (median ${currency} ${fscMed}).`
  } else {
    fact0 = `Across ${totalOffers} ${originCity}–${destCity} offers analyzed in ${monthYear}, prices ranged from ${currency} ${p10} (10th percentile) to ${currency} ${p90} (90th percentile), with half of all fares falling between ${currency} ${p25} and ${currency} ${p75}.`
  }

  const fact1 = `On ${originCity}–${destCity} routes, advertised base fares start from ${currency} ${min}, but the median total paid including taxes and carrier surcharges reached ${currency} ${p50} in our ${monthYear} analysis.`

  const fact2 = `Our agents analyzed ${totalOffers} distinct ${originCity}–${destCity} offers from ${carrierCount} airline${carrierCount !== 1 ? 's' : ''} in ${monthYear}, covering ${connectorCount} search connector${connectorCount !== 1 ? 's' : ''} across direct airlines, OTAs, and meta-search.`

  return { summary, key_facts: [fact0, fact1, fact2] }
}

/** Compute the weighted median price from a group of carrier summary items. */
function _carrierGroupMedian(carriers: CarrierSummaryItem[]): number {
  if (carriers.length === 0) return 0
  const sorted = [...carriers].sort((a, b) => a.price_p50 - b.price_p50)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]!.price_p50 + sorted[mid]!.price_p50) / 2
    : sorted[mid]!.price_p50
}

/** Format an ISO date string as "Month YYYY". Uses UTC to avoid timezone skew. */
export function _formatMonthYear(isoDate: string): string {
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December']
  const d = new Date(isoDate)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}
