import { Suspense } from 'react'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import CurrencyButton from '../currency-button'
import GlobeButton from '../globe-button'
import ResultsSearchForm from './ResultsSearchForm'
import ResultsPanel from './[searchId]/ResultsPanel'
import SearchingTasks from './[searchId]/SearchingTasks'
import CacheHitReveal from './CacheHitReveal'
import {
  LETSFG_CURRENCY_COOKIE,
  resolveSearchCurrency,
  type CurrencyCode,
} from '../../lib/currency-preference'
import { parseNLQuery, resolveCity, type ParsedQuery } from '../lib/searchParsing'
import { vertexParse } from '../lib/vertex-parse'
import { IATA_TO_NAME, getAirlineNameFromCode, looksLikeIataCode } from '../airlineLogos'
import { startWebSearch, startExploreSearch } from '../../lib/fsw-search'
import { upsertSearchSessionServer } from '../../lib/search-session-analytics-server'
import { getGitHubStars, formatStars } from '../../lib/github-stars'
import { getTrackedSourcePath, isProbeModeValue } from '../../lib/probe-mode'
import { detectPreferredCurrency } from '../../lib/user-currency'

const FSW_SECRET = process.env.FSW_SECRET || ''
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://letsfg.co'
const FSW_URL = process.env.FSW_URL || 'https://flight-search-worker-qryvus4jia-uc.a.run.app'

const REPO_URL = 'https://github.com/LetsFG/LetsFG'
const INSTAGRAM_URL = 'https://www.instagram.com/letsfg_'
const TIKTOK_URL = 'https://www.tiktok.com/@letsfg_'
const X_URL = 'https://x.com/LetsFG_'

// ── Icon components ───────────────────────────────────────────────────────────

function GitHubIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" width="18" height="18" className="lp-github-icon">
      <path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8a8.01 8.01 0 0 0 5.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.54 7.54 0 0 1 4.01 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  )
}

function InstagramIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
    </svg>
  )
}

function TikTokIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.18 8.18 0 0 0 4.78 1.52V6.74a4.85 4.85 0 0 1-1.01-.05z" />
    </svg>
  )
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.737-8.835L1.254 2.25H8.08l4.264 5.633 5.9-5.633zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}

// ── FSW helpers ───────────────────────────────────────────────────────────────

interface RawSegment {
  origin: string
  destination: string
  departure: string
  arrival: string
  flight_no?: string
  flight_number?: string
  airline?: string
  airline_name?: string
  carrier_name?: string
}

interface RawOffer {
  id?: string
  price: number
  currency: string
  airlines?: string[]
  airline?: string
  airline_code?: string
  owner_airline?: string
  origin_name?: string
  destination_name?: string
  google_flights_price?: number
  outbound: {
    segments: RawSegment[]
    stopovers: number
    total_duration_seconds?: number
  }
  inbound?: {
    segments: RawSegment[]
    stopovers: number
    total_duration_seconds?: number
  }
}

function extractIataFromFlightNo(flightNo: string): string {
  // IATA codes can be 2 chars: letters (BA), letter+digit (W6, F9), digit+letter (2W)
  const m = flightNo.match(/^([A-Z]{2}|[A-Z]\d|\d[A-Z])/i)
  return m ? m[1].toUpperCase() : ''
}

function looksLikePlaceholderAirline(value: string): boolean {
  return /^Airline\s*#\d+$/i.test(value.trim())
}

function resolveAirline(raw: RawOffer, first: RawSegment): { airlineName: string; airlineCode: string } {
  const candidates = [
    ...(raw.airlines || []),
    first.airline_name,
    first.carrier_name,
    raw.airline,
    raw.owner_airline,
    first.airline,
  ].filter((value): value is string => Boolean(
    value && value.trim().length > 0 && !looksLikePlaceholderAirline(value)
  ))
  const rawName = candidates[0] || ''
  const flightNo: string = first.flight_no || first.flight_number || ''
  const fallbackCode = raw.airline_code
    || (first.airline && looksLikeIataCode(first.airline) ? first.airline.toUpperCase() : '')
    || extractIataFromFlightNo(flightNo)
    || '??'

  // If the 'name' is actually an IATA code (e.g. FSW returned ['FR'] instead of ['Ryanair'])
  if (rawName && looksLikeIataCode(rawName)) {
    const code = rawName.toUpperCase()
    const name = getAirlineNameFromCode(code) || code
    return { airlineName: name, airlineCode: code }
  }

  // Normal case: rawName is a full airline name
  const airlineName = rawName || getAirlineNameFromCode(fallbackCode) || 'Unknown'
  const airlineCode = fallbackCode

  return { airlineName, airlineCode }
}

