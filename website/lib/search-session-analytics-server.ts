import type { SearchSessionPayload } from './search-session-analytics'
import { getLetsfgAnalyticsApiBase, withLetsfgWebsiteApiHeaders } from './letsfg-api'

const ANALYTICS_API_BASE = getLetsfgAnalyticsApiBase()

export async function upsertSearchSessionServer(payload: SearchSessionPayload) {
  try {
    const res = await fetch(`${ANALYTICS_API_BASE}/api/v1/analytics/search-sessions/upsert`, {
      method: 'POST',
      headers: withLetsfgWebsiteApiHeaders({
        'Content-Type': 'application/json',
        'Origin': 'https://letsfg.co',
        'Referer': 'https://letsfg.co/',
        'User-Agent': 'Mozilla/5.0 (compatible; LetsFG Website/1.0; +https://letsfg.co)',
      }),
      body: JSON.stringify(payload),
      cache: 'no-store',
      signal: AbortSignal.timeout(2500),
    })

    return res.ok
  } catch {
    return false
  }
}