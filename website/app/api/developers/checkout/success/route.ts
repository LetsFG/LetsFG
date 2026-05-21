import { type NextRequest, NextResponse } from 'next/server'
import { getLetsfgApiBase } from '../../../../../lib/letsfg-api'

const API_BASE = getLetsfgApiBase()

/**
 * GET /api/developers/checkout/success
 *
 * Stripe redirects the developer's browser here after a successful TEST payment.
 * We proxy to the backend's /api/v1/developers/checkout/success, adding the
 * internal website API key so the DirectHostGuardMiddleware lets us through.
 * The backend verifies the Stripe session, decrypts the offer_ref, stores
 * payment_token → booking_url in Firestore, and returns an HTML confirmation page.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)

  const upstreamUrl = new URL(`${API_BASE}/api/v1/developers/checkout/success`)
  searchParams.forEach((value, key) => upstreamUrl.searchParams.set(key, value))

  const websiteApiKey = process.env.LETSFG_WEBSITE_API_KEY?.trim() ?? ''

  try {
    const upstream = await fetch(upstreamUrl.toString(), {
      method: 'GET',
      headers: {
        ...(websiteApiKey ? { Authorization: `Bearer ${websiteApiKey}` } : {}),
      },
      signal: AbortSignal.timeout(15_000),
    })

    const html = await upstream.text()
    return new NextResponse(html, {
      status: upstream.status,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  } catch (err) {
    console.error('[developers/checkout/success] upstream error:', err)
    return new NextResponse(
      '<html><body><h1>Error</h1><p>Could not reach payment verification backend.</p></body></html>',
      { status: 502, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    )
  }
}
