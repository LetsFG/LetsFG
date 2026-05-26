'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import Image from 'next/image'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter, useSearchParams } from 'next/navigation'
import CurrencyButton from '../../currency-button'
import GlobeButton from '../../globe-button'
import SearchingLoadingScene from '../SearchingLoadingScene'
import UnlockDrawer from '../UnlockDrawer'

// Heavy modals — load only when the user actually opens an alert.
const MonitorModal = dynamic(() => import('./MonitorModal'), { ssr: false })
const MonitorConfirmedOverlay = dynamic(() => import('./MonitorConfirmedOverlay'), { ssr: false })
import {
  CURRENCY_CHANGE_EVENT,
  readBrowserCurrencyPreference,
  type CurrencyCode,
} from '../../../lib/currency-preference'
import {
  getOfferDisplayTotalPrice,
  type FxRateTable,
} from '../../../lib/display-price'
import { formatCurrencyAmount } from '../../../lib/user-currency'
import { readBrowserCachedResults, writeBrowserCachedResults } from '../../../lib/browser-offer-cache'
import { formatFlightTime } from '../../../lib/flight-datetime'
import { appendProbeParam } from '../../../lib/probe-mode'
import { parseNLQuery } from '../../lib/searchParsing'
import { getOfferInstanceKey, rankOffers, type RankingContext, type RankOffer } from '../../lib/rankOffers'

// Reuse the pending page's CTA color tokens — keeps the brand visible.
const POLL_FIRST_PHASE_MS = 2000
const POLL_LATER_PHASE_MS = 5000
const POLL_FIRST_PHASE_HORIZON_MS = 15000
// Render the "Other flights" list this many at a time. "Show more" reveals
// the next OTHER_PAGE_SIZE items until we run out.
const OTHER_PAGE_SIZE = 20

interface FlightOffer {
  id: string
  price: number
  google_flights_price?: number
  offer_ref?: string
  currency: string
  airline: string
  airline_code: string
  /** First-segment flight number e.g. "VY7831". Used in the drawer's
   *  flight summary line so we don't need a second fetch to surface it. */
  flight_number?: string
  origin: string
  origin_name: string
  destination: string
  destination_name: string
  departure_time: string
  arrival_time: string
  duration_minutes: number
  stops: number
  /** Present only on round-trip offers. Full leg data so we can render
   *  the return row on cards + the drawer, not just toggle "Round trip". */
  inbound?: {
    origin?: string
    destination?: string
    departure_time?: string
    arrival_time?: string
    duration_minutes?: number
    stops?: number
    airline?: string
  }
  /** Virtual interlining — flight ships as TWO or more separate bookings
   *  rather than a single ticket. Surface with a "Separate tickets" badge. */
  is_combo?: boolean
  /** Bag / seat / cabin_bag prices, shipped inline with the offer list so
   *  the drawer renders the price breakdown instantly without a second
   *  /api/offer/{id} round-trip. */
  ancillaries?: {
    cabin_bag?: { included?: boolean; price?: number; currency?: string; description?: string }
    checked_bag?: { included?: boolean; price?: number; currency?: string; description?: string }
    seat_selection?: { included?: boolean; price?: number; currency?: string; description?: string }
  }
}

interface ParsedQuery {
  origin?: string
  origin_name?: string
  destination?: string
  destination_name?: string
  date?: string
  return_date?: string
  passengers?: number
  cabin?: string
}

interface RankResponse {
  title?: string
  subtitle?: string
  hero?: string
  hero_bullets?: string[]
  runners?: string[]
  offer_ids?: string[]
}

export interface ResultsClientProps {
  searchId: string
  isTestSearch: boolean
  initialCurrency: CurrencyCode
  fxRates: FxRateTable
  query: string
  parsed: ParsedQuery
  initialStatus: 'searching' | 'completed' | 'expired' | 'error'
  initialOffers: FlightOffer[]
  searchedAt?: string
  fswSession?: string
  /** Has this user already paid the unlock fee for this search? Computed
   *  SSR-side from the lfg_unlocks cookie. When true, every offer's drawer
   *  skips the Stripe flow and goes straight to the booking-link state. */
  initialIsUnlocked: boolean
}

function dedup(offers: FlightOffer[]): FlightOffer[] {
  return Array.from(new Map(offers.map((o) => [getOfferInstanceKey(o), o])).values())
}

function formatTime(iso: string): string {
  // Routes through the shared lib/flight-datetime formatter — required by
  // tests/flight-time-surfaces.test.ts so every flight clock on the site
  // renders identically (UTC, 24h, --:-- on missing data).
  return formatFlightTime(iso)
}

