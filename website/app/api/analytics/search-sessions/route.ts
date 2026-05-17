import { NextRequest, NextResponse } from 'next/server'
import { getSessionUid } from '../../../../lib/session-uid'
import { getLetsfgAnalyticsApiBase, withLetsfgWebsiteApiHeaders } from '../../../../lib/letsfg-api'

const ANALYTICS_API_BASE = getLetsfgAnalyticsApiBase()

function debugHeaders(extra?: Record<string, string>) {
  return {
    'X-Letsfg-Analytics-Base': ANALYTICS_API_BASE,
    ...(extra || {}),
  }
}

function acceptedAnalyticsResponse(extra?: Record<string, string>) {
  // Browser analytics is best-effort. Upstream failures should not surface as
  // hard console errors on the results page when the user flow can continue.
  return new NextResponse(null, {
    status: 204,
    headers: debugHeaders(extra),
  })
}

export async function POST(request: NextRequest) {
  let bodyText = ''

  try {
    bodyText = await request.text()
    if (!bodyText) {
      return NextResponse.json({ error: 'Missing request body' }, { status: 400 })
    }

    const parsed = JSON.parse(bodyText)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const payload = parsed as Record<string, unknown>
    const sessionUid = getSessionUid(request)
    if (sessionUid && !String(payload.session_uid ?? '').trim()) {
      payload.session_uid = sessionUid
    }

    const response = await fetch(`${ANALYTICS_API_BASE}/api/v1/analytics/search-sessions/upsert`, {
      method: 'POST',
      headers: withLetsfgWebsiteApiHeaders({
        'Content-Type': 'application/json',
        'Origin': 'https://letsfg.co',
        'Referer': 'https://letsfg.co/',
        'User-Agent': request.headers.get('user-agent') || 'Mozilla/5.0 (compatible; LetsFG Website/1.0; +https://letsfg.co)',
      }),
      body: JSON.stringify(payload),
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    })

    if (!response.ok) {
      return acceptedAnalyticsResponse({
        'X-Letsfg-Analytics-Upstream-Status': String(response.status),
        'X-Letsfg-Analytics-Upstream-Url': response.url,
        'X-Letsfg-Analytics-Dropped': '1',
      })
    }

    const data = await response.json()
    return NextResponse.json(data, {
      headers: debugHeaders({
        'X-Letsfg-Analytics-Upstream-Status': String(response.status),
        'X-Letsfg-Analytics-Upstream-Url': response.url,
      }),
    })
  } catch (_) {
    return acceptedAnalyticsResponse({ 'X-Letsfg-Analytics-Dropped': '1' })
  }
}