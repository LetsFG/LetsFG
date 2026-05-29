import { buildRecommendationQualityPayload } from './recommendation-quality.ts'

export interface SearchSessionEventPayload {
  type: string
  at?: string
  data?: Record<string, unknown>
}

export interface SearchSessionOfferPreview {
  id?: string
  airline?: string
  price?: number
  currency?: string
  google_flights_price?: number
  stops?: number
  duration_minutes?: number
}

export interface SearchSessionPayload {
  search_id: string
  query?: string
  origin?: string
  origin_name?: string
  destination?: string
  destination_name?: string
  route?: string
  date_from?: string
  return_date?: string
  adults?: number
  currency?: string
  max_stops?: number
  cabin?: string
  source?: string
  source_path?: string
  referrer_path?: string
  referrer_host?: string
  source_search_id?: string
  session_uid?: string
  status?: string
  decision?: string
  is_test_search?: boolean
  cache_hit?: boolean
  search_started_at?: string
  search_completed_at?: string
  search_duration_ms?: number
  search_duration_seconds?: number
  results_count?: number
  cheapest_price?: number
  google_flights_price?: number
  value?: number
  savings_vs_google_flights?: number
  selected_offer_id?: string
  selected_offer_airline?: string
  selected_offer_currency?: string
  selected_offer_price?: number
  selected_offer_google_flights_price?: number
  revenue?: number
  potential_revenue?: number
  cost_per_search?: number
  other_costs?: number
  results_preview?: SearchSessionOfferPreview[]
  event?: SearchSessionEventPayload
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_term?: string
}

export interface ClarificationSearchSessionContext extends Omit<
  SearchSessionPayload,
  'search_id' | 'status' | 'decision' | 'event' | 'search_started_at' | 'search_completed_at' | 'search_duration_ms' | 'search_duration_seconds' | 'results_count' | 'cost_per_search'
> {
  search_id?: string
  follow_up_topics?: string[]
  missing_origin?: boolean
  missing_destination?: boolean
  needs_date_clarification?: boolean
  same_route?: boolean
}

function createEphemeralTrackingId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}:${crypto.randomUUID().replace(/-/g, '')}`
  }

  return `${prefix}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

export function generateClarificationSearchId(isProbe = false): string {
  const baseId = createEphemeralTrackingId('clarify')
  return isProbe ? `probe:${baseId}` : baseId
}

export function buildClarificationSearchSessionPayload(
  context: ClarificationSearchSessionContext,
): SearchSessionPayload {
  const now = new Date().toISOString()

  return {
    search_id: context.search_id || generateClarificationSearchId(Boolean(context.is_test_search)),
    query: context.query,
    origin: context.origin,
    origin_name: context.origin_name,
    destination: context.destination,
    destination_name: context.destination_name,
    route: context.route,
    date_from: context.date_from,
    return_date: context.return_date,
    adults: context.adults,
    currency: context.currency,
    max_stops: context.max_stops,
    cabin: context.cabin,
    source: context.source,
    source_path: context.source_path,
    referrer_path: context.referrer_path,
    referrer_host: context.referrer_host,
    session_uid: context.session_uid,
    is_test_search: context.is_test_search,
    utm_source: context.utm_source,
    utm_medium: context.utm_medium,
    utm_campaign: context.utm_campaign,
    utm_term: context.utm_term,
    status: 'clarification_required',
    decision: 'clarification_required',
    search_started_at: now,
    search_completed_at: now,
    search_duration_ms: 0,
    search_duration_seconds: 0,
    results_count: 0,
    cost_per_search: 0,
    event: {
      type: 'clarification_required',
      at: now,
      data: {
        follow_up_topics: context.follow_up_topics || [],
        missing_origin: Boolean(context.missing_origin),
        missing_destination: Boolean(context.missing_destination),
        needs_date_clarification: Boolean(context.needs_date_clarification),
        same_route: Boolean(context.same_route),
      },
    },
  }
}

interface TrackOptions {
  beacon?: boolean
  keepalive?: boolean
}

export function trackSearchSession(payload: SearchSessionPayload, options: TrackOptions = {}) {
  if (typeof window === 'undefined') {
    return
  }

  const body = JSON.stringify(payload)
  if (options.beacon && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    const sent = navigator.sendBeacon('/api/analytics/search-sessions', new Blob([body], { type: 'application/json' }))
    if (sent) {
      return
    }
  }

  void fetch('/api/analytics/search-sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: options.keepalive ?? options.beacon ?? false,
    cache: 'no-store',
  }).catch(() => {})
}

// ─── Growth model event builders ─────────────────────────────────────────────

export interface OfferSelectedEventData {
  offer_id: string
  position: number
  is_top3: boolean
  time_to_select_ms: number
  scroll_depth_at_select: number
}

export interface OfferSelectedInput {
  offer_id: string
  position: number
  results_viewed_at: string | null
  scroll_depth_pct: number
}

export function buildOfferSelectedEventData(input: OfferSelectedInput): OfferSelectedEventData {
  const time_to_select_ms = input.results_viewed_at
    ? Math.max(0, Date.now() - new Date(input.results_viewed_at).getTime())
    : 0

  return {
    offer_id: input.offer_id,
    position: input.position,
    is_top3: input.position <= 3,
    time_to_select_ms,
    scroll_depth_at_select: input.scroll_depth_pct,
  }
}

export interface RecommendationQualityEventData {
  search_id: string
  result_count: number
  connector_count: number
  top3_present: boolean
  price_vs_google_pct: number | null
  quality_score: number
  has_direct_flight: boolean
  min_stops: number
  carrier_diversity: number
}

export interface RecommendationQualityInput {
  search_id: string
  result_count: number
  connector_count: number
  has_direct_flight: boolean
  min_stops: number
  carrier_diversity: number
  cheapest_price: number | null
  google_flights_price: number | null
  search_duration_ms: number
}

export function buildRecommendationQualityEventData(
  input: RecommendationQualityInput,
): RecommendationQualityEventData {
  return buildRecommendationQualityPayload(input)
}

export interface ReturnVisitEventData {
  days_since_last_search: number
  prior_search_count: number
}

export function buildReturnVisitEventData(data: ReturnVisitEventData): ReturnVisitEventData {
  return data
}

export interface OfferSharedEventData {
  offer_id: string
  position: number
  share_method: 'copy_link' | 'native_share'
}

export function buildOfferSharedEventData(data: OfferSharedEventData): OfferSharedEventData {
  return data
}

export function trackSearchSessionEvent(
  searchId: string | null | undefined,
  type: string,
  data: Record<string, unknown> = {},
  fields: Omit<SearchSessionPayload, 'search_id' | 'event'> = {},
  options: TrackOptions = {},
) {
  if (!searchId) {
    return
  }

  trackSearchSession({
    search_id: searchId,
    ...fields,
    event: {
      type,
      at: new Date().toISOString(),
      data,
    },
  }, options)
}