/**
 * Durable search-cache client — calls the LetsFG-private backend's
 * `/api/v1/internal/search-cache/{search_id}` endpoint to persist completed
 * search results in Firestore.
 *
 * Why: `app/api/results/[searchId]/route.ts` polls FSW on every request.
 * FSW state is per-Cloud-Run-instance and ~10min TTL, so reloading the same
 * URL later returns a different/reranked/empty set. This client lets the
 * route serve cache-first so reloads stay stable. Origin:
 * ws_47776b352af74a1b reload-instability on 2026-05-23.
 *
 * All operations are best-effort: GET returns null on any failure, PUT
 * swallows errors. The website's user-visible flow must never break if the
 * backend cache is unavailable — it just falls through to live FSW polling.
 */

import { getLetsfgApiBase, withLetsfgWebsiteApiHeaders } from './letsfg-api'

export interface DurableCachedSearchResult {
  search_id: string
  status: string
  stored_at?: string
  offers: unknown[]
  parsed?: Record<string, unknown>
  query?: string
  total_results?: number
  cheapest_price?: number
  google_flights_price?: number
  value?: number
  savings_vs_google_flights?: number
  searched_at?: string
  expires_at?: string
  // Allow other fields to flow through.
  [key: string]: unknown
}

const REQUEST_TIMEOUT_MS = 1500

function endpointUrl(searchId: string): string {
  return `${getLetsfgApiBase()}/api/v1/internal/search-cache/${encodeURIComponent(searchId)}`
}

/**
 * Read a cached search result by id. Returns the full payload on a hit,
 * `null` on any miss / error / network failure.
 */
export async function getDurableSearchResult(searchId: string): Promise<DurableCachedSearchResult | null> {
  if (!searchId) return null

  try {
    const res = await fetch(endpointUrl(searchId), {
      method: 'GET',
      headers: withLetsfgWebsiteApiHeaders(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: 'no-store',
    })

    if (!res.ok) return null

    const body = await res.json() as { payload?: unknown }
    const payload = body?.payload
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null

    return payload as DurableCachedSearchResult
  } catch {
    return null
  }
}

/**
 * Persist a completed search result. Refuses non-`completed` payloads locally
 * (avoids round-trip for in-flight state). Swallows all backend / network
 * errors — caller never needs a try/catch.
 */
export async function putDurableSearchResult(searchId: string, payload: unknown): Promise<void> {
  if (!searchId) return

  // Local guard: only completed searches should be persisted. Mirrors the
  // backend's 400 response but avoids the round-trip.
  const status = (payload as { status?: unknown } | null)?.status
  if (status !== 'completed') return

  try {
    await fetch(endpointUrl(searchId), {
      method: 'PUT',
      headers: withLetsfgWebsiteApiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ payload }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: 'no-store',
    })
  } catch {
    // Best effort — never break the caller.
  }
}
