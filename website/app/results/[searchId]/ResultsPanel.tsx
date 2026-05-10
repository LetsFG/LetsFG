'use client'

import { useState, useMemo, useCallback, useEffect } from 'react'
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

function getStopsLabel(stops: number, segments: FlightSegment[] | undefined, directLabel: string) {
  if (stops === 0) return directLabel

  const routeStops = getRouteStops(segments)
  const viaCodes = routeStops.map((stop) => stop.code || stop.name).filter(Boolean)

  if (viaCodes.length === 0) {
    return `${stops} stop${stops > 1 ? 's' : ''}`
  }

  return `${stops} stop${stops > 1 ? 's' : ''} · via ${viaCodes.join(', ')}`
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

function getSortEffectivePrice(offer: FlightOffer, sortMode: string, displayCurrency: string): number {
  if (sortMode === 'price_with_bag') {
    const bag = offer.ancillaries?.checked_bag
    if (hasIncludedAncillary(bag)) return convertCurrencyAmount(getOfferBaseTotal(offer), offer.currency, displayCurrency)
    const total = getOfferDisplayTotalWithAncillary(offer, bag, displayCurrency)
    return total ?? getOfferDisplayTotalPrice(offer, displayCurrency)
  }
  if (sortMode === 'price_with_seat') {
    const seat = offer.ancillaries?.seat_selection
    if (hasIncludedAncillary(seat)) return convertCurrencyAmount(getOfferBaseTotal(offer), offer.currency, displayCurrency)
    const total = getOfferDisplayTotalWithAncillary(offer, seat, displayCurrency)
    return total ?? getOfferDisplayTotalPrice(offer, displayCurrency)
  }
  if (sortMode === 'price_with_all') {
    return convertCurrencyAmount(getOfferKnownTotalPrice(offer), offer.currency, displayCurrency)
  }
  return getOfferDisplayTotalPrice(offer, displayCurrency)
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
  tripContext?: 'solo' | 'couple' | 'family' | 'group' | 'business_traveler'
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ResultsPanel({
  allOffers,
  currency,
  priceMin,
  priceMax,
  searchId,
  trackingSearchId,
  isTestSearch = false,
  onTrackPrices,
  onOfferSelect,
  newOfferIds,
  isSearching = false,
  progress,
  defaultSort,
  requireSeatPerPerson = false,
  requireBagPerPerson = false,
  initialDepTimePref,
  initialRetTimePref,
  tripContext,
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
  const [priceRange, setPriceRange] = useState<[number, number]>([priceMin, priceMax])
  const [depRange, setDepRange] = useState<[number, number]>([0, 1439])
  const [retRange, setRetRange] = useState<[number, number]>([0, 1439])
  const [durationRange, setDurationRange] = useState<[number, number]>([0, Infinity])
  const [airlinesOpen, setAirlinesOpen] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const [visibleCount, setVisibleCount] = useState(20)
  const [isUnlocked, setIsUnlocked] = useState(false)
  const [revealedSources, setRevealedSources] = useState<Record<string, string>>({})

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
    if (sort === 'duration') {
      list = [...list].sort((a, b) => a.duration_minutes - b.duration_minutes)
    } else {
      list = [...list].sort((a, b) => getSortEffectivePrice(a, sort, currency) - getSortEffectivePrice(b, sort, currency))
    }
    // Soft time-pref boost: if NL query specified time-of-day preferences and the
    // user hasn't manually adjusted the sliders, pin matching offers to the top
    // (all offers still visible — matching ones just float up).
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
    // Persona-based grouping: for family/business/couple, pin best-fit flights to the top.
    // Within each group the existing price/duration sort is preserved (stable sort).
    if (tripContext && tripContext !== 'solo' && tripContext !== 'group') {
      // For family, re-sort by duration inside groups (kids care more about time than price)
      if (tripContext === 'family' && sort !== 'duration') {
        list = [...list].sort((a, b) => a.duration_minutes - b.duration_minutes)
      }
      list = [...list].sort((a, b) => personaGroup(a) - personaGroup(b))
    }
    return list
  }, [allOffers, stopsFilter, airlinesFilter, amenityFilters, priceRange, depRange, retRange, durationRange, sort, currency, initialDepTimePref, initialRetTimePref, tripContext])

  const visibleOffers = useMemo(() => displayOffers.slice(0, visibleCount), [displayOffers, visibleCount])

  useEffect(() => {
    setPriceRange([priceMin, priceMax])
  }, [priceMin, priceMax])

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
    setPriceRange([priceMin, priceMax])
    setDepRange([0, 1439])
    setRetRange([0, 1439])
    setDurationRange([0, Infinity])
    setVisibleCount(20)
    trackSearchSessionEvent(analyticsSearchId, 'filters_changed', { filter: 'clear_all' }, {
      source: 'website-results-panel',
      source_path: resultsSourcePath,
      is_test_search: isTestSearch || undefined,
    })
  }, [analyticsSearchId, isTestSearch, priceMax, priceMin, resultsSourcePath])

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
    || priceRange[0] > priceMin || priceRange[1] < priceMax
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
    <div className="rf-layout">
      {/* ── Mobile filter overlay backdrop ─────────────────────────────── */}
      {mobileFiltersOpen && (
        <div className="rf-filters-backdrop" onClick={() => setMobileFiltersOpen(false)} aria-hidden="true" />
      )}

      {/* ── Mobile filter toggle bar ───────────────────────────────────── */}
      <div className="rf-mobile-topbar">
        <button
          className={`rf-mobile-filter-btn${mobileFiltersOpen ? ' rf-mobile-filter-btn--active' : ''}`}
          onClick={() => setMobileFiltersOpen(o => !o)}
        >
          <svg viewBox="0 0 20 20" fill="none" width="15" height="15" aria-hidden="true">
            <path d="M3 5h14M6 10h8M9 15h2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          {t('filterTitle')}{hasActiveFilters ? ' ·' : ''}
        </button>
        <div className="rf-mobile-sort">
          <span className="rf-bar-label">{t('sort')}</span>
          <button className={`rf-chip${sort === 'price' ? ' rf-chip--on' : ''}`} onClick={() => handleSortChange('price')}>{t('sortPrice')}</button>
          <button className={`rf-chip${sort === 'price_with_bag' ? ' rf-chip--on' : ''}`} onClick={() => handleSortChange('price_with_bag')}>+ Bag</button>
          <button className={`rf-chip${sort === 'price_with_seat' ? ' rf-chip--on' : ''}`} onClick={() => handleSortChange('price_with_seat')}>+ Seat</button>
          <button className={`rf-chip${sort === 'price_with_all' ? ' rf-chip--on' : ''}`} onClick={() => handleSortChange('price_with_all')}>+ All</button>
          <button className={`rf-chip${sort === 'duration' ? ' rf-chip--on' : ''}`} onClick={() => handleSortChange('duration')}>{t('sortDuration')}</button>
        </div>
      </div>
      {/* ── Filter sidebar ─────────────────────────────────────────────────── */}
      <aside className={`rf-filters${mobileFiltersOpen ? ' rf-filters--mobile-open' : ''}`}>
        <div className="rf-filters-header">
          <span className="rf-filters-title">{t('filterTitle')}</span>
          <div className="rf-filters-header-actions">
            {hasActiveFilters && (
              <button className="rf-filters-clear" onClick={clearAll}>{t('clearAll')}</button>
            )}
            <button className="rf-filters-close" onClick={() => setMobileFiltersOpen(false)} aria-label={t('closeFilters')}>
              <svg viewBox="0 0 20 20" fill="none" width="16" height="16" aria-hidden="true">
                <path d="M5 5l10 10M15 5l-10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        {/* Stops */}
        <div className="rf-filter-section">
          <div className="rf-filter-heading"><span>{t('stops')}</span></div>
          {stopsOptions.map(({ key, label }) => {
            const stat = stopsStats[key]
            if (!stat || stat.count === 0) return null
            const active = stopsFilter.includes(key)
            return (
              <button key={key} className={`rf-filter-row${active ? ' rf-filter-row--on' : ''}`}
                onClick={() => toggleStop(key)}>
                <span className={`rf-filter-check${active ? ' rf-filter-check--on' : ''}`} aria-hidden="true" />
                <span className="rf-filter-label">{label}</span>
                {stat.min !== Infinity && (
                  <span className="rf-filter-price">{fmtOfferPrice(stat.min, stat.currency || currency, currency, locale)}</span>
                )}
              </button>
            )
          })}
        </div>

        {/* Price range */}
        <div className="rf-filter-section">
          <div className="rf-filter-heading"><span>{t('priceRange')}</span></div>
          <DualRange
            min={priceMin} max={priceMax}
            low={priceRange[0]} high={priceRange[1]}
            onChange={(lo, hi) => setPriceRange([lo, hi])}
            formatLabel={fmt}
          />
        </div>

        {/* Departure time */}
        <div className="rf-filter-section">
          <div className="rf-filter-heading"><span>{t('departureTime')}</span></div>
          <div className="rf-filter-sub">{t('outbound')}</div>
          <DualRange
            min={0} max={1439}
            low={depRange[0]} high={depRange[1]}
            onChange={(lo, hi) => setDepRange([lo, hi])}
            formatLabel={minsToLabel}
          />
        </div>

        {/* Return/arrival time */}
        <div className="rf-filter-section">
          <div className="rf-filter-heading"><span>{t('returnTime')}</span></div>
          <DualRange
            min={0} max={1439}
            low={retRange[0]} high={retRange[1]}
            onChange={(lo, hi) => setRetRange([lo, hi])}
            formatLabel={minsToLabel}
          />
        </div>

        {/* Flight duration */}
        <div className="rf-filter-section">
          <div className="rf-filter-heading"><span>{t('flightTime')}</span></div>
          <DualRange
            min={durationBounds.min} max={durationBounds.max}
            low={Math.max(durationBounds.min, isFinite(durationRange[0]) ? durationRange[0] : durationBounds.min)}
            high={Math.min(durationBounds.max, isFinite(durationRange[1]) ? durationRange[1] : durationBounds.max)}
            onChange={(lo, hi) => setDurationRange([lo, hi])}
            formatLabel={fmtDuration}
          />
        </div>

        {/* Airlines */}
        <div className="rf-filter-section">
          <button className="rf-filter-heading rf-filter-heading--btn"
            onClick={() => setAirlinesOpen(o => !o)}>
            <span>{t('airlines')}</span>
            <ChevronIcon open={airlinesOpen} />
          </button>
          {airlinesOpen && airlineOptions.map(({ airline, minPrice, currency: airlineCurrency }) => {
            const active = airlinesFilter.includes(airline)
            return (
              <button key={airline} className={`rf-filter-row${active ? ' rf-filter-row--on' : ''}`}
                onClick={() => toggleAirline(airline)}>
                <span className={`rf-filter-check${active ? ' rf-filter-check--on' : ''}`} aria-hidden="true" />
                <span className="rf-filter-label">{airline}</span>
                <span className="rf-filter-price">{fmtOfferPrice(minPrice, airlineCurrency || currency, currency, locale)}</span>
              </button>
            )
          })}
        </div>

        {/* Amenities */}
        <div className="rf-filter-section rf-filter-section--last">
          <div className="rf-filter-heading">
            <span>{t('amenities')}</span>
          </div>
          {amenityOptions.map(({ key, label, count }) => {
            if (count === 0) return null
            const active = amenityFilters.includes(key)
            return (
              <button key={key} className={`rf-filter-row${active ? ' rf-filter-row--on' : ''}`}
                onClick={() => toggleAmenity(key)}>
                <span className={`rf-filter-check${active ? ' rf-filter-check--on' : ''}`} aria-hidden="true" />
                <span className="rf-filter-label">{label}</span>
              </button>
            )
          })}
        </div>
      </aside>

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
          </div>
          {!isSearching && (
            <div className="rf-bar-checked" aria-label="Sources checked">
              <span className="rf-bar-checked-label">checked:</span>
              <div className="rf-bar-checked-logos">
                {CHECKED_SOURCES.map((src) => (
                  <span key={src} className="rf-bar-checked-chip" title={src}>
                    {src}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="rf-bar-controls">
            <span className="rf-bar-label">{t('sort')}</span>
            <button
              className={`rf-chip${sort === 'price' ? ' rf-chip--on' : ''}`}
              onClick={() => handleSortChange('price')}
            >
              {t('sortPrice')}
            </button>
            <button
              className={`rf-chip${sort === 'price_with_bag' ? ' rf-chip--on' : ''}`}
              onClick={() => handleSortChange('price_with_bag')}
            >
              + Bag
            </button>
            <button
              className={`rf-chip${sort === 'price_with_seat' ? ' rf-chip--on' : ''}`}
              onClick={() => handleSortChange('price_with_seat')}
            >
              + Seat
            </button>
            <button
              className={`rf-chip${sort === 'price_with_all' ? ' rf-chip--on' : ''}`}
              onClick={() => handleSortChange('price_with_all')}
            >
              + All
            </button>
            <button
              className={`rf-chip${sort === 'duration' ? ' rf-chip--on' : ''}`}
              onClick={() => handleSortChange('duration')}
            >
              {t('sortDuration')}
            </button>
          </div>
        </div>

        {/* Flight list */}
        <div className="rf-list">
          {onTrackPrices && (
            <div className="mon-strip">
              <div className="mon-strip-copy">
                <span className="mon-strip-title">Track prices for this route</span>
                <span className="mon-strip-sub">Daily price alerts from Google Flights, Kayak, Kiwi, direct airlines, over 200 websites · Get notified when prices drop · Free booking unlock/week · $5/week</span>
              </div>
              <button className="mon-strip-btn" onClick={onTrackPrices} aria-haspopup="dialog">
                Track prices
              </button>
            </div>
          )}
          {visibleOffers.map((offer, index) => {
            const isBestValue = sort !== 'duration' && index === 0
            const isExpanded = expandedId === offer.id
            const offerCarriers = getOfferCarriers(offer)
            const airlineLabel = getOfferAirlineLabel(offer)
            const outboundStops = getRouteStops(offer.segments)
            const outboundViaBadge = getRouteViaBadge(outboundStops)
            const outboundViaTitle = getRouteViaTitle(outboundStops)
            const inboundStops = getRouteStops(offer.inbound?.segments)
            const inboundViaBadge = getRouteViaBadge(inboundStops)
            const inboundViaTitle = getRouteViaTitle(inboundStops)
            const outboundStopsLabel = getStopsLabel(offer.stops, offer.segments, t('direct'))
            const inboundStopsLabel = offer.inbound
              ? getStopsLabel(offer.inbound.stops, offer.inbound.segments, t('direct'))
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
            return (
              <div key={offer.id} className={`rf-card${isBestValue ? ' rf-card--best' : ''}${isExpanded ? ' rf-card--expanded' : ''}${newOfferIds?.has(offer.id) ? ' rf-card--new' : ''}`}>
                {googleFlightsSavingsLabel && (
                  <div className="rf-card-badges">
                    <span className="rf-card-badge rf-card-badge--savings">{googleFlightsSavingsLabel}</span>
                  </div>
                )}
                <div className="rf-card-row">
                  <div className={`rf-airline${offerCarriers.length > 1 ? ' rf-airline--multi' : ''}`}>
                    {isUnlocked ? (
                      /* ── Revealed: real logo + airline name ── */
                      <>
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
                            <div className="rf-source-pill">Deal from {sourceLabel}</div>
                          )}
                        </div>
                      </>
                    ) : (
                      /* ── Hidden: generic placeholder until unlocked ── */
                      <>
                        <div className="rf-airline-logos">
                          <HiddenAirlineLogo />
                        </div>
                        <div className="rf-airline-copy">
                          <div className="rf-airline-name rf-airline-name--hidden">
                            {getAirlineCategory(offerCarriers[0]?.code || '')}
                          </div>
                          <div className="rf-airline-cabin">Economy class</div>
                        </div>
                      </>
                    )}
                  </div>

                  {offer.inbound ? (
                    <div className="rf-legs">
                      <div className="rf-route">
                        <div className="rf-endpoint">
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
                          <span className="rf-time">
                            {formatFlightTime(offer.arrival_time)}
                            {outboundCtx.dayOffset > 0 && (
                              <span className="rf-day-badge" title={outboundCtx.dayOffset === 1 ? 'Arrives next day' : `Arrives +${outboundCtx.dayOffset} days`}>
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
                          <span className="rf-time">
                            {formatFlightTime(offer.inbound.arrival_time)}
                            {inboundCtx!.dayOffset > 0 && (
                              <span className="rf-day-badge" title={inboundCtx!.dayOffset === 1 ? 'Arrives next day' : `Arrives +${inboundCtx!.dayOffset} days`}>
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
                        <span className="rf-time">
                          {formatFlightTime(offer.arrival_time)}
                          {outboundCtx.dayOffset > 0 && (
                            <span className="rf-day-badge" title={outboundCtx.dayOffset === 1 ? 'Arrives next day' : `Arrives +${outboundCtx.dayOffset} days`}>
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
                    <span className="rf-price-total-label">Total</span>
                    <span className="rf-price">{fmt(getSortEffectivePrice(offer, sort, currency))}</span>
                    <span className="rf-price-sub">{t('perPerson')}</span>
                    <div className="rf-price-breakdown">
                      <div className="rf-price-breakdown-row">
                        <span className="rf-price-breakdown-label">✈ Ticket</span>
                        <span className="rf-price-breakdown-value">{fmt(convertCurrencyAmount(offer.price, offer.currency, currency))}</span>
                      </div>
                      <div className="rf-price-breakdown-row">
                        <span className="rf-price-breakdown-label">LetsFG fee</span>
                        <span className="rf-price-breakdown-value">+{fmt(convertCurrencyAmount(calculateFee(offer.price, offer.currency), offer.currency, currency))}</span>
                      </div>
                      {hasPaidAncillary(checkedBag) && (
                        <div className={`rf-price-breakdown-row${(sort === 'price_with_bag' || sort === 'price_with_all') ? ' rf-price-breakdown-row--on' : ''}`}>
                          <span className="rf-price-breakdown-label">🧳 Bag</span>
                          <span className="rf-price-breakdown-value">+{fmtOfferPrice(checkedBag!.price!, checkedBag!.currency || offer.currency, currency, locale)}</span>
                        </div>
                      )}
                      {hasIncludedAncillary(checkedBag) && (
                        <div className="rf-price-breakdown-row rf-price-breakdown-row--incl">
                          <span className="rf-price-breakdown-label">🧳 Bag incl.</span>
                        </div>
                      )}
                      {hasPaidAncillary(seatSelection) && (
                        <div className={`rf-price-breakdown-row${(sort === 'price_with_seat' || sort === 'price_with_all') ? ' rf-price-breakdown-row--on' : ''}`}>
                          <span className="rf-price-breakdown-label">💺 Seat</span>
                          <span className="rf-price-breakdown-value">+{fmtOfferPrice(seatSelection!.price!, seatSelection!.currency || offer.currency, currency, locale)}</span>
                        </div>
                      )}
                      {hasIncludedAncillary(seatSelection) && (
                        <div className="rf-price-breakdown-row rf-price-breakdown-row--incl">
                          <span className="rf-price-breakdown-label">💺 Seat incl.</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <a
                    href={(() => {
                      const params = new URLSearchParams()
                      if (searchId) params.set('from', searchId)
                      if (offer.offer_ref) params.set('ref', offer.offer_ref)
                      if (emailUnlockToken) params.set('mt', emailUnlockToken)
                      if (currency) params.set('cur', currency)
                      appendProbeParam(params, isTestSearch)
                      const query = params.toString()
                      return `/book/${offer.id}${query ? `?${query}` : ''}`
                    })()}
                    className="rf-book-btn"
                    onClick={() => {
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
                    }}
                  >
                    {t('select')}
                    <ArrowIcon />
                  </a>
                </div>

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
                            </div>
                          )}
                          <div className="rf-leg">
                            <div className="rf-leg-header">
                              <span className="rf-leg-num">{t('leg', { number: si + 1 })}</span>
                              <span className="rf-leg-flight">
                                {isUnlocked
                                  ? `${seg.flight_number} · ${getSegmentAirlineLabel(seg, mainAirline)}`
                                  : 'Economy class · Unlock to reveal'}
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
                                      <span className="rf-leg-date">{formatFlightDateCompact(seg.departure_time)}</span>
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
                                      <span className="rf-leg-date">{formatFlightDateCompact(seg.arrival_time)}</span>
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
                              {hasReturn && <div className="rf-details-col-label rf-details-col-label--out">Outbound</div>}
                              {renderSegs(offer.segments, offer.airline)}
                            </div>
                          ) : null}
                          {hasReturn ? (
                            <div className="rf-details-col">
                              <div className="rf-details-col-label rf-details-col-label--ret">Return</div>
                              {renderSegs(offer.inbound!.segments!, offer.inbound!.airline || offer.airline)}
                            </div>
                          ) : null}
                        </div>
                      )
                    })()}
                  </>
                )}
              </div>
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
