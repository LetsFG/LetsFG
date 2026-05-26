'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useLocale } from 'next-intl'
import { useRouter, useSearchParams } from 'next/navigation'
import CurrencyButton from '../../currency-button'
import GlobeButton from '../../globe-button'
import SearchingLoadingScene from '../SearchingLoadingScene'
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
  origin: string
  origin_name: string
  destination: string
  destination_name: string
  departure_time: string
  arrival_time: string
  duration_minutes: number
  stops: number
  /** Present only on round-trip offers — used to render "Round trip" vs
   *  "One way" under the price. We don't read the inbound details here. */
  inbound?: { departure_time?: string }
  /** Virtual interlining — flight ships as TWO or more separate bookings
   *  rather than a single ticket. Surface with a "Separate tickets" badge. */
  is_combo?: boolean
}

interface ParsedQuery {
  origin?: string
  origin_name?: string
  destination?: string
  destination_name?: string
  date?: string
  return_date?: string
  passengers?: number
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
}

function dedup(offers: FlightOffer[]): FlightOffer[] {
  return Array.from(new Map(offers.map((o) => [getOfferInstanceKey(o), o])).values())
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
  } catch {
    return iso
  }
}

function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

function stopsLabel(stops: number): string {
  if (stops === 0) return 'Direct'
  if (stops === 1) return '1 stop'
  return `${stops} stops`
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
  return (
    <Link href={`/${locale}`} className="lp-topbar-brand-link" aria-label="LetsFG home">
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
  return (
    <span
      className="res2-combo-icon"
      title="Booked as two separate fares — you'll complete two checkouts"
    >
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      Separate tickets
    </span>
  )
}

function HeroCard({
  offer,
  displayCurrency,
  fxRates,
  hrefSuffix,
  bullets,
  googleFlightsLowest,
  onAlert,
}: CardProps & { bullets: string[]; googleFlightsLowest?: number; onAlert: () => void }) {
  const price = getOfferDisplayTotalPrice(offer, displayCurrency, fxRates)
  const priceFmt = formatCurrencyAmount(price, displayCurrency)
  const savings = (() => {
    if (typeof googleFlightsLowest !== 'number') return null
    const diff = googleFlightsLowest - price
    if (diff <= 0) return null
    return { diff: Math.round(diff), comparedTo: Math.round(googleFlightsLowest) }
  })()
  const href = buildBookHref(offer, hrefSuffix)
  return (
    <div className="res2-hero">
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

      <div className="res2-hero-pills">
        <span className={`res2-pill res2-pill--stops${offer.stops === 0 ? ' res2-pill--direct' : ''}`}>
          {stopsLabel(offer.stops)}
        </span>
        <span className="res2-pill res2-pill--airline">{offer.airline}</span>
        <span className="res2-pill">{formatDuration(offer.duration_minutes)}</span>
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
          {offer.inbound ? 'Round trip' : 'One way'} · total per person · all fees included
        </div>
        {offer.is_combo ? <ComboTicketsLabel /> : null}
        {savings ? (
          <div className="res2-hero-savings">
            ↓ {formatCurrencyAmount(savings.diff, displayCurrency)} less than Google Flights avg ({formatCurrencyAmount(savings.comparedTo, displayCurrency)})
          </div>
        ) : null}
      </div>

      <div className="res2-hero-actions">
        <Link href={href} className="res2-hero-cta res2-hero-cta--primary" prefetch={false}>
          Unlock &amp; Book
        </Link>
        <button
          type="button"
          className="res2-hero-cta res2-hero-cta--secondary"
          onClick={onAlert}
          aria-label="Set price alert for this route"
        >
          <span className="res2-hero-cta-icon" aria-hidden="true">🔔</span>
          Alert
        </button>
      </div>
    </div>
  )
}

// Short tag derived from offer characteristics vs. the hero — no Gemini.
// Returns at most two `·`-separated chips, mockup-style ("Cheapest option ·
// hand luggage only"). When nothing differentiates, falls back to a plain
// "Direct" / "1 stop" so the line is never empty.
function deriveRunnerTag(offer: FlightOffer, heroOffer: FlightOffer | undefined): string | null {
  if (!heroOffer || offer.id === heroOffer.id) return null
  const tags: string[] = []
  if (offer.price < heroOffer.price) tags.push('Cheapest option')
  if (offer.stops < heroOffer.stops) tags.push('Fewer stops')
  if (offer.duration_minutes < heroOffer.duration_minutes - 15) tags.push('Faster')
  if (tags.length === 0) {
    tags.push(offer.stops === 0 ? 'Direct alternative' : 'Alternative option')
  }
  return tags.slice(0, 2).join(' · ')
}

function RunnerCard({
  offer,
  displayCurrency,
  fxRates,
  hrefSuffix,
  heroOffer,
}: CardProps & { heroOffer: FlightOffer | undefined }) {
  const price = getOfferDisplayTotalPrice(offer, displayCurrency, fxRates)
  const priceFmt = formatCurrencyAmount(price, displayCurrency)
  const href = buildBookHref(offer, hrefSuffix)
  const tag = deriveRunnerTag(offer, heroOffer)
  const tripType = offer.inbound ? 'Round trip' : 'One way'
  return (
    <Link href={href} className="res2-runner" prefetch={false}>
      <div className="res2-runner-main">
        <div className="res2-runner-times">
          <span className="res2-runner-time">{formatTime(offer.departure_time)}</span>
          <span className="res2-runner-code">{offer.origin}</span>
          <span className="res2-runner-arrow" aria-hidden="true">→</span>
          <span className="res2-runner-time">{formatTime(offer.arrival_time)}</span>
          <span className="res2-runner-code">{offer.destination}</span>
        </div>
        <div className="res2-runner-meta">
          {offer.airline} · {stopsLabel(offer.stops)} · {formatDuration(offer.duration_minutes)}
        </div>
        {tag ? <div className="res2-runner-reason">✓ {tag}</div> : null}
      </div>
      <div className="res2-runner-price">
        <div className="res2-runner-price-val">{priceFmt}</div>
        <div className="res2-runner-price-meta">{tripType}</div>
        {offer.is_combo ? <ComboTicketsLabel /> : null}
      </div>
    </Link>
  )
}

function OtherCard({ offer, displayCurrency, fxRates, hrefSuffix }: CardProps) {
  const price = getOfferDisplayTotalPrice(offer, displayCurrency, fxRates)
  const priceFmt = formatCurrencyAmount(price, displayCurrency)
  const href = buildBookHref(offer, hrefSuffix)
  const tripType = offer.inbound ? 'Round trip' : 'One way'
  return (
    <Link href={href} className="res2-other" prefetch={false}>
      <div className="res2-other-main">
        <div className="res2-other-times">
          <span className="res2-other-time">{formatTime(offer.departure_time)}</span>
          <span className="res2-other-arrow" aria-hidden="true">→</span>
          <span className="res2-other-time">{formatTime(offer.arrival_time)}</span>
        </div>
        <div className="res2-other-meta">
          {offer.airline} · {stopsLabel(offer.stops)} · {formatDuration(offer.duration_minutes)}
        </div>
      </div>
      <div className="res2-other-price">
        <div className="res2-other-price-val">{priceFmt}</div>
        <div className="res2-other-price-meta">{tripType}</div>
        {offer.is_combo ? <ComboTicketsLabel /> : null}
      </div>
    </Link>
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
}: ResultsClientProps) {
  const router = useRouter()
  const locale = useLocale()
  const searchParams = useSearchParams()

  const [status, setStatus] = useState(initialStatus)
  const [offers, setOffers] = useState<FlightOffer[]>(initialOffers)
  const [displayCurrency, setDisplayCurrency] = useState<CurrencyCode>(initialCurrency)
  const [otherLimit, setOtherLimit] = useState(OTHER_PAGE_SIZE)
  const [rankCopy, setRankCopy] = useState<RankResponse | null>(null)
  const finalRankFiredRef = useRef(false)

  // Currency switcher events.
  useEffect(() => {
    const handler = () => setDisplayCurrency(readBrowserCurrencyPreference(initialCurrency))
    window.addEventListener(CURRENCY_CHANGE_EVENT, handler)
    return () => window.removeEventListener(CURRENCY_CHANGE_EVENT, handler)
  }, [initialCurrency])

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
      ? `From ${total.toLocaleString()} option${total === 1 ? '' : 's'} across 180 airlines · all prices include baggage & seat`
      : 'Comparing every fee, seat cost, and baggage charge…'
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
  const isWaitingForFirstOffer = top3.length === 0 && status === 'searching'
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
            Your {Math.min(3, Math.max(1, top3.length))} best flights
          </h1>
          <p className="res2-subtitle">{subtitle}</p>

          {heroOffer ? (
            <HeroCard
              offer={heroOffer}
              displayCurrency={displayCurrency}
              fxRates={fxRates}
              hrefSuffix={bookHrefSuffix}
              bullets={rankCopy?.hero_bullets ?? []}
              googleFlightsLowest={googleFlightsLowest}
              onAlert={() => alert('Price alerts coming soon — feature in development')}
            />
          ) : isEmpty ? (
            <div className="res2-empty">
              We couldn’t find flights for this search.
              <button
                type="button"
                className="res2-empty-cta"
                onClick={() => router.push(`/${locale}?q=${encodeURIComponent(query)}`)}
              >
                Try a different search
              </button>
            </div>
          ) : null}

          {runnerOffers.length > 0 ? (
            <>
              <h2 className="res2-section-heading">Also worth considering</h2>
              <div className="res2-runner-list">
                {runnerOffers.map((offer) => (
                  <RunnerCard
                    key={offer.id}
                    offer={offer}
                    displayCurrency={displayCurrency}
                    fxRates={fxRates}
                    hrefSuffix={bookHrefSuffix}
                    heroOffer={heroOffer}
                  />
                ))}
              </div>
            </>
          ) : null}

          {others.length > 0 ? (
            <>
              <h2 className="res2-section-heading">Other flights</h2>
              <div className="res2-other-list">
                {visibleOthers.map((offer) => (
                  <OtherCard
                    key={offer.id}
                    offer={offer}
                    displayCurrency={displayCurrency}
                    fxRates={fxRates}
                    hrefSuffix={bookHrefSuffix}
                  />
                ))}
              </div>
              {moreLeft > 0 ? (
                <button
                  type="button"
                  className="res2-show-more"
                  onClick={() => setOtherLimit((n) => n + OTHER_PAGE_SIZE)}
                >
                  Show {Math.min(moreLeft, OTHER_PAGE_SIZE)} more
                </button>
              ) : null}
            </>
          ) : null}
        </section>
      )}
    </main>
  )
}
