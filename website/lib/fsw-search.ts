const FSW_URL = process.env.FSW_URL || 'https://flight-search-worker-qryvus4jia-uc.a.run.app'
const FSW_SECRET = process.env.FSW_SECRET || ''
const WEBSITE_SEARCH_LIMIT = 500

import { upsertSearchSessionServer } from './search-session-analytics-server'
import { getTrackingSearchId } from './probe-mode'

export interface WebSearchParams {
  origin: string
  destination: string
  date_from: string
  return_date?: string
  adults: number
  currency: string
  max_stops?: number
  cabin?: string
  via_iata?: string
  min_layover_hours?: number
  max_layover_hours?: number
}

export interface WebSearchAnalyticsContext {
  query?: string
  origin_name?: string
  destination_name?: string
  source?: string
  source_path?: string
  referrer_path?: string
  source_search_id?: string
  session_uid?: string
  is_test_search?: boolean
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
}

export interface StartWebSearchResult {
  searchId: string | null
  cache: 'hit' | 'miss'
  fswSession?: string  // Cloud Run __session affinity cookie — must be forwarded on all /web-status calls
}

export async function startWebSearch(
  params: WebSearchParams,
  analytics?: WebSearchAnalyticsContext,
  userIp?: string,
): Promise<StartWebSearchResult> {
  const startedAt = new Date().toISOString()
  const extraHeaders: Record<string, string> = {}
  if (userIp) extraHeaders['X-Client-IP'] = userIp
  const res = await fetch(`${FSW_URL}/web-search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${FSW_SECRET}`,
      ...extraHeaders,
    },
    body: JSON.stringify({
      origin: params.origin,
      destination: params.destination,
      date_from: params.date_from,
      return_date: params.return_date,
      adults: params.adults,
      currency: params.currency,
      limit: WEBSITE_SEARCH_LIMIT,
      ...(params.max_stops !== undefined ? { max_stops: params.max_stops } : {}),
      ...(params.cabin ? { cabin: params.cabin } : {}),
      ...(params.via_iata ? { via_iata: params.via_iata } : {}),
      ...(params.min_layover_hours !== undefined ? { min_layover_hours: params.min_layover_hours } : {}),
      ...(params.max_layover_hours !== undefined ? { max_layover_hours: params.max_layover_hours } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
  })

  if (!res.ok) {
    return { searchId: null, cache: 'miss' }
  }

  const data = await res.json()
  const searchId = typeof data.search_id === 'string' ? data.search_id : null

  if (searchId) {
    const isTestSearch = Boolean(analytics?.is_test_search)
    const analyticsSearchId = getTrackingSearchId(searchId, isTestSearch) || searchId

    await upsertSearchSessionServer({
      search_id: analyticsSearchId,
      query: analytics?.query,
      origin: params.origin,
      origin_name: analytics?.origin_name || params.origin,
      destination: params.destination,
      destination_name: analytics?.destination_name || params.destination,
      route: `${params.origin}-${params.destination}`,
      date_from: params.date_from,
      return_date: params.return_date,
      adults: params.adults,
      currency: params.currency,
      max_stops: params.max_stops,
      cabin: params.cabin,
      source: analytics?.utm_source || analytics?.source || 'website',
      source_path: analytics?.source_path,
      referrer_path: analytics?.referrer_path,
      source_search_id: analytics?.source_search_id || (isTestSearch ? searchId : undefined),
      session_uid: analytics?.session_uid,
      is_test_search: isTestSearch || undefined,
      utm_source: analytics?.utm_source,
      utm_medium: analytics?.utm_medium,
      utm_campaign: analytics?.utm_campaign,
      status: 'searching',
      cache_hit: Boolean(data.cache_hit),
      search_started_at: startedAt,
    })
  }

  // Capture the Cloud Run session affinity cookie so callers can forward it
  // on subsequent /web-status requests to guarantee the same FSW instance.
  const setCookieHeader = res.headers.get('set-cookie') || ''
  const sessionMatch = setCookieHeader.match(/(?:^|,)\s*__session=([^;,\s]+)/)
  const fswSession = sessionMatch ? sessionMatch[1] : undefined

  return {
    searchId,
    cache: data.cache_hit ? 'hit' : 'miss',
    fswSession,
  }
}

export interface ExploreSearchParams {
  origin: string
  date_from: string
  adults: number
  currency: string
  max_price?: number
  return_days?: number
}

export async function startExploreSearch(
  params: ExploreSearchParams,
): Promise<StartWebSearchResult> {
  const res = await fetch(`${FSW_URL}/web-explore`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${FSW_SECRET}`,
    },
    body: JSON.stringify({
      origin: params.origin,
      date_from: params.date_from,
      adults: params.adults,
      currency: params.currency,
      ...(params.max_price !== undefined ? { max_price: params.max_price } : {}),
      ...(params.return_days !== undefined ? { return_days: params.return_days } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
  })

  if (!res.ok) {
    return { searchId: null, cache: 'miss' }
  }

  const data = await res.json()
  const searchId = typeof data.search_id === 'string' ? data.search_id : null
  return { searchId, cache: 'miss' }
}