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
import { getInflight, setInflight, type DateGridKey, type DateGridPayload } from '../../lib/date-grid-cache'
import { scrapeDateGrid } from '../../lib/date-grid-scrape'
import { getLiveFxRates } from '../../../lib/live-fx'
import { convertCurrencyAmount, normalizeCurrencyCode } from '../../../lib/display-price'

const ALLOWED_ORIGIN_RE = /^https:\/\/(www\.)?letsfg\.co$|^https:\/\/(\w[\w-]*---)?letsfg-website[\w-]*(?:\.[\w-]+)*\.run\.app$|^http:\/\/localhost(:\d+)?$/

const IATA_RE = /^[A-Z]{3}$/
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function validate(searchParams: URLSearchParams): { ok: true; key: DateGridKey; targetCurrency: string } | { ok: false; error: string } {
  const origin = (searchParams.get('origin') ?? '').toUpperCase().trim()
  const destination = (searchParams.get('destination') ?? '').toUpperCase().trim()
  const dep = (searchParams.get('dep') ?? '').trim()
  const retRaw = (searchParams.get('ret') ?? '').trim()
  const ret = retRaw === '' ? null : retRaw
  // Optional `cur` query param — converts EUR prices (Google's response) to the
  // user's selected currency using the same live FX rates as the rest of the
  // app. Defaults to EUR (no conversion).
  const targetCurrency = normalizeCurrencyCode(searchParams.get('cur') ?? 'EUR') ?? 'EUR'
  if (!IATA_RE.test(origin)) return { ok: false, error: 'origin must be a 3-letter IATA code' }
  if (!IATA_RE.test(destination)) return { ok: false, error: 'destination must be a 3-letter IATA code' }
  if (!ISO_DATE_RE.test(dep)) return { ok: false, error: 'dep must be YYYY-MM-DD' }
  if (ret !== null && !ISO_DATE_RE.test(ret)) return { ok: false, error: 'ret must be YYYY-MM-DD or omitted' }
  return { ok: true, key: { origin, destination, dep, ret }, targetCurrency }
}

async function convertPayload(payload: DateGridPayload, targetCurrency: string): Promise<DateGridPayload> {
  if (!payload || !Array.isArray(payload.grid) || payload.grid.length === 0) return payload
  const target = normalizeCurrencyCode(targetCurrency) ?? 'EUR'
  // If everything in the payload is already in the target currency, no work.
  if ((payload.currency ?? '').toUpperCase() === target && payload.grid.every(c => (c.currency ?? '').toUpperCase() === target)) {
    return payload
  }
  // Fetch live rates once (cached with a 6h TTL by getLiveFxRates).
  let rates
  try {
    rates = await getLiveFxRates()
  } catch {
    // If FX fails entirely, return the original payload — better to show
    // some prices in the wrong currency than no prices at all.
    return payload
  }
  return {
    ...payload,
    currency: target,
    grid: payload.grid.map(c => {
      const sourceCcy = (c.currency ?? payload.currency ?? 'EUR').toUpperCase()
      const converted = convertCurrencyAmount(c.price, sourceCcy, target, rates)
      // Date grid prices are whole-integer travel-money numbers — keep them ints.
      return { ...c, currency: target, price: Math.round(converted) }
    }),
  }
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

  // Convert to the user's display currency using live FX (same rates the
  // offer prices use). Scrape always lands in EUR (the connector's default).
  const converted = await convertPayload(result, params.targetCurrency)
  return NextResponse.json(converted, { headers: { 'Cache-Control': 'no-store' } })
}
