/**
 * normalizer.ts — converts a raw Python SDK JSON payload to AgentSearchSession.
 *
 * Handles:
 *  - snake_case → camelCase field mapping
 *  - cabin_class normalization to lowercase (Kiwi sends 'ECONOMY', others lowercase)
 *  - Missing/absent field defaults
 *  - PII stripping (user_id, email, session_token, ip_address stripped from agent_context)
 *  - Price statistics computation (percentiles p10–p95, CV, carrier/connector counts)
 */

import type {
  AgentSearchSession,
  NormalizedOffer,
  NormalizedRoute,
  NormalizedSegment,
  BagsPrice,
  OfferConditions,
  AnonymizedSearchParams,
  SessionPriceStats,
  ConnectorRunResult,
  SourceTier,
} from '../types/agent-session.types.ts'

// ─── Raw Python SDK types (JSON snake_case) ───────────────────────────────────

interface RawSegment {
  airline: string
  airline_name?: string
  flight_no?: string
  origin: string
  destination: string
  origin_city?: string
  destination_city?: string
  departure: string
  arrival: string
  duration_seconds?: number
  cabin_class?: string
  aircraft?: string
}

interface RawRoute {
  segments: RawSegment[]
  total_duration_seconds?: number
  stopovers?: number
}

interface RawOffer {
  id: string
  price: number
  currency: string
  price_formatted?: string
  price_normalized?: number | null
  outbound: RawRoute
  inbound?: RawRoute | null
  airlines?: string[]
  owner_airline?: string
  bags_price?: Record<string, number>
  availability_seats?: number | null
  conditions?: Record<string, string>
  source?: string
  source_tier?: string
  is_locked?: boolean
  fetched_at?: string
  booking_url?: string
}

interface RawConnectorResult {
  connector: string
  ok: boolean
  offers: number
  latency_ms?: number
  error_type?: string | null
  error_message?: string | null
  error_category?: string | null
  http_status?: number | null
}

/** Optional agent pipeline context attached to raw payload. May contain PII. */
interface RawAgentContext {
  // PII fields — always stripped
  user_id?: string
  email?: string
  session_token?: string
  ip_address?: string
  device_id?: string
  // Non-PII fields preserved into searchParams
  pax_count?: number
  trip_type?: 'oneway' | 'return'
  cabin_preference?: 'M' | 'W' | 'C' | 'F' | null
  advance_booking_days?: number
  max_stopovers?: number
  currency_code?: string
}

/** Full raw payload as received from the agent pipeline. */
export interface RawSearchPayload {
  session_id?: string
  origin: string
  destination: string
  currency?: string
  offers: RawOffer[]
  total_results?: number
  origin_city?: string
  dest_city?: string
  searched_at?: string
  search_params?: Partial<AnonymizedSearchParams>
  connector_results?: RawConnectorResult[]
  /** Optional agent context — may contain PII, always stripped before normalization. */
  agent_context?: RawAgentContext
}

// ─── Extended stats returned by computeSessionStats ──────────────────────────

/**
 * Extends SessionPriceStats with additional computed fields used internally
 * by the ingest pipeline (not stored directly in the DB).
 */
export interface ComputedStats extends SessionPriceStats {
  /** Coefficient of variation: stddev / mean. 0 when all prices are identical. */
  priceCV: number
  /** Price at 10th percentile. null if no offers. */
  priceP10: number | null
  /** Price at 90th percentile. null if no offers. */
  priceP90: number | null
}

// ─── computePercentile ────────────────────────────────────────────────────────

/**
 * Compute a percentile value from an already-sorted array using linear interpolation.
 *
 * @param sorted  Array of numbers sorted in ascending order.
 * @param p       Percentile (0–100).
 * @returns       Interpolated value, or null for empty arrays.
 */
export function computePercentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null
  if (sorted.length === 1) return sorted[0]
  const idx = (p / 100) * (sorted.length - 1)
  const lower = Math.floor(idx)
  const upper = Math.ceil(idx)
  if (lower === upper) return sorted[lower]
  const frac = idx - lower
  return sorted[lower] * (1 - frac) + sorted[upper] * frac
}

// ─── computeSessionStats ─────────────────────────────────────────────────────

