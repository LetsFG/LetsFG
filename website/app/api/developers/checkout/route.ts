import { NextRequest, NextResponse } from 'next/server'
import { getLetsfgApiBase } from '../../../../lib/letsfg-api'

const API_BASE = getLetsfgApiBase()

/**
 * POST /api/developers/checkout
 *
 * Proxy to the backend's Stripe TEST checkout session creator.
 * Used by the SDK / test scripts to get a test Stripe checkout URL
 * without going through the live letsfg.co website UI.
 *
 * Body: { offer_id, offer_ref, payment_token, currency?, amount? }
 * Response: { checkout_url, stripe_session_id }
 *
 * The returned checkout_url is a real Stripe TEST checkout page.
 * Pay with card 4242 4242 4242 4242 (any future expiry / any CVC).
 * After payment, Stripe redirects to the backend success handler which
 * writes payment_token → booking_url to Firestore.
 * Then poll /api/developers/payment-verify?token={payment_token} as usual.
 *
 * Auth: caller provides their agent API key as X-API-Key.
 * The proxy uses Authorization: Bearer {LETSFG_WEBSITE_API_KEY} to satisfy
 * the backend's direct-host guard, while forwarding X-API-Key for agent auth.
 */
export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch (_) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Caller's agent API key — forwarded as X-API-Key for backend require_api_key
  const callerApiKey = req.headers.get('x-api-key') ?? ''
  // Internal website key — sent as Bearer to satisfy the direct-host guard
  const websiteApiKey = process.env.LETSFG_WEBSITE_API_KEY?.trim() ?? ''

  const upstreamHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(callerApiKey ? { 'X-API-Key': callerApiKey } : {}),
    ...(websiteApiKey ? { 'Authorization': `Bearer ${websiteApiKey}` } : {}),
  }

  try {
    const upstream = await fetch(
      `${API_BASE}/api/v1/developers/checkout/create-session`,
      {
        method: 'POST',
        headers: upstreamHeaders,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      },
    )

    const data = await upstream.json()
    return NextResponse.json(data, { status: upstream.status })
  } catch (err) {
    console.error('[developers/checkout] upstream error:', err)
    return NextResponse.json({ error: 'Backend error' }, { status: 502 })
  }
}
