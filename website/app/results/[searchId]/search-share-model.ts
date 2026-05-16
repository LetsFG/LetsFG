import { getOfferDisplayTotalPrice } from '../../../lib/display-price'
import { formatCurrencyAmount } from '../../../lib/user-currency'
import { deduplicateOffers } from '../../lib/rankOffers'
import type { TripPurpose } from '../../lib/trip-purpose'

export interface FlightOffer {
  id: string
  price: number
  displayPrice?: number
  google_flights_price?: number
  currency: string
  airline: string
  airline_code: string
  offer_ref?: string
  origin: string
  origin_name: string
  destination: string
  destination_name: string
  departure_time: string
  arrival_time: string
  duration_minutes: number
  stops: number
  inbound?: {
    departure_time?: string
    arrival_time?: string
    stops?: number
  }
}

export interface FallbackNote {
  intended: string
  used_code: string
  used_name: string
  hub_name: string
  reason: string
}

export interface SearchResult {
  search_id: string
  status: 'searching' | 'completed' | 'expired'
  query: string
  parsed: {
    origin?: string
    origin_name?: string
    destination?: string
    destination_name?: string
    date?: string
    return_date?: string
    min_trip_days?: number
    max_trip_days?: number
    passengers?: number
    cabin?: string
    require_cancellation?: boolean
    fallback_notes?: { origin?: FallbackNote; destination?: FallbackNote }
    ai_passengers?: number
    ai_depart_after?: string
    ai_depart_before?: string
    ai_direct_only?: boolean
    ai_bags_included?: boolean
    ai_cabin_class?: string
    ai_sort_by?: 'price' | 'duration'
    ai_trip_purposes?: TripPurpose[]
    ai_trip_purpose?: TripPurpose
    ai_dep_time_pref?: 'early_morning' | 'morning' | 'afternoon' | 'evening' | 'red_eye'
    ai_ret_time_pref?: 'early_morning' | 'morning' | 'afternoon' | 'evening' | 'red_eye'
    ai_passenger_context?: 'solo' | 'couple' | 'family' | 'group' | 'business_traveler'
  }
  progress?: {
    checked: number
    total: number
    found: number
    pending_connectors?: string[]
  }
  offers?: FlightOffer[]
  total_results?: number
  cheapest_price?: number
  searched_at?: string
  expires_at?: string
  gemini_justification?: {
    title?: string
    hero: string
    runners: string[]
    offer_ids?: string[]
    ts: number
    locale?: string
  }
}

export interface SearchShareMetric {
  label: string
  value: string
  caption?: string
}

export interface SearchShareSummary {
  status: SearchResult['status'] | 'missing'
  fromLabel: string
  toLabel: string
  routeLabel: string
  title: string
  description: string
  offersMetric: SearchShareMetric
  secondaryMetric: SearchShareMetric
  cheapestFormattedPrice: string | null
}

function formatCount(value: number) {
  return new Intl.NumberFormat('en-US').format(Math.max(0, Math.round(value)))
}

function resolvePlaceLabel(label?: string, fallback?: string) {
  return label?.trim() || fallback?.trim() || 'Anywhere'
}

function compactWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function shortenPlaceLabel(label: string) {
  const compact = compactWhitespace(label)
  const noParens = compactWhitespace(compact.replace(/\s*\([^)]*\)\s*$/g, ''))
  const beforeComma = compactWhitespace((noParens.split(',')[0] || noParens))
  const beforeDash = compactWhitespace(beforeComma.replace(/\s+[–-]\s+.*$/, ''))
  const noAirportSuffix = compactWhitespace(
    beforeDash.replace(
      /\s+(international airport|intercontinental airport|regional airport|municipal airport|domestic airport|airport|international|intl\.?|airfield|terminal)\s*$/i,
      '',
    ),
  )
  const firstTwoWords = compactWhitespace(noAirportSuffix.split(' ').slice(0, 2).join(' '))
  const candidates = [noAirportSuffix, beforeDash, beforeComma, noParens, compact]
    .filter((value, index, all) => value.length > 0 && all.indexOf(value) === index)

  const shortEnough = candidates.find((value) => value.length <= 18)
  if (shortEnough) {
    return shortEnough
  }

  if (firstTwoWords.length > 0 && firstTwoWords.length <= 18) {
    return firstTwoWords
  }

  const preferred = candidates[0] || compact
  return preferred.length > 18 ? `${preferred.slice(0, 17).trimEnd()}…` : preferred
}

function resolveOffersAnalyzed(result: SearchResult, dedupedOffers: FlightOffer[]) {
  const totalResults = typeof result.total_results === 'number' ? result.total_results : 0
  const foundSoFar = typeof result.progress?.found === 'number' ? result.progress.found : 0
  return Math.max(totalResults, dedupedOffers.length, foundSoFar)
}

function resolveTopPicks(result: SearchResult) {
  const justification = result.gemini_justification
  const offerIds = (justification?.offer_ids || [])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)

  if (offerIds.length > 0) {
    return new Set(offerIds).size
  }

  const runners = (justification?.runners || [])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)

  if (runners.length > 0) {
    return runners.length + 1
  }

  return null
}

function resolveCheapestOffer(offers: FlightOffer[], displayCurrency: string) {
  if (offers.length === 0) {
    return null
  }

  return offers.reduce((best, offer) => {
    if (!best) {
      return offer
    }

    return getOfferDisplayTotalPrice(offer, displayCurrency) < getOfferDisplayTotalPrice(best, displayCurrency)
      ? offer
      : best
  }, offers[0])
}

