import { cookies, headers } from 'next/headers'
import { LETSFG_CURRENCY_COOKIE, resolveSearchCurrency } from '../../../lib/currency-preference'
import { appendProbeParam } from '../../../lib/probe-mode'
import { detectPreferredCurrency } from '../../../lib/user-currency'
import type { SearchResult } from './search-share-model'

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://letsfg.co'
export const INITIAL_SEARCH_RESULTS_TIMEOUT_MS = 1200

export async function getApiBase(): Promise<string> {
  const explicitBase = process.env.API_URL?.trim()
  if (explicitBase) {
    return explicitBase.replace(/\/$/, '')
  }

  const headerList = await headers()
  const host = headerList.get('x-forwarded-host') || headerList.get('host')
  if (host) {
    const proto = headerList.get('x-forwarded-proto') || (host.includes('localhost') ? 'http' : 'https')
    return `${proto}://${host}`
  }

  return SITE_URL
}

export async function getSearchResults(searchId: string, isProbe: boolean, fswSession?: string): Promise<SearchResult | null> {
  return getSearchResultsWithTimeout(searchId, isProbe, fswSession)
}

export async function getInitialSearchResults(searchId: string, isProbe: boolean, fswSession?: string): Promise<SearchResult | null> {
  return getSearchResultsWithTimeout(searchId, isProbe, fswSession, INITIAL_SEARCH_RESULTS_TIMEOUT_MS)
}

async function getSearchResultsWithTimeout(
  searchId: string,
  isProbe: boolean,
  fswSession?: string,
  timeoutMs?: number,
): Promise<SearchResult | null> {
  try {
    const apiBase = await getApiBase()
    const url = new URL(`/api/results/${searchId}`, apiBase)
    appendProbeParam(url.searchParams, isProbe)
    if (fswSession) url.searchParams.set('_fss', fswSession)
    const res = await fetch(url.toString(), {
      cache: 'no-store',
      ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

export async function resolveRequestCurrency(queryParam?: string): Promise<string> {
  const requestHeaders = await headers()
  const cookieStore = await cookies()

  return resolveSearchCurrency({
    queryParam: queryParam?.trim(),
    cookieValue: cookieStore.get(LETSFG_CURRENCY_COOKIE)?.value,
    fallback: detectPreferredCurrency(requestHeaders),
  })
}