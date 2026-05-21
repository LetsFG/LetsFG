import { NextRequest, NextResponse } from 'next/server'
import { getLetsfgApiBase, withLetsfgWebsiteApiHeaders } from '../../../../lib/letsfg-api'

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
 */
export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch (_) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Forward the caller's agent API key to the backend (required by require_api_key)
  const callerApiKey = req.headers.get('x-api-key') ?? ''

  try {
    const upstream = await fetch(
      `${API_BASE}/api/v1/developers/checkout/create-session`,
      {
        method: 'POST',
        headers: withLetsfgWebsiteApiHeaders({
          'Content-Type': 'application/json',
          ...(callerApiKey ? { 'X-API-Key': callerApiKey } : {}),
        }),
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
