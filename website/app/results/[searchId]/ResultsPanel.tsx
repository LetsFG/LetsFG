'use client'

import { Fragment, useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { getAirlineCodeFromName, getAirlineLogoUrl, getAirlineNameFromCode, looksLikeIataCode } from '../../airlineLogos'
import {
  convertCurrencyAmount,
  formatOfferDisplayPrice,
  getOfferDisplayTotalPrice,
  getOfferDisplayTotalWithAncillary,
} from '../../../lib/display-price'
import { computeFlightTimeContext, extractFlightClockMinutes, formatFlightDateCompact, formatFlightTime } from '../../../lib/flight-datetime'
import { formatGoogleFlightsSavings, getGoogleFlightsSavingsAmount } from '../../../lib/google-flights-savings'
import { trackSearchSessionEvent } from '../../../lib/search-session-analytics'
import { formatCurrencyAmount } from '../../../lib/user-currency'
import {
  getOfferBaseTotal,
  getOfferKnownTotalPrice,
  hasIncludedAncillary,
  hasPaidAncillary,
} from '../../../lib/offer-pricing'
import { calculateFee } from '../../../lib/pricing'
import { appendProbeParam, getTrackedSourcePath } from '../../../lib/probe-mode'
import { SearchProgressBarInline } from './SearchProgressBar'
import { rankOffers, selectDiverseTop, getProfileLabel, type RankingContext, type RankedOffer } from '../../lib/rankOffers'
// build:2026-05-05b

// ── Types ─────────────────────────────────────────────────────────────────────
interface FlightSegment {
  airline?: string
  airline_code?: string
  origin: string
  origin_name: string
  destination: string
  destination_name: string
  departure_time: string
  arrival_time: string
  flight_number: string
  duration_minutes: number
  layover_minutes: number
  aircraft?: string
}

interface InboundLeg {
  origin: string
  destination: string
  departure_time: string
  arrival_time: string
  duration_minutes: number
  stops: number
  airline?: string
  airline_code?: string
  segments?: FlightSegment[]
}

interface OfferAncillary {
  included?: boolean
  price?: number
  currency?: string
  description?: string
}

interface OfferAncillaries {
  cabin_bag?: OfferAncillary
  checked_bag?: OfferAncillary
  seat_selection?: OfferAncillary
}

interface FlightOffer {
  id: string
  price: number
  google_flights_price?: number
  offer_ref?: string
  source?: string
  currency: string
  airline: string
  airline_code: string
  flight_number?: string
  is_combo?: boolean
  origin: string
  origin_name: string
  destination: string
  destination_name: string
  departure_time: string
  arrival_time: string
  duration_minutes: number
  stops: number
  segments?: FlightSegment[]
  inbound?: InboundLeg
  ancillaries?: OfferAncillaries
}

interface SourceMetaResponse {
  booking_site?: string
  booking_site_summary?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtDuration(mins: number) {
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

/** Format a timezone offset in minutes as a short label, e.g. -180 → "−3h", 90 → "+1.5h" */
function fmtTzOffset(mins: number): string {
  const abs = Math.abs(mins)
  const sign = mins < 0 ? '−' : '+'
  const hours = Math.floor(abs / 60)
  const halfHour = abs % 60 >= 30
  return halfHour ? `${sign}${hours}.5h` : `${sign}${hours}h`
}

function isoToMins(iso: string) {
  return extractFlightClockMinutes(iso)
}

function minsToLabel(m: number) {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

function extractIataFromFlightNo(flightNo: string) {
  const match = flightNo.match(/^([A-Z]{2}|[A-Z]\d|\d[A-Z])/i)
  return match ? match[1].toUpperCase() : ''
}

interface OfferCarrier {
  name: string
  code: string
}

interface RouteStop {
  code: string
  name: string
}

function isMeaningfulCarrierName(value: string) {
  if (!value) return false
  const normalized = value.trim()
  if (!normalized || normalized === '??') return false
  return normalized.toLowerCase() !== 'unknown'
}

function resolveCarrier(name: unknown, code: unknown, flightNumber?: unknown): OfferCarrier | null {
  const normalizedName = typeof name === 'string' ? name.trim() : ''
  const normalizedCode = typeof code === 'string' ? code.trim().toUpperCase() : ''
  const flightCode = typeof flightNumber === 'string' ? extractIataFromFlightNo(flightNumber) : ''
  const codeFromField = looksLikeIataCode(normalizedCode) ? normalizedCode : ''
  const codeFromName = looksLikeIataCode(normalizedName) ? normalizedName.toUpperCase() : ''
  const inferredCode = getAirlineCodeFromName(normalizedName) || getAirlineCodeFromName(normalizedCode)
  const resolvedCode = codeFromField || flightCode || codeFromName || inferredCode || ''
  const resolvedName = isMeaningfulCarrierName(normalizedName) && !looksLikeIataCode(normalizedName)
    ? normalizedName
    : (resolvedCode ? getAirlineNameFromCode(resolvedCode) || resolvedCode : '')

  if (!isMeaningfulCarrierName(resolvedName)) {
    return null
  }

  return {
    name: resolvedName,
    code: resolvedCode || getAirlineCodeFromName(resolvedName) || resolvedName.slice(0, 2).toUpperCase(),
  }
}

function getRouteStops(segments?: FlightSegment[]): RouteStop[] {
  const routeStops: RouteStop[] = []
  const seen = new Set<string>()

  for (const segment of segments?.slice(0, -1) || []) {
    const code = (segment.destination || '').trim().toUpperCase()
    const name = (segment.destination_name || segment.destination || '').trim()
    const key = code || name.toLowerCase()

    if (!key || seen.has(key)) {
      continue
    }

    seen.add(key)
    routeStops.push({ code, name: name || code })
  }

  return routeStops
}

function getRouteViaBadge(stops: RouteStop[]) {
  const codes = stops.map((stop) => stop.code || stop.name).filter(Boolean)
  if (codes.length === 0) return null
  if (codes.length === 1) return codes[0]
  return `${codes[0]} +${codes.length - 1}`
}

function getRouteViaTitle(stops: RouteStop[]) {
  if (stops.length === 0) return undefined
  return stops.map((stop) => stop.code && stop.name ? `${stop.code} · ${stop.name}` : stop.code || stop.name).join(', ')
}

function getStopsLabel(
  stops: number,
  segments: FlightSegment[] | undefined,
  directLabel: string,
  tFn: (key: string, values?: Record<string, unknown>) => string,
) {
  if (stops === 0) return directLabel

  const routeStops = getRouteStops(segments)
  const viaCodes = routeStops.map((stop) => stop.code || stop.name).filter(Boolean)

  if (viaCodes.length === 0) {
    return stops === 1 ? tFn('stopsSingle', { n: stops }) : tFn('stopsPlural', { n: stops })
  }

  const via = viaCodes.join(', ')
  return stops === 1
    ? tFn('stopsVia', { n: stops, via })
    : tFn('stopsViaPlural', { n: stops, via })
}

function getOfferCarriers(offer: FlightOffer): OfferCarrier[] {
  const carriers: OfferCarrier[] = []
  const seen = new Set<string>()

  const addCarrier = (name: unknown, code: unknown, flightNumber?: unknown) => {
    const carrier = resolveCarrier(name, code, flightNumber)

    if (!carrier) {
      return
    }

    const key = carrier.name.toLowerCase()

    if (seen.has(key)) {
      return
    }

    seen.add(key)
    carriers.push(carrier)
  }

  addCarrier(offer.airline, offer.airline_code, offer.flight_number)

  for (const segment of offer.segments || []) {
    addCarrier(segment.airline, segment.airline_code, segment.flight_number)
  }

  addCarrier(offer.inbound?.airline, offer.inbound?.airline_code)

  for (const segment of offer.inbound?.segments || []) {
    addCarrier(segment.airline, segment.airline_code, segment.flight_number)
  }

  const fallbackCarrier = resolveCarrier(offer.airline, offer.airline_code, offer.flight_number)
  return carriers.length > 0 ? carriers : (fallbackCarrier ? [fallbackCarrier] : [])
}

function getOfferAirlineLabel(offer: FlightOffer) {
  return getOfferCarriers(offer).map((carrier) => carrier.name).join(' + ')
}

function getSegmentAirlineLabel(segment: FlightSegment, fallbackAirline: string) {
  const carrier = resolveCarrier(segment.airline, segment.airline_code, segment.flight_number)
  if (carrier?.name) return carrier.name

  const fallbackCarrier = resolveCarrier(fallbackAirline, '', undefined)
  return fallbackCarrier?.name || fallbackAirline
}

function fmtOfferPrice(amount: number, sourceCurrency: string, displayCurrency: string, locale?: string) {
  return formatOfferDisplayPrice(amount, sourceCurrency, displayCurrency, locale)
}

function findCheapestOffer(offers: FlightOffer[], displayCurrency: string): FlightOffer | null {
  if (offers.length === 0) return null

  let cheapestOffer = offers[0]
  let cheapestPrice = getOfferDisplayTotalPrice(cheapestOffer, displayCurrency)

  for (const offer of offers.slice(1)) {
    const offerPrice = getOfferDisplayTotalPrice(offer, displayCurrency)
    if (offerPrice < cheapestPrice) {
      cheapestOffer = offer
      cheapestPrice = offerPrice
    }
  }

  return cheapestOffer
}

// ── Airline category classification ──────────────────────────────────────────
// Used to show "Low-cost carrier" / "Full-service carrier" when airline is hidden (pre-unlock).
const LCC_IATA = new Set([
  'FR', 'U2', 'W6', 'DY', 'VY', 'HV', 'V7', 'LS', 'NK', 'F9', 'G4', 'WN',
  'AK', 'D7', 'VJ', 'DD', 'QP', 'SG', '5J', 'QG', 'JT', 'IU', 'TR', 'MM',
  'ZG', 'BC', 'KC', 'FO', 'F3', 'XY', 'FA', 'XP', 'MX', 'F8', 'PD', 'SY',
  'B6', '7C', 'TW', 'LJ', 'I2', 'J9', 'OV', 'JA', 'H2', 'UO', 'AQ', '8L',
  'IJ', 'FZ', 'G9', '4D', 'VB', 'Y4', 'P5', 'BX', 'PC', 'FC', '5R',
])

const FSC_IATA = new Set([
  'BA', 'LH', 'AF', 'KL', 'EK', 'QR', 'EY', 'SQ', 'CX', 'TK', 'VS', 'IB',
  'TP', 'AY', 'SK', 'LO', 'OS', 'LX', 'SN', 'AA', 'DL', 'UA', 'AC', 'QF',
  'JL', 'NH', 'KE', 'OZ', 'CA', 'CZ', 'MU', 'TG', 'GA', 'MH', 'PR', 'AI',
  'ET', 'ME', 'UL', 'WY', 'GF', 'KU', 'KQ', 'RJ', 'SA', 'WB', 'AT', 'JU',
  'GL', 'SB', 'TN', 'NF', 'PX', 'MK', 'FJ', 'WS', 'HA', 'AS', 'VA', 'NZ',
  'SV', 'MS', 'LY', 'PK', 'OA', 'CY', 'CM', 'AV', 'LA', 'AR', 'BW', 'FI',
  'BT', 'BG', 'S4', 'TS', 'PG', 'ID', 'IX', 'UX', 'EI', 'A3', 'CI', 'BR',
  'J2', 'AD', 'G3', 'HU', 'JX', 'JJ', 'DM', 'JQ', 'ZL', 'MS', 'LY',
])

function getAirlineCategory(code: string): string {
  const c = code.toUpperCase()
  if (LCC_IATA.has(c)) return 'Low-cost carrier'
  if (FSC_IATA.has(c)) return 'Full-service carrier'
  return 'Airline'
}

// ── Hidden airline placeholder (shown before unlock) ─────────────────────────
function HiddenAirlineLogo() {
  return (
    <div className="rf-airline-badge rf-airline-badge--hidden" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20" aria-hidden="true">
        <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" />
      </svg>
    </div>
  )
}

// ── Airline logo with IATA-code fallback ──────────────────────────────────────
function AirlineLogo({ code, name }: { code: string; name: string }) {
  const [failed, setFailed] = useState(false)
  const [tapped, setTapped] = useState(false)
  const inner = failed
    ? <div className="rf-airline-badge">{code.slice(0, 2)}</div>
    : (
      <div className="rf-airline-badge rf-airline-badge--img">
        <img
          src={getAirlineLogoUrl(code)}
          alt={name}
          width={28}
          height={28}
          onError={() => setFailed(true)}
        />
      </div>
    )
  return (
    <div
      className={`rf-airline-logo-wrap${tapped ? ' rf-airline-logo-wrap--tapped' : ''}`}
      onClick={() => setTapped((current) => !current)}
      onMouseLeave={() => setTapped(false)}
      title={name}
    >
      {inner}
      <span className="rf-airline-tooltip">{name}</span>
    </div>
  )
}

// ── Dual-handle range slider ──────────────────────────────────────────────────
function DualRange({
  min, max, low, high, onChange, formatLabel,
}: {
  min: number
  max: number
  low: number
  high: number
  onChange: (low: number, high: number) => void
  formatLabel: (v: number) => string
}) {
  const range = max - min || 1
  const loPct = ((low - min) / range) * 100
  const hiPct = ((high - min) / range) * 100

  return (
    <div className="rf-dual">
      <div className="rf-dual-vals">
        <span>{formatLabel(low)}</span>
        <span>{formatLabel(high)}</span>
      </div>
      <div
        className="rf-dual-track"
        style={{ '--lo': `${loPct}%`, '--hi': `${hiPct}%` } as React.CSSProperties}
      >
        <input
          type="range"
          className="rf-dual-input"
          min={min} max={max} value={low}
          onChange={e => onChange(Math.min(Number(e.target.value), high - 1), high)}
        />
        <input
          type="range"
          className="rf-dual-input"
          min={min} max={max} value={high}
          onChange={e => onChange(low, Math.max(Number(e.target.value), low + 1))}
        />
      </div>
    </div>
  )
}

// ── Icons ─────────────────────────────────────────────────────────────────────
function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" width="15" height="15" aria-hidden="true"
      style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
      <path d="M5 7.5l5 5 5-5" stroke="currentColor" strokeWidth="1.7"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" width="13" height="13" aria-hidden="true">
      <path d="M4 10h12M10 4l6 6-6 6" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// Sources shown as logos after search completes
const CHECKED_SOURCES = [
  'Google Flights', 'Kiwi.com', 'Skyscanner', 'Kayak', 'Momondo',
  'Ryanair', 'EasyJet', 'Wizz Air', 'Norwegian', 'Vueling',
  'Transavia', 'Iberia', 'British Airways', 'Air France', 'KLM',
  'Lufthansa', 'Eurowings', 'Southwest', 'JetBlue', 'Spirit',
  'AirAsia', 'IndiGo', 'LATAM', 'FlyDubai', 'Air Arabia',
  'TAP Air', 'Jet2', 'Volotea', 'Corendon', 'SunExpress',
]

/** Convert a single ancillary fee to display currency, handling mismatched source currency. */
function ancillaryInDisplay(anc: OfferAncillary | undefined, offerCurrency: string, displayCurrency: string): number {
  if (!anc || anc.included === true || typeof anc.price !== 'number' || anc.price <= 0) return 0
  return convertCurrencyAmount(anc.price, anc.currency || offerCurrency, displayCurrency)
}

function getSortEffectivePrice(offer: FlightOffer, sortMode: string, displayCurrency: string): number {
  const base = convertCurrencyAmount(getOfferBaseTotal(offer), offer.currency, displayCurrency)
  if (sortMode === 'price_with_bag') {
    const bag = offer.ancillaries?.checked_bag
    if (hasIncludedAncillary(bag)) return base
    const bagAmt = ancillaryInDisplay(bag, offer.currency, displayCurrency)
    return Math.round((base + bagAmt) * 100) / 100
  }
  if (sortMode === 'price_with_seat') {
    const seat = offer.ancillaries?.seat_selection
    if (hasIncludedAncillary(seat)) return base
    const seatAmt = ancillaryInDisplay(seat, offer.currency, displayCurrency)
    return Math.round((base + seatAmt) * 100) / 100
  }
  if (sortMode === 'price_with_all') {
    const bagAmt = ancillaryInDisplay(offer.ancillaries?.checked_bag, offer.currency, displayCurrency)
    const seatAmt = ancillaryInDisplay(offer.ancillaries?.seat_selection, offer.currency, displayCurrency)
    return Math.round((base + bagAmt + seatAmt) * 100) / 100
  }
  return getOfferDisplayTotalPrice(offer, displayCurrency)
}

// ── Deal reasoning helpers ────────────────────────────────────────────────────
function computeDealReason(
  offer: FlightOffer,
  allOffers: FlightOffer[],
  tripContext: string | undefined,
  depTimePref: string | undefined,
  currency: string,
  locale: string,
): string {
  const price = getOfferDisplayTotalPrice(offer, currency)
  const googleSavings = getGoogleFlightsSavingsAmount(getOfferKnownTotalPrice(offer), offer.google_flights_price)

  const parts: string[] = []

  if (googleSavings !== null && googleSavings > 20) {
    const label = formatGoogleFlightsSavings(
      convertCurrencyAmount(googleSavings, offer.currency, currency),
      currency,
      locale,
    )
    parts.push(`${label} cheaper than Google Flights`)
  }

  const isCheapestDirect = offer.stops === 0 &&
    allOffers.filter(o => o.stops === 0).every(o => getOfferDisplayTotalPrice(o, currency) >= price - 0.01)
  const isOverallCheapest = allOffers.every(o => getOfferDisplayTotalPrice(o, currency) >= price - 0.01)

  if (isCheapestDirect) {
    parts.push('cheapest direct flight')
  } else if (isOverallCheapest && offer.stops > 0) {
    parts.push('cheapest option found')
  } else if (offer.stops === 0) {
    parts.push('direct flight')
  }

  if (parts.length < 2) {
    if (tripContext === 'family' && offer.stops === 0) {
      parts.push('no layover — ideal for families')
    } else if (tripContext === 'business_traveler' && offer.stops === 0) {
      parts.push('direct — reliable for business')
    } else if (tripContext === 'couple' && offer.stops === 0) {
      parts.push('smooth and direct')
    }
  }

  if (depTimePref && parts.length < 2) {
    const depMins = isoToMins(offer.departure_time)
    const [lo, hi]: [number, number] =
      depTimePref === 'early_morning' ? [0, 360]
      : depTimePref === 'morning' ? [360, 720]
      : depTimePref === 'afternoon' ? [720, 1080]
      : [1080, 1439]
    if (depMins >= lo && depMins <= hi) {
      const label =
        depTimePref === 'early_morning' ? 'early morning departure'
        : depTimePref === 'morning' ? 'morning departure'
        : depTimePref === 'afternoon' ? 'afternoon departure'
        : 'evening departure'
      parts.push(label)
    }
  }

  if (parts.length === 0) return 'Best value found across 200+ airlines'
  return parts.slice(0, 2).join(' · ')
}

// ── Concierge-voice deal reason (punchy scan-and-fact paragraph for hero) ────
function computeDealReasonParagraph(
  offer: FlightOffer,
  allOffers: FlightOffer[],
  tripContext: string | undefined,
  depTimePref: string | undefined,
  currency: string,
  locale: string,
): string {
  const total = allOffers.length
  const price = getOfferDisplayTotalPrice(offer, currency)
  const googleSavings = getGoogleFlightsSavingsAmount(getOfferKnownTotalPrice(offer), offer.google_flights_price)
  const facts: string[] = []

  const directOffers = allOffers.filter(o => o.stops === 0)
  const isCheapestDirect = offer.stops === 0 && directOffers.every(o => getOfferDisplayTotalPrice(o, currency) >= price - 0.01)
  const isOverallCheapest = allOffers.every(o => getOfferDisplayTotalPrice(o, currency) >= price - 0.01)

  if (googleSavings !== null && googleSavings > 15) {
    const label = formatGoogleFlightsSavings(
      convertCurrencyAmount(googleSavings, offer.currency, currency),
      currency,
      locale,
    )
    facts.push(`${label} cheaper than Google Flights`)
  }

  if (isCheapestDirect) {
    facts.push('cheapest direct flight on this route')
  } else if (isOverallCheapest) {
    facts.push('cheapest option overall')
  } else if (offer.stops === 0) {
    facts.push('direct — no layovers')
  }

  const checkedBag = offer.ancillaries?.checked_bag
  if (hasIncludedAncillary(checkedBag) && facts.length < 2) {
    const nearbyWithBag = allOffers
      .filter(o => o.id !== offer.id)
      .slice(0, 10)
      .filter(o => hasIncludedAncillary(o.ancillaries?.checked_bag)).length
    facts.push(nearbyWithBag < 3 ? 'bag included (most others charge extra)' : 'bag included')
  }

  if (facts.length < 2) {
    if (tripContext === 'family' && offer.stops === 0) {
      facts.push('no layover — easy with kids')
    } else if (tripContext === 'business_traveler' && offer.stops === 0) {
      facts.push('direct keeps your schedule')
    } else if (tripContext === 'couple' && facts.length < 1) {
      facts.push('smooth and comfortable')
    }
  }

  if (depTimePref && facts.length < 2) {
    const depMins = isoToMins(offer.departure_time)
    const [lo, hi]: [number, number] =
      depTimePref === 'early_morning' ? [0, 360]
      : depTimePref === 'morning' ? [360, 720]
      : depTimePref === 'afternoon' ? [720, 1080]
      : [1080, 1439]
    if (depMins >= lo && depMins <= hi) {
      const timeLabel =
        depTimePref === 'early_morning' ? 'early departure'
        : depTimePref === 'morning' ? 'morning departure'
        : depTimePref === 'afternoon' ? 'afternoon departure'
        : 'evening departure'
      facts.push(timeLabel)
    }
  }

  const countPfx = total > 5 ? `${total} flights scanned. ` : ''
  if (facts.length === 0) return `${countPfx}Best overall value across all sources checked.`
  const joined = facts.slice(0, 2).join(', ')
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
  return `${countPfx}${cap(joined)}.`
}

function computeWhyNot(
  offer: FlightOffer,
  hero: FlightOffer,
  currency: string,
  locale: string,
  tFn: (key: string, values?: Record<string, unknown>) => string,
): string {
  const heroPrice = getOfferDisplayTotalPrice(hero, currency)
  const offerPrice = getOfferDisplayTotalPrice(offer, currency)
  const priceDiff = Math.round(offerPrice - heroPrice)
  const parts: string[] = []

  if (priceDiff > 5) {
    parts.push(tFn('whyNotMoreExpensive', { amount: formatCurrencyAmount(priceDiff, currency, locale) }))
  } else if (priceDiff < -5) {
    parts.push(tFn('whyNotCheaper', { amount: formatCurrencyAmount(-priceDiff, currency, locale) }))
  }

  const stopsDiff = offer.stops - hero.stops
  if (stopsDiff > 0) {
    parts.push(stopsDiff === 1 ? tFn('whyNotMoreStop') : tFn('whyNotMoreStops', { n: stopsDiff }))
  } else if (stopsDiff < 0) {
    parts.push(tFn('whyNotFewerStops'))
  }

  const durDiff = offer.duration_minutes - hero.duration_minutes
  if (durDiff > 60 && parts.length < 2) {
    parts.push(tFn('whyNotLonger', { duration: fmtDuration(durDiff) }))
  }

  if (parts.length === 0) return tFn('whyNotAlternative')
  if (parts.length === 1) return tFn('whyNot1', { reason: parts[0] })
  return tFn('whyNot2', { reason1: parts[0], reason2: parts[1] })
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  allOffers: FlightOffer[]
  currency: string
  priceMin: number
  priceMax: number
  searchId?: string
  trackingSearchId?: string | null
  isTestSearch?: boolean
  onTrackPrices?: () => void
  /** Called when user clicks Select on any offer (navigates toward checkout). */
  onOfferSelect?: () => void
  newOfferIds?: Set<string>
  isSearching?: boolean
  progress?: { checked: number; total: number; found: number }
  defaultSort?: 'price' | 'price_with_bag' | 'price_with_seat' | 'price_with_all' | 'duration'
  requireSeatPerPerson?: boolean
  requireBagPerPerson?: boolean
  initialDepTimePref?: 'early_morning' | 'morning' | 'afternoon' | 'evening' | 'red_eye'
  initialRetTimePref?: 'early_morning' | 'morning' | 'afternoon' | 'evening' | 'red_eye'
  initialArrTimePref?: 'morning' | 'afternoon' | 'evening'
  /** Hard departure time floor in minutes from midnight (e.g. 600 = 10:00 am). */
  initialDepartAfterMins?: number
  /** Hard departure time ceiling in minutes from midnight (e.g. 540 = 9:00 am). */
  initialDepartBeforeMins?: number
  tripContext?: 'solo' | 'couple' | 'family' | 'group' | 'business_traveler'
  tripPurpose?: 'honeymoon' | 'business' | 'ski' | 'beach' | 'city_break' | 'family_holiday' | 'graduation' | 'concert_festival' | 'sports_event' | 'spring_break'
  preferredAirline?: string
  preferQuickFlight?: boolean
  preferCheapest?: boolean
  viaIata?: string
  maxStops?: number
  fallbackNotes?: {
    origin?: { intended: string; used_code: string; used_name: string; hub_name: string; reason: string }
    destination?: { intended: string; used_code: string; used_name: string; hub_name: string; reason: string }
  }
  initialGemini?: { title?: string; hero: string; runners: string[]; ts: number; locale?: string }
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ResultsPanel({
  allOffers,
  currency,
  priceMin: _priceMin,
  priceMax: _priceMax,
  searchId,
  trackingSearchId,
  isTestSearch = false,
  onTrackPrices,
  onOfferSelect,
  newOfferIds,
  isSearching = false,
  progress,
  defaultSort,
  requireSeatPerPerson: _requireSeatPerPerson = false,
  requireBagPerPerson = false,
  initialDepTimePref,
  initialRetTimePref,
  initialArrTimePref,
  initialDepartAfterMins,
  initialDepartBeforeMins,
  tripContext,
  tripPurpose,
  preferredAirline,
  preferQuickFlight,
  preferCheapest,
  viaIata,
  maxStops,
  fallbackNotes,
  initialGemini,
}: Props) {
  // Persona-based grouping: 0 = ideal match, higher = less preferred
  function personaGroup(o: FlightOffer): number {
    if (!tripContext || tripContext === 'solo' || tripContext === 'group') return 0
    const stops = o.stops ?? 0
    const dep = isoToMins(o.departure_time)
    const goodHours = dep >= 360 && dep <= 1260  // 6am–9pm
    if (tripContext === 'family') {
      // Kids on plane: direct flights first, then by stop count
      return stops
    }
    if (tripContext === 'business_traveler') {
      // Direct + civilised hours > direct + bad hours > connecting + good hours > rest
      if (stops === 0 && goodHours) return 0
      if (stops === 0) return 1
      if (goodHours) return 2
      return 3
    }
    if (tripContext === 'couple') {
      return stops === 0 ? 0 : 1
    }
    return 0
  }
  // Convert time-of-day pref to minute-range [lo, hi] used for soft-boost scoring
  function timePrefRange(pref: string | undefined): [number, number] {
    if (pref === 'early_morning') return [0, 360]
    if (pref === 'morning') return [360, 720]
    if (pref === 'afternoon') return [720, 1080]
    if (pref === 'evening' || pref === 'red_eye') return [1080, 1439]
    return [0, 1439]
  }
  function inTimePref(mins: number, pref: string | undefined): boolean {
    if (!pref) return true
    const [lo, hi] = timePrefRange(pref)
    return mins >= lo && mins <= hi
  }
  const t = useTranslations('ResultsPanel')
  const locale = useLocale()
  const searchParams = useSearchParams()
  const emailUnlockToken = searchParams.get('mt')
  const analyticsSearchId = trackingSearchId || searchId
  const resultsSourcePath = getTrackedSourcePath(searchId ? `/results/${searchId}` : '/results', isTestSearch)
  // ── Filter state ──────────────────────────────────────────────────────────
  const [sort, setSort] = useState<'price' | 'price_with_bag' | 'price_with_seat' | 'price_with_all' | 'duration'>(defaultSort ?? 'price')
  const [stopsFilter, setStopsFilter] = useState<string[]>([])          // [] = all
  const [airlinesFilter, setAirlinesFilter] = useState<string[]>([])    // [] = all
  const [amenityFilters, setAmenityFilters] = useState<string[]>([])
  const [priceRange, setPriceRange] = useState<[number, number]>([_priceMin, _priceMax])
  const [depRange, setDepRange] = useState<[number, number]>([0, 1439])
  const [retRange, setRetRange] = useState<[number, number]>([0, 1439])
  const [durationRange, setDurationRange] = useState<[number, number]>([0, Infinity])
  const [airlinesOpen, setAirlinesOpen] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const autoExpandedRef = useRef<string | null>(null) // tracks ID of the last auto-set #1 offer
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const [visibleCount, setVisibleCount] = useState(20)
  const [isUnlocked, setIsUnlocked] = useState(false)
  const [revealedSources, setRevealedSources] = useState<Record<string, string>>({})
  const [geminiJustification, setGeminiJustification] = useState<{
    title?: string
    hero: string
    runners: string[]
  } | 'loading' | null>(() => {
    // 1. Server-provided (canonical) — only use if locale matches (avoids showing
    //    English text to a Japanese user when the cache was seeded by a different locale).
    if (initialGemini?.hero && initialGemini.hero.length > 10) {
      const age = Date.now() - (initialGemini.ts ?? 0)
      // Treat absent locale as 'en' (old cache entries were always English).
      // Only use if locale matches — don't show English text to a Japanese user.
      const cachedLocale = initialGemini.locale ?? 'en'
      const localeMatch = cachedLocale === locale
      if (age < 6 * 3600 * 1000 && localeMatch) {
        return { title: initialGemini.title, hero: initialGemini.hero, runners: initialGemini.runners }
      }
    }
    // 2. localStorage fallback — locale-keyed so each language gets its own cache.
    if (typeof window === 'undefined' || !searchId) return null
    try {
      const raw = localStorage.getItem(`gemini_${searchId}_${locale}`)
      if (!raw) return null
      const d = JSON.parse(raw) as { title?: string; hero?: string; runners?: string[]; ts?: number }
      const age = Date.now() - (d.ts ?? 0)
      if (age < 6 * 3600 * 1000 && typeof d.hero === 'string' && d.hero.length > 10) {
        return { title: d.title as string | undefined, hero: d.hero, runners: (d.runners as string[] | undefined) ?? [] }
      }
    } catch { /* ignore */ }
    return null
  })
  // Tracks which generation phase has fired and what hero it was based on
  const geminiStateRef = useRef<{
    phase: 'none' | 'early' | 'mid' | 'final'
    heroId: string | null
    lastSentIds: string | null
    callCount: number
    gen20Fired: boolean
    gen40Fired: boolean
    gen70Fired: boolean
    finalFired: boolean
    finalSentIds: string | null
    finalRefired: boolean
  }>({ phase: 'none', heroId: null, lastSentIds: null, callCount: 0, gen20Fired: false, gen40Fired: false, gen70Fired: false, finalFired: false, finalSentIds: null, finalRefired: false })

  // ── Sidebar stats (always based on all offers) ────────────────────────────
  const stopsStats = useMemo(() => {
    const groups: Record<string, { count: number; min: number; currency?: string }> = {}
    for (const key of ['0', '1', '2plus'] as const) {
      const arr = allOffers.filter(o =>
        key === '0' ? o.stops === 0 : key === '1' ? o.stops === 1 : o.stops >= 2
      )
      const cheapestOffer = findCheapestOffer(arr, currency)
      groups[key] = {
        count: arr.length,
        min: cheapestOffer ? getOfferDisplayTotalPrice(cheapestOffer, currency) : Infinity,
        currency,
      }
    }
    return groups
  }, [allOffers, currency])

  const airlineOptions = useMemo(() => {
    const map = new Map<string, { minPrice: number; currency: string }>()
    for (const o of allOffers) {
      const offerPrice = getOfferDisplayTotalPrice(o, currency)
      for (const carrier of getOfferCarriers(o)) {
        const category = getAirlineCategory(carrier.code)
        const current = map.get(category)
        if (!current || offerPrice < current.minPrice) {
          map.set(category, { minPrice: offerPrice, currency })
        }
      }
    }
    // Fixed display order: LCC → FSC → generic
    const ORDER = ['Low-cost carrier', 'Full-service carrier', 'Airline']
    return [...map.entries()]
      .sort((a, b) => ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]))
      .map(([airline, value]) => ({ airline, minPrice: value.minPrice, currency: value.currency }))
  }, [allOffers, currency])

  const amenityStats = useMemo(() => {
    const stats = {
      checked_included: 0,
      checked_fee_known: 0,
      seat_fee_known: 0,
    }

    for (const offer of allOffers) {
      if (hasIncludedAncillary(offer.ancillaries?.checked_bag)) {
        stats.checked_included += 1
      }
      if (hasPaidAncillary(offer.ancillaries?.checked_bag)) {
        stats.checked_fee_known += 1
      }
      if (hasPaidAncillary(offer.ancillaries?.seat_selection)) {
        stats.seat_fee_known += 1
      }
    }

    return stats
  }, [allOffers])

  const durationBounds = useMemo(() => {
    if (!allOffers.length) return { min: 0, max: 1440 }
    let min = Infinity, max = 0
    for (const o of allOffers) {
      if (o.duration_minutes < min) min = o.duration_minutes
      if (o.duration_minutes > max) max = o.duration_minutes
    }
    return { min, max }
  }, [allOffers])

  // ── Filtered + sorted offers ──────────────────────────────────────────────
  const displayOffers = useMemo(() => {
    let list = allOffers.filter(o => {
      const offerPrice = getOfferDisplayTotalPrice(o, currency)
      // Stops
      if (stopsFilter.length > 0) {
        const key = o.stops === 0 ? '0' : o.stops === 1 ? '1' : '2plus'
        if (!stopsFilter.includes(key)) return false
      }
      // Airlines (by category)
      if (airlinesFilter.length > 0) {
        const offerCategories = new Set(
          getOfferCarriers(o).map((carrier) => getAirlineCategory(carrier.code))
        )
        if (!airlinesFilter.some((cat) => offerCategories.has(cat))) return false
      }
      // Ancillaries
      if (amenityFilters.includes('checked_included') && !hasIncludedAncillary(o.ancillaries?.checked_bag)) return false
      if (amenityFilters.includes('checked_fee_known') && !hasPaidAncillary(o.ancillaries?.checked_bag)) return false
      if (amenityFilters.includes('seat_fee_known') && !hasPaidAncillary(o.ancillaries?.seat_selection)) return false
      // Price range
      if (offerPrice < priceRange[0] || offerPrice > priceRange[1]) return false
      // Departure time
      const dep = isoToMins(o.departure_time)
      if (dep < depRange[0] || dep > depRange[1]) return false
      // Return departure time for RT, outbound arrival for OW
      const arr = isoToMins(o.inbound?.departure_time ?? o.arrival_time)
      if (arr < retRange[0] || arr > retRange[1]) return false
      // Duration
      if (o.duration_minutes < durationRange[0] || o.duration_minutes > durationRange[1]) return false
      return true
    })
    // Via-IATA filter: NL query specified a preferred stopover airport/city.
    // Only keep offers that pass through the requested airport (or a same-city sibling).
    // Direct flights are excluded — they have no stopover by definition.
    if (viaIata) {
      const targetUpper = viaIata.toUpperCase()
      // Known same-city airport groups — e.g. IST and SAW both serve Istanbul
      const SAME_CITY: Record<string, string[]> = {
        IST: ['IST', 'SAW'], SAW: ['IST', 'SAW'],
        LHR: ['LHR', 'LGW', 'STN', 'LCY', 'LTN', 'SEN'],
        LGW: ['LHR', 'LGW', 'STN', 'LCY', 'LTN', 'SEN'],
        STN: ['LHR', 'LGW', 'STN', 'LCY', 'LTN', 'SEN'],
        LCY: ['LHR', 'LGW', 'STN', 'LCY', 'LTN', 'SEN'],
        LTN: ['LHR', 'LGW', 'STN', 'LCY', 'LTN', 'SEN'],
        JFK: ['JFK', 'LGA', 'EWR'], LGA: ['JFK', 'LGA', 'EWR'], EWR: ['JFK', 'LGA', 'EWR'],
        NRT: ['NRT', 'HND'], HND: ['NRT', 'HND'],
        MXP: ['MXP', 'LIN', 'BGY'], LIN: ['MXP', 'LIN', 'BGY'], BGY: ['MXP', 'LIN', 'BGY'],
        CDG: ['CDG', 'ORY', 'BVA'], ORY: ['CDG', 'ORY', 'BVA'], BVA: ['CDG', 'ORY', 'BVA'],
        FCO: ['FCO', 'CIA'], CIA: ['FCO', 'CIA'],
        DXB: ['DXB', 'DWC'], DWC: ['DXB', 'DWC'],
      }
      const acceptedAirports = new Set<string>(SAME_CITY[targetUpper] ?? [targetUpper])
      list = list.filter(o => {
        // Direct flights have no stopover — exclude
        if (o.stops === 0) return false
        // Check outbound segment destinations for the via airport
        const outSegs = o.segments ?? []
        if (outSegs.length > 0) {
          const outMatch = outSegs.slice(0, -1).some(s => acceptedAirports.has((s.destination ?? '').toUpperCase()))
          if (outMatch) return true
          // Check inbound for round-trips
          const inSegs = o.inbound?.segments ?? []
          if (inSegs.length > 0) {
            return inSegs.slice(0, -1).some(s => acceptedAirports.has((s.destination ?? '').toUpperCase()))
          }
          // Outbound segments present but no match found — exclude
          return false
        }
        // No segment data available — keep (cannot verify stopover)
        return true
      })
    }
    if (sort === 'duration') {
      list = [...list].sort((a, b) => a.duration_minutes - b.duration_minutes)
    } else if (sort !== 'price') {
      // Explicit ancillary sort chosen by user — respect it
      list = [...list].sort((a, b) => getSortEffectivePrice(a, sort, currency) - getSortEffectivePrice(b, sort, currency))
    } else {
      // Default: personalized ranking based on user intent
      const rctx: RankingContext = {
        tripContext,
        tripPurpose,
        depTimePref: initialDepTimePref,
        retTimePref: initialRetTimePref,
        arrivalTimePref: initialArrTimePref,
        departAfterMins: initialDepartAfterMins,
        departBeforeMins: initialDepartBeforeMins,
        requireBag: requireBagPerPerson,
        preferredAirline,
        preferQuickFlight,
        preferCheapest,
        preferDirect: maxStops === 0,
      }
      const listWithDisplayPrice = list.map(o => ({ ...o, displayPrice: getOfferDisplayTotalPrice(o, currency) }))
      const ranked = rankOffers(listWithDisplayPrice, rctx)

      // Pick top-3 that are genuinely different propositions (different departure
      // time slot or different stop count). This prevents showing the same flight
      // from 3 booking sources as "3 different options" — runner-ups are real
      // alternatives with different trade-offs (e.g. evening 1-stop vs morning direct).
      const diverseTop3 = selectDiverseTop(ranked, 3)
      const diverseIds = new Set(diverseTop3.map(r => r.offer.id))
      const rest = ranked.filter(r => !diverseIds.has(r.offer.id))
      list = [...diverseTop3, ...rest].map(r => r.offer as typeof list[number])

      // Guarantee the absolute cheapest offer is always visible in the top 3.
      // If ranking placed it at position 3+ (e.g. because it departs at 3am), swap it to #3.
      if (list.length >= 3) {
        const cheapestIdx = list.reduce((minIdx, o, idx) =>
          getOfferDisplayTotalPrice(o, currency) < getOfferDisplayTotalPrice(list[minIdx], currency) ? idx : minIdx, 0)
        if (cheapestIdx > 2) {
          const tmp = [...list]
          const [cheapestOffer] = tmp.splice(cheapestIdx, 1)
          tmp.splice(2, 0, cheapestOffer)
          list = tmp
        }
      }

      // When the user explicitly asked for direct flights but none of the top 3
      // match their stops preference, surface the offer with the FEWEST stops
      // (tiebreak: shortest duration) into position #2 so the alternates panel
      // honours their request even if no true direct exists. Without this the
      // top 3 can all end up as 3-stop, 30h+ itineraries that ignore the
      // "direct" preference entirely.
      if (rctx.preferDirect && list.length >= 3) {
        const top3MinStops = Math.min(list[0].stops, list[1].stops, list[2].stops)
        let bestIdx = -1
        let bestStops = top3MinStops
        let bestDuration = Infinity
        for (let i = 3; i < list.length; i++) {
          const o = list[i]
          if (o.stops < bestStops || (o.stops === bestStops && o.duration_minutes < bestDuration)) {
            bestStops = o.stops
            bestDuration = o.duration_minutes
            bestIdx = i
          }
        }
        // Only swap if we found a strictly better stops profile (not just a
        // tie — top 3 already represents the chosen tradeoff at that stop count).
        if (bestIdx !== -1 && bestStops < top3MinStops) {
          const tmp = [...list]
          const [fastestOffer] = tmp.splice(bestIdx, 1)
          tmp.splice(1, 0, fastestOffer)
          list = tmp
        }
      }
    }

    // Soft time-pref boost and persona grouping only apply when user has
    // explicitly selected a non-price sort (ranking already handles these).
    if (sort !== 'price') {
      if ((initialDepTimePref || initialRetTimePref) && depRange[0] === 0 && depRange[1] === 1439 && retRange[0] === 0 && retRange[1] === 1439) {
        const matched: typeof list = []
        const rest: typeof list = []
        for (const o of list) {
          const depMins = isoToMins(o.departure_time)
          const retMins = isoToMins(o.inbound?.departure_time ?? o.arrival_time)
          const depOk = inTimePref(depMins, initialDepTimePref)
          const retOk = inTimePref(retMins, initialRetTimePref)
          if (depOk && retOk) matched.push(o)
          else rest.push(o)
        }
        list = [...matched, ...rest]
      }
      if (tripContext && tripContext !== 'solo' && tripContext !== 'group') {
        if (tripContext === 'family' && sort !== 'duration') {
          list = [...list].sort((a, b) => a.duration_minutes - b.duration_minutes)
        }
        list = [...list].sort((a, b) => personaGroup(a) - personaGroup(b))
      }
    }
    return list
  }, [allOffers, stopsFilter, airlinesFilter, amenityFilters, priceRange, depRange, retRange, durationRange, sort, currency, initialDepTimePref, initialRetTimePref, initialArrTimePref, tripContext, tripPurpose, preferredAirline, requireBagPerPerson, viaIata])

  const visibleOffers = useMemo(() => displayOffers.slice(0, visibleCount), [displayOffers, visibleCount])

  // Auto-expand the top-ranked offer on first load; follow it when AI reranking swaps #1
  useEffect(() => {
    const first = displayOffers[0]
    if (!first) return
    if (autoExpandedRef.current === null) {
      // Initial: expand the first offer
      autoExpandedRef.current = first.id
      setExpandedId(first.id)
    } else if (first.id !== autoExpandedRef.current) {
      // #1 changed (AI rerank) — if the previously auto-expanded offer is still expanded,
      // collapse it and expand the new #1
      const prevId = autoExpandedRef.current
      autoExpandedRef.current = first.id
      setExpandedId(prev => prev === prevId ? first.id : prev)
    }
  }, [displayOffers])

  // Top 3 for Gemini justification — MUST match exactly what's shown in the top 3 cards.
  // Derived from displayOffers (which already applies all active UI filters and sort order)
  // so globalRankTopThree[0] is always the same offer rendered as the hero card.
  // We re-run rankOffers on the full displayOffers set to get calibrated score/breakdown/
  // heroFacts/tradeoffs metadata, then return the results in display order.
  const globalRankTopThree = useMemo((): RankedOffer<FlightOffer>[] => {
    const top = displayOffers.slice(0, 3)
    if (top.length === 0) return []
    const rctx: RankingContext = {
      tripContext,
      tripPurpose,
      depTimePref: initialDepTimePref,
      retTimePref: initialRetTimePref,
      arrivalTimePref: initialArrTimePref,
      requireBag: requireBagPerPerson,
      preferredAirline,
      preferQuickFlight,
      preferCheapest,
      preferDirect: maxStops === 0,
    }
    // Rank all displayOffers so scores/tradeoffs are calibrated against the full visible set.
    const withDisplayPrice = displayOffers.map(o => ({ ...o, displayPrice: getOfferDisplayTotalPrice(o, currency) }))
    const fullRanked = rankOffers(withDisplayPrice, rctx) as RankedOffer<FlightOffer>[]
    const rankedById = new Map(fullRanked.map(r => [r.offer.id, r]))
    // Return in display order so globalRankTopThree[0] === displayOffers[0] (the hero card).
    return top.map((o, idx) => {
      const ranked = rankedById.get(o.id)
      if (ranked) return { ...ranked, rank: idx + 1 }
      return { offer: o, rank: idx + 1, score: 0, breakdown: {} as RankedOffer<FlightOffer>['breakdown'], heroFacts: [], tradeoffs: [] }
    })
  }, [displayOffers, currency, tripContext, tripPurpose, initialDepTimePref, initialRetTimePref, initialArrTimePref, requireBagPerPerson, preferredAirline, preferQuickFlight, preferCheapest, maxStops])

  const profileLabel = useMemo(() => getProfileLabel({
    tripContext, tripPurpose, requireBag: requireBagPerPerson, preferredAirline,
  }), [tripContext, tripPurpose, requireBagPerPerson, preferredAirline])

  // ── 3-generation Gemini justification system ─────────────────────────────
  // Gen 1 (early):  fires as soon as ≥5 offers arrive, even while still searching
  // Gen 2 (mid):    fires at ≥90% progress if the hero changed since Gen 1
  // Gen 3 (final):  fires when search completes if the hero changed since last gen
  //                 (if hero didn't change, we just clear the "still searching" tone)
  // Max 3 Gemini calls total per search session.

  const rawQuery = typeof window !== 'undefined'
    ? (new URL(window.location.href).searchParams.get('q') ?? '')
    : ''

  const callGemini = useCallback((phase: 'early' | 'mid' | 'final') => {
    if (globalRankTopThree.length === 0) return
    setGeminiJustification('loading')
    const heroId = globalRankTopThree[0].offer.id
    geminiStateRef.current.heroId = heroId
    geminiStateRef.current.phase = phase
    geminiStateRef.current.lastSentIds = globalRankTopThree.map(r => r.offer.id).join(',')
    geminiStateRef.current.callCount++

    void fetch('/api/rank', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phase,
        searchId,
        topOffers: globalRankTopThree.map(r => ({
          offer: {
            id: r.offer.id,
            airline: r.offer.airline,
            price: r.offer.price,
            source: r.offer.source,
            currency: r.offer.currency,
            origin: r.offer.origin,
            destination: r.offer.destination,
            departure_time: r.offer.departure_time,
            arrival_time: r.offer.arrival_time,
            duration_minutes: r.offer.duration_minutes,
            stops: r.offer.stops,
            google_flights_price: r.offer.google_flights_price,
            ancillaries: r.offer.ancillaries,
            segments: r.offer.segments,
            inbound: r.offer.inbound ? { departure_time: r.offer.inbound.departure_time } : undefined,
          },
          score: r.score,
          breakdown: r.breakdown,
          heroFacts: r.heroFacts,
          tradeoffs: r.tradeoffs,
        })),
        rawQuery,
        context: {
          tripContext,
          tripPurpose,
          depTimePref: initialDepTimePref,
          retTimePref: initialRetTimePref,
          arrivalTimePref: initialArrTimePref,
          requireBag: requireBagPerPerson,
          preferredAirline,
          preferQuickFlight,
          preferCheapest,
          preferDirect: maxStops === 0,
        } satisfies RankingContext,
        ...(fallbackNotes?.origin || fallbackNotes?.destination
          ? { fallbackNotes }
          : {}),
        locale,
      }),
    })
      .then(res => (res.ok ? res.json() : null))
      .then((data: { title?: string; hero?: string; runners?: string[] } | null) => {
        if (data?.hero && data.hero.length > 10) {
          const result = { title: data.title, hero: data.hero, runners: data.runners ?? [] }
          setGeminiJustification(result)
          // Persist locale-keyed so each language version is cached independently.
          if (searchId && typeof window !== 'undefined') {
            try { localStorage.setItem(`gemini_${searchId}_${locale}`, JSON.stringify({ ...result, ts: Date.now() })) } catch { /* ignore */ }
          }
        } else {
          setGeminiJustification(null)
        }
      })
      .catch(() => setGeminiJustification(null))
  }, [globalRankTopThree, rawQuery, locale, tripContext, tripPurpose, initialDepTimePref, initialArrTimePref, requireBagPerPerson, preferredAirline, preferQuickFlight, fallbackNotes])

  // ── 5-generation Gemini justification system ─────────────────────────────
  // Max 5 Gemini calls per search session:
  //   Gen 1 (early)  — always fires at start once ≥6 connectors have checked in
  //   Gen 2 (mid)    — fires at 20% progress ONLY if a better hero was found
  //   Gen 3 (mid)    — fires at 40% progress ONLY if a better hero was found
  //   Gen 4 (mid)    — fires at 70% progress ONLY if a better hero was found
  //   Gen 5 (final)  — always fires when search completes
  // Middle gens (2-4) are conditional — if the ranking is stable they are skipped.

  // Gen 1 — fires once the first wave of fast API connectors have all reported back.
  // Waiting for progress.checked >= 6 ensures we have results from multiple independent
  // sources (Ryanair, Wizz, EasyJet, Kiwi, Skyscanner, Norwegian etc.) before ranking.
  // A single-connector pool would produce a meaningless Gemini justification.
  useEffect(() => {
    if (geminiStateRef.current.phase !== 'none') return  // already started
    if (globalRankTopThree.length === 0) return
    // Cache hit: search is done and we already restored a justification from localStorage.
    // Don't re-fire — the user gets the same result they saw before.
    if (geminiJustification !== null && geminiJustification !== 'loading' && !isSearching) return
    // Need either (a) ≥6 connectors checked in from a live search, or
    // (b) a finished search with ≥5 offers (page reopen / cached results).
    const enoughConnectors = progress && progress.checked >= 6
    const finishedWithOffers = !isSearching && allOffers.length >= 5
    if (!enoughConnectors && !finishedWithOffers) return
    callGemini('early')
  }, [progress, globalRankTopThree, callGemini, geminiJustification, isSearching, allOffers.length])

  // Gen 2 — fires at 30% progress if a better offer displaced the current hero
  useEffect(() => {
    if (!isSearching) return  // search done, let Gen 5 handle it
    if (geminiStateRef.current.phase === 'none') return  // Gen 1 not done yet
    if (geminiStateRef.current.gen20Fired) return
    if (geminiStateRef.current.callCount >= 4) return  // reserve last slot for Gen 5
    if (globalRankTopThree.length === 0) return
    const progressPct = progress ? progress.checked / Math.max(progress.total, 1) : 0
    if (progressPct < 0.30) return
    const currentHeroId = globalRankTopThree[0].offer.id
    if (currentHeroId === geminiStateRef.current.heroId) return  // no better deal found, skip
    geminiStateRef.current.gen20Fired = true
    callGemini('mid')
  }, [isSearching, progress, globalRankTopThree, callGemini])

  // Gen 3 — fires at 55% progress if a better offer displaced the current hero
  useEffect(() => {
    if (!isSearching) return
    if (geminiStateRef.current.phase === 'none') return
    if (geminiStateRef.current.gen40Fired) return
    if (geminiStateRef.current.callCount >= 4) return  // reserve last slot for Gen 5
    if (globalRankTopThree.length === 0) return
    const progressPct = progress ? progress.checked / Math.max(progress.total, 1) : 0
    if (progressPct < 0.55) return
    const currentHeroId = globalRankTopThree[0].offer.id
    if (currentHeroId === geminiStateRef.current.heroId) return  // no better deal found, skip
    geminiStateRef.current.gen40Fired = true
    callGemini('mid')
  }, [isSearching, progress, globalRankTopThree, callGemini])

  // Gen 4 — fires at 85% progress if a better offer displaced the current hero
  useEffect(() => {
    if (!isSearching) return
    if (geminiStateRef.current.phase === 'none') return
    if (geminiStateRef.current.gen70Fired) return
    if (geminiStateRef.current.callCount >= 4) return  // reserve last slot for Gen 5
    if (globalRankTopThree.length === 0) return
    const progressPct = progress ? progress.checked / Math.max(progress.total, 1) : 0
    if (progressPct < 0.85) return
    const currentHeroId = globalRankTopThree[0].offer.id
    if (currentHeroId === geminiStateRef.current.heroId) return  // no better deal found, skip
    geminiStateRef.current.gen70Fired = true
    callGemini('mid')
  }, [isSearching, progress, globalRankTopThree, callGemini])

  // Gen 5 (final) — always fires when search completes, regardless of hero change
  useEffect(() => {
    if (isSearching) return
    if (geminiStateRef.current.phase === 'none') return  // Gen 1 never ran (no offers yet)
    if (globalRankTopThree.length === 0) return
    const sentIds = globalRankTopThree.map(r => r.offer.id).join(',')
    if (geminiStateRef.current.finalFired) {
      // Race condition guard: one extra re-fire if top-3 changed slightly after final
      if (geminiStateRef.current.finalRefired) return
      if (geminiStateRef.current.finalSentIds === sentIds) return
      geminiStateRef.current.finalRefired = true
      geminiStateRef.current.finalSentIds = sentIds
      callGemini('final')
      return
    }
    geminiStateRef.current.finalFired = true
    geminiStateRef.current.finalSentIds = sentIds
    callGemini('final')
  }, [isSearching, globalRankTopThree, callGemini])

  useEffect(() => {
    setPriceRange([_priceMin, _priceMax])
  }, [_priceMin, _priceMax])

  const refreshUnlockState = useCallback(async () => {
    if (!searchId) {
      setIsUnlocked(false)
      return
    }

    try {
      const res = await fetch(`/api/unlock-status?searchId=${encodeURIComponent(searchId)}`, {
        cache: 'no-store',
      })
      if (!res.ok) return
      const data = await res.json() as { unlocked?: boolean }
      setIsUnlocked(Boolean(data.unlocked))
    } catch (_) {
      // Ignore transient unlock-status failures.
    }
  }, [searchId])

  useEffect(() => {
    if (!searchId) return

    void refreshUnlockState()

    const handlePageShow = () => {
      void refreshUnlockState()
    }
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void refreshUnlockState()
      }
    }

    window.addEventListener('pageshow', handlePageShow)
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      window.removeEventListener('pageshow', handlePageShow)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [refreshUnlockState, searchId])

  useEffect(() => {
    if (!searchId || !isUnlocked || visibleOffers.length === 0) return

    const pendingOffers = visibleOffers.filter((offer) => !revealedSources[offer.id])
    if (pendingOffers.length === 0) return

    let cancelled = false

    void Promise.all(pendingOffers.map(async (offer) => {
      try {
        const params = new URLSearchParams({
          from: searchId,
          view: 'source-meta',
        })
        appendProbeParam(params, isTestSearch)
        if (offer.offer_ref) {
          params.set('ref', offer.offer_ref)
        }

        const res = await fetch(`/api/offer/${encodeURIComponent(offer.id)}?${params.toString()}`, {
          cache: 'no-store',
        })
        if (!res.ok) return null

        const data = await res.json() as SourceMetaResponse
        const label = typeof data.booking_site_summary === 'string' && data.booking_site_summary.trim().length > 0
          ? data.booking_site_summary.trim()
          : typeof data.booking_site === 'string' && data.booking_site.trim().length > 0
            ? data.booking_site.trim()
            : ''

        return label ? { offerId: offer.id, label } : null
      } catch (_) {
        return null
      }
    })).then((results) => {
      if (cancelled) return

      const nextSources: Record<string, string> = {}
      for (const result of results) {
        if (!result) continue
        nextSources[result.offerId] = result.label
      }

      if (Object.keys(nextSources).length > 0) {
        setRevealedSources((current) => ({ ...current, ...nextSources }))
      }
    })

    return () => {
      cancelled = true
    }
  }, [isUnlocked, revealedSources, searchId, visibleOffers])

  // ── Handlers ─────────────────────────────────────────────────────────────
  const toggleStop = useCallback((key: string) => {
    setStopsFilter(prev => prev.includes(key) ? prev.filter(s => s !== key) : [...prev, key])
    setVisibleCount(20)
    trackSearchSessionEvent(analyticsSearchId, 'filters_changed', { filter: 'stops', value: key }, {
      source: 'website-results-panel',
      source_path: resultsSourcePath,
      is_test_search: isTestSearch || undefined,
    })
  }, [analyticsSearchId, isTestSearch, resultsSourcePath])

  const toggleAirline = useCallback((airline: string) => {
    setAirlinesFilter(prev => prev.includes(airline) ? prev.filter(a => a !== airline) : [...prev, airline])
    setVisibleCount(20)
    trackSearchSessionEvent(analyticsSearchId, 'filters_changed', { filter: 'airline', value: airline }, {
      source: 'website-results-panel',
      source_path: resultsSourcePath,
      is_test_search: isTestSearch || undefined,
    })
  }, [analyticsSearchId, isTestSearch, resultsSourcePath])

  const toggleAmenity = useCallback((key: string) => {
    setAmenityFilters(prev => prev.includes(key) ? prev.filter((value) => value !== key) : [...prev, key])
    setVisibleCount(20)
    trackSearchSessionEvent(analyticsSearchId, 'filters_changed', { filter: 'amenity', value: key }, {
      source: 'website-results-panel',
      source_path: resultsSourcePath,
      is_test_search: isTestSearch || undefined,
    })
  }, [analyticsSearchId, isTestSearch, resultsSourcePath])

  const clearAll = useCallback(() => {
    setStopsFilter([])
    setAirlinesFilter([])
    setAmenityFilters([])
    setPriceRange([_priceMin, _priceMax])
    setDepRange([0, 1439])
    setRetRange([0, 1439])
    setDurationRange([0, Infinity])
    setVisibleCount(20)
    trackSearchSessionEvent(analyticsSearchId, 'filters_changed', { filter: 'clear_all' }, {
      source: 'website-results-panel',
      source_path: resultsSourcePath,
      is_test_search: isTestSearch || undefined,
    })
  }, [analyticsSearchId, isTestSearch, _priceMax, _priceMin, resultsSourcePath])

  const handleSortChange = useCallback((nextSort: 'price' | 'price_with_bag' | 'price_with_seat' | 'price_with_all' | 'duration') => {
    setSort(nextSort)
    setVisibleCount(20)
    trackSearchSessionEvent(analyticsSearchId, 'sort_changed', { sort: nextSort }, {
      source: 'website-results-panel',
      source_path: resultsSourcePath,
      is_test_search: isTestSearch || undefined,
    })
  }, [analyticsSearchId, isTestSearch, resultsSourcePath])

  const hasActiveFilters = stopsFilter.length > 0 || airlinesFilter.length > 0 || amenityFilters.length > 0
    || priceRange[0] > _priceMin || priceRange[1] < _priceMax
    || depRange[0] > 0 || depRange[1] < 1439
    || retRange[0] > 0 || retRange[1] < 1439
    || durationRange[0] > durationBounds.min || durationRange[1] < durationBounds.max

  const fmt = (p: number) => formatCurrencyAmount(p, currency, locale)

  const stopsOptions = [
    { key: '0', label: t('direct') },
    { key: '1', label: t('oneStop') },
    { key: '2plus', label: t('twoPlus') },
  ]

  const amenityOptions = [
    { key: 'checked_included', label: t('checkedBagIncludedFilter'), count: amenityStats.checked_included },
    { key: 'checked_fee_known', label: t('checkedBagFeeFilter'), count: amenityStats.checked_fee_known },
    { key: 'seat_fee_known', label: t('seatFeeFilter'), count: amenityStats.seat_fee_known },
  ]

  return (
    <div className="rf-layout rf-layout--curated">
      {/* ── Filter sidebar (hidden — curated mode) ─────────────────────── */}
      {/* ── Results card ───────────────────────────────────────────────────── */}
      <div className="rf-card-shell">
        {/* Sort bar */}
        <div className={`rf-bar${isSearching ? ' rf-bar--searching' : ''}`}>
          <div className="rf-bar-meta">
            <span className="rf-bar-count">
              {displayOffers.length === 1 ? t('flightSingular', { count: 1 }) : t('flightPlural', { count: displayOffers.length })}
            </span>
            {isSearching ? (
              <SearchProgressBarInline progress={progress} />
            ) : (
              displayOffers[0] && (
                <span className="rf-bar-from">
                  {t('fromPrice', {
                    price: fmt(getSortEffectivePrice(displayOffers[0], sort, currency)),
                  })}
                </span>
              )
            )}
            {onTrackPrices && !isSearching && (
              <span>{/* track prices moved below top-3 */}</span>
            )}
          </div>
          {!isSearching && (
            <div className="rf-bar-checked" aria-label="Sources checked">
              <span className="rf-bar-checked-label">{t('checkedSources')}</span>
              <div className="rf-bar-checked-logos">
                {CHECKED_SOURCES.map((src) => (
                  <span key={src} className="rf-bar-checked-chip" title={src}>
                    {src}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Flight list */}
        <div className="rf-list">
          {visibleOffers.map((offer, index) => {
            const isHero = index === 0
            const isRunnerUp = index === 1 || index === 2
            const isExpanded = expandedId === offer.id
            const offerCarriers = getOfferCarriers(offer)
            const airlineLabel = getOfferAirlineLabel(offer)
            const outboundStops = getRouteStops(offer.segments)
            const outboundViaBadge = getRouteViaBadge(outboundStops)
            const outboundViaTitle = getRouteViaTitle(outboundStops)
            const inboundStops = getRouteStops(offer.inbound?.segments)
            const inboundViaBadge = getRouteViaBadge(inboundStops)
            const inboundViaTitle = getRouteViaTitle(inboundStops)
            const outboundStopsLabel = getStopsLabel(offer.stops, offer.segments, t('direct'), t as (key: string, values?: Record<string, unknown>) => string)
            const inboundStopsLabel = offer.inbound
              ? getStopsLabel(offer.inbound.stops, offer.inbound.segments, t('direct'), t as (key: string, values?: Record<string, unknown>) => string)
              : t('direct')
            const outboundOriginName = offer.origin_name || offer.origin
            const outboundDestinationName = offer.destination_name || offer.destination
            const inboundOriginName = offer.inbound?.segments?.[0]?.origin_name || offer.destination_name || offer.inbound?.origin || ''
            const inboundDestinationName = offer.inbound?.segments?.[offer.inbound.segments.length - 1]?.destination_name || offer.origin_name || offer.inbound?.destination || ''
            const rawOfferTotal = getOfferKnownTotalPrice(offer)
            const fullOfferPrice = getOfferDisplayTotalPrice(offer, currency)
            const googleFlightsSavings = getGoogleFlightsSavingsAmount(rawOfferTotal, offer.google_flights_price)
            const googleFlightsSavingsLabel = googleFlightsSavings === null
              ? null
              : t('cheaperThanGoogleFlights', {
                  amount: formatGoogleFlightsSavings(
                    convertCurrencyAmount(googleFlightsSavings, offer.currency, currency),
                    currency,
                    locale,
                  ),
                })
            const checkedBag = offer.ancillaries?.checked_bag
            const seatSelection = offer.ancillaries?.seat_selection
            const ancillaryBadges = [
              hasIncludedAncillary(checkedBag)
                ? t('checkedBagIncluded')
                : hasPaidAncillary(checkedBag)
                  ? t('checkedBagFee', { price: fmtOfferPrice(checkedBag!.price!, checkedBag!.currency || offer.currency, currency, locale) })
                  : null,
              hasIncludedAncillary(seatSelection)
                ? t('seatSelectionIncluded')
                : hasPaidAncillary(seatSelection)
                  ? t('seatSelectionFee', { price: fmtOfferPrice(seatSelection!.price!, seatSelection!.currency || offer.currency, currency, locale) })
                  : null,
            ].filter((value): value is string => Boolean(value))
            const sourceLabel = revealedSources[offer.id]
            const outboundCtx = computeFlightTimeContext(offer.departure_time, offer.arrival_time, offer.duration_minutes)
            const inboundCtx = offer.inbound
              ? computeFlightTimeContext(offer.inbound.departure_time, offer.inbound.arrival_time, offer.inbound.duration_minutes)
              : null
            const offerParams = new URLSearchParams()
            if (searchId) offerParams.set('from', searchId)
            if (offer.offer_ref) offerParams.set('ref', offer.offer_ref)
            if (emailUnlockToken) offerParams.set('mt', emailUnlockToken)
            if (currency) offerParams.set('cur', currency)
            appendProbeParam(offerParams, isTestSearch)
            const bookHref = `/book/${offer.id}${offerParams.toString() ? `?${offerParams.toString()}` : ''}`
            const handleSelect = () => {
              trackSearchSessionEvent(analyticsSearchId, 'offer_selected', {
                offer_id: offer.id,
                airline: airlineLabel,
                currency: offer.currency,
                price: offer.price,
                google_flights_price: offer.google_flights_price ?? null,
              }, {
                source: 'website-results-panel',
                source_path: resultsSourcePath,
                is_test_search: isTestSearch || undefined,
                selected_offer_id: offer.id,
                selected_offer_airline: airlineLabel,
                selected_offer_currency: offer.currency,
                selected_offer_price: offer.price,
                selected_offer_google_flights_price: offer.google_flights_price,
              }, { keepalive: true })
              onOfferSelect?.()
            }
            return (
              <Fragment key={offer.id}>
                {isHero && (
                  <div className="rf-concierge-intro">
                    <div className="rf-pick-header">
                      <span className="rf-pick-badge">
                        <span className="rf-pick-star" aria-hidden="true">✦</span>
                        {isSearching ? t('topPickSoFar') : t('topPick')}
                        {profileLabel && <span className="rf-pick-label">· {t(profileLabel as Parameters<typeof t>[0])}</span>}
                      </span>
                      {isSearching && <span className="rf-pick-searching" aria-label="Searching" />}
                    </div>
                    <p className="rf-concierge-headline">
                      {typeof geminiJustification === 'object' && geminiJustification?.title
                        ? geminiJustification.title
                        : isSearching ? t('bestMatchSoFar') : t('bestFlight')}
                    </p>
                    <div className="rf-concierge-reason">
                      {geminiJustification === 'loading' ? (
                        <div className="rf-reasoning-blur" aria-label="Analyzing your options">
                          <div className="rf-reasoning-blur-line" style={{ width: '95%' }} />
                          <div className="rf-reasoning-blur-line" style={{ width: '82%' }} />
                          <div className="rf-reasoning-blur-line" style={{ width: '68%' }} />
                          <div className="rf-reasoning-blur-line" style={{ width: '45%' }} />
                        </div>
                      ) : geminiJustification?.hero ? (
                        <span className="rf-reasoning-text rf-reasoning-text--gemini">{geminiJustification.hero}</span>
                      ) : isSearching ? (
                        <span className="rf-reasoning-text rf-reasoning-searching">
                          {t('stillScanning')}
                        </span>
                      ) : locale === 'en' ? (
                        <span className="rf-reasoning-text">{computeDealReasonParagraph(offer, allOffers, tripContext, initialDepTimePref, currency, locale)}</span>
                      ) : null}
                    </div>
                  </div>
                )}
                {index === 1 && (
                  <div className="rf-section-divider">
                    <span className="rf-section-label">{t('otherDeals')}</span>
                  </div>
                )}
                {isRunnerUp && (
                  <div className="rf-runner-why">
                    <span className="rf-runner-rank">{t('dealN', { n: index + 1 })}</span>
                    <p className="rf-runner-text">
                      {typeof geminiJustification === 'object' && geminiJustification !== null && geminiJustification.runners[index - 1]
                        ? geminiJustification.runners[index - 1]
                        : computeWhyNot(offer, displayOffers[0], currency, locale, t as (key: string, values?: Record<string, unknown>) => string)}
                    </p>
                  </div>
                )}
                {index === 3 && (
                  <div className="rf-track-nudge">
                    <div className="rf-track-nudge-label">
                      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true"><path d="M8 1.5a5 5 0 0 1 5 5v2.5l1.2 2H1.8L3 9V6.5a5 5 0 0 1 5-5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/><path d="M6.5 13.5a1.5 1.5 0 0 0 3 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
                      {t('flightMonitoring')}
                    </div>
                    <div className="rf-track-nudge-body">
                      <div className="rf-track-nudge-text">
                        <span className="rf-track-nudge-heading">{t('wantToWait')}</span>
                        {displayOffers[0] && (
                          <span className="rf-track-nudge-price">
                            {t('fromPriceNow', { price: fmt(getOfferDisplayTotalPrice(displayOffers[0], currency)) })}
                          </span>
                        )}
                        <span className="rf-track-nudge-sub">{t('trackNudgeSub', { count: displayOffers.length, total: Math.max(progress?.total ?? 0, 200) })}</span>
                      </div>
                      {onTrackPrices && (
                        <button className="rf-track-nudge-btn" onClick={onTrackPrices} aria-haspopup="dialog">
                          <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true"><path d="M8 2v6l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/><circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.4"/></svg>
                          {t('trackPrices')}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              <div className={`rf-card${isHero ? ' rf-card--hero' : ''}${isRunnerUp ? ' rf-card--runner' : ''}${!isHero && !isRunnerUp ? ' rf-card--list' : ''}${isExpanded ? ' rf-card--expanded' : ''}${newOfferIds?.has(offer.id) ? ' rf-card--new' : ''}`}>
                {googleFlightsSavingsLabel && (
                  <div className="rf-card-badges">
                    <span className="rf-card-badge rf-card-badge--savings">{googleFlightsSavingsLabel}</span>
                  </div>
                )}
                {!isUnlocked && (
                  <div className="rf-carrier-type-header">
                    {(() => {
                      const cat = getAirlineCategory(offerCarriers[0]?.code || '')
                      const catKey = cat === 'Low-cost carrier' ? 'airlineLcc' : cat === 'Full-service carrier' ? 'airlineFsc' : 'airlineLabel'
                      return `${t(catKey)} · ${t('economy')}`
                    })()}
                  </div>
                )}
                <div className={`rf-card-row${!isUnlocked ? ' rf-card-row--locked' : ''}`}>
                  {isUnlocked && (
                    <div className={`rf-airline${offerCarriers.length > 1 ? ' rf-airline--multi' : ''}`}>
                      <div className={`rf-airline-logos${offerCarriers.length > 1 ? ' rf-airline-logos--multi' : ''}`}>
                        {offerCarriers.map((carrier) => (
                          <AirlineLogo key={`${carrier.code}-${carrier.name}`} code={carrier.code} name={carrier.name} />
                        ))}
                      </div>
                      <div className={`rf-airline-copy${offerCarriers.length > 1 ? ' rf-airline-copy--multi' : ''}`}>
                        <div
                          className={`rf-airline-name${offerCarriers.length > 1 ? ' rf-airline-name--multi' : ''}`}
                          title={offerCarriers.length > 1 ? airlineLabel : undefined}
                        >
                          {airlineLabel}
                        </div>
                        {sourceLabel && (
                          <div className="rf-source-pill">{t('dealFrom', { source: sourceLabel })}</div>
                        )}
                      </div>
                    </div>
                  )}

                  {offer.inbound ? (
                    <div className="rf-legs">
                      <div className="rf-route">
                        <div className="rf-endpoint">
                          <span className="rf-flight-date">{formatFlightDateCompact(offer.departure_time, locale)}</span>
                          <span className="rf-time">{formatFlightTime(offer.departure_time)}</span>
                          <span className="rf-city" title={outboundOriginName}>{outboundOriginName}</span>
                          <span className="rf-iata">{offer.origin}</span>
                        </div>
                        <div className="rf-path">
                          <span className="rf-duration">{fmtDuration(offer.duration_minutes)}</span>
                          <div className="rf-path-line">
                            <span className="rf-path-dot" />
                            <span className="rf-path-track">
                              {offer.stops > 0 && outboundViaBadge && (
                                <span className="rf-path-via" title={outboundViaTitle}>{outboundViaBadge}</span>
                              )}
                            </span>
                            <span className="rf-path-dot" />
                          </div>
                          <span className={`rf-stops${offer.stops === 0 ? ' rf-stops--direct' : ''}`} title={outboundViaTitle}>
                            {outboundStopsLabel}
                          </span>
                        </div>
                        <div className="rf-endpoint rf-endpoint--arr">
                          <span className="rf-flight-date">{formatFlightDateCompact(offer.arrival_time, locale)}</span>
                          <span className="rf-time">
                            {formatFlightTime(offer.arrival_time)}
                            {outboundCtx.dayOffset > 0 && (
                              <span className="rf-day-badge" title={outboundCtx.dayOffset === 1 ? t('arrivesNextDay') : t('arrivesNDays', { n: outboundCtx.dayOffset })}>
                                +{outboundCtx.dayOffset}
                              </span>
                            )}
                          </span>
                          <span className="rf-city" title={outboundDestinationName}>{outboundDestinationName}</span>
                          <span className="rf-iata">{offer.destination}</span>
                          {Math.abs(outboundCtx.tzOffsetMins) >= 30 && (
                            <span className="rf-tz-note" title={`Local times · destination is ${Math.abs(outboundCtx.tzOffsetMins)} min ${outboundCtx.tzOffsetMins < 0 ? 'behind' : 'ahead'}`}>
                              {fmtTzOffset(outboundCtx.tzOffsetMins)} tz
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="rf-leg-sep" aria-hidden="true">
                        <span className="rf-leg-sep-line" />
                        <span className="rf-leg-sep-label">{t('returnLeg')}</span>
                        <span className="rf-leg-sep-line" />
                      </div>

                      <div className="rf-route">
                        <div className="rf-endpoint">
                          <span className="rf-flight-date">{formatFlightDateCompact(offer.inbound.departure_time, locale)}</span>
                          <span className="rf-time">{formatFlightTime(offer.inbound.departure_time)}</span>
                          <span className="rf-city" title={inboundOriginName}>{inboundOriginName}</span>
                          <span className="rf-iata">{offer.inbound.origin}</span>
                        </div>
                        <div className="rf-path">
                          <span className="rf-duration">{fmtDuration(offer.inbound.duration_minutes)}</span>
                          <div className="rf-path-line">
                            <span className="rf-path-dot" />
                            <span className="rf-path-track">
                              {offer.inbound.stops > 0 && inboundViaBadge && (
                                <span className="rf-path-via" title={inboundViaTitle}>{inboundViaBadge}</span>
                              )}
                            </span>
                            <span className="rf-path-dot" />
                          </div>
                          <span className={`rf-stops${offer.inbound.stops === 0 ? ' rf-stops--direct' : ''}`} title={inboundViaTitle}>
                            {inboundStopsLabel}
                          </span>
                        </div>
                        <div className="rf-endpoint rf-endpoint--arr">
                          <span className="rf-flight-date">{formatFlightDateCompact(offer.inbound.arrival_time, locale)}</span>
                          <span className="rf-time">
                            {formatFlightTime(offer.inbound.arrival_time)}
                            {inboundCtx!.dayOffset > 0 && (
                              <span className="rf-day-badge" title={inboundCtx!.dayOffset === 1 ? t('arrivesNextDay') : t('arrivesNDays', { n: inboundCtx!.dayOffset })}>
                                +{inboundCtx!.dayOffset}
                              </span>
                            )}
                          </span>
                          <span className="rf-city" title={inboundDestinationName}>{inboundDestinationName}</span>
                          <span className="rf-iata">{offer.inbound.destination}</span>
                          {Math.abs(inboundCtx!.tzOffsetMins) >= 30 && (
                            <span className="rf-tz-note" title={`Local times · destination is ${Math.abs(inboundCtx!.tzOffsetMins)} min ${inboundCtx!.tzOffsetMins < 0 ? 'behind' : 'ahead'}`}>
                              {fmtTzOffset(inboundCtx!.tzOffsetMins)} tz
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="rf-route">
                      <div className="rf-endpoint">
                        <span className="rf-flight-date">{formatFlightDateCompact(offer.departure_time, locale)}</span>
                        <span className="rf-time">{formatFlightTime(offer.departure_time)}</span>
                        <span className="rf-city" title={outboundOriginName}>{outboundOriginName}</span>
                        <span className="rf-iata">{offer.origin}</span>
                      </div>
                      <div className="rf-path">
                        <span className="rf-duration">{fmtDuration(offer.duration_minutes)}</span>
                        <div className="rf-path-line">
                          <span className="rf-path-dot" />
                          <span className="rf-path-track">
                            {offer.stops > 0 && outboundViaBadge && (
                              <span className="rf-path-via" title={outboundViaTitle}>{outboundViaBadge}</span>
                            )}
                          </span>
                          <span className="rf-path-dot" />
                        </div>
                        <span className={`rf-stops${offer.stops === 0 ? ' rf-stops--direct' : ''}`} title={outboundViaTitle}>
                          {outboundStopsLabel}
                        </span>
                      </div>
                      <div className="rf-endpoint rf-endpoint--arr">
                        <span className="rf-flight-date">{formatFlightDateCompact(offer.arrival_time, locale)}</span>
                        <span className="rf-time">
                          {formatFlightTime(offer.arrival_time)}
                          {outboundCtx.dayOffset > 0 && (
                            <span className="rf-day-badge" title={outboundCtx.dayOffset === 1 ? t('arrivesNextDay') : t('arrivesNDays', { n: outboundCtx.dayOffset })}>
                              +{outboundCtx.dayOffset}
                            </span>
                          )}
                        </span>
                        <span className="rf-city" title={outboundDestinationName}>{outboundDestinationName}</span>
                        <span className="rf-iata">{offer.destination}</span>
                        {Math.abs(outboundCtx.tzOffsetMins) >= 30 && (
                          <span className="rf-tz-note" title={`Local times · destination is ${Math.abs(outboundCtx.tzOffsetMins)} min ${outboundCtx.tzOffsetMins < 0 ? 'behind' : 'ahead'}`}>
                            {fmtTzOffset(outboundCtx.tzOffsetMins)} tz
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="rf-price-wrap">
                    <span className="rf-price-total-label">{t('priceTotal')}</span>
                    <span className="rf-price">{fmt(getSortEffectivePrice(offer, sort, currency))}</span>
                    <span className="rf-price-sub">{t('perPerson')}</span>
                    <div className="rf-price-breakdown">
                      <div className="rf-price-breakdown-row">
                        <span className="rf-price-breakdown-label">✈ {t('ticket')}</span>
                        <span className="rf-price-breakdown-value">{fmt(convertCurrencyAmount(offer.price, offer.currency, currency))}</span>
                      </div>
                      {offer.source !== 'serpapi_google' && offer.source !== 'google_flights' && (
                        <div className="rf-price-breakdown-row">
                          <span className="rf-price-breakdown-label">{t('letsfgFee')}</span>
                          <span className="rf-price-breakdown-value">+{fmt(convertCurrencyAmount(calculateFee(offer.price, offer.currency), offer.currency, currency))}</span>
                        </div>
                      )}
                      {hasPaidAncillary(checkedBag) && (
                        <div className={`rf-price-breakdown-row${(sort === 'price_with_bag' || sort === 'price_with_all') ? ' rf-price-breakdown-row--on' : ''}`}>
                          <span className="rf-price-breakdown-label">🧳 {t('bag')}</span>
                          <span className="rf-price-breakdown-value">+{fmtOfferPrice(checkedBag!.price!, checkedBag!.currency || offer.currency, currency, locale)}</span>
                        </div>
                      )}
                      {hasIncludedAncillary(checkedBag) && (
                        <div className="rf-price-breakdown-row rf-price-breakdown-row--incl">
                          <span className="rf-price-breakdown-label">🧳 {t('bagIncluded')}</span>
                        </div>
                      )}
                      {hasPaidAncillary(seatSelection) && (
                        <div className={`rf-price-breakdown-row${(sort === 'price_with_seat' || sort === 'price_with_all') ? ' rf-price-breakdown-row--on' : ''}`}>
                          <span className="rf-price-breakdown-label">💺 {t('seat')}</span>
                          <span className="rf-price-breakdown-value">+{fmtOfferPrice(seatSelection!.price!, seatSelection!.currency || offer.currency, currency, locale)}</span>
                        </div>
                      )}
                      {hasIncludedAncillary(seatSelection) && (
                        <div className="rf-price-breakdown-row rf-price-breakdown-row--incl">
                          <span className="rf-price-breakdown-label">💺 {t('seatIncluded')}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {!isHero && (
                    isRunnerUp
                      ? <a href={bookHref} className="rf-book-btn rf-book-btn--choose" onClick={handleSelect}>
                          {t('chooseInstead')} <ArrowIcon />
                        </a>
                      : <a href={bookHref} className="rf-book-btn--arrow" aria-label="Select this flight" onClick={handleSelect}>
                          <ArrowIcon />
                        </a>
                  )}
                </div>
                {isHero && (
                  <div className="rf-hero-footer">
                    <button className="rf-book-for-me" disabled aria-disabled="true">
                      {t('bookForMe')}
                      <span className="rf-soon-badge">{t('soon')}</span>
                    </button>
                    <a href={bookHref} className="rf-book-btn" onClick={handleSelect}>
                      {t('getBookingLink')} <ArrowIcon />
                    </a>
                  </div>
                )}

                {(offer.segments?.length || offer.inbound?.segments?.length) && (
                  <>
                    <button
                      className="rf-details-btn"
                      onClick={() => {
                        setExpandedId(isExpanded ? null : offer.id)
                        trackSearchSessionEvent(analyticsSearchId, 'details_toggled', {
                          offer_id: offer.id,
                          open: !isExpanded,
                        }, {
                          source: 'website-results-panel',
                          source_path: resultsSourcePath,
                          is_test_search: isTestSearch || undefined,
                        })
                      }}
                    >
                      {isExpanded ? t('hideDetails') : t('flightDetails')}
                      <ChevronIcon open={isExpanded} />
                    </button>

                    {isExpanded && (() => {
                      const hasReturn = !!offer.inbound?.segments?.length
                      const renderSegs = (segs: FlightSegment[], mainAirline: string) => segs.map((seg, si) => (
                        <div key={si}>
                          {si > 0 && segs[si - 1].layover_minutes > 0 && (
                            <div className="rf-layover">
                              <span className="rf-layover-icon" aria-hidden="true" />
                              <span className="rf-layover-text">
                                {t('layover', { duration: fmtDuration(segs[si - 1].layover_minutes), city: segs[si - 1].destination_name })}
                              </span>
                              {(segs[si - 1].destination ?? '').toUpperCase() !== (seg.origin ?? '').toUpperCase() &&
                                (segs[si - 1].destination ?? '') !== '' && (seg.origin ?? '') !== '' && (
                                <span
                                  className="rf-layover-airport-change"
                                  title={`Arrives ${segs[si - 1].destination}, departs ${seg.origin} — different airport`}
                                >⚠ {t('airportChange')}</span>
                              )}
                            </div>
                          )}
                          <div className="rf-leg">
                            <div className="rf-leg-header">
                              <span className="rf-leg-num">{t('leg', { number: si + 1 })}</span>
                              <span className="rf-leg-flight">
                                {isUnlocked
                                  ? `${seg.flight_number} · ${getSegmentAirlineLabel(seg, mainAirline)}${seg.aircraft ? ` · ${seg.aircraft.replace(/\s*\([^)]*\)/, '')}` : ''}`
                                  : t('economyUnlock')}
                              </span>
                            </div>
                            <div className="rf-leg-body">
                              <div className="rf-leg-spine" />
                              <div className="rf-leg-stops">
                                <div className="rf-leg-point">
                                  <span className="rf-leg-dot rf-leg-dot--dep" />
                                  <div className="rf-leg-info">
                                    <span className="rf-leg-time">
                                      {formatFlightTime(seg.departure_time)}
                                      <span className="rf-leg-date">{formatFlightDateCompact(seg.departure_time, locale)}</span>
                                    </span>
                                    <span className="rf-leg-airport">{seg.origin}{seg.origin_name ? ` · ${seg.origin_name}` : ''}</span>
                                  </div>
                                </div>
                                <div className="rf-leg-dur">{fmtDuration(seg.duration_minutes)}</div>
                                <div className="rf-leg-point">
                                  <span className="rf-leg-dot rf-leg-dot--arr" />
                                  <div className="rf-leg-info">
                                    <span className="rf-leg-time">
                                      {formatFlightTime(seg.arrival_time)}
                                      <span className="rf-leg-date">{formatFlightDateCompact(seg.arrival_time, locale)}</span>
                                    </span>
                                    <span className="rf-leg-airport">{seg.destination}{seg.destination_name ? ` · ${seg.destination_name}` : ''}</span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))

                      return (
                        <div className={`rf-details${hasReturn ? ' rf-details--cols' : ''}`}>
                          {offer.segments?.length ? (
                            <div className="rf-details-col">
                              {hasReturn && <div className="rf-details-col-label rf-details-col-label--out">{t('outbound')}</div>}
                              {renderSegs(offer.segments, offer.airline)}
                            </div>
                          ) : null}
                          {hasReturn ? (
                            <div className="rf-details-col">
                              <div className="rf-details-col-label rf-details-col-label--ret">{t('returnDetails')}</div>
                              {renderSegs(offer.inbound!.segments!, offer.inbound!.airline || offer.airline)}
                            </div>
                          ) : null}
                        </div>
                      )
                    })()}
                  </>
                )}
              </div>
              </Fragment>
            )
          })}
          {displayOffers.length === 0 && (
            <div className="rf-empty">{t('noFlights')}</div>
          )}
          {displayOffers.length > visibleCount && (
            <div className="rf-load-more">
              <button
                className="rf-load-more-btn"
                onClick={() => {
                  setVisibleCount(c => c + 20)
                  trackSearchSessionEvent(analyticsSearchId, 'show_more', {
                    next_visible_count: Math.min(displayOffers.length, visibleCount + 20),
                  }, {
                    source: 'website-results-panel',
                    source_path: resultsSourcePath,
                    is_test_search: isTestSearch || undefined,
                  })
                }}
              >
                {t('showMore', { count: Math.min(20, displayOffers.length - visibleCount) })}
                <span className="rf-load-more-total">{t('remaining', { count: displayOffers.length - visibleCount })}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
