import { NextRequest, NextResponse } from 'next/server'
import { recordLocalSearch } from '../../lib/stats'
import { parseNLQuery, type ParsedQuery } from '../../lib/searchParsing'
import { buildHomeConvoTopicOrder, getRequiredSearchClarificationTopics, getSearchClarificationState, isSearchLaunchReady, needsDateClarification, normalizeHomeConvoFollowUpTopics, type HomeConvoFollowUpTopic } from '../../lib/home-search-assist'
import { applyVertexIntent } from '../../lib/vertex-intent'
import { vertexParse, type VertexFollowUpQuestion } from '../../lib/vertex-parse'
import { startWebSearch } from '../../../lib/fsw-search'
import { setSearchMeta } from '../../../lib/results-cache'
import { getTrackedSourcePath, isProbeModeValue } from '../../../lib/probe-mode'
import { getSessionUid } from '../../../lib/session-uid'
import { buildRateLimitClientKey, checkRouteBurst, getGlobalRouteBurstStore, getRouteBurstPolicy } from '../../../lib/rate-limit'
import { buildClarificationSearchSessionPayload } from '../../../lib/search-session-analytics'
import { upsertSearchSessionServer } from '../../../lib/search-session-analytics-server'
import { detectPreferredCurrency } from '../../../lib/user-currency'
import { resolveSearchLaunchRoute } from '../../../lib/search-launch-route'
import { getPrimaryTripPurpose, normalizeTripPurposes, type TripPurpose } from '../../lib/trip-purpose'

function getReferrerContext(request: NextRequest): {
  referrer_path?: string
  referrer_host?: string
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_term?: string
} {
  const referer = request.headers.get('referer')
  if (!referer) {
    return {}
  }

  try {
    const url = new URL(referer)
    return {
      referrer_path: url.pathname || undefined,
      referrer_host: url.host || undefined,
      utm_source: url.searchParams.get('utm_source') || undefined,
      utm_medium: url.searchParams.get('utm_medium') || undefined,
      utm_campaign: url.searchParams.get('utm_campaign') || undefined,
      utm_term: url.searchParams.get('utm_term') || undefined,
    }
  } catch {
    return {}
  }
}

function parseClockTimeToMinutes(value: string | null | undefined): number | undefined {
  if (!value) return undefined
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return undefined

  const hours = parseInt(match[1], 10)
  const minutes = parseInt(match[2], 10)
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return undefined
  return hours * 60 + minutes
}

function normalizeCabinCode(value: unknown): ParsedQuery['cabin'] {
  const normalized = typeof value === 'string' ? value.toUpperCase().trim() : ''

  switch (normalized) {
    case 'M':
    case 'W':
    case 'C':
    case 'F':
      return normalized
    default:
      return undefined
  }
}