function normalizeSegments(segments: RawSegment[], fallbackAirlineName: string, fallbackAirlineCode: string) {
  return segments.map((s: RawSegment, index: number) => {
    const sDep = s.departure || ''
    const sArr = s.arrival || ''
    const sDur = sDep && sArr
      ? Math.round((new Date(sArr).getTime() - new Date(sDep).getTime()) / 60000)
      : 0
    const nextSeg = segments[index + 1]
    const nextDep = nextSeg?.departure || ''
    const layoverMins = sArr && nextDep
      ? Math.max(0, Math.round((new Date(nextDep).getTime() - new Date(sArr).getTime()) / 60000))
      : 0
    const originCode = (s.origin || '').toUpperCase()
    const destinationCode = (s.destination || '').toUpperCase()
    const airlineCode = (s.airline && looksLikeIataCode(s.airline) ? s.airline.toUpperCase() : '')
      || extractIataFromFlightNo(s.flight_no || '')
      || fallbackAirlineCode
    const rawAirlineName = s.airline_name || s.carrier_name
      || (s.airline && !looksLikeIataCode(s.airline) && !looksLikePlaceholderAirline(s.airline) ? s.airline : '')
    const airlineName = rawAirlineName || getAirlineNameFromCode(airlineCode) || fallbackAirlineName

    return {
      airline: airlineName,
      airline_code: airlineCode,
      flight_number: s.flight_no || s.flight_number || '',
      origin: originCode,
      origin_name: IATA_TO_NAME[originCode] || originCode,
      destination: destinationCode,
      destination_name: IATA_TO_NAME[destinationCode] || destinationCode,
      departure_time: sDep,
      arrival_time: sArr,
      duration_minutes: sDur,
      layover_minutes: layoverMins,
    }
  })
}

function normalizeOffer(raw: RawOffer, idx: number) {
  const ob = raw.outbound || { segments: [], stopovers: 0 }
  const segs = ob.segments || []
  const first = segs[0] || {} as RawSegment
  const last = segs[segs.length - 1] || first

  const origin = (first.origin || '').toUpperCase()
  const destination = (last.destination || '').toUpperCase()
  const departure = first.departure || ''
  const arrival = last.arrival || ''

  let durationMins = 0
  if (departure && arrival) {
    durationMins = Math.round((new Date(arrival).getTime() - new Date(departure).getTime()) / 60000)
  }

  const { airlineName, airlineCode } = resolveAirline(raw, first)
  const id = raw.id || `wo_${idx}_${Math.random().toString(36).slice(2, 8)}`
  const normSegs = normalizeSegments(segs, airlineName, airlineCode)

  let inbound: {
    origin: string; destination: string; departure_time: string; arrival_time: string
    duration_minutes: number; stops: number; airline?: string; airline_code?: string
    segments?: typeof normSegs
  } | undefined
  const ibRaw = raw.inbound
  if (ibRaw && ibRaw.segments?.length) {
    const ibSegs = ibRaw.segments
    const ibFirst = ibSegs[0]
    const ibLast = ibSegs[ibSegs.length - 1]
    const ibDep = ibFirst.departure || ''
    const ibArr = ibLast.arrival || ''
    let ibDurMins = 0
    if (ibDep && ibArr) {
      ibDurMins = Math.round((new Date(ibArr).getTime() - new Date(ibDep).getTime()) / 60000)
    }
    const ibAirlineName = ibFirst.airline_name || ibFirst.carrier_name
      || (ibFirst.airline && !looksLikeIataCode(ibFirst.airline) ? ibFirst.airline : null)
      || (ibFirst.airline ? (getAirlineNameFromCode(ibFirst.airline.toUpperCase()) || ibFirst.airline) : null)
      || airlineName
    const ibAirlineCode = (ibFirst.airline && looksLikeIataCode(ibFirst.airline) ? ibFirst.airline.toUpperCase() : '')
      || extractIataFromFlightNo(ibFirst.flight_no || '') || airlineCode
    const ibNormSegs = normalizeSegments(ibSegs, ibAirlineName, ibAirlineCode)

    inbound = {
      origin: (ibFirst.origin || '').toUpperCase(),
      destination: (ibLast.destination || '').toUpperCase(),
      departure_time: ibDep,
      arrival_time: ibArr,
      duration_minutes: ibDurMins,
      stops: ibRaw.stopovers ?? Math.max(0, ibSegs.length - 1),
      airline: ibAirlineName,
      airline_code: ibAirlineCode,
      segments: ibNormSegs.length > 1 ? ibNormSegs : undefined,
    }
  }

  return {
    id,
    price: Math.round((raw.price || 0) * 100) / 100,
    google_flights_price: typeof raw.google_flights_price === 'number'
      ? Math.round(raw.google_flights_price * 100) / 100
      : undefined,
    currency: raw.currency || 'EUR',
    airline: airlineName,
    airline_code: airlineCode,
    origin,
    origin_name: raw.origin_name || origin,
    destination,
    destination_name: raw.destination_name || destination,
    departure_time: departure,
    arrival_time: arrival,
    duration_minutes: durationMins,
    stops: ob.stopovers ?? Math.max(0, segs.length - 1),
    segments: normSegs.length > 1 ? normSegs : undefined,
    inbound,
  }
}

