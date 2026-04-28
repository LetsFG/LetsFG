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
  source_search_id?: string
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