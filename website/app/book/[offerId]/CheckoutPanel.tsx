'use client'

import { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { getAirlineLogoUrl } from '../../airlineLogos'
import { computeFlightTimeContext, formatFlightTime } from '../../../lib/flight-datetime'
import { calculateFee, withFee } from '../../../lib/pricing'
import { convertCurrencyAmount, type FxRateTable } from '../../../lib/display-price'
import type { Offer } from './page'
import { trackSearchSessionEvent } from '../../../lib/search-session-analytics'
import { appendProbeParam, getTrackedSourcePath } from '../../../lib/probe-mode'
import { useExperiment, type ExperimentConfig } from '../../../lib/ab-testing'
import BookingFrictionSurvey, { SS_KEY_CHECKOUT_VISITED } from '../../BookingFrictionSurvey'
import CheckoutCountdown, { CHECKOUT_COUNTDOWN_EXPERIMENT_ID } from './CheckoutCountdown'

const CHECKOUT_COUNTDOWN_EXPERIMENT: ExperimentConfig<'control' | 'countdown'> = {
  id: CHECKOUT_COUNTDOWN_EXPERIMENT_ID,
  variants: { control: 0.5, countdown: 0.5 },
}

interface Props {
  offer: Offer
  searchId: string | null
  trackingSearchId: string | null
  isTestSearch: boolean
  offerRef: string | null
  displayCurrency?: string
  fxRates?: FxRateTable
}

type CheckoutStep =
  | { type: 'checking' }           // checking unlock status on mount
  | { type: 'verifying-payment' }  // verifying Stripe session after redirect
  | { type: 'locked' }
  | { type: 'paying' }             // waiting for Stripe redirect
  | { type: 'unlocked'; via: 'payment' | 'existing' }

interface BookingOption {
  leg: 'outbound' | 'inbound'
  airline: string
  airline_code: string
  booking_url: string
  booking_site?: string
  price?: number
  currency?: string
  origin?: string
  destination?: string
  departure_time?: string
  arrival_time?: string
}

type TripBreakdownLeg = NonNullable<Offer['trip_breakdown']>[number]

interface SplitBookingLeg extends TripBreakdownLeg {
  booking_url?: string
  booking_site?: string
}

function fmtTime(iso: string) {
  return formatFlightTime(iso)
}

function fmtDuration(mins: number) {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${h}h ${m > 0 ? ` ${m}m` : ''}`
}

function fmtTzOffset(mins: number): string {
  const abs = Math.abs(mins)
  const sign = mins < 0 ? '−' : '+'
  const hours = Math.floor(abs / 60)
  const halfHour = abs % 60 >= 30
  return halfHour ? `${sign}${hours}.5h` : `${sign}${hours}h`
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function fmtFee(fee: number, currency: string) {
  return `${currency}${fee < 10 ? fee.toFixed(2) : Math.round(fee)}`
}

function fmtMoney(amount: number, currency: string) {
  return `${currency}${amount.toFixed(2).replace(/\.00$/, '')}`
}

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

const UNLOCK_TOKEN_STORAGE_PREFIX = 'lfg_unlock_token:'
const UNLOCK_TOKEN_HEADER_NAME = 'x-letsfg-unlock-token'

function getUnlockTokenStorageKey(searchId: string) {
  return `${UNLOCK_TOKEN_STORAGE_PREFIX}${searchId}`
}

function readStoredUnlockToken(searchId: string | null): string | null {
  if (!searchId) return null

  try {
    return window.localStorage.getItem(getUnlockTokenStorageKey(searchId))
  } catch (_) {
    return null
  }
}

function persistUnlockToken(searchId: string | null, unlockToken: string | undefined) {
  if (!searchId || !unlockToken) return

  try {
    window.localStorage.setItem(getUnlockTokenStorageKey(searchId), unlockToken)
  } catch (_) {
    // Ignore storage failures and keep the in-memory flow working.
  }
}

async function fetchLatestOfferRef(searchId: string, offerId: string, isTestSearch: boolean): Promise<string | null> {
  try {
    const params = new URLSearchParams()
    appendProbeParam(params, isTestSearch)
    const query = params.toString()
    const res = await fetch(`/api/results/${encodeURIComponent(searchId)}${query ? `?${query}` : ''}`, {
      cache: 'no-store',
      credentials: 'same-origin',
    })
    if (!res.ok) {
      return null
    }

    const data = await res.json() as {
      offers?: Array<{ id?: string; offer_ref?: string }>
    }
    const matchedOffer = data.offers?.find((candidate) => candidate.id === offerId)
    return typeof matchedOffer?.offer_ref === 'string' && matchedOffer.offer_ref.length > 0
      ? matchedOffer.offer_ref
      : null
  } catch (_) {
    return null
  }
}

function LockIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" width="16" height="16" aria-hidden="true">
      <rect x="4" y="9" width="12" height="9" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M7 9V6a3 3 0 1 1 6 0v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" width="18" height="18" aria-hidden="true">
      <path d="M4 10l4.5 4.5L16 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" width="16" height="16" aria-hidden="true">
      <path d="M4 10h12M11 5l5 5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function AirlineLogo({ code, name }: { code: string; name: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <div className="ck-airline-logo ck-airline-logo--text" aria-label={name}>
        {code.slice(0, 2)}
      </div>
    )
  }
  return (
    <div className="ck-airline-logo">
      <img
        src={getAirlineLogoUrl(code)}
        alt={name}
        width={40}
        height={40}
        onError={() => setFailed(true)}
      />
    </div>
  )
}

const LCC_IATA = new Set([
  'FR', 'U2', 'W6', 'DY', 'VY', 'HV', 'PC', 'G4', 'SY', 'F9', 'NK', 'B6', 'WN', 'WS',
  'FZ', 'G9', 'XY', 'J9', 'HH', 'HG', '5O', 'M3', 'FB', 'V7', 'IG', 'Z4', 'VG', '7R',
  '8H', 'W4', 'F3', 'SX', 'I2', 'BV', 'HO', 'OM', 'GX', 'CK', '7C', 'BX', 'LJ', 'TW',
  'ZE', '5J', 'Z2', 'AK', 'FD', 'QZ', 'QG', 'XT', 'VZ', 'SL', 'KK', 'OD', 'ID', 'SJ',
  '3K', 'TR', 'MM', 'GK', 'BC', 'SG', 'OG', 'G8', 'IX', 'S5', '6E', '2T', '5Z', 'FA',
  'O2', 'ZL',
])

const FSC_IATA = new Set([
  'BA', 'LH', 'AF', 'KL', 'EK', 'QR', 'EY', 'TK', 'SQ', 'CX', 'QF', 'UA', 'AA', 'DL',
  'SK', 'AY', 'LX', 'OS', 'SN', 'IB', 'AZ', 'TP', 'LO', 'OK', 'A3', 'OA', 'RO', 'BT',
  'OU', 'JP', 'JU', 'AC', 'AI', 'GF', 'MS', 'RJ', 'KU', 'OZ', 'KE', 'NH', 'JL', 'CI',
  'BR', 'TG', 'MH', 'MI', 'GA', 'PR', 'MU', 'CA', 'FM', 'ZH', 'CZ', 'SC', 'D7', 'LA',
  'CM', 'AM', 'UX', 'ME', 'LY', 'WY', 'AT', 'SA', 'ET', 'KQ', 'RB',
])

function getAirlineCategory(code: string): string {
  if (LCC_IATA.has(code)) return 'Low-cost carrier'
  if (FSC_IATA.has(code)) return 'Full-service carrier'
  return 'Airline'
}

function HiddenAirlineLogo() {
  return (
    <div className="ck-airline-logo ck-airline-logo--hidden" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor">
        <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" />
      </svg>
    </div>
  )
}

export default function CheckoutPanel({
  offer,
  searchId,
  trackingSearchId,
  isTestSearch,
  offerRef,
  displayCurrency: displayCurrencyProp,
  fxRates,
}: Props) {
  const t = useTranslations('Checkout')
  const analyticsSearchId = trackingSearchId || searchId
  const checkoutSourcePath = getTrackedSourcePath(`/book/${offer.id}`, isTestSearch)
  const homeHref = isTestSearch ? 'https://letsfg.co/en?probe=1' : 'https://letsfg.co'
  // Use the user's preferred display currency; fall back to the offer's native currency
  const displayCurrency = displayCurrencyProp || offer.currency
  const displayPrice = convertCurrencyAmount(offer.price, offer.currency, displayCurrency, fxRates)
  const fee = calculateFee(offer.price, offer.currency)
  const displayFee = convertCurrencyAmount(fee, offer.currency, displayCurrency, fxRates)
  const tripBreakdown = useMemo<TripBreakdownLeg[]>(() => {
    if (offer.trip_breakdown?.length) {
      return offer.trip_breakdown
    }
    if (!offer.inbound) {
      return []
    }
    return [
      {
        leg: 'outbound',
        airline: offer.airline,
        airline_code: offer.airline_code,
        origin: offer.origin,
        destination: offer.destination,
        departure_time: offer.departure_time,
        arrival_time: offer.arrival_time,
        duration_minutes: offer.duration_minutes,
      },
      {
        leg: 'inbound',
        airline: offer.inbound.airline || offer.airline,
        airline_code: offer.inbound.airline_code || offer.airline_code,
        origin: offer.inbound.origin,
        destination: offer.inbound.destination,
        departure_time: offer.inbound.departure_time,
        arrival_time: offer.inbound.arrival_time,
        duration_minutes: offer.inbound.duration_minutes,
      },
    ]
  }, [offer])
  const summaryLegs = useMemo<TripBreakdownLeg[]>(() => {
    if (tripBreakdown.length) {
      return tripBreakdown
    }
    return [
      {
        leg: 'outbound',
        airline: offer.airline,
        airline_code: offer.airline_code,
        origin: offer.origin,
        destination: offer.destination,
        departure_time: offer.departure_time,
        arrival_time: offer.arrival_time,
        duration_minutes: offer.duration_minutes,
      },
    ]
  }, [offer, tripBreakdown])
  const summaryDates = useMemo(() => {
    const seen = new Set<string>()
    const dates: string[] = []
    for (const leg of summaryLegs) {
      const label = fmtDate(leg.departure_time)
      if (!seen.has(label)) {
        seen.add(label)
        dates.push(label)
      }
    }
    return dates
  }, [summaryLegs])
  const summaryAirline = offer.is_combo && offer.inbound?.airline && offer.inbound.airline !== offer.airline
    ? `${offer.airline} + ${offer.inbound.airline}`
    : offer.airline
  const displayFlightNumber = offer.flight_number && offer.flight_number !== offer.airline_code
    ? offer.flight_number
    : ''

  // ── A/B experiments ──────────────────────────────────────────────────
  const { variant: countdownVariant } = useExperiment(CHECKOUT_COUNTDOWN_EXPERIMENT, analyticsSearchId)

  // Start in 'checking' — we always verify unlock status on mount.
  const [step, setStep] = useState<CheckoutStep>({ type: 'checking' })
  const [bookingUrl, setBookingUrl] = useState<string | null>(null)
  const [bookingSite, setBookingSite] = useState<string | null>(null)
  const [bookingOptions, setBookingOptions] = useState<BookingOption[]>([])
  const [bookingLinkStatus, setBookingLinkStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const bookingLinkTrackedRef = useRef(false)
  const splitBookingLegs = useMemo<SplitBookingLeg[]>(() => {
    if (tripBreakdown.length <= 1 || (!offer.is_combo && bookingOptions.length === 0)) {
      return []
    }

    const bookingOptionByLeg = new Map(bookingOptions.map((option) => [option.leg, option]))

    return tripBreakdown.map((leg) => {
      const option = bookingOptionByLeg.get(leg.leg)
      return {
        ...leg,
        price: leg.price ?? option?.price,
        currency: leg.currency ?? option?.currency ?? offer.currency,
        booking_url: option?.booking_url,
        booking_site: option?.booking_site,
      }
    })
  }, [bookingOptions, offer.currency, offer.is_combo, tripBreakdown])

  const isUnlocked = step.type === 'unlocked'
  const isLoading = step.type === 'checking' || step.type === 'verifying-payment'
  const showShareOption = false

  // Mark that user visited checkout so results page can detect a "back from checkout" return
  useEffect(() => {
    try { sessionStorage.setItem(SS_KEY_CHECKOUT_VISITED, '1') } catch (_) { /* ignore */ }
  }, [])

  const getLegTitle = useCallback((leg: 'outbound' | 'inbound') => (
    leg === 'outbound' ? 'Flight there' : 'Flight back'
  ), [])

  const getLegButtonLabel = useCallback((leg: 'outbound' | 'inbound') => (
    leg === 'outbound' ? 'Book outbound flight' : 'Book return flight'
  ), [])

  const getLegStops = useCallback((leg: TripBreakdownLeg | BookingOption) => (
    leg.leg === 'inbound' ? offer.inbound?.stops ?? 0 : offer.stops
  ), [offer.inbound?.stops, offer.stops])

  const getLegCityLabel = useCallback((leg: TripBreakdownLeg, endpoint: 'origin' | 'destination') => {
    const code = endpoint === 'origin' ? leg.origin : leg.destination
    if (code === offer.origin) return offer.origin_name
    if (code === offer.destination) return offer.destination_name
    return code
  }, [offer.destination, offer.destination_name, offer.origin, offer.origin_name])

  const getLockedLegButtonLabel = useCallback((leg: 'outbound' | 'inbound') => (
    leg === 'outbound' ? t('unlockOutboundBookingLink') : t('unlockReturnBookingLink')
  ), [t])

  const getLegRouteLabel = useCallback((leg: TripBreakdownLeg | BookingOption) => {
    const departureDate = leg.departure_time ? fmtDate(leg.departure_time) : ''
    const departureTime = leg.departure_time ? fmtTime(leg.departure_time) : '--:--'
    const arrivalTime = leg.arrival_time
      ? fmtTime(leg.arrival_time)
      : '--:--'
    const route = `${leg.origin || '--'} ${departureTime} -> ${leg.destination || '--'} ${arrivalTime}`
    return departureDate ? `${departureDate} · ${route}` : route
  }, [])

  const checkUnlockStatus = useCallback(async (): Promise<boolean> => {
    if (!searchId) return false

    const unlockToken = readStoredUnlockToken(searchId)

    try {
      const res = await fetch(`/api/unlock-status?searchId=${encodeURIComponent(searchId)}`, {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: unlockToken ? { [UNLOCK_TOKEN_HEADER_NAME]: unlockToken } : undefined,
      })
      if (!res.ok) {
        return false
      }

      const data = await res.json() as { unlocked?: boolean }
      return data.unlocked === true
    } catch (_) {
      return false
    }
  }, [searchId])

  const loadBookingLink = useCallback(async (): Promise<boolean> => {
    if (!searchId) return false

    setBookingLinkStatus('loading')
    try {
      const unlockToken = readStoredUnlockToken(searchId)
      // Resolve offer_ref: use the one on the offer, or fetch a fresh one if missing.
      let resolvedOfferRef = offer.offer_ref || offerRef || undefined
      if (!resolvedOfferRef) {
        const snapshotParams = new URLSearchParams({ from: searchId })
        appendProbeParam(snapshotParams, isTestSearch)
        if (offerRef) {
          snapshotParams.set('ref', offerRef)
        }
        try {
          const offerRes = await fetch(
            `/api/offer/${encodeURIComponent(offer.id)}?${snapshotParams.toString()}`,
            {
              cache: 'no-store',
              credentials: 'same-origin',
            },
          )
          if (offerRes.ok) {
            const offerData = await offerRes.json() as { offer_ref?: string }
            resolvedOfferRef = offerData.offer_ref
          }
        } catch (_) {
          // Best-effort — proceed without offer_ref
        }
      }

      const params = new URLSearchParams({
        from: searchId,
        view: 'booking-link',
      })
      appendProbeParam(params, isTestSearch)
      if (resolvedOfferRef) {
        params.set('ref', resolvedOfferRef)
      }
      let res = await fetch(
        `/api/offer/${encodeURIComponent(offer.id)}?${params.toString()}`,
        {
          cache: 'no-store',
          credentials: 'same-origin',
          headers: unlockToken ? { [UNLOCK_TOKEN_HEADER_NAME]: unlockToken } : undefined,
        },
      )

      if (!res.ok && res.status === 404) {
        const latestOfferRef = await fetchLatestOfferRef(searchId, offer.id, isTestSearch)
        if (latestOfferRef && latestOfferRef !== resolvedOfferRef) {
          resolvedOfferRef = latestOfferRef
          const retryParams = new URLSearchParams({
            from: searchId,
            view: 'booking-link',
          })
          appendProbeParam(retryParams, isTestSearch)
          retryParams.set('ref', latestOfferRef)
          res = await fetch(
            `/api/offer/${encodeURIComponent(offer.id)}?${retryParams.toString()}`,
            {
              cache: 'no-store',
              credentials: 'same-origin',
              headers: unlockToken ? { [UNLOCK_TOKEN_HEADER_NAME]: unlockToken } : undefined,
            },
          )
        }
      }

      if (!res.ok) {
        setBookingUrl(null)
        setBookingSite(null)
        setBookingLinkStatus('error')
        return false
      }

      const data = await res.json() as {
        booking_url?: string
        booking_site?: string
        booking_site_summary?: string
        booking_options?: unknown[]
      }
      const options = Array.isArray(data.booking_options)
        ? data.booking_options.filter((option: unknown): option is BookingOption => {
            if (!option || typeof option !== 'object') return false
            const candidate = option as Record<string, unknown>
            return (
              (candidate.leg === 'outbound' || candidate.leg === 'inbound')
              && typeof candidate.airline === 'string'
              && typeof candidate.airline_code === 'string'
              && typeof candidate.booking_url === 'string'
              && candidate.booking_url.length > 0
              && (candidate.booking_site === undefined || typeof candidate.booking_site === 'string')
            )
          })
        : []
      const primaryBookingUrl = typeof data.booking_url === 'string' ? data.booking_url : ''
      const primaryBookingSite = typeof data.booking_site_summary === 'string' && data.booking_site_summary.trim().length > 0
        ? data.booking_site_summary.trim()
        : typeof data.booking_site === 'string' && data.booking_site.trim().length > 0
          ? data.booking_site.trim()
          : ''

      if (!primaryBookingUrl && options.length === 0) {
        setBookingUrl(null)
        setBookingSite(null)
        setBookingOptions([])
        setBookingLinkStatus('error')
        return false
      }

      setBookingUrl(primaryBookingUrl || options[0].booking_url)
      setBookingSite(primaryBookingSite || options[0]?.booking_site || null)
      setBookingOptions(options)
      setBookingLinkStatus('idle')
      if (!bookingLinkTrackedRef.current) {
        bookingLinkTrackedRef.current = true
        trackSearchSessionEvent(analyticsSearchId, 'booking_link_ready', {
          offer_id: offer.id,
        }, {
          source: 'website-checkout',
          source_path: checkoutSourcePath,
          is_test_search: isTestSearch || undefined,
        })
      }
      return true
    } catch (_) {
      setBookingUrl(null)
      setBookingSite(null)
      setBookingOptions([])
      setBookingLinkStatus('error')
      return false
    }
  }, [analyticsSearchId, checkoutSourcePath, isTestSearch, offer.id, offer.offer_ref, offerRef, searchId])

  const loadUnlockedBookingLink = useCallback(async (): Promise<boolean> => {
    for (const delayMs of [0, 200, 600, 1200]) {
      if (delayMs > 0) {
        await wait(delayMs)
      }

      if (!(await checkUnlockStatus())) {
        continue
      }

      if (await loadBookingLink()) {
        return true
      }
    }

    return false
  }, [checkUnlockStatus, loadBookingLink])

  useEffect(() => {
    const handlePageHide = () => {
      trackSearchSessionEvent(analyticsSearchId, 'pagehide_checkout', {
        offer_id: offer.id,
        step: step.type,
      }, {
        source: 'website-checkout',
        source_path: checkoutSourcePath,
        is_test_search: isTestSearch || undefined,
      }, { beacon: true })
    }

    window.addEventListener('pagehide', handlePageHide)
    return () => window.removeEventListener('pagehide', handlePageHide)
  }, [analyticsSearchId, checkoutSourcePath, isTestSearch, offer.id, step.type])

  // ── On mount: verify payment redirect OR consume email token OR check stored unlock ────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const stripeSession = params.get('stripe_session')
    const emailToken = params.get('mt')

    if (stripeSession) {
      // Returned from Stripe — verify the payment server-side
      setStep({ type: 'verifying-payment' })
      fetch('/api/checkout/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ stripeSessionId: stripeSession }),
      })
        .then(r => r.json())
        .then(async (data: { unlocked: boolean; unlockToken?: string }) => {
          if (data.unlocked) {
            persistUnlockToken(searchId, data.unlockToken)
            setStep({ type: 'unlocked', via: 'payment' })
            trackSearchSessionEvent(analyticsSearchId, 'payment_verified', {
              offer_id: offer.id,
            }, {
              source: 'website-checkout',
              source_path: checkoutSourcePath,
              is_test_search: isTestSearch || undefined,
              revenue: fee,
            })
            await loadUnlockedBookingLink()
            // Clean the stripe_session param from the URL without a reload
            const url = new URL(window.location.href)
            url.searchParams.delete('stripe_session')
            window.history.replaceState({}, '', url.toString())
          } else {
            setStep({ type: 'locked' })
          }
        })
        .catch(() => setStep({ type: 'locked' }))
      return
    }

    if (!searchId) {
      setStep({ type: 'locked' })
      return
    }

    // Email single-use token path — consume the mt token to get a website unlock token
    if (emailToken) {
      fetch(
        `/api/monitor/use-email-unlock?token=${encodeURIComponent(emailToken)}&offer_id=${encodeURIComponent(offer.id)}&search_id=${encodeURIComponent(searchId)}`,
        { method: 'POST', credentials: 'same-origin' },
      )
        .then(r => r.ok ? r.json() : Promise.reject(r.status))
        .then(async (data: { unlockToken?: string }) => {
          if (data.unlockToken) {
            persistUnlockToken(searchId, data.unlockToken)
            // Remove mt from URL so refresh/back doesn't try to reuse the token
            const cleanUrl = new URL(window.location.href)
            cleanUrl.searchParams.delete('mt')
            window.history.replaceState({}, '', cleanUrl.toString())
          }
          // Fall through to regular unlock check (which will find the stored token)
          const unlocked = await checkUnlockStatus()
          if (unlocked) {
            setStep({ type: 'unlocked', via: 'existing' })
            await loadUnlockedBookingLink()
          } else {
            setStep({ type: 'locked' })
          }
        })
        .catch(async () => {
          // Token was invalid/used — fall back to normal unlock check
          const unlocked = await checkUnlockStatus()
          if (unlocked) {
            setStep({ type: 'unlocked', via: 'existing' })
            await loadUnlockedBookingLink()
          } else {
            setStep({ type: 'locked' })
          }
        })
      return
    }

    // Server-side unlock check — always authoritative
    checkUnlockStatus()
      .then(async (unlocked) => {
        if (unlocked) {
          setStep({ type: 'unlocked', via: 'existing' })
          trackSearchSessionEvent(analyticsSearchId, 'existing_unlock', {
            offer_id: offer.id,
          }, {
            source: 'website-checkout',
            source_path: checkoutSourcePath,
            is_test_search: isTestSearch || undefined,
          })
          await loadUnlockedBookingLink()
          return
        }
        setStep({ type: 'locked' })
      })
      .catch(() => setStep({ type: 'locked' }))
  }, [analyticsSearchId, checkUnlockStatus, checkoutSourcePath, fee, isTestSearch, loadUnlockedBookingLink, offer.id, searchId])

  // ── Pay via Stripe ───────────────────────────────────────────────────────
  const handlePay = useCallback(async () => {
    trackSearchSessionEvent(analyticsSearchId, 'payment_attempted', {
      offer_id: offer.id,
      airline: offer.airline,
      currency: offer.currency,
      price: offer.price,
    }, {
      source: 'website-checkout',
      source_path: checkoutSourcePath,
      is_test_search: isTestSearch || undefined,
      potential_revenue: fee,
    })
    setStep({ type: 'paying' })
    try {
      const res = await fetch('/api/checkout/create-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offerId: offer.id,
          searchId: searchId ?? '',
          probe: isTestSearch ? '1' : undefined,
        }),
      })
      const data = await res.json()
      if (data.url) {
        trackSearchSessionEvent(analyticsSearchId, 'checkout_opened', {
          offer_id: offer.id,
          airline: offer.airline,
          currency: offer.currency,
          price: offer.price,
        }, {
          source: 'website-checkout',
          source_path: checkoutSourcePath,
          is_test_search: isTestSearch || undefined,
          selected_offer_id: offer.id,
          selected_offer_airline: offer.airline,
          selected_offer_currency: offer.currency,
          selected_offer_price: offer.price,
          potential_revenue: fee,
        }, { beacon: true })
        window.location.href = data.url
      } else {
        setStep({ type: 'locked' })
      }
    } catch (_) {
      setStep({ type: 'locked' })
    }
  }, [analyticsSearchId, checkoutSourcePath, fee, isTestSearch, offer, searchId])

  return (
    <div className="ck-page">
      <div className="ck-inner">

        {/* ── Flight summary card ─────────────────────────────────────────── */}
        <div className="ck-flight-card">
          <div className="ck-flight-header">
            <HiddenAirlineLogo />
            <div className="ck-flight-airline">
              <span className="ck-airline-name">{getAirlineCategory(offer.airline_code)}</span>
              <span className="ck-airline-cabin">Economy class</span>
            </div>
            <div className="ck-flight-price-badge">
              <span className="ck-flight-price">{displayCurrency}{Math.round(convertCurrencyAmount(withFee(offer.price, offer.currency), offer.currency, displayCurrency, fxRates))}</span>
              <span className="ck-flight-price-label">{t('perPerson')}</span>
            </div>
          </div>

          <div className="ck-flight-routes">
            {summaryLegs.map((leg) => {
              const stops = getLegStops(leg)
              const durationLabel = leg.duration_minutes > 0 ? fmtDuration(leg.duration_minutes) : '--'
              const hasArrival = leg.duration_minutes > 0 || leg.arrival_time !== leg.departure_time
              const arrivalLabel = hasArrival ? fmtTime(leg.arrival_time) : '--:--'
              const legCtx = leg.departure_time && leg.arrival_time && leg.duration_minutes > 0
                ? computeFlightTimeContext(leg.departure_time, leg.arrival_time, leg.duration_minutes)
                : null

              return (
                <div className="ck-flight-route-block" key={`${leg.leg}-${leg.departure_time}-${leg.arrival_time}`}>
                  {summaryLegs.length > 1 && (
                    <div className="ck-flight-route-topline">
                      <span className="ck-leg-label">{getLegTitle(leg.leg)}</span>
                      <span className="ck-flight-route-date">{fmtDate(leg.departure_time)}</span>
                    </div>
                  )}

                  <div className="ck-flight-route">
                    <div className="ck-endpoint">
                      <span className="ck-time">{fmtTime(leg.departure_time)}</span>
                      <span className="ck-iata">{leg.origin}</span>
                      <span className="ck-city">{getLegCityLabel(leg, 'origin')}</span>
                    </div>

                    <div className="ck-path">
                      <span className="ck-duration">{durationLabel}</span>
                      <div className="ck-path-line">
                        <span className="ck-path-dot" />
                        <span className="ck-path-track" />
                        {stops === 0 && <span className="ck-direct-label">Direct</span>}
                        {stops > 0 && <span className="ck-stop-dot" />}
                        <span className="ck-path-track" />
                        <span className="ck-path-dot" />
                      </div>
                      {stops > 0 && (
                        <span className="ck-stops-label">{stops} stop{stops > 1 ? 's' : ''}</span>
                      )}
                    </div>

                    <div className="ck-endpoint ck-endpoint--right">
                      <span className="ck-time">
                        {arrivalLabel}
                        {legCtx && legCtx.dayOffset > 0 && (
                          <span className="ck-day-badge" title={legCtx.dayOffset === 1 ? 'Arrives next day' : `Arrives +${legCtx.dayOffset} days`}>
                            +{legCtx.dayOffset}
                          </span>
                        )}
                      </span>
                      <span className="ck-iata">{leg.destination}</span>
                      <span className="ck-city">{getLegCityLabel(leg, 'destination')}</span>
                      {legCtx && Math.abs(legCtx.tzOffsetMins) >= 30 && (
                        <span className="ck-tz-note" title={`Local airport times · destination is ${Math.abs(legCtx.tzOffsetMins)} min ${legCtx.tzOffsetMins < 0 ? 'behind' : 'ahead'}`}>
                          {fmtTzOffset(legCtx.tzOffsetMins)} tz
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="ck-flight-meta">
            <span>{summaryDates.join(' · ')}</span>
            <span className="ck-meta-dot">·</span>
            <span>{t('onePassenger')}</span>
            <span className="ck-meta-dot">·</span>
            <span>{t('economy')}</span>
          </div>
        </div>

        {/* ── Unlocked success banner ─────────────────────────────────────── */}
        {isLoading && (
          <div className="ck-checking-banner">
            <span className="ck-spinner ck-spinner--sm" aria-hidden="true" />
            <span className="ck-checking-text">
              {step.type === 'verifying-payment' ? t('verifyingPayment') : t('checkingUnlock')}
            </span>
          </div>
        )}

        {isUnlocked && (
          <div className="ck-unlocked-banner">
            <span className="ck-unlocked-check"><CheckIcon /></span>
            <div>
              <div className="ck-unlocked-title">
                {step.via === 'existing'
                  ? t('dealUnlockedExisting')
                  : t('dealUnlocked')}
              </div>
              <div className="ck-unlocked-sub">
                {t('bookingLinkReady')}
              </div>
              {bookingSite && (
                <div className="ck-unlocked-source">Deal from {bookingSite}</div>
              )}
            </div>
          </div>
        )}

        {/* Countdown timer — sticky below flight card, variant B only */}
        {countdownVariant === 'countdown' && (
          <CheckoutCountdown
            isUnlocked={isUnlocked}
            onExpired={() => {
              // Redirect back to search results if we have a searchId, otherwise home
              if (searchId) {
                window.location.href = `/results/${encodeURIComponent(searchId)}`
              } else {
                window.location.href = homeHref
              }
            }}
          />
        )}

        {/* ── Checkout card ───────────────────────────────────────────────── */}
        <div className="ck-checkout-card">
          <div className="ck-unified-body">

            {/* Price breakdown — always visible */}
            <div className="ck-price-breakdown">
              <div className="ck-price-row">
                <span className="ck-price-label">{t('airlineTicket')}</span>
                <span className="ck-price-value">{displayCurrency}{Math.round(displayPrice * 100) / 100}</span>
              </div>
              <div className="ck-price-row">
                <span className="ck-price-label">{t('letsfgFee')}</span>
                <span className="ck-price-value">{fmtFee(displayFee, displayCurrency)}</span>
              </div>
              <div className="ck-price-row ck-price-row--total">
                <span className="ck-price-label">{t('total')}</span>
                <span className="ck-price-value">{displayCurrency}{Math.round(convertCurrencyAmount(withFee(offer.price, offer.currency), offer.currency, displayCurrency, fxRates))}</span>
              </div>
            </div>

            {/* ── Comparison: what you'd pay elsewhere ────────────────── */}
            <div className="ck-elsewhere">
              <div className="ck-elsewhere-heading">What you'd pay on popular travel sites</div>
              <div className="ck-elsewhere-rows">
                {([
                  ['Popular flight aggregator', 1.10],
                  ['Leading booking platform',  1.17],
                  ['Full-service travel site',  1.24],
                ] as [string, number][]).map(([label, factor]) => (
                  <div className="ck-elsewhere-row" key={label}>
                    <span className="ck-elsewhere-site">{label}</span>
                    <span className="ck-elsewhere-price">
                      {displayCurrency}{Math.round(convertCurrencyAmount(offer.price * factor, offer.currency, displayCurrency, fxRates))}
                    </span>
                  </div>
                ))}
                <div className="ck-elsewhere-row ck-elsewhere-row--ours">
                  <span className="ck-elsewhere-site ck-elsewhere-site--ours">
                    <svg viewBox="0 0 20 20" fill="none" width="13" height="13" aria-hidden="true">
                      <path d="M4 10l4.5 4.5L16 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    LetsFG total
                  </span>
                  <span className="ck-elsewhere-price ck-elsewhere-price--ours">
                    {displayCurrency}{Math.round(convertCurrencyAmount(withFee(offer.price, offer.currency), offer.currency, displayCurrency, fxRates))}
                  </span>
                </div>
              </div>
              <p className="ck-elsewhere-note">
                Travel sites typically add demand-based markups, add OTA fees on top, or just don't have everything. LetsFG compares the prices from ALL the websites in the world — scanning both your favourite sites and those you didn't even know existed.
              </p>
            </div>

            {splitBookingLegs.length > 0 ? (
              /* ── Split booking: per-leg action cards ── */
              <>
                {!isUnlocked && !isLoading && (
                  <div className="ck-fee-note">{t('oneTimeUnlocksAll')}</div>
                )}
                {/* Single unlock button — shown only when locked */}
                {!isLoading && !isUnlocked && (
                  <button
                    className={`ck-book-btn ck-book-btn--active${step.type === 'paying' ? ' ck-pay-btn--loading' : ''}`}
                    onClick={handlePay}
                    disabled={step.type === 'paying'}
                  >
                    {step.type === 'paying' ? (
                      <><span className="ck-spinner" aria-hidden="true" />{t('processing')}</>
                    ) : (
                      <><LockIcon />{t('unlockBookingLink')} · {fmtFee(displayFee, displayCurrency)}</>
                    )}
                  </button>
                )}
                <div className="ck-book-actions">
                  {splitBookingLegs.map((leg) => {
                    const legPrice = typeof leg.price === 'number' ? leg.price : null
                    const hasBookingUrl = typeof leg.booking_url === 'string' && leg.booking_url.length > 0
                    return (
                      <div className="ck-book-action-card" key={`${leg.leg}-${leg.airline}-${leg.departure_time}`}>
                        <div className="ck-book-action-meta">
                          <div className="ck-book-action-copy">
                            <span className="ck-book-action-title">{getLegTitle(leg.leg)}</span>
                            <span className="ck-book-action-subtitle">{getLegRouteLabel(leg)}</span>
                            {leg.booking_site && (
                              <span className="ck-book-action-site">Book via {leg.booking_site}</span>
                            )}
                          </div>
                          <span className={`ck-book-action-price${legPrice !== null ? '' : ' ck-leg-price--muted'}`}>
                            {legPrice !== null ? fmtMoney(convertCurrencyAmount(legPrice, leg.currency || offer.currency, displayCurrency, fxRates), displayCurrency) : 'Included in total'}
                          </span>
                        </div>
                        {!isLoading && isUnlocked && (
                          hasBookingUrl ? (
                            <a
                              href={leg.booking_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="ck-book-btn ck-book-btn--active"
                              onClick={() => trackSearchSessionEvent(analyticsSearchId, 'booking_link_opened', {
                                offer_id: offer.id,
                                airline: leg.airline,
                                leg: leg.leg,
                              }, {
                                source: 'website-checkout',
                                source_path: checkoutSourcePath,
                                is_test_search: isTestSearch || undefined,
                                decision: 'booking_link_opened',
                              }, { keepalive: true })}
                            >
                              {getLegButtonLabel(leg.leg)}
                              <ArrowIcon />
                            </a>
                          ) : (
                            <button className="ck-book-btn ck-book-btn--locked" disabled aria-disabled="true">
                              {bookingLinkStatus === 'loading' ? t('processing') : getLegButtonLabel(leg.leg)}
                            </button>
                          )
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            ) : (
              /* ── Standard booking ── */
              <>
                {tripBreakdown.length > 1 && (
                  <div className="ck-leg-breakdown">
                    {tripBreakdown.map((leg) => (
                      <div className="ck-leg-row" key={`${leg.leg}-${leg.airline}-${leg.departure_time}`}>
                        <div className="ck-leg-copy">
                          <span className="ck-leg-label">{getLegTitle(leg.leg)}</span>
                          <span className="ck-leg-route">{getLegRouteLabel(leg)}</span>
                        </div>
                        <div className="ck-leg-price-wrap">
                          <span className={`ck-leg-price${typeof leg.price === 'number' ? '' : ' ck-leg-price--muted'}`}>
                            {typeof leg.price === 'number'
                              ? fmtMoney(convertCurrencyAmount(leg.price, leg.currency || offer.currency, displayCurrency, fxRates), displayCurrency)
                              : 'Included in total'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {!isUnlocked && !isLoading && (
                  <div className="ck-fee-note">{t('oneTimeUnlocksAll')}</div>
                )}

                {!isLoading && (isUnlocked ? (
                  /* Unlocked: show actual booking links */
                  bookingOptions.length > 0 ? (
                    <div className="ck-book-actions">
                      {bookingOptions.map((option) => (
                        <div className="ck-book-action-card" key={`${option.leg}-${option.airline}-${option.booking_url}`}>
                          {(option.origin || option.destination) && (
                            <div className="ck-book-action-meta">
                              <div className="ck-book-action-copy">
                                <span className="ck-book-action-title">{getLegTitle(option.leg)}</span>
                                <span className="ck-book-action-subtitle">{getLegRouteLabel(option)}</span>
                                {option.booking_site && (
                                  <span className="ck-book-action-site">Book via {option.booking_site}</span>
                                )}
                              </div>
                              {typeof option.price === 'number' && (
                                <span className="ck-book-action-price">{fmtMoney(convertCurrencyAmount(option.price, option.currency || offer.currency, displayCurrency, fxRates), displayCurrency)}</span>
                              )}
                            </div>
                          )}
                          <a
                            href={option.booking_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ck-book-btn ck-book-btn--active"
                            onClick={() => trackSearchSessionEvent(analyticsSearchId, 'booking_link_opened', {
                              offer_id: offer.id,
                              airline: option.airline,
                              leg: option.leg,
                            }, {
                              source: 'website-checkout',
                              source_path: checkoutSourcePath,
                              is_test_search: isTestSearch || undefined,
                              decision: 'booking_link_opened',
                            }, { keepalive: true })}
                          >
                            {getLegButtonLabel(option.leg)}
                            <ArrowIcon />
                          </a>
                        </div>
                      ))}
                    </div>
                  ) : bookingUrl ? (
                    <a
                      href={bookingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ck-book-btn ck-book-btn--active"
                      onClick={() => trackSearchSessionEvent(analyticsSearchId, 'booking_link_opened', {
                        offer_id: offer.id,
                        airline: offer.airline,
                      }, {
                        source: 'website-checkout',
                        source_path: checkoutSourcePath,
                        is_test_search: isTestSearch || undefined,
                        decision: 'booking_link_opened',
                      }, { keepalive: true })}
                    >
                      Book flight
                      <ArrowIcon />
                    </a>
                  ) : (
                    /* Unlocked but booking link still loading */
                    tripBreakdown.length > 1 ? (
                      <div className="ck-book-actions">
                        {tripBreakdown.map((leg) => (
                          <button key={`${leg.leg}-${leg.airline}`} className="ck-book-btn ck-book-btn--locked" disabled aria-disabled="true">
                            {bookingLinkStatus === 'loading' ? t('processing') : getLegButtonLabel(leg.leg)}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <button className="ck-book-btn ck-book-btn--locked" disabled aria-disabled="true">
                        {bookingLinkStatus === 'loading' ? t('processing') : 'Book flight'}
                      </button>
                    )
                  )
                ) : (
                  /* Locked: single Stripe checkout button */
                  <button
                    className={`ck-book-btn ck-book-btn--active${step.type === 'paying' ? ' ck-pay-btn--loading' : ''}`}
                    onClick={handlePay}
                    disabled={step.type === 'paying'}
                  >
                    {step.type === 'paying' ? (
                      <><span className="ck-spinner" aria-hidden="true" />{t('processing')}</>
                    ) : (
                      <><LockIcon />{t('unlockBookingLink')} · {fmtFee(displayFee, displayCurrency)}</>
                    )}
                  </button>
                ))}

              </>
            )}

            <div className="ck-guarantee-row">
              <span className="ck-guarantee-item">
                <CheckIcon /> {t('rawAirlinePrice')}
              </span>
              <span className="ck-guarantee-item">
                <CheckIcon /> {t('secureCheckout')}
              </span>
              <span className="ck-guarantee-item">
                <CheckIcon /> {t('noHiddenFees')}
              </span>
            </div>
          </div>
        </div>

        {/* ── Support line ───────────────────────────────────────────────── */}
        <div className="ck-support-line">
          Need help?{' '}
          <a href="mailto:contact@letsfg.co" className="ck-support-link">contact@letsfg.co</a>
          <span className="ck-meta-dot">·</span>
          <a href="https://x.com/amjaworsky" target="_blank" rel="noreferrer" className="ck-support-link">Message on X</a>
        </div>

        {/* ── Trust footer ────────────────────────────────────────────────── */}
        <div className="ck-trust-footer">
          <a
            href={homeHref}
            target="_blank"
            rel="noreferrer"
            className="ck-trust-link ck-trust-brand"
            onClick={() => trackSearchSessionEvent(analyticsSearchId, 'navigate_home', {}, {
              source: 'website-checkout',
              source_path: checkoutSourcePath,
              is_test_search: isTestSearch || undefined,
            }, { keepalive: true })}
          >LetsFG</a>
          <span className="ck-meta-dot">·</span>
          <a href="https://instagram.com/letsfg_" target="_blank" rel="noreferrer" className="ck-trust-link">Instagram</a>
          <span className="ck-meta-dot">·</span>
          <a href="https://www.tiktok.com/@letsfg_" target="_blank" rel="noreferrer" className="ck-trust-link">TikTok</a>
          <span className="ck-meta-dot">·</span>
          <a href="https://twitter.com/LetsFG_" target="_blank" rel="noreferrer" className="ck-trust-link">Twitter / X</a>
        </div>

      </div>

      {/* ── Booking friction survey (bottom slide-up, after 3 min on checkout) ── */}
      {!isUnlocked && !isLoading && showShareOption && step.type !== 'paying' && (
        <BookingFrictionSurvey
          searchId={analyticsSearchId}
          offerId={offer.id}
          isTestSearch={isTestSearch}
          context="checkout"
        />
      )}
    </div>
  )
}