async function startFSWSearch(
  parsed: ReturnType<typeof parseNLQuery>,
  query?: string,
  isProbe = false,
  currency: CurrencyCode = 'EUR',
  utmSource?: string,
  utmMedium?: string,
  utmCampaign?: string,
): Promise<{ searchId: string | null; cache: 'hit' | 'miss' }> {
  if (!parsed.origin || !parsed.destination || !parsed.date) {
    return { searchId: null, cache: 'miss' }
  }

  try {
    const reqHeaders = await headers()
    const userIp = reqHeaders.get('x-forwarded-for')?.split(',')[0].trim() || undefined

    // For flexible trips: if caller gave us a mid-point return_date derived from
    // trip duration, honour it; the UI will display the duration range as context.
    const result = await startWebSearch({
      origin: parsed.origin,
      destination: parsed.destination,
      date_from: parsed.date,
      return_date: parsed.return_date || undefined,
      adults: parsed.adults || 1,
      currency,
      ...(parsed.stops !== undefined ? { max_stops: parsed.stops } : {}),
      ...(parsed.cabin ? { cabin: parsed.cabin } : {}),
    }, {
      query,
      origin_name: parsed.origin_name,
      destination_name: parsed.destination_name,
      source: utmSource || 'website-results-page',
      source_path: getTrackedSourcePath('/results', isProbe),
      is_test_search: isProbe,
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
    }, userIp)
    return result
  } catch (_) {
    return { searchId: null, cache: 'miss' }
  }
}

async function pollFSW(searchId: string, maxWaitMs: number): Promise<{ offers: RawOffer[] } | null> {
  const deadline = Date.now() + maxWaitMs
  while (Date.now() < deadline) {
    try {
      const remaining = deadline - Date.now()
      const res = await fetch(`${FSW_URL}/web-status/${searchId}`, {
        headers: { 'Authorization': `Bearer ${FSW_SECRET}` },
        signal: AbortSignal.timeout(Math.min(5_000, remaining)),
        cache: 'no-store',
      })
      if (res.ok) {
        const data = await res.json()
        if (data.status === 'completed') return { offers: data.offers || [] }
        if (data.status === 'failed') return { offers: [] }
      }
    } catch (_) {}
    if (Date.now() + 3000 < deadline) {
      await new Promise(r => setTimeout(r, 3000))
    } else {
      break
    }
  }
  return null
}

// ── Page components ───────────────────────────────────────────────────────────

async function PageTopbar({
  homeHref = '/en',
  initialCurrency,
  searchQuery,
  probeMode = false,
}: {
  homeHref?: string
  initialCurrency: CurrencyCode
  searchQuery?: string
  probeMode?: boolean
}) {
  const stars = await getGitHubStars()
  return (
    <div className="res-topbar res-topbar--results">
      <Link href={homeHref} className="res-topbar-logo-link" aria-label="LetsFG home">
        <Image src="/lfg_ban.png" alt="LetsFG" width={4990} height={1560} className="res-topbar-logo" priority />
      </Link>
      <div className="res-topbar-actions">
        <GlobeButton inline />
        <CurrencyButton
          inline
          behavior={searchQuery?.trim() ? 'rerun-search' : 'refresh'}
          initialCurrency={initialCurrency}
          searchQuery={searchQuery}
          probeMode={probeMode}
        />
        <a href={REPO_URL} target="_blank" rel="noreferrer" className={stars !== null ? 'res-icon-btn res-icon-btn--gh' : 'res-icon-btn'} aria-label="GitHub" title="GitHub">
          <GitHubIcon />
          {stars !== null && <span className="res-gh-stars"><span className="res-gh-star" aria-hidden="true">⭐</span>{formatStars(stars)}</span>}
        </a>
      </div>
    </div>
  )
}