function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

function formatLegDate(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleDateString(locale, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    })
  } catch {
    return ''
  }
}

function stopsLabel(stops: number, t: ReturnType<typeof useTranslations>): string {
  if (stops === 0) return t('stops_direct')
  if (stops === 1) return t('stops_one')
  return t('stops_many', { count: stops })
}

function lowestGoogleFlightsPrice(offers: FlightOffer[]): number | undefined {
  let lowest: number | undefined
  for (const o of offers) {
    const p = o.google_flights_price
    if (typeof p === 'number' && p > 0 && (lowest === undefined || p < lowest)) {
      lowest = p
    }
  }
  return lowest
}

function HomeLogo({ locale }: { locale: string }) {
  const t = useTranslations('Results')
  return (
    <Link href={`/${locale}`} className="lp-topbar-brand-link" aria-label={t('homeLogoAria')}>
      <Image
        src="/lfg_ban.png"
        alt="LetsFG"
        width={4990}
        height={1560}
        className="lp-topbar-brand"
        priority
        sizes="(max-width: 768px) 180px, 280px"
      />
    </Link>
  )
}

// ── Card sub-components ────────────────────────────────────────────────────

interface CardProps {
  offer: FlightOffer
  displayCurrency: CurrencyCode
  fxRates: FxRateTable
  hrefSuffix: string
  onClick?: () => void
}

function buildBookHref(offer: FlightOffer, suffix: string): string {
  const base = `/book/${encodeURIComponent(offer.id)}`
  return suffix ? `${base}?${suffix}` : base
}

// Single understated "⚠ Separate tickets" label used on every card type
// when an offer is virtual-interlining (is_combo). Brand orange, normal
// weight, no chip background. Hover tooltip carries the full caveat.
function ComboTicketsLabel() {
  const t = useTranslations('Results')
  return (
    <span
      className="res2-combo-icon"
      title={t('comboSeparateTicketsTitle')}
    >
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      {t('comboSeparateTickets')}
    </span>
  )
}

function HeroCard({
  offer,
  displayCurrency,
  fxRates,
  hrefSuffix: _hrefSuffix,
  bullets,
  googleFlightsLowest,
  locale,
  onUnlock,
  onAlert,
}: CardProps & { bullets: string[]; googleFlightsLowest?: number; locale: string; onUnlock: () => void; onAlert: () => void }) {
  const t = useTranslations('Results')
  const price = getOfferDisplayTotalPrice(offer, displayCurrency, fxRates)
  const priceFmt = formatCurrencyAmount(price, displayCurrency)
  const savings = (() => {
    if (typeof googleFlightsLowest !== 'number') return null
    const diff = googleFlightsLowest - price
    if (diff <= 0) return null
    return { diff: Math.round(diff), comparedTo: Math.round(googleFlightsLowest) }
  })()
  const hasReturn = !!(offer.inbound && offer.inbound.departure_time && offer.inbound.arrival_time)

  return (
    <div className="res2-hero">
      <div className="res2-hero-leg">
        {hasReturn ? (
          <div className="res2-hero-leg-label">
            {t('legOutbound')} · {formatLegDate(offer.departure_time, locale)}
          </div>
        ) : null}
        <div className="res2-hero-times">
          <div className="res2-hero-time-col">
            <span className="res2-hero-time">{formatTime(offer.departure_time)}</span>
            <span className="res2-hero-code">{offer.origin}</span>
          </div>
          <div className="res2-hero-flightline" aria-hidden="true">
            <span className="res2-hero-flightline-bar" />
          </div>
          <div className="res2-hero-time-col res2-hero-time-col--right">
            <span className="res2-hero-time">{formatTime(offer.arrival_time)}</span>
            <span className="res2-hero-code">{offer.destination}</span>
          </div>
        </div>
      </div>

      {hasReturn && offer.inbound ? (
        <div className="res2-hero-leg">
          <div className="res2-hero-leg-label">
            {t('legReturn')} · {formatLegDate(offer.inbound.departure_time!, locale)}
          </div>
          <div className="res2-hero-times">
            <div className="res2-hero-time-col">
              <span className="res2-hero-time">{formatTime(offer.inbound.departure_time!)}</span>
              <span className="res2-hero-code">{offer.inbound.origin ?? offer.destination}</span>
            </div>
            <div className="res2-hero-flightline" aria-hidden="true">
              <span className="res2-hero-flightline-bar" />
            </div>
            <div className="res2-hero-time-col res2-hero-time-col--right">
              <span className="res2-hero-time">{formatTime(offer.inbound.arrival_time!)}</span>
              <span className="res2-hero-code">{offer.inbound.destination ?? offer.origin}</span>
            </div>
          </div>
        </div>
      ) : null}

      <div className="res2-hero-pills">
        <span className={`res2-pill res2-pill--stops${offer.stops === 0 ? ' res2-pill--direct' : ''}`}>
          {stopsLabel(offer.stops, t)}
        </span>
        <span className="res2-pill res2-pill--airline">{offer.airline}</span>
        <span className="res2-pill">
          {hasReturn && offer.inbound?.duration_minutes
            ? `${formatDuration(offer.duration_minutes)} + ${formatDuration(offer.inbound.duration_minutes)}`
            : formatDuration(offer.duration_minutes)}
        </span>
      </div>

      {bullets.length > 0 ? (
        <ul className="res2-hero-bullets">
          {bullets.slice(0, 3).map((b, i) => (
            <li key={i} className="res2-hero-bullet">{b}</li>
          ))}
        </ul>
      ) : null}

      <div className="res2-hero-price-block">
        <div className="res2-hero-price">{priceFmt}</div>
        <div className="res2-hero-price-meta">
          {t('priceMeta', { trip: offer.inbound ? t('tripRoundTrip') : t('tripOneWay') })}
        </div>
        {offer.is_combo ? <ComboTicketsLabel /> : null}
        {savings ? (
          <div className="res2-hero-savings">
            {t('savingsVsGoogleFlights', {
              diff: formatCurrencyAmount(savings.diff, displayCurrency),
              comparedTo: formatCurrencyAmount(savings.comparedTo, displayCurrency),
            })}
          </div>
        ) : null}
      </div>

      <div className="res2-hero-actions">
        <button
          type="button"
          className="res2-hero-cta res2-hero-cta--primary"
          onClick={onUnlock}
        >
          {t('unlockAndBook')}
        </button>
        <button
          type="button"
          className="res2-hero-cta res2-hero-cta--secondary"
          onClick={onAlert}
          aria-label={t('alertCtaAria')}
        >
          <span className="res2-hero-cta-icon" aria-hidden="true">🔔</span>
          {t('alertCta')}
        </button>
      </div>
    </div>
  )
}

