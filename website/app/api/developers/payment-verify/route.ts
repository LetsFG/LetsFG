import { NextRequest, NextResponse } from 'next/server'
import { getLetsfgApiBase, withLetsfgWebsiteApiHeaders } from '../../../../lib/letsfg-api'
import { getRateLimitPolicy, getGlobalRateLimitStore, checkRateLimit, buildRateLimitClientKey } from '../../../../lib/rate-limit'
import { getSessionUid } from '../../../../lib/session-uid'

const API_BASE = getLetsfgApiBase()

/**
 * GET /api/developers/payment-verify?token={payment_token}
 *
 * Polling endpoint for SDK/CLI users who've sent a browser to the hosted
 * Stripe checkout (letsfg.co/book/{id}?ref={offer_ref}&pt={payment_token}).
 *
 * Returns {verified: false} until the Stripe payment webhook or verify
 * endpoint resolves the token, then returns {verified: true, booking_url}.
 *
 * SDK polling pattern:
 *   - Poll every 5 seconds for up to ~60 seconds (12 attempts).
 *   - Stop when verified=true or after max attempts.
 *
 * Rate limited to 12 requests/min per IP (covers one full polling cycle).
 */
export async function GET(req: NextRequest) {
  // Rate limiting
  const policy = getRateLimitPolicy(req.nextUrl.pathname)
  if (policy) {
    const store = getGlobalRateLimitStore()
    const uid = getSessionUid(req)
    const clientKey = buildRateLimitClientKey(req.headers, uid)
    const decision = checkRateLimit(store, clientKey, policy)
    if (!decision.allowed) {
      return NextResponse.json(
        { verified: false, error: 'Rate limit exceeded' },
        {
          status: 429,
          headers: {
            'Retry-After': String(Math.ceil(decision.retryAfterMs / 1000)),
            'X-RateLimit-Limit': String(decision.limit),
            'X-RateLimit-Remaining': String(decision.remaining),
          },
        },
      )
    }
  }

  const token = req.nextUrl.searchParams.get('token')?.trim()
  if (!token || token.length < 8 || token.length > 64) {
    return NextResponse.json({ verified: false, error: 'Invalid token' }, { status: 400 })
  }

  try {
    const upstream = await fetch(
      `${API_BASE}/api/v1/payment-tokens/${encodeURIComponent(token)}`,
      {
        method: 'GET',
        headers: withLetsfgWebsiteApiHeaders({ Accept: 'application/json' }),
        cache: 'no-store',
        signal: AbortSignal.timeout(8_000),
      },
    )

    if (upstream.status === 404) {
      return NextResponse.json({ verified: false })
    }

    if (!upstream.ok) {
      return NextResponse.json({ verified: false, error: 'Upstream error' }, { status: 502 })
    }

    const data = await upstream.json() as { verified?: boolean; booking_url?: string }
    return NextResponse.json({
      verified: Boolean(data.verified),
      ...(data.verified && data.booking_url ? { booking_url: data.booking_url } : {}),
    })
  } catch (err) {
    console.error('[payment-verify] upstream fetch failed:', err)
    // Return verified=false rather than surfacing a 5xx — the SDK can retry.
    return NextResponse.json({ verified: false, error: 'Service unavailable' }, { status: 503 })
  }
}
