/**
 * GET /api/date-grid
 *
 * Returns the Google Flights ±3-day price grid for a given route + dates.
 * Used by the /refine page to show real price-flexibility signal.
 *
 * Resolution order:
 *   1. In-memory request cache       — if /api/parse-query already pre-warmed
 *      this exact (origin, dest, dep, ret), we just await the cached Promise.
 *   2. Backend endpoint              POST {LETSFG_API_URL}/api/v1/flights/date-grid
 *   3. Dev subprocess                LETSFG_DEV_DATE_GRID_PY=1 → Python connector
 *   4. 503                           — caller should show a graceful fallback
 *
 * Query params:
 *   origin       IATA code (3 letters), required
 *   destination  IATA code (3 letters), required
 *   dep          outbound date YYYY-MM-DD, required
 *   ret          return date YYYY-MM-DD, optional (one-way if omitted)
 */

import { NextRequest, NextResponse } from 'next/server'
import { getInflight, setInflight, type DateGridKey } from '../../lib/date-grid-cache'
import { scrapeDateGrid } from '../../lib/date-grid-scrape'

const ALLOWED_ORIGIN_RE = /^https:\/\/(www\.)?letsfg\.co$|^https:\/\/(\w[\w-]*---)?letsfg-website[\w-]*(?:\.[\w-]+)*\.run\.app$|^http:\/\/localhost(:\d+)?$/

const IATA_RE = /^[A-Z]{3}$/
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function validate(searchParams: URLSearchParams): { ok: true; key: DateGridKey } | { ok: false; error: string } {
  const origin = (searchParams.get('origin') ?? '').toUpperCase().trim()
  const destination = (searchParams.get('destination') ?? '').toUpperCase().trim()
  const dep = (searchParams.get('dep') ?? '').trim()
  const retRaw = (searchParams.get('ret') ?? '').trim()
  const ret = retRaw === '' ? null : retRaw
  if (!IATA_RE.test(origin)) return { ok: false, error: 'origin must be a 3-letter IATA code' }
  if (!IATA_RE.test(destination)) return { ok: false, error: 'destination must be a 3-letter IATA code' }
  if (!ISO_DATE_RE.test(dep)) return { ok: false, error: 'dep must be YYYY-MM-DD' }
  if (ret !== null && !ISO_DATE_RE.test(ret)) return { ok: false, error: 'ret must be YYYY-MM-DD or omitted' }
  return { ok: true, key: { origin, destination, dep, ret } }
}

export async function GET(request: NextRequest) {
  const origin = request.headers.get('origin') ?? ''
  if (origin && !ALLOWED_ORIGIN_RE.test(origin)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const params = validate(request.nextUrl.searchParams)
  if (!params.ok) {
    return NextResponse.json({ error: params.error }, { status: 400 })
  }

  // Coalesce: if parse-query already kicked off a scrape for this exact
  // (route, dates), reuse the in-flight Promise instead of starting a
  // second one.
  let promise = getInflight(params.key)
  if (!promise) {
    promise = setInflight(params.key, scrapeDateGrid(params.key))
  }

  const result = await promise
  if (!result) {
    return NextResponse.json(
      { error: 'date-grid unavailable — backend endpoint not deployed and LETSFG_DEV_DATE_GRID_PY not set' },
      { status: 503 },
    )
  }

  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
}