// Short tag derived from offer characteristics vs. the hero — no Gemini.
// Returns at most two `·`-separated chips, mockup-style ("Cheapest option ·
// hand luggage only"). When nothing differentiates, falls back to a plain
// "Direct" / "1 stop" so the line is never empty.
function deriveRunnerTag(
  offer: FlightOffer,
  heroOffer: FlightOffer | undefined,
  t: ReturnType<typeof useTranslations>,
): string | null {
  if (!heroOffer || offer.id === heroOffer.id) return null
  const tags: string[] = []
  if (offer.price < heroOffer.price) tags.push(t('runnerTagCheapest'))
  if (offer.stops < heroOffer.stops) tags.push(t('runnerTagFewerStops'))
  if (offer.duration_minutes < heroOffer.duration_minutes - 15) tags.push(t('runnerTagFaster'))
  if (tags.length === 0) {
    tags.push(offer.stops === 0 ? t('runnerTagDirectAlt') : t('runnerTagAlt'))
  }
  return tags.slice(0, 2).join(' · ')
}

function RunnerCard({
  offer,
  displayCurrency,
  fxRates,
  hrefSuffix: _hrefSuffix,
  heroOffer,
  onUnlock,
}: CardProps & { heroOffer: FlightOffer | undefined; onUnlock: () => void }) {
  const t = useTranslations('Results')
  const price = getOfferDisplayTotalPrice(offer, displayCurrency, fxRates)
  const priceFmt = formatCurrencyAmount(price, displayCurrency)
  const tag = deriveRunnerTag(offer, heroOffer, t)
  const tripType = offer.inbound ? t('tripRoundTrip') : t('tripOneWay')
  const hasReturn = !!(offer.inbound && offer.inbound.departure_time && offer.inbound.arrival_time)
  return (
    <button type="button" onClick={onUnlock} className="res2-runner">
      <div className="res2-runner-main">
        <div className="res2-runner-times">
          <span className="res2-runner-time">{formatTime(offer.departure_time)}</span>
          <span className="res2-runner-code">{offer.origin}</span>
          <span className="res2-runner-arrow" aria-hidden="true">→</span>
          <span className="res2-runner-time">{formatTime(offer.arrival_time)}</span>
          <span className="res2-runner-code">{offer.destination}</span>
        </div>
        {hasReturn && offer.inbound ? (
          <div className="res2-runner-times res2-runner-times--return">
            <span className="res2-runner-return-icon" aria-hidden="true">↩</span>
            <span className="res2-runner-time">{formatTime(offer.inbound.departure_time!)}</span>
            <span className="res2-runner-code">{offer.inbound.origin ?? offer.destination}</span>
            <span className="res2-runner-arrow" aria-hidden="true">→</span>
            <span className="res2-runner-time">{formatTime(offer.inbound.arrival_time!)}</span>
            <span className="res2-runner-code">{offer.inbound.destination ?? offer.origin}</span>
          </div>
        ) : null}
        <div className="res2-runner-meta">
          {offer.airline} · {stopsLabel(offer.stops, t)} · {formatDuration(offer.duration_minutes)}
        </div>
        {tag ? <div className="res2-runner-reason">✓ {tag}</div> : null}
      </div>
      <div className="res2-runner-price">
        <div className="res2-runner-price-val">{priceFmt}</div>
        <div className="res2-runner-price-meta">{tripType}</div>
        {offer.is_combo ? <ComboTicketsLabel /> : null}
      </div>
    </button>
  )
}