function PageFooter() {
  return (
    <footer className="res-search-footer" aria-label="LetsFG footer">
      <div className="res-search-footer-inner">
        <span className="res-search-footer-copy">LetsFG © 2026</span>
        <div className="res-search-footer-links">
          <a href="/privacy" className="res-search-footer-link">Privacy</a>
          <a href="/terms" className="res-search-footer-link">Terms</a>
          <a href="mailto:contact@letsfg.co" className="res-search-footer-link">Support</a>
          <span className="res-search-footer-sep" aria-hidden="true" />
          <a href={INSTAGRAM_URL} className="res-search-footer-social" target="_blank" rel="noreferrer" aria-label="Instagram"><InstagramIcon /></a>
          <a href={TIKTOK_URL} className="res-search-footer-social" target="_blank" rel="noreferrer" aria-label="TikTok"><TikTokIcon /></a>
          <a href={X_URL} className="res-search-footer-social" target="_blank" rel="noreferrer" aria-label="X"><XIcon /></a>
        </div>
      </div>
    </footer>
  )
}

// ── Main async search component (runs server-side) ────────────────────────────

async function SearchContent({
  query,
  sid,
  started,
  isProbe,
  currency,
  mt,
  utmSource,
  utmMedium,
  utmCampaign,
}: {
  query: string
  sid?: string
  started?: string
  isProbe: boolean
  currency: CurrencyCode
  mt?: string
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
}) {
  const today = new Date().toISOString().slice(0, 10)
  // Gemini is the primary parser — regex is only the fallback when Gemini is unavailable.
  const _ai = await vertexParse(query, today).catch(() => null)

  const CABIN_MAP: Record<string, ParsedQuery['cabin']> = {
    economy: 'M', premium_economy: 'W', business: 'C', first: 'F',
  }

  let parsed: ParsedQuery
  if (_ai) {
    const aiOrigin = _ai.origin_city ? resolveCity(_ai.origin_city) : null
    const aiDest   = (_ai.destination_city && _ai.destination_city !== 'ANYWHERE')
      ? resolveCity(_ai.destination_city) : null
    const aiVia    = _ai.via_city ? resolveCity(_ai.via_city) : null
    parsed = {
      // Locations
      ...(aiOrigin ? { origin: aiOrigin.code, origin_name: aiOrigin.name }
        : _ai.origin_city ? { failed_origin_raw: _ai.origin_city } : {}),
      ...(_ai.destination_city === 'ANYWHERE' ? { anywhere_destination: true } : {}),
      ...(aiDest ? { destination: aiDest.code, destination_name: aiDest.name }
        : (_ai.destination_city && _ai.destination_city !== 'ANYWHERE') ? { failed_destination_raw: _ai.destination_city } : {}),
      ...(aiVia ? { via_iata: aiVia.code, via_name: aiVia.name } : {}),
      // Dates
      ...(_ai.date              ? { date: _ai.date }                                : {}),
      // Derive return_date from trip duration when Gemini gives days but no explicit return date
      ...((() => {
        const rd = _ai.return_date
          || (_ai.date && _ai.min_trip_days != null
            ? (() => { const d = new Date(_ai.date!); d.setUTCDate(d.getUTCDate() + _ai.min_trip_days!); return d.toISOString().slice(0, 10) })()
            : null)
        return rd ? { return_date: rd } : {}
      })()),
      ...(_ai.date_month_only   ? { date_month_only: true }                         : {}),
      ...(_ai.find_best_window  ? { find_best_window: true,
        ...(_ai.date_window_month != null ? { date_window_month: _ai.date_window_month } : {}),
        ...(_ai.date_window_year  != null ? { date_window_year:  _ai.date_window_year  } : {}),
      } : {}),
      ...(_ai.min_trip_days != null ? { min_trip_days: _ai.min_trip_days } : {}),
      ...(_ai.max_trip_days != null ? { max_trip_days: _ai.max_trip_days } : {}),
      // Passengers
      adults: _ai.adults || 1,
      ...(_ai.children  ? { children: _ai.children }   : {}),
      ...(_ai.infants   ? { infants:  _ai.infants }    : {}),
      ...(_ai.context   ? { passenger_context: (
        _ai.context === 'business' ? 'business_traveler' : _ai.context
      ) as ParsedQuery['passenger_context'] } : {}),
      // Flight preferences
      ...(_ai.cabin                  ? { cabin: CABIN_MAP[_ai.cabin] }              : {}),
      ...(_ai.direct_only            ? { stops: 0 }
        : _ai.max_stops != null      ? { stops: _ai.max_stops }                     : {}),
      ...(_ai.preferred_airline      ? { preferred_airline: _ai.preferred_airline } : {}),
      ...(_ai.excluded_airline       ? { excluded_airline:  _ai.excluded_airline }  : {}),
      // Price
      ...(_ai.max_price != null      ? { max_price: _ai.max_price }                 : {}),
      // Time prefs
      ...(_ai.depart_time_pref        ? { depart_time_pref:        _ai.depart_time_pref }        : {}),
      ...(_ai.return_depart_time_pref ? { return_depart_time_pref: _ai.return_depart_time_pref } : {}),
      // Ancillaries
      ...(_ai.require_checked_baggage ? { require_checked_baggage: true } : {}),
      ...(_ai.carry_on_only           ? { carry_on_only:           true } : {}),
      ...(_ai.require_meals           ? { require_meals:           true } : {}),
      ...(_ai.require_cancellation    ? { require_cancellation:    true } : {}),
      ...(_ai.require_lounge          ? { require_lounge:          true } : {}),
      // Seat / purpose / urgency
      ...(_ai.seat_pref    ? { seat_pref:    _ai.seat_pref }    : {}),
      ...(_ai.trip_purpose ? { trip_purpose: _ai.trip_purpose } : {}),
      ...(_ai.urgency      ? { urgency:      _ai.urgency }      : {}),
    }
  } else {
    // Gemini unavailable (local dev, quota, timeout) — fall back to regex parser
    parsed = parseNLQuery(query)
  }

  // Build route label — include flexible date/duration context when relevant
  const destLabel = parsed.anywhere_destination
    ? 'Anywhere'
    : (parsed.destination_name || parsed.destination)
  const routeLabel = [
    parsed.origin_name || parsed.origin,
    destLabel,
  ].filter(Boolean).join(' → ')

  const homeHref = isProbe ? '/en?probe=1' : '/en'

  let searchId = sid
  let cacheHit = false

  // Start a new search if no sid provided
  if (!searchId) {
    // "Anywhere" mode — start an explore search and redirect to the explore page
    if (parsed.anywhere_destination && !parsed.destination) {
      let exploreSearchId: string | null = null
      if (parsed.origin && parsed.date) {
        try {
          const returnDays = parsed.min_trip_days
            ? Math.round(((parsed.min_trip_days ?? 0) + (parsed.max_trip_days ?? parsed.min_trip_days ?? 0)) / 2)
            : undefined
          const result = await startExploreSearch({
            origin: parsed.origin,
            date_from: parsed.date,
            adults: 1,
            currency,
            max_price: parsed.max_price,
            return_days: returnDays,
          })
          exploreSearchId = result.searchId
        } catch (_) {
          // FSW unavailable — fall through to error UI
        }
      }
      if (exploreSearchId) {
        const exploreUrl = `/results/explore/${exploreSearchId}?q=${encodeURIComponent(query)}&currency=${currency}`
        redirect(exploreUrl)
      }
      const originLabel = parsed.origin_name || parsed.origin || 'your city'
      return (
        <main className="res-page">
          <section className="res-hero res-hero--results">
            <div className="res-hero-backdrop" aria-hidden="true" />
            <div className="res-hero-inner">
              <PageTopbar homeHref={homeHref} initialCurrency={currency} searchQuery={query} probeMode={isProbe} />
              <div className="res-search-shell">
                <ResultsSearchForm initialQuery={query} initialCurrency={currency} trackingSearchId={searchId} trackingSourcePath={getTrackedSourcePath('/results', isProbe)} probeMode={isProbe} />
              </div>
              <div className="res-hero-copy">
                <p className="res-hero-kicker">{parsed.origin ? 'Explore search unavailable' : 'Where are you flying from?'}</p>
                <h1 className="res-hero-route">{originLabel} → Anywhere</h1>
                <p className="res-hero-status">{parsed.origin ? 'Try a specific destination below, or check back soon.' : `Try "${originLabel || 'London'} to anywhere"`}</p>
              </div>
            </div>
          </section>
          <PageFooter />
        </main>
      )
    }

    if (!parsed.origin || !parsed.destination) {
      // Build a specific, helpful error message
      let errKicker: string
      let errRoute: string
      if (parsed.failed_origin_raw && parsed.failed_destination_raw) {
        errKicker = `Couldn\u2019t find airports for \u201c${parsed.failed_origin_raw}\u201d or \u201c${parsed.failed_destination_raw}\u201d`
        errRoute = 'Try a city name, country, or airport code \u2014 e.g. \u201cLondon to Switzerland\u201d'
      } else if (parsed.failed_origin_raw) {
        errKicker = `Couldn\u2019t find an airport for \u201c${parsed.failed_origin_raw}\u201d`
        errRoute = parsed.destination_name
          ? `Try a city or country name \u2192 ${parsed.destination_name}`
          : 'Try a city name or country, e.g. \u201cSwitzerland to Spain\u201d'
      } else if (parsed.failed_destination_raw) {
        errKicker = `Couldn\u2019t find an airport for \u201c${parsed.failed_destination_raw}\u201d`
        errRoute = parsed.origin_name
          ? `${parsed.origin_name} \u2192 try a city name or country`
          : 'Try a city name or country, e.g. \u201cLondon to Switzerland\u201d'
      } else {
        errKicker = 'Couldn\u2019t find a route in that'
        errRoute = 'Try \u201cLondon to Barcelona, 15 May\u201d'
      }
      return (
        <main className="res-page">
          <section className="res-hero res-hero--results">
            <div className="res-hero-backdrop" aria-hidden="true" />
            <div className="res-hero-inner">
              <PageTopbar homeHref={homeHref} initialCurrency={currency} searchQuery={query} probeMode={isProbe} />
              <div className="res-search-shell">
                <ResultsSearchForm initialQuery={query} initialCurrency={currency} trackingSearchId={searchId} trackingSourcePath={getTrackedSourcePath('/results', isProbe)} probeMode={isProbe} />
              </div>
              <div className="res-hero-copy">
                <p className="res-hero-kicker">{errKicker}</p>
                <h1 className="res-hero-route">{errRoute}</h1>
              </div>
            </div>
          </section>
          <PageFooter />
        </main>
      )
    }

    const fswResult = await startFSWSearch(parsed, query, isProbe, currency, utmSource, utmMedium, utmCampaign)
    searchId = fswResult.searchId ?? undefined
    cacheHit = fswResult.cache === 'hit'
    if (!searchId) {
      return (
        <main className="res-page">
          <section className="res-hero res-hero--results">
            <div className="res-hero-backdrop" aria-hidden="true" />
            <div className="res-hero-inner">
              <PageTopbar homeHref={homeHref} initialCurrency={currency} searchQuery={query} probeMode={isProbe} />
              <div className="res-search-shell">
                <ResultsSearchForm initialQuery={query} initialCurrency={currency} trackingSearchId={searchId} trackingSourcePath={getTrackedSourcePath('/results', isProbe)} probeMode={isProbe} />
              </div>
              <div className="res-hero-copy">
                <p className="res-hero-kicker">Search unavailable</p>
                <h1 className="res-hero-route">{routeLabel || query}</h1>
                <p className="res-hero-status">Could not reach flight search. Please try again.</p>
              </div>
            </div>
          </section>
          <PageFooter />
        </main>
      )
    }
  }

  if (!searchId) {
    return null
  }

  // Hand off immediately to the stable search page so the browser can leave
  // the homepage without waiting for server-side polling on /results.
  const startedTs = started || Date.now().toString()
  const tripCtx = (parsed.min_trip_days !== undefined && parsed.max_trip_days !== undefined)
    ? `&trip_min=${parsed.min_trip_days}&trip_max=${parsed.max_trip_days}`
    : (parsed.min_trip_days !== undefined ? `&trip_min=${parsed.min_trip_days}` : '')
  const monthCtx = parsed.date_month_only ? '&month_only=1' : ''
  redirect(getTrackedSourcePath(`/results/${searchId}?started=${startedTs}&cur=${encodeURIComponent(currency)}&q=${encodeURIComponent(query)}${mt ? `&mt=${encodeURIComponent(mt)}` : ''}${tripCtx}${monthCtx}`, isProbe))
}