/**
 * Compute price statistics and diversity counts from a list of normalized offers.
 *
 * Uses priceNormalized when available, falls back to price.
 * Filters out non-positive prices before computing stats.
 */
export function computeSessionStats(offers: NormalizedOffer[]): ComputedStats {
  const prices = offers
    .map(o => o.priceNormalized != null && o.priceNormalized > 0 ? o.priceNormalized : o.price)
    .filter(p => p > 0)
    .sort((a, b) => a - b)

  const carriers = new Set(offers.map(o => o.ownerAirline).filter(Boolean))
  const connectors = new Set(offers.map(o => o.source).filter(Boolean))

  if (prices.length === 0) {
    return {
      offerCount: 0,
      carrierCount: carriers.size,
      connectorCount: connectors.size,
      priceMin: null,
      priceMax: null,
      priceP10: null,
      priceP25: null,
      priceP50: null,
      priceP75: null,
      priceP90: null,
      priceP95: null,
      priceCV: 0,
      hiddenFeesAvg: null,
      hiddenFeesPctAvg: null,
    }
  }

  const mean = prices.reduce((s, p) => s + p, 0) / prices.length
  const variance = prices.reduce((s, p) => s + (p - mean) ** 2, 0) / prices.length
  const stddev = Math.sqrt(variance)
  const priceCV = mean > 0 ? stddev / mean : 0

  // Bag fee averages across offers that provided pricing
  const bagsOffers = offers.filter(o => Object.keys(o.bagsPrice ?? {}).length > 0)
  const hiddenFeesAvg = bagsOffers.length > 0
    ? bagsOffers.reduce((s, o) => {
        const fee = Object.values(o.bagsPrice).reduce((a: number, v) => a + (v ?? 0), 0)
        return s + fee
      }, 0) / bagsOffers.length
    : null
  const hiddenFeesPctAvg = hiddenFeesAvg != null && mean > 0
    ? hiddenFeesAvg / mean
    : null

  return {
    offerCount: prices.length,
    carrierCount: carriers.size,
    connectorCount: connectors.size,
    priceMin: prices[0],
    priceMax: prices[prices.length - 1],
    priceP10: computePercentile(prices, 10),
    priceP25: computePercentile(prices, 25),
    priceP50: computePercentile(prices, 50),
    priceP75: computePercentile(prices, 75),
    priceP90: computePercentile(prices, 90),
    priceP95: computePercentile(prices, 95),
    priceCV,
    hiddenFeesAvg,
    hiddenFeesPctAvg,
  }
}

// ─── Segment / Route normalizers ──────────────────────────────────────────────

function normalizeSegment(raw: RawSegment): NormalizedSegment {
  return {
    airline: raw.airline ?? '',
    airlineName: raw.airline_name ?? '',
    flightNo: raw.flight_no ?? '',
    origin: raw.origin ?? '',
    destination: raw.destination ?? '',
    originCity: raw.origin_city ?? '',
    destinationCity: raw.destination_city ?? '',
    departure: raw.departure ?? '',
    arrival: raw.arrival ?? '',
    durationSeconds: raw.duration_seconds ?? 0,
    // Normalize cabin_class to lowercase regardless of connector casing
    cabinClass: (raw.cabin_class ?? '').toLowerCase(),
    aircraft: raw.aircraft ?? '',
  }
}

function normalizeRoute(raw: RawRoute): NormalizedRoute {
  return {
    segments: (raw.segments ?? []).map(normalizeSegment),
    totalDurationSeconds: raw.total_duration_seconds ?? 0,
    stopovers: raw.stopovers ?? 0,
  }
}

// ─── Offer normalizer ─────────────────────────────────────────────────────────

