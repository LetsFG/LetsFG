import { NextRequest, NextResponse } from 'next/server'
import { PFP_ACQUISITION_COOKIE, PFP_ACQUISITION_COOKIE_MAX_AGE } from '@/lib/pfp/analytics/pfp-acquisition'

/**
 * POST /api/pfp-cookie?route=[slug]
 *
 * Sets the PFP acquisition cookie so the next search can be attributed to a
 * Programmatic Flight Page visit. Called client-side from SetPfpAcquisitionCookie.
 */
export async function POST(request: NextRequest) {
  const route = request.nextUrl.searchParams.get('route')
  if (!route) {
    return NextResponse.json({ error: 'missing route' }, { status: 400 })
  }

  // Validate — only allow slug-like values (two IATA codes separated by dash)
  if (!/^[a-z]{2,4}-[a-z]{2,4}$/.test(route)) {
    return NextResponse.json({ error: 'invalid route' }, { status: 400 })
  }

  const response = NextResponse.json({ ok: true })
  response.cookies.set(PFP_ACQUISITION_COOKIE, encodeURIComponent(route), {
    maxAge: PFP_ACQUISITION_COOKIE_MAX_AGE,
    path: '/',
    sameSite: 'lax',
    httpOnly: false, // Must be readable client-side for cookie → search attribution
    secure: process.env.NODE_ENV === 'production',
  })
  return response
}