// ── Suspense fallback (shown instantly while SearchContent runs) ───────────────

function SearchFallback({ query, isProbe, initialCurrency }: { query: string; isProbe: boolean; initialCurrency: CurrencyCode }) {
  const parsed = parseNLQuery(query)
  const destLabel = parsed.anywhere_destination ? 'Anywhere' : (parsed.destination_name || parsed.destination)
  const routeLabel = [
    parsed.origin_name || parsed.origin,
    destLabel,
  ].filter(Boolean).join(' → ')
  const homeHref = isProbe ? '/en?probe=1' : '/en'

  return (
    <main className="res-page res-page--searching">
      <section className="res-hero res-hero--searching">
        <div className="res-hero-backdrop" aria-hidden="true" />
        <div className="res-hero-inner">
          <div className="res-topbar res-topbar--searching">
            <Link href={homeHref} className="res-topbar-logo-link" aria-label="LetsFG home">
              <Image src="/lfg_ban.png" alt="LetsFG" width={4990} height={1560} className="res-topbar-logo" priority />
            </Link>
            <div className="res-topbar-actions">
              <GlobeButton inline />
              <CurrencyButton inline behavior="rerun-search" initialCurrency={initialCurrency} searchQuery={query} probeMode={isProbe} />
            </div>
          </div>
          <div className="res-search-shell">
            <ResultsSearchForm initialQuery={query} initialCurrency={initialCurrency} probeMode={isProbe} />
          </div>
          <div className="res-searching-stage">
            <SearchingTasks
              originLabel={parsed.origin_name || parsed.origin}
              originCode={parsed.origin}
              destinationLabel={parsed.destination_name || parsed.destination}
              destinationCode={parsed.destination}
            />
          </div>
        </div>
      </section>
    </main>
  )
}