function OtherCard({
  offer,
  displayCurrency,
  fxRates,
  hrefSuffix: _hrefSuffix,
  onUnlock,
}: CardProps & { onUnlock: () => void }) {
  const t = useTranslations('Results')
  const price = getOfferDisplayTotalPrice(offer, displayCurrency, fxRates)
  const priceFmt = formatCurrencyAmount(price, displayCurrency)
  const tripType = offer.inbound ? t('tripRoundTrip') : t('tripOneWay')
  const hasReturn = !!(offer.inbound && offer.inbound.departure_time && offer.inbound.arrival_time)
  return (
    <button type="button" onClick={onUnlock} className="res2-other">
      <div className="res2-other-main">
        <div className="res2-other-times">
          <span className="res2-other-time">{formatTime(offer.departure_time)}</span>
          <span className="res2-other-arrow" aria-hidden="true">→</span>
          <span className="res2-other-time">{formatTime(offer.arrival_time)}</span>
        </div>
        {hasReturn && offer.inbound ? (
          <div className="res2-other-times res2-other-times--return">
            <span className="res2-other-return-icon" aria-hidden="true">↩</span>
            <span className="res2-other-time">{formatTime(offer.inbound.departure_time!)}</span>
            <span className="res2-other-arrow" aria-hidden="true">→</span>
            <span className="res2-other-time">{formatTime(offer.inbound.arrival_time!)}</span>
          </div>
        ) : null}
        <div className="res2-other-meta">
          {offer.airline} · {stopsLabel(offer.stops, t)} · {formatDuration(offer.duration_minutes)}
        </div>
      </div>
      <div className="res2-other-price">
        <div className="res2-other-price-val">{priceFmt}</div>
        <div className="res2-other-price-meta">{tripType}</div>
        {offer.is_combo ? <ComboTicketsLabel /> : null}
      </div>
    </button>
  )
}

// ── Main client ────────────────────────────────────────────────────────────