function normalizeOffer(raw: RawOffer): NormalizedOffer {
  return {
    id: raw.id,
    price: raw.price,
    currency: raw.currency ?? '',
    priceFormatted: raw.price_formatted ?? '',
    priceNormalized: raw.price_normalized != null ? raw.price_normalized : null,
    outbound: normalizeRoute(raw.outbound),
    inbound: raw.inbound ? normalizeRoute(raw.inbound) : null,
    airlines: raw.airlines ?? [],
    ownerAirline: raw.owner_airline ?? '',
    bagsPrice: (raw.bags_price ?? {}) as BagsPrice,
    availabilitySeats: raw.availability_seats ?? null,
    conditions: (raw.conditions ?? {}) as OfferConditions,
    source: raw.source ?? '',
    sourceTier: (raw.source_tier ?? 'free') as SourceTier,
    isLocked: raw.is_locked ?? false,
    fetchedAt: raw.fetched_at ?? new Date().toISOString(),
    bookingUrl: raw.booking_url ?? '',
  }
}

// ─── Connector result normalizer ──────────────────────────────────────────────

function normalizeConnectorResult(raw: RawConnectorResult): ConnectorRunResult {
  return {
    connector: raw.connector,
    ok: raw.ok,
    offers: raw.offers,
    latencyMs: raw.latency_ms ?? 0,
    errorType: raw.error_type ?? null,
    errorMessage: raw.error_message ?? null,
    errorCategory: (raw.error_category ?? null) as ConnectorRunResult['errorCategory'],
    httpStatus: raw.http_status ?? null,
  }
}

// ─── Search params builder ────────────────────────────────────────────────────

function buildSearchParams(
  raw: RawSearchPayload,
  context?: RawAgentContext
): AnonymizedSearchParams {
  // Non-PII fields from agent_context override any search_params from the payload
  return {
    paxCount: context?.pax_count ?? raw.search_params?.paxCount ?? 1,
    tripType: context?.trip_type ?? raw.search_params?.tripType ?? 'oneway',
    cabinPreference: context?.cabin_preference ?? raw.search_params?.cabinPreference ?? null,
    advanceBookingDays: context?.advance_booking_days ?? raw.search_params?.advanceBookingDays ?? 0,
    maxStopovers: context?.max_stopovers ?? raw.search_params?.maxStopovers ?? 2,
    currencyCode: context?.currency_code ?? raw.search_params?.currencyCode ?? raw.currency ?? 'EUR',
  }
}

// ─── ID generation ────────────────────────────────────────────────────────────

let _idCounter = 0

function generateSessionId(raw: RawSearchPayload): string {
  if (raw.session_id) return raw.session_id
  // Deterministic but opaque ID — derived from route + search details.
  // No crypto dependency; good enough for test environments.
  const base = `${raw.origin}-${raw.destination}-${raw.searched_at ?? Date.now()}-${++_idCounter}`
  return `sess_${base.replace(/[^a-zA-Z0-9-]/g, '_')}`
}

// ─── normalizeSession ─────────────────────────────────────────────────────────

/**
 * Convert a raw Python SDK JSON payload to a fully-normalized AgentSearchSession.
 *
 * Privacy contract: agent_context is read only for non-PII fields.
 * PII fields (user_id, email, session_token, ip_address, device_id)
 * are NEVER propagated into the returned AgentSearchSession.
 */
export function normalizeSession(raw: RawSearchPayload): AgentSearchSession {
  // Intentionally destructure agent_context to access only non-PII fields.
  // The PII fields (user_id, email, etc.) are left inside `_pii` and not used.
  const {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    user_id: _userId,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    email: _email,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    session_token: _sessionToken,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ip_address: _ipAddress,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    device_id: _deviceId,
    ...safeContext
  } = raw.agent_context ?? {}

  const offers = (raw.offers ?? []).map(normalizeOffer)
  const stats = computeSessionStats(offers)
  const connectorResults = (raw.connector_results ?? []).map(normalizeConnectorResult)
  const dataSources = connectorResults.length > 0
    ? connectorResults.map(r => r.connector)
    : [...new Set(offers.map(o => o.source).filter(Boolean))]

  return {
    sessionId: generateSessionId(raw),
    originIata: raw.origin,
    destIata: raw.destination,
    originCity: raw.origin_city ?? '',
    destCity: raw.dest_city ?? '',
    searchedAt: raw.searched_at ?? new Date().toISOString(),
    searchParams: buildSearchParams(raw, safeContext as RawAgentContext),
    offers,
    stats,
    dataSources,
    connectorResults,
    targetCurrency: raw.currency ?? 'EUR',
  }
}