// ── Page entry point ──────────────────────────────────────────────────────────

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams
  if (!q?.trim()) return { title: 'Flight Search — LetsFG' }
  const parsed = parseNLQuery(q)
  const destLabel = parsed.anywhere_destination ? 'Anywhere' : (parsed.destination_name || parsed.destination)
  const route = [parsed.origin_name || parsed.origin, destLabel].filter(Boolean).join(' → ')
  const durationSuffix = parsed.min_trip_days !== undefined
    ? parsed.min_trip_days === parsed.max_trip_days
      ? ` · ${parsed.min_trip_days} days`
      : ` · ${parsed.min_trip_days}–${parsed.max_trip_days} days`
    : ''
  return {
    title: route ? `Flights ${route}${durationSuffix} — LetsFG` : `"${q}" — LetsFG`,
    description: `Search 180+ airlines for ${route || q}. Zero markup, raw airline prices.`,
  }
}

export default async function ResultsQueryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; sid?: string; started?: string; probe?: string; cur?: string; mt?: string; utm_source?: string; utm_medium?: string; utm_campaign?: string }>
}) {
  const { q, sid, started, probe, cur, mt, utm_source, utm_medium, utm_campaign } = await searchParams
  const isProbe = isProbeModeValue(probe)
  const requestHeaders = await headers()
  const cookieStore = await cookies()
  const resolvedCurrency = resolveSearchCurrency({
    queryParam: cur?.trim(),
    cookieValue: cookieStore.get(LETSFG_CURRENCY_COOKIE)?.value,
    fallback: detectPreferredCurrency(requestHeaders),
  })

  if (!q?.trim()) {
    redirect(isProbe ? '/en?probe=1' : '/')
  }

  const query = q.trim()

  return (
    <Suspense fallback={<SearchFallback query={query} isProbe={isProbe} initialCurrency={resolvedCurrency} />}>
      <SearchContent query={query} sid={sid?.trim()} started={started?.trim()} isProbe={isProbe} currency={resolvedCurrency} mt={mt?.trim()} utmSource={utm_source?.trim()} utmMedium={utm_medium?.trim()} utmCampaign={utm_campaign?.trim()} />
    </Suspense>
  )
}