function resolveCompletedSecondaryMetric(topPicks: number | null, cheapestFormattedPrice: string | null, cheapestAirline?: string): SearchShareMetric {
  if (topPicks !== null) {
    return {
      label: 'TOP PICKS',
      value: formatCount(topPicks),
      caption: 'shortlisted',
    }
  }

  if (cheapestFormattedPrice) {
    return {
      label: 'CHEAPEST',
      value: cheapestFormattedPrice,
      caption: cheapestAirline || 'best live price',
    }
  }

  return {
    label: 'STATUS',
    value: 'Live',
    caption: 'results ready',
  }
}

export function buildFallbackSearchQuery(parsed: SearchResult['parsed']): string {
  const origin = parsed.origin || parsed.origin_name
  const destination = parsed.destination || parsed.destination_name

  if (!origin || !destination) {
    return ''
  }

  const parts = [`${origin} to ${destination}`]

  if (parsed.date) parts.push(parsed.date)
  if (parsed.return_date) parts.push(`return ${parsed.return_date}`)

  return parts.join(' ').trim()
}

export function buildMissingSearchShareSummary(): SearchShareSummary {
  return {
    status: 'missing',
    fromLabel: 'Search',
    toLabel: 'Unavailable',
    routeLabel: 'Search unavailable',
    title: 'Search not found — LetsFG',
    description: 'This shared flight search is no longer available. Search again for fresh live results.',
    offersMetric: {
      label: 'OFFERS ANALYZED',
      value: '0',
      caption: 'unavailable',
    },
    secondaryMetric: {
      label: 'STATUS',
      value: 'Missing',
      caption: 'search again',
    },
    cheapestFormattedPrice: null,
  }
}

export function buildSearchShareSummary(result: SearchResult, displayCurrency?: string): SearchShareSummary {
  const dedupedOffers = deduplicateOffers(result.offers || [])
  const currency = displayCurrency?.trim() || dedupedOffers[0]?.currency || 'EUR'
  const cheapest = resolveCheapestOffer(dedupedOffers, currency)
  const cheapestDisplayPrice = cheapest ? getOfferDisplayTotalPrice(cheapest, currency) : null
  const cheapestFormattedPrice = cheapestDisplayPrice === null
    ? null
    : formatCurrencyAmount(cheapestDisplayPrice, currency)

  const fromFull = resolvePlaceLabel(result.parsed.origin_name, result.parsed.origin)
  const toFull = resolvePlaceLabel(result.parsed.destination_name, result.parsed.destination)
  const routeLabel = `${fromFull} → ${toFull}`
  const offersAnalyzed = resolveOffersAnalyzed(result, dedupedOffers)
  const topPicks = resolveTopPicks(result)

  const offersMetric: SearchShareMetric = {
    label: 'OFFERS ANALYZED',
    value: formatCount(offersAnalyzed),
    caption: result.status === 'searching' ? 'so far' : 'live offers',
  }

  if (result.status === 'searching') {
    const checked = typeof result.progress?.checked === 'number' ? result.progress.checked : 0
    const total = typeof result.progress?.total === 'number' ? result.progress.total : null

    return {
      status: 'searching',
      fromLabel: shortenPlaceLabel(fromFull),
      toLabel: shortenPlaceLabel(toFull),
      routeLabel,
      title: `Searching flights ${routeLabel} — LetsFG`,
      description: `Searching ${routeLabel}. ${formatCount(checked)} sources checked, ${formatCount(offersAnalyzed)} offers found so far.`,
      offersMetric,
      secondaryMetric: {
        label: 'SOURCES CHECKED',
        value: formatCount(checked),
        caption: total ? `of ${formatCount(total)}` : 'searching',
      },
      cheapestFormattedPrice: null,
    }
  }

  if (result.status === 'expired') {
    return {
      status: 'expired',
      fromLabel: shortenPlaceLabel(fromFull),
      toLabel: shortenPlaceLabel(toFull),
      routeLabel,
      title: 'Search expired — LetsFG',
      description: `The shared results for ${routeLabel} have expired. Search again for current live fares.`,
      offersMetric,
      secondaryMetric: {
        label: 'STATUS',
        value: 'Expired',
        caption: 'search again',
      },
      cheapestFormattedPrice: cheapestFormattedPrice,
    }
  }

  const titleBase = cheapestFormattedPrice
    ? `${formatCount(dedupedOffers.length)} flights ${routeLabel} from ${cheapestFormattedPrice}`
    : `Flights ${routeLabel}`

  const descriptionParts = [`Found ${formatCount(offersAnalyzed)} flights for ${routeLabel}.`]

  if (topPicks !== null) {
    descriptionParts.push(`${formatCount(topPicks)} top picks shortlisted.`)
  } else if (cheapestFormattedPrice) {
    descriptionParts.push(`Cheapest from ${cheapestFormattedPrice}${cheapest?.airline ? ` on ${cheapest.airline}` : ''}.`)
  }

  descriptionParts.push('Zero markup, raw airline prices.')

  return {
    status: 'completed',
    fromLabel: shortenPlaceLabel(fromFull),
    toLabel: shortenPlaceLabel(toFull),
    routeLabel,
    title: `${titleBase} — LetsFG`,
    description: descriptionParts.join(' '),
    offersMetric,
    secondaryMetric: resolveCompletedSecondaryMetric(topPicks, cheapestFormattedPrice, cheapest?.airline),
    cheapestFormattedPrice,
  }
}