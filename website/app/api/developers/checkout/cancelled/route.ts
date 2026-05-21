import { type NextRequest, NextResponse } from 'next/server'
import { getLetsfgApiBase } from '../../../../../lib/letsfg-api'

const API_BASE = getLetsfgApiBase()

/**
 * GET /api/developers/checkout/cancelled
 *
 * Stripe redirects here when the developer cancels a TEST checkout session.
 * Proxies to the backend's cancelled page.
 */
export async function GET(_req: NextRequest) {
  const websiteApiKey = process.env.LETSFG_WEBSITE_API_KEY?.trim() ?? ''

  try {
    const upstream = await fetch(`${API_BASE}/api/v1/developers/checkout/cancelled`, {
      method: 'GET',
      headers: {
        ...(websiteApiKey ? { Authorization: `Bearer ${websiteApiKey}` } : {}),
      },
      signal: AbortSignal.timeout(10_000),
    })

    const html = await upstream.text()
    return new NextResponse(html, {
      status: upstream.status,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  } catch (err) {
    console.error('[developers/checkout/cancelled] upstream error:', err)
    return new NextResponse(
      '<html><body><h1>Cancelled</h1><p>Test payment was cancelled.</p></body></html>',
      { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    )
  }
}
