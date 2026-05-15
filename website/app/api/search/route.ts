import { NextRequest, NextResponse } from 'next/server'
import { recordLocalSearch } from '../../lib/stats'
import { parseNLQuery } from '../../lib/searchParsing'
import { applyVertexIntent } from '../../lib/vertex-intent'
import { vertexParse } from '../../lib/vertex-parse'
import { lookupNearbyAirport, resolveNearbyAirport, isUsableIata, type NearbyAirportFallback } from '../../lib/nearby-airports'
import { startWebSearch } from '../../../lib/fsw-search'
import { setSearchMeta, type FallbackNote } from '../../../lib/results-cache'
import { getTrackedSourcePath, isProbeModeValue } from '../../../lib/probe-mode'
import { getSessionUid } from '../../../lib/session-uid'
import { detectPreferredCurrency } from '../../../lib/user-currency'

// ── POST /api/search ─────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const isProbeSearch = isProbeModeValue(body.probe)

    let origin: string | undefined
    let originName: string | undefined
    let destination: string | undefined
    let destinationName: string | undefined
    let dateFrom: string | undefined
    let returnDate: string | undefined
    let adults = Math.max(1, parseInt(body.adults ?? '1', 10) || 1)
    const currency = typeof body.currency === 'string' && body.currency.trim()
      ? body.currency.toUpperCase()
      : detectPreferredCurrency(request.headers)
    let maxStops: number | undefined
    let preferredStops: number | undefined  // soft preference surfaced to the UI
    let cabin: string | undefined
    let viaIata: string | undefined
    let minLayoverHours: number | undefined
    let maxLayoverHours: number | undefined
    // Captured by the NL/Gemini path so the post-resolution nearby-airport
    // fallback can paraphrase the user's intended city in the fallback note,
    // and so the geo-based fallback (`resolveNearbyAirport`) can find the
    // closest commercial airport using Gemini-supplied lat/lon.
    let aiOriginCity: string | undefined
    let aiDestinationCity: string | undefined
    let aiOriginLat: number | undefined
    let aiOriginLon: number | undefined
    let aiDestinationLat: number | undefined
    let aiDestinationLon: number | undefined
    // AI intent fields extracted by Gemini — forwarded to client in `parsed`
    let _aiIntent: Record<string, unknown> = {}
    let _parsedContext: Record<string, unknown> = {}

    if (body.origin && body.destination && body.date_from) {
      origin = (body.origin as string).toUpperCase().trim()
      originName = body.origin_name || origin
      destination = (body.destination as string).toUpperCase().trim()
      destinationName = body.destination_name || destination
      dateFrom = body.date_from
      returnDate = body.return_date || undefined
      if (body.max_stops !== undefined && body.max_stops !== null && body.max_stops !== '') {
        maxStops = parseInt(body.max_stops, 10)
        preferredStops = maxStops
      }
      cabin = body.cabin ? String(body.cabin).toUpperCase() : undefined
      viaIata = body.via_iata ? String(body.via_iata).toUpperCase().trim() : undefined
      if (body.min_layover_hours !== undefined) minLayoverHours = parseFloat(body.min_layover_hours)
      if (body.max_layover_hours !== undefined) maxLayoverHours = parseFloat(body.max_layover_hours)
    } else if (body.query) {
      // Fire Gemini immediately so it runs in parallel with synchronous parsing below.
      const today = new Date().toISOString().slice(0, 10)
      const _aiPromise = vertexParse(body.query as string, today).catch(() => null)

      const parsed = parseNLQuery(body.query)
      origin = parsed.origin
      originName = parsed.origin_name
      destination = parsed.destination
      destinationName = parsed.destination_name
      dateFrom = parsed.date
      returnDate = parsed.return_date || undefined
      // NL queries like "direct flights only" set parsed.stops = 0. We do NOT
      // forward stops === 0 as a HARD backend filter, because many real routes
      // (e.g. GDL → EZE) have zero direct service and the search would return
      // nothing at all — the UI would poll forever with no offers.
      // Instead, we keep the signal in the response payload so the results
      // page can use it as a ranking preference (`preferDirect` boost + the
      // "guarantee a min-stops alternative in top 3" logic in ResultsPanel).
      // Other stops values (1, 2) are still safe to use as a hard filter.
      maxStops = parsed.stops !== undefined && parsed.stops > 0 ? parsed.stops : undefined
      preferredStops = parsed.stops
      cabin = parsed.cabin ? String(parsed.cabin).toUpperCase() : undefined
      viaIata = parsed.via_iata
      minLayoverHours = parsed.min_layover_hours
      maxLayoverHours = parsed.max_layover_hours
      // Apply regex-parsed passenger count (override default of 1)
      if (parsed.adults && parsed.adults > 1) adults = parsed.adults

      // ── Gemini: city resolution + intent extraction ────────────────────────────────────────
      // Promise was fired at top; synchronous ops above absorbed most latency.
      const _ai = await _aiPromise

      if (_ai) {
        const applied = applyVertexIntent(parsed, _ai, adults)
        origin = applied.origin
        originName = applied.originName
        destination = applied.destination
        destinationName = applied.destinationName
        viaIata = applied.viaIata
        dateFrom = applied.dateFrom
        returnDate = applied.returnDate
        adults = applied.adults
        if (!cabin && applied.cabin) cabin = applied.cabin
        aiOriginCity = applied.aiOriginCity
        aiDestinationCity = applied.aiDestinationCity
        aiOriginLat = applied.aiOriginLat
        aiOriginLon = applied.aiOriginLon
        aiDestinationLat = applied.aiDestinationLat
        aiDestinationLon = applied.aiDestinationLon
        Object.assign(_aiIntent, applied.aiIntent)
      }

      if (parsed.min_trip_days !== undefined) _parsedContext.min_trip_days = parsed.min_trip_days
      if (parsed.max_trip_days !== undefined) _parsedContext.max_trip_days = parsed.max_trip_days
      if (parsed.require_cancellation) _parsedContext.require_cancellation = true
    } else {
      return NextResponse.json({ error: 'Provide either query or origin/destination/date_from' }, { status: 400 })
    }

    // ── Nearby-airport fallback ───────────────────────────────────────
    // Two-stage: (1) curated overrides for famous airport-less cities
    // (Pretoria → JNB, Vatican → FCO, Niagara Falls → BUF, etc.) which
    // encode "human practical answer", then (2) a global geo-lookup using
    // Gemini-supplied lat/lon against the bundled OurAirports DB (~3,300
    // large/medium airports with IATA + scheduled service). Together
    // these cover ANY named city worldwide — no more 5-minute zero-result
    // waits because the user typed a city we'd never heard of.
    const fallbackNotes: { origin?: FallbackNote; destination?: FallbackNote } = {}
    const tryFallback = (
      candidates: Array<string | undefined>,
      lat: number | undefined,
      lon: number | undefined,
    ): NearbyAirportFallback | null => {
      for (const c of candidates) {
        if (!c) continue
        const hit = lookupNearbyAirport(c)
        if (hit) return hit
      }
      // Geo-based fallback. Pass the first non-empty candidate as the
      // human label so the resulting note reads naturally.
      const cityLabel = candidates.find((c): c is string => Boolean(c && c.trim())) || ''
      return resolveNearbyAirport(cityLabel, lat, lon)
    }
    const queryStr = typeof body.query === 'string' ? body.query : ''

    // "Ghost" IATAs: codes that exist in our city alias map but have no
    // scheduled commercial service (PRY = Wonderboom/Pretoria, etc.). The
    // parser/Gemini path may resolve to them — we clear them so the
    // fallback runs and swaps in a real hub. Track the original city
    // label (preferring the Gemini-normalized name, then the parser's
    // friendly name, then the raw query) so the fallback note still
    // names what the user typed.
    const ghostOriginCity = (!isUsableIata(origin)) ? (aiOriginCity || originName || queryStr) : undefined
    const ghostDestinationCity = (!isUsableIata(destination)) ? (aiDestinationCity || destinationName || queryStr) : undefined
    if (ghostOriginCity) { origin = undefined; originName = undefined }
    if (ghostDestinationCity) { destination = undefined; destinationName = undefined }

    if (!origin) {
      const hit = tryFallback([ghostOriginCity, aiOriginCity, queryStr], aiOriginLat, aiOriginLon)
      if (hit) {
        origin = hit.code
        originName = hit.name
        fallbackNotes.origin = {
          intended: aiOriginCity || queryStr.trim() || hit.name,
          used_code: hit.code,
          used_name: hit.name,
          hub_name: hit.hub_name,
          reason: hit.reason,
        }
      }
    }
    if (!destination) {
      const hit = tryFallback([ghostDestinationCity, aiDestinationCity, queryStr], aiDestinationLat, aiDestinationLon)
      if (hit) {
        destination = hit.code
        destinationName = hit.name
        fallbackNotes.destination = {
          intended: aiDestinationCity || queryStr.trim() || hit.name,
          used_code: hit.code,
          used_name: hit.name,
          hub_name: hit.hub_name,
          reason: hit.reason,
        }
      }
    }

    if (!origin || !destination) {
      return NextResponse.json({ error: 'Could not determine origin or destination.' }, { status: 400 })
    }

    recordLocalSearch()

    const userIp = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || undefined

    const { searchId, cache, fswSession } = await startWebSearch({
      origin,
      destination,
      date_from: dateFrom!,
      return_date: returnDate,
      adults,
      currency,
      ...(maxStops !== undefined ? { max_stops: maxStops } : {}),
      ...(cabin ? { cabin } : {}),
      ...(viaIata ? { via_iata: viaIata } : {}),
      ...(minLayoverHours !== undefined ? { min_layover_hours: minLayoverHours } : {}),
      ...(maxLayoverHours !== undefined ? { max_layover_hours: maxLayoverHours } : {}),
    }, {
      query: typeof body.query === 'string' ? body.query : undefined,
      origin_name: originName,
      destination_name: destinationName,
      source: 'website-api-search',
      source_path: getTrackedSourcePath('/api/search', isProbeSearch),
      session_uid: getSessionUid(request) ?? undefined,
      is_test_search: isProbeSearch,
    }, userIp)

    if (!searchId) {
      return NextResponse.json({ error: 'Search service unavailable' }, { status: 502 })
    }

    const parsedResponse = {
      origin,
      origin_name: originName,
      destination,
      destination_name: destinationName,
      date: dateFrom,
      return_date: returnDate,
      passengers: adults,
      ...(preferredStops !== undefined ? { stops: preferredStops } : {}),
      ...(cabin ? { cabin } : {}),
      ..._parsedContext,
      ..._aiIntent,
      ...(fallbackNotes.origin || fallbackNotes.destination
        ? { fallback_notes: fallbackNotes }
        : {}),
    }

    // Persist any fallback notes so /api/results can merge them into the
    // poll response (FSW doesn't know about our website-side resolution).
    if (fallbackNotes.origin || fallbackNotes.destination || Object.keys(parsedResponse).length > 0) {
      setSearchMeta(searchId, {
        ...(fallbackNotes.origin || fallbackNotes.destination ? { fallback_notes: fallbackNotes } : {}),
        parsed_context: parsedResponse,
      })
    }

    return NextResponse.json({
      search_id: searchId,
      status: 'searching',
      cache,
      // Cloud Run __session affinity token for the FSW instance that owns
      // this search. The client must forward it as `_fss` on every poll —
      // otherwise the load balancer routes the poll to a different FSW
      // instance, which returns 404 and the UI shows "Search expired".
      ...(fswSession ? { fsw_session: fswSession } : {}),
      parsed: parsedResponse,
    })
  } catch (error) {
    console.error('Search error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