// ── POST /api/search ─────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const isProbeSearch = isProbeModeValue(body.probe)
    const queryText = typeof body.query === 'string' ? body.query : ''

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
    let cabin: ParsedQuery['cabin'] | undefined
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
    let failedOriginRaw: string | undefined
    let failedDestinationRaw: string | undefined
    let parsedQuery: ReturnType<typeof parseNLQuery> | null = null
    let aiParsed: Awaited<ReturnType<typeof vertexParse>> | null = null
    let aiFollowUpTopics: HomeConvoFollowUpTopic[] = []
    let aiFollowUpQuestions: VertexFollowUpQuestion[] = []
    // AI intent fields extracted by Gemini — forwarded to client in `parsed`
    let _aiIntent: Record<string, unknown> = {}
    let _parsedContext: Record<string, unknown> = {}
    // Extra context forwarded from the convo wizard via the fast path pre-fire.
    // These satisfy isSearchLaunchReady without requiring a Gemini re-parse.
    let fastPathTripPurpose: TripPurpose | undefined
    let fastPathSortBy: 'price' | 'duration' | undefined
    let fastPathPassengerContext: 'solo' | 'couple' | 'family' | 'group' | 'business_traveler' | undefined

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
      cabin = normalizeCabinCode(body.cabin)
      viaIata = body.via_iata ? String(body.via_iata).toUpperCase().trim() : undefined
      if (body.min_layover_hours !== undefined) minLayoverHours = parseFloat(body.min_layover_hours)
      if (body.max_layover_hours !== undefined) maxLayoverHours = parseFloat(body.max_layover_hours)
      // Convo-wizard context forwarded from home-search-form.tsx to satisfy isSearchLaunchReady.
      fastPathTripPurpose = typeof body.trip_purpose === 'string' && body.trip_purpose.trim() ? body.trip_purpose.trim() as TripPurpose : undefined
      fastPathSortBy = body.sort_by === 'price' || body.sort_by === 'duration' ? body.sort_by as 'price' | 'duration' : undefined
      fastPathPassengerContext = typeof body.passenger_context === 'string' && ['solo', 'couple', 'family', 'group', 'business_traveler'].includes(body.passenger_context)
        ? body.passenger_context as 'solo' | 'couple' | 'family' | 'group' | 'business_traveler'
        : undefined
    } else if (body.query) {
      // Fire Gemini immediately so it runs in parallel with synchronous parsing below.
      const today = new Date().toISOString().slice(0, 10)
      const _aiPromise = vertexParse(body.query as string, today).catch(() => null)

      const parsed = parseNLQuery(body.query)
      parsedQuery = parsed
      origin = parsed.origin
      originName = parsed.origin_name
      destination = parsed.destination
      destinationName = parsed.destination_name
      failedOriginRaw = parsed.failed_origin_raw
      failedDestinationRaw = parsed.failed_destination_raw
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
      cabin = parsed.cabin
      viaIata = parsed.via_iata
      minLayoverHours = parsed.min_layover_hours
      maxLayoverHours = parsed.max_layover_hours
      // Apply regex-parsed passenger count (override default of 1)
      if (parsed.adults && parsed.adults > 1) adults = parsed.adults

      // ── Gemini: city resolution + intent extraction ────────────────────────────────────────
      // Promise was fired at top; synchronous ops above absorbed most latency.
      aiParsed = await _aiPromise

      if (aiParsed) {
        aiFollowUpTopics = normalizeHomeConvoFollowUpTopics(aiParsed.follow_up_topics)
        aiFollowUpQuestions = Array.isArray(aiParsed.follow_up_questions)
          ? aiParsed.follow_up_questions
          : []
        const applied = applyVertexIntent(parsed, aiParsed, adults)
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

    const resolvedRoute = resolveSearchLaunchRoute({
      origin,
      originName,
      failedOriginRaw,
      destination,
      destinationName,
      failedDestinationRaw,
      aiOriginCity,
      aiDestinationCity,
      aiOriginLat,
      aiOriginLon,
      aiDestinationLat,
      aiDestinationLon,
    })
    origin = resolvedRoute.origin
    originName = resolvedRoute.originName
    destination = resolvedRoute.destination
    destinationName = resolvedRoute.destinationName
    const fallbackNotes = resolvedRoute.fallbackNotes

    const mergedTripPurposes = normalizeTripPurposes({
      tripPurpose: parsedQuery?.trip_purpose ?? fastPathTripPurpose,
      tripPurposes: [...(parsedQuery?.trip_purposes ?? []), ...(aiParsed?.trip_purposes ?? []), aiParsed?.trip_purpose],
    })
    const primaryTripPurpose = getPrimaryTripPurpose({
      tripPurpose: parsedQuery?.trip_purpose ?? fastPathTripPurpose,
      tripPurposes: mergedTripPurposes,
    })
    const passengerContext = parsedQuery?.passenger_context ?? aiParsed?.passenger_context ?? fastPathPassengerContext ?? undefined
    const effectiveStops = preferredStops ?? (aiParsed?.direct_only ? 0 : undefined)
    const effectivePreferredSort = parsedQuery?.preferred_sort ?? aiParsed?.sort_by ?? fastPathSortBy ?? undefined
    const effectiveDepartTimePref = parsedQuery?.depart_time_pref ?? aiParsed?.dep_time_pref ?? undefined
    const effectiveReturnDepartTimePref = parsedQuery?.return_depart_time_pref ?? aiParsed?.ret_time_pref ?? undefined
    const effectiveDepartAfterMins = parsedQuery?.depart_after_mins ?? parseClockTimeToMinutes(aiParsed?.depart_after)
    const effectiveDepartBeforeMins = parsedQuery?.depart_before_mins ?? parseClockTimeToMinutes(aiParsed?.depart_before)
    const requireCheckedBaggage = parsedQuery?.require_checked_baggage ?? (aiParsed?.bags_included === true ? true : undefined)

    const parsedResponse = {
      origin,
      origin_name: originName,
      destination,
      destination_name: destinationName,
      date: dateFrom,
      return_date: returnDate,
      passengers: adults,
      ...(effectiveStops !== undefined ? { stops: effectiveStops } : {}),
      ...(cabin ? { cabin } : {}),
      ...(passengerContext ? { passenger_context: passengerContext } : {}),
      ...(mergedTripPurposes.length > 0 ? { trip_purposes: mergedTripPurposes, trip_purpose: primaryTripPurpose } : {}),
      ...(effectivePreferredSort ? { preferred_sort: effectivePreferredSort } : {}),
      ...(effectiveDepartTimePref ? { depart_time_pref: effectiveDepartTimePref } : {}),
      ...(effectiveReturnDepartTimePref ? { return_depart_time_pref: effectiveReturnDepartTimePref } : {}),
      ...(effectiveDepartAfterMins !== undefined ? { depart_after_mins: effectiveDepartAfterMins } : {}),
      ...(effectiveDepartBeforeMins !== undefined ? { depart_before_mins: effectiveDepartBeforeMins } : {}),
      ...(requireCheckedBaggage ? { require_checked_baggage: true } : {}),
      ..._parsedContext,
      ..._aiIntent,
      ...(fallbackNotes.origin || fallbackNotes.destination
        ? { fallback_notes: fallbackNotes }
        : {}),
    }

    const parsedForLaunch = {
      ...(parsedQuery ?? {}),
      origin,
      origin_name: originName,
      destination,
      destination_name: destinationName,
      date: dateFrom,
      return_date: returnDate,
      adults,
      ...(effectiveStops !== undefined ? { stops: effectiveStops } : {}),
      ...(cabin ? { cabin } : {}),
      ...(passengerContext ? { passenger_context: passengerContext } : {}),
      ...(mergedTripPurposes.length > 0 ? { trip_purposes: mergedTripPurposes, trip_purpose: primaryTripPurpose } : {}),
      ...(effectivePreferredSort ? { preferred_sort: effectivePreferredSort } : {}),
      ...(effectiveDepartTimePref ? { depart_time_pref: effectiveDepartTimePref } : {}),
      ...(effectiveReturnDepartTimePref ? { return_depart_time_pref: effectiveReturnDepartTimePref } : {}),
      ...(effectiveDepartAfterMins !== undefined ? { depart_after_mins: effectiveDepartAfterMins } : {}),
      ...(effectiveDepartBeforeMins !== undefined ? { depart_before_mins: effectiveDepartBeforeMins } : {}),
      ...(requireCheckedBaggage ? { require_checked_baggage: true } : {}),
      failed_origin_raw: failedOriginRaw,
      failed_destination_raw: failedDestinationRaw,
      origin_candidates: parsedQuery?.origin_candidates,
      destination_candidates: parsedQuery?.destination_candidates,
      date_is_default: parsedQuery?.date_is_default,
      date_month_only: parsedQuery?.date_month_only,
      anywhere_destination: parsedQuery?.anywhere_destination,
      same_route: parsedQuery?.same_route === true || (!!origin && !!destination && origin === destination),
    }

    const referrer = getReferrerContext(request)
    const sessionUid = getSessionUid(request) ?? undefined

    // Suppress Gemini's 'date' follow-up if local parsing already has enough date context
    // (e.g. "end of June, 2 weeks" sets date_month_only + min_trip_days → no clarification needed).
    // Gemini tends to flag month-only dates even when trip duration makes them actionable.
    if (aiFollowUpTopics.includes('date') && !needsDateClarification(parsedForLaunch)) {
      aiFollowUpTopics = aiFollowUpTopics.filter(t => t !== 'date')
    }

    if (aiFollowUpTopics.length > 0) {
      await upsertSearchSessionServer(buildClarificationSearchSessionPayload({
        query: queryText || undefined,
        origin,
        origin_name: originName,
        destination,
        destination_name: destinationName,
        route: origin && destination ? `${origin}-${destination}` : undefined,
        date_from: dateFrom,
        return_date: returnDate,
        adults,
        currency,
        source: 'website-api-search',
        source_path: getTrackedSourcePath('/api/search', isProbeSearch),
        referrer_path: referrer.referrer_path,
        referrer_host: referrer.referrer_host,
        session_uid: sessionUid,
        is_test_search: isProbeSearch || undefined,
        utm_source: referrer.utm_source,
        utm_medium: referrer.utm_medium,
        utm_campaign: referrer.utm_campaign,
        utm_term: referrer.utm_term,
        follow_up_topics: aiFollowUpTopics,
        missing_origin: aiFollowUpTopics.includes('origin'),
        missing_destination: aiFollowUpTopics.includes('destination'),
        needs_date_clarification: aiFollowUpTopics.includes('date'),
        same_route: !!origin && !!destination && origin === destination,
      }))

      return NextResponse.json({
        error: 'clarification_required',
        needs_clarification: true,
        status: 'clarification_required',
        follow_up_topics: aiFollowUpTopics,
        follow_up_questions: aiFollowUpQuestions,
        parsed: parsedResponse,
      }, { status: 422 })
    }

    if (!isSearchLaunchReady(queryText, parsedForLaunch)) {
      const clarification = getSearchClarificationState(queryText, parsedForLaunch)
      const requiredTopics = getRequiredSearchClarificationTopics(queryText, parsedForLaunch)
      const followUpTopics = buildHomeConvoTopicOrder(aiFollowUpTopics, requiredTopics)

      // Fast-path pre-fire calls (body.origin/destination/date_from provided by the home form's
      // navigateSearch) are internal implementation details — not user-initiated NL searches.
      // Skip stats logging for them to avoid phantom -¥100 entries in the P&L dashboard.
      const isFastPathPrefire = !!(body.origin && body.destination && body.date_from)
      if (!isFastPathPrefire) {
        await upsertSearchSessionServer(buildClarificationSearchSessionPayload({
        query: queryText || undefined,
        origin,
        origin_name: originName,
        destination,
        destination_name: destinationName,
        route: origin && destination ? `${origin}-${destination}` : undefined,
        date_from: dateFrom,
        return_date: returnDate,
        adults,
        currency,
        source: 'website-api-search',
        source_path: getTrackedSourcePath('/api/search', isProbeSearch),
        referrer_path: referrer.referrer_path,
        referrer_host: referrer.referrer_host,
        session_uid: sessionUid,
        is_test_search: isProbeSearch || undefined,
        utm_source: referrer.utm_source,
        utm_medium: referrer.utm_medium,
        utm_campaign: referrer.utm_campaign,
        utm_term: referrer.utm_term,
        follow_up_topics: followUpTopics,
        missing_origin: clarification.missingOrigin,
        missing_destination: clarification.missingDestination,
        needs_date_clarification: needsDateClarification(parsedForLaunch),
        same_route: clarification.sameRoute,
      }))
      }

      return NextResponse.json({
        error: 'clarification_required',
        needs_clarification: true,
        status: 'clarification_required',
        follow_up_topics: followUpTopics,
        follow_up_questions: aiFollowUpQuestions,
        parsed: parsedResponse,
      }, { status: 422 })
    }

    if (!origin || !destination) {
      return NextResponse.json({ error: 'Could not determine origin or destination.' }, { status: 400 })
    }

    const burstPolicy = getRouteBurstPolicy()
    const burstKey = `burst:${buildRateLimitClientKey(request.headers, sessionUid)}`
    const burstDecision = checkRouteBurst(getGlobalRouteBurstStore(), burstKey, origin, destination, burstPolicy)
    if (!burstDecision.allowed) {
      const retryAfterSec = Math.max(1, Math.ceil(burstDecision.retryAfterMs / 1000))
      return NextResponse.json(
        {
          error: 'route_burst_limit',
          message: `Too many different destinations from ${burstDecision.origin} in a short window. Please wait and try again.`,
          retry_after_seconds: retryAfterSec,
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(retryAfterSec),
            'X-RateLimit-Policy': 'route-burst',
          },
        },
      )
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
      // Personalized ranking signals — from NL parser + Gemini vertexParse
      ...(effectivePreferredSort ? { sort_by: effectivePreferredSort } : {}),
      ...(effectiveDepartTimePref ? { depart_time_pref: effectiveDepartTimePref } : {}),
      ...(effectiveReturnDepartTimePref ? { return_depart_time_pref: effectiveReturnDepartTimePref } : {}),
      ...(effectiveDepartAfterMins !== undefined ? { depart_after_mins: effectiveDepartAfterMins } : {}),
      ...(effectiveDepartBeforeMins !== undefined ? { depart_before_mins: effectiveDepartBeforeMins } : {}),
      // Soft stops preference: 0 = user wants direct but we didn't hard-filter FSW
      // so all offers still come back — just heavily deprioritised vs direct options.
      ...(preferredStops !== undefined ? { preferred_stops: preferredStops } : {}),
    }, {
      query: typeof body.query === 'string' ? body.query : undefined,
      origin_name: originName,
      destination_name: destinationName,
      source: 'website-api-search',
      source_path: getTrackedSourcePath('/api/search', isProbeSearch),
      referrer_path: referrer.referrer_path,
      referrer_host: referrer.referrer_host,
      session_uid: sessionUid,
      is_test_search: isProbeSearch,
      utm_source: referrer.utm_source,
      utm_medium: referrer.utm_medium,
      utm_campaign: referrer.utm_campaign,
      utm_term: referrer.utm_term,
    }, userIp)

    if (!searchId) {
      return NextResponse.json({ error: 'Search service unavailable' }, { status: 502 })
    }

    // Persist any fallback notes so /api/results can merge them into the
    // poll response (FSW doesn't know about our website-side resolution).
    setSearchMeta(searchId, {
      ...(fallbackNotes.origin || fallbackNotes.destination ? { fallback_notes: fallbackNotes } : {}),
      parsed_context: parsedResponse,
      ...(queryText ? { query: queryText } : {}),
    })

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