export default function ResultsClient({
  searchId,
  isTestSearch,
  initialCurrency,
  fxRates,
  query,
  parsed,
  initialStatus,
  initialOffers,
  searchedAt,
  fswSession,
  initialIsUnlocked,
}: ResultsClientProps) {
  const router = useRouter()
  const locale = useLocale()
  const searchParams = useSearchParams()
  const t = useTranslations('Results')

  const [status, setStatus] = useState(initialStatus)
  // Seed offers from the SSR snapshot, but also try the session/local cache
  // if SSR returned nothing — happens on cold-cache search IDs and crucially
  // on the Stripe-return navigation (cross-site nav → FSW cold-cache → SSR
  // returns empty → without this we'd wait 6-8s for polling to repopulate).
  const [offers, setOffers] = useState<FlightOffer[]>(() => {
    if (initialOffers.length > 0) return initialOffers
    if (typeof window === 'undefined') return initialOffers
    const cached = readBrowserCachedResults<FlightOffer>(searchId)
    return cached?.offers && cached.offers.length > 0 ? cached.offers : initialOffers
  })

  // Whenever offers update, mirror to the browser cache so the next visit
  // to this same searchId (Stripe return, manual refresh, back-button)
  // can hydrate instantly without waiting for polling.
  useEffect(() => {
    if (offers.length === 0) return
    writeBrowserCachedResults(searchId, offers)
  }, [searchId, offers])
  const [displayCurrency, setDisplayCurrency] = useState<CurrencyCode>(initialCurrency)
  const [otherLimit, setOtherLimit] = useState(OTHER_PAGE_SIZE)
  const [rankCopy, setRankCopy] = useState<RankResponse | null>(null)
  const [unlockingOffer, setUnlockingOffer] = useState<FlightOffer | null>(null)
  // When the user comes back from Stripe Checkout, the URL carries
  // `unlocked=<offerId>&stripe_session=<cs_...>`. We feed the session ID
  // into the drawer so it can call /api/checkout/verify and morph into
  // the booking-link state. Cleared once consumed.
  const [verifyStripeSession, setVerifyStripeSession] = useState<string | null>(null)
  // Price-alert modal state — opened by the hero card's "Alert" button.
  // MonitorModal handles the configure+create flow, which redirects to
  // Stripe; on return the URL carries `monitor_active=<id>` and we show
  // the MonitorConfirmedOverlay so the user can attach notification channels.
  const [monitorOpen, setMonitorOpen] = useState(false)
  const [confirmedMonitorId, setConfirmedMonitorId] = useState<string | null>(null)
  // SSR-derived; we flip it client-side once a successful Stripe verify
  // completes in-session so the next drawer open skips the unlock flow
  // without waiting for a page refresh.
  const [isUnlocked, setIsUnlocked] = useState(initialIsUnlocked)
  const stripeReturnHandledRef = useRef(false)
  const finalRankFiredRef = useRef(false)

  // Currency switcher events.
  useEffect(() => {
    const handler = () => setDisplayCurrency(readBrowserCurrencyPreference(initialCurrency))
    window.addEventListener(CURRENCY_CHANGE_EVENT, handler)
    return () => window.removeEventListener(CURRENCY_CHANGE_EVENT, handler)
  }, [initialCurrency])

  // Stripe return: when the URL carries ?unlocked=<id>&stripe_session=<cs_...>
  // we open the drawer for that offer IMMEDIATELY so the user doesn't have to
  // wait for the offers list to populate. If the offer is already in the list
  // we use it (instant real data). Otherwise we open with a placeholder AND
  // fetch /api/offer/{id} in the background so the drawer can swap to real
  // flight info as soon as it arrives — keeps the drawer visible the whole
  // time, no flicker, no waiting for the page to finish loading.
  useEffect(() => {
    if (stripeReturnHandledRef.current) return
    const unlockedId = searchParams.get('unlocked')
    const stripeSession = searchParams.get('stripe_session')
    if (!unlockedId || !stripeSession) return
    stripeReturnHandledRef.current = true

    const fromList = offers.find((o) => o.id === unlockedId)
    if (fromList) {
      setUnlockingOffer(fromList)
    } else {
      const placeholder: FlightOffer = {
        id: unlockedId,
        price: 0,
        currency: displayCurrency,
        airline: '',
        airline_code: '',
        origin: '',
        destination: '',
        origin_name: '',
        destination_name: '',
        departure_time: '',
        arrival_time: '',
        duration_minutes: 0,
        stops: 0,
      }
      setUnlockingOffer(placeholder)
      // Background fetch — drawer is already open so this is a silent upgrade.
      fetch(`/api/offer/${encodeURIComponent(unlockedId)}?from=${encodeURIComponent(searchId)}`, {
        cache: 'no-store',
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data: FlightOffer | null) => {
          if (data && data.id) setUnlockingOffer(data)
        })
        .catch(() => { /* swallow — placeholder stays, verify still runs */ })
    }
    setVerifyStripeSession(stripeSession)
    // Strip the Stripe-return params from the URL without re-rendering /
    // re-triggering effects. Using replaceState avoids Next.js router events.
    try {
      const url = new URL(window.location.href)
      url.searchParams.delete('unlocked')
      url.searchParams.delete('stripe_session')
      url.searchParams.delete('ref')
      History.prototype.replaceState.call(window.history, null, '', url.toString())
    } catch { /* ignore — URL cleanup is non-essential */ }
  }, [searchParams, offers, displayCurrency, searchId])

  // Monitor-checkout return: MonitorModal's create-flow redirects to Stripe;
  // on success the page mounts with `?monitor_active=<id>`. Show the
  // confirmed overlay so the user can attach push + Telegram channels.
  // Scrub the param afterwards so a refresh doesn't re-open the overlay.
  const monitorReturnHandledRef = useRef(false)
  useEffect(() => {
    if (monitorReturnHandledRef.current) return
    const monitorActive = searchParams.get('monitor_active')
    if (!monitorActive) return
    monitorReturnHandledRef.current = true
    setConfirmedMonitorId(monitorActive)
    try {
      const url = new URL(window.location.href)
      url.searchParams.delete('monitor_active')
      History.prototype.replaceState.call(window.history, null, '', url.toString())
    } catch { /* ignore — URL cleanup is non-essential */ }
  }, [searchParams])

  // Poll /api/results/{searchId} while status is 'searching'. New offers merge
  // in progressively; once status flips to anything else we stop polling.
  useEffect(() => {
    if (status !== 'searching') return

    const pollStart = Date.now()
    let cancelled = false
    let timeoutId: ReturnType<typeof setTimeout>

    const poll = async () => {
      if (cancelled) return
      try {
        const params = new URLSearchParams()
        appendProbeParam(params, isTestSearch)
        if (fswSession) params.set('_fss', fswSession)
        if (query) params.set('q', query)
        if (displayCurrency) params.set('cur', displayCurrency)
        const qs = params.toString()
        const res = await fetch(`/api/results/${encodeURIComponent(searchId)}${qs ? `?${qs}` : ''}`, {
          cache: 'no-store',
        })
        if (!res.ok) throw new Error(`poll ${res.status}`)
        const data = (await res.json()) as { status?: string; offers?: FlightOffer[] }
        if (cancelled) return
        if (data.offers && data.offers.length > 0) {
          if (data.status === 'searching') {
            setOffers((prev) => dedup([...prev, ...data.offers!]))
          } else {
            setOffers(dedup(data.offers))
          }
        }
        if (data.status && data.status !== 'searching') {
          setStatus(data.status as typeof status)
          return
        }
      } catch {
        // transient — retry next tick
      }
      if (cancelled) return
      const elapsed = Date.now() - pollStart
      const interval = elapsed < POLL_FIRST_PHASE_HORIZON_MS
        ? POLL_FIRST_PHASE_MS
        : POLL_LATER_PHASE_MS
      timeoutId = setTimeout(poll, interval)
    }

    timeoutId = setTimeout(poll, POLL_FIRST_PHASE_MS)
    return () => {
      cancelled = true
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [displayCurrency, fswSession, isTestSearch, query, searchId, status])

  // Ranked offers — first 3 cheapest by total price after the current
  // r_baggage / r_seat_selection wiring applied upstream by /api/results.
  const sortedOffers = useMemo(() => {
    if (offers.length === 0) return [] as FlightOffer[]
    return [...offers].sort(
      (a, b) =>
        getOfferDisplayTotalPrice(a, displayCurrency, fxRates) -
        getOfferDisplayTotalPrice(b, displayCurrency, fxRates),
    )
  }, [offers, displayCurrency, fxRates])

  const top3 = sortedOffers.slice(0, 3)
  const others = sortedOffers.slice(3)
  const heroOffer = top3[0]
  const runnerOffers = top3.slice(1)

  const googleFlightsLowest = useMemo(() => lowestGoogleFlightsPrice(offers), [offers])

  // Build the RankingContext that the local ranker + /api/rank both consume.
  // We only project the basics here — the full elaborate context (trip
  // purposes, ancillary requirements, etc.) is the next-task scope.
  const rankingContext: RankingContext = useMemo(() => {
    const r = (k: string) => searchParams.get(k)
    const requireBag = r('r_baggage') === '1_bag' || r('r_baggage') === '2_bags'
    const requireSeat =
      r('r_seat_selection') === 'pick' || r('r_seat_selection') === 'together'
    const passengers = typeof parsed.passengers === 'number' ? parsed.passengers : undefined
    return {
      travelerCount: passengers,
      requireBag,
      requireSeat,
    }
  }, [parsed.passengers, searchParams])

  // Fetch Gemini-driven copy: hero bullets + subtitle + runner reasons.
  // Fires once when we have ≥3 offers, and again on 'completed' for the
  // final pass over the full offer set (per user spec).
  const fetchRankCopy = useCallback(
    async (phase: 'partial' | 'final') => {
      if (offers.length < 1) return
      try {
        // Re-rank locally so the topOffers payload includes score/breakdown/
        // heroFacts/tradeoffs (Gemini's prompt builder uses heroFacts to know
        // why this flight won, and tradeoffs for the runner-up rationale).
        const ranked = rankOffers(offers as unknown as RankOffer[], rankingContext)
        const topThree = ranked.slice(0, 3)
        if (topThree.length === 0) return
        const body = {
          phase: phase === 'final' ? 'final' : status === 'searching' ? 'mid' : 'final',
          searchId,
          scannedDealsCount: offers.length,
          topOffers: topThree.map((r) => ({
            offer: r.offer,
            score: r.score,
            breakdown: r.breakdown,
            heroFacts: r.heroFacts,
            tradeoffs: r.tradeoffs,
            relaxedGates: r.relaxedGates,
          })),
          rawQuery: query,
          context: rankingContext,
          locale,
          displayCurrency,
        }
        const res = await fetch('/api/rank', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) return
        const data = (await res.json()) as RankResponse
        setRankCopy(data)
      } catch {
        // soft-fail — UI falls back to template copy
      }
    },
    [offers, rankingContext, query, searchId, locale, displayCurrency, status],
  )

  const rankCopyFiredOnceRef = useRef(false)
  useEffect(() => {
    if (top3.length >= 3 && !rankCopyFiredOnceRef.current) {
      rankCopyFiredOnceRef.current = true
      void fetchRankCopy('partial')
    }
  }, [top3.length, fetchRankCopy])

  // Final re-run once search completes (per user spec — fresh hero/bullets
  // for the complete offer set, not just the partial snapshot).
  useEffect(() => {
    if (status === 'completed' && !finalRankFiredRef.current && top3.length >= 1) {
      finalRankFiredRef.current = true
      void fetchRankCopy('final')
    }
  }, [status, top3.length, fetchRankCopy])

  // Deterministic subtitle fallback so the page never sits with an empty line.
  const subtitle = (() => {
    if (rankCopy?.subtitle) return rankCopy.subtitle
    const total = offers.length
    return total > 0
      ? t('subtitleFallback', { n: total })
      : t('subtitleScanning')
  })()

  // Carry the same search-state params through to /book/<id> so the checkout
  // panel knows which currency, probe mode, etc. to use.
  const bookHrefSuffix = useMemo(() => {
    const params = new URLSearchParams()
    if (displayCurrency) params.set('cur', displayCurrency)
    if (isTestSearch) params.set('probe', '1')
    const fromSearch = searchParams.toString()
    if (fromSearch) {
      const sp = new URLSearchParams(fromSearch)
      for (const key of ['q', '_fss', 'started']) {
        const val = sp.get(key)
        if (val && !params.get(key)) params.set(key, val)
      }
    }
    return params.toString()
  }, [displayCurrency, isTestSearch, searchParams])

  const visibleOthers = others.slice(0, otherLimit)
  const moreLeft = others.length - visibleOthers.length

  // Three states: still loading first offer (show pending-style scene),
  // search ended with no offers at all (show empty state with CTA),
  // or we have offers (show results layout).
  //
  // When the user just returned from Stripe (`verifyStripeSession` is set),
  // skip the loading scene even if no offers have rendered yet — the
  // drawer is the focus, the background should be the results layout
  // (empty / minimal is fine) rather than a flashy "searching…" view.
  const isWaitingForFirstOffer =
    top3.length === 0 && status === 'searching' && !verifyStripeSession
  const isEmpty = top3.length === 0 && status !== 'searching'

  return (
    <main className="res2-page">
      <header className="lp-topbar">
        <HomeLogo locale={locale} />
        <div className="lp-topbar-side">
          <GlobeButton inline />
          <CurrencyButton
            inline
            behavior="persist"
            initialCurrency={displayCurrency}
            searchQuery={query}
            probeMode={isTestSearch}
          />
        </div>
      </header>

      {isWaitingForFirstOffer ? (
        <section className="pend-body">
          <SearchingLoadingScene
            originCode={parsed.origin ?? undefined}
            originName={parsed.origin_name ?? parsed.origin ?? undefined}
            destinationCode={parsed.destination ?? undefined}
            destinationName={parsed.destination_name ?? parsed.destination ?? undefined}
          />
        </section>
      ) : (
        <section className="res2-body">
          <h1 className="res2-title">
            {t('heroTitle', { n: Math.min(3, Math.max(1, top3.length)) })}
          </h1>
          <p className="res2-subtitle">{subtitle}</p>

          {status === 'searching' ? (
            <div className="res2-streaming" role="status" aria-live="polite">
              <span className="res2-streaming-dot" aria-hidden="true" />
              <span className="res2-streaming-text">
                {t('streamingChip', { n: offers.length })}
              </span>
            </div>
          ) : null}

          {heroOffer ? (
            <HeroCard
              offer={heroOffer}
              displayCurrency={displayCurrency}
              fxRates={fxRates}
              hrefSuffix={bookHrefSuffix}
              bullets={rankCopy?.hero_bullets ?? []}
              googleFlightsLowest={googleFlightsLowest}
              locale={locale}
              onUnlock={() => setUnlockingOffer(heroOffer)}
              onAlert={() => setMonitorOpen(true)}
            />
          ) : isEmpty ? (
            <div className="res2-empty">
              {t('emptyState')}
              <button
                type="button"
                className="res2-empty-cta"
                onClick={() => router.push(`/${locale}?q=${encodeURIComponent(query)}`)}
              >
                {t('emptyStateCta')}
              </button>
            </div>
          ) : null}

          {runnerOffers.length > 0 ? (
            <>
              <h2 className="res2-section-heading">{t('sectionAlsoWorth')}</h2>
              <div className="res2-runner-list">
                {runnerOffers.map((offer) => (
                  <RunnerCard
                    key={offer.id}
                    offer={offer}
                    displayCurrency={displayCurrency}
                    fxRates={fxRates}
                    hrefSuffix={bookHrefSuffix}
                    heroOffer={heroOffer}
                    onUnlock={() => setUnlockingOffer(offer)}
                  />
                ))}
              </div>
            </>
          ) : null}

          {others.length > 0 ? (
            <>
              <h2 className="res2-section-heading">{t('sectionOther')}</h2>
              <div className="res2-other-list">
                {visibleOthers.map((offer) => (
                  <OtherCard
                    key={offer.id}
                    offer={offer}
                    displayCurrency={displayCurrency}
                    fxRates={fxRates}
                    hrefSuffix={bookHrefSuffix}
                    onUnlock={() => setUnlockingOffer(offer)}
                  />
                ))}
              </div>
              {moreLeft > 0 ? (
                <button
                  type="button"
                  className="res2-show-more"
                  onClick={() => setOtherLimit((n) => n + OTHER_PAGE_SIZE)}
                >
                  {t('showMore', { n: Math.min(moreLeft, OTHER_PAGE_SIZE) })}
                </button>
              ) : null}
            </>
          ) : null}
        </section>
      )}

      <UnlockDrawer
        offer={unlockingOffer}
        searchId={searchId}
        displayCurrency={displayCurrency}
        fxRates={fxRates}
        baggageChoice={searchParams.get('r_baggage')}
        seatChoice={searchParams.get('r_seat_selection')}
        locale={locale}
        probeMode={isTestSearch}
        verifyStripeSession={verifyStripeSession}
        isAlreadyUnlocked={isUnlocked}
        onUnlocked={() => setIsUnlocked(true)}
        onClose={() => {
          setUnlockingOffer(null)
          setVerifyStripeSession(null)
        }}
      />

      {/* Fall back to client-side parseNLQuery when SSR returned an empty
        * parsed snapshot (FSW hadn't persisted the parse yet at first SSR
        * hit, and polling doesn't update `parsed`). Without this the
        * Alert button silently no-ops when the user lands on the page
        * before the backend finishes the parse. */}
      {(() => {
        const fallback = (!parsed.origin || !parsed.destination || !parsed.date)
          ? parseNLQuery(query)
          : null
        const origin = parsed.origin || fallback?.origin
        const destination = parsed.destination || fallback?.destination
        const date = parsed.date || fallback?.date
        const originName = parsed.origin_name || fallback?.origin_name || origin
        const destinationName = parsed.destination_name || fallback?.destination_name || destination
        const returnDate = parsed.return_date || fallback?.return_date || undefined
        const passengers = parsed.passengers || 1
        const cabin = parsed.cabin || fallback?.cabin || undefined
        const routeLabel = [originName, destinationName].filter(Boolean).join(' → ')
        return (
          <>
            {monitorOpen && origin && destination && date ? (
              <MonitorModal
                searchId={searchId}
                origin={origin}
                originName={originName || origin}
                destination={destination}
                destinationName={destinationName || destination}
                departureDate={date}
                returnDate={returnDate}
                adults={passengers}
                cabinClass={cabin}
                currency={displayCurrency}
                fxRates={fxRates}
                onClose={() => setMonitorOpen(false)}
              />
            ) : null}

            {confirmedMonitorId ? (
              <MonitorConfirmedOverlay
                monitorId={confirmedMonitorId}
                routeLabel={routeLabel}
                onClose={() => setConfirmedMonitorId(null)}
              />
            ) : null}
          </>
        )
      })()}
    </main>
  )
}
