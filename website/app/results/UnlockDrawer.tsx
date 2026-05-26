'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { calculateFee } from '../../lib/pricing'
import { convertCurrencyAmount, type FxRateTable } from '../../lib/display-price'
import { formatCurrencyAmount } from '../../lib/user-currency'
import { formatFlightTime } from '../../lib/flight-datetime'

// Full offer shape the drawer needs — matches what /api/results/[searchId]
// now ships per-offer (since the route was updated to include ancillaries
// + flight_number inline, no second fetch required).
interface BasicOffer {
  id: string
  price: number
  /** Encoded snapshot of the full TrustedOffer (price, currency, ancillaries,
   *  booking_url, etc.) signed server-side. We forward it to
   *  /api/checkout/create-session so the route can reconstruct the offer
   *  without depending on the in-memory cache OR a live FSW lookup. Without
   *  this we'd 404 whenever the search session has rolled over to a
   *  different Cloud Run instance or the cache was cold. */
  offer_ref?: string
  /** Comparable price scraped from Google Flights for the same route+dates.
   *  When present, we surface "You saved €X vs Google Flights" in the
   *  unlocked state. */
  google_flights_price?: number
  currency: string
  airline: string
  airline_code: string
  flight_number?: string
  origin: string
  destination: string
  departure_time: string
  arrival_time: string
  duration_minutes: number
  stops: number
  /** Round-trip return leg. Same fields as the outbound, mirrored. */
  inbound?: {
    origin?: string
    destination?: string
    departure_time?: string
    arrival_time?: string
    duration_minutes?: number
    stops?: number
    airline?: string
  }
  ancillaries?: {
    cabin_bag?: { included?: boolean; price?: number; currency?: string; description?: string }
    checked_bag?: { included?: boolean; price?: number; currency?: string; description?: string }
    seat_selection?: { included?: boolean; price?: number; currency?: string; description?: string }
  }
}

export interface UnlockDrawerProps {
  /** The card that was clicked — provides immediate visual context before
   *  the full PublicOffer fetch resolves. Null = drawer is closed. */
  offer: BasicOffer | null
  searchId: string
  displayCurrency: string
  fxRates: FxRateTable
  /** From URL r_baggage param: '1_bag' / '2_bags' opt the user IN to the
   *  bag line being added to the total. Others (carry_on / unsure / null)
   *  show the line muted (not in total). */
  baggageChoice: string | null
  /** From URL r_seat_selection: 'pick' / 'together' opts the user IN. */
  seatChoice: string | null
  /** App locale (from useLocale()) — used for date formatting so we never
   *  fall through to the browser's locale and end up with stray Polish/
   *  German strings on the English version of the site. */
  locale: string
  /** Probe mode — passed through to create-session so probe searches don't
   *  accidentally bill the user (the existing `probe` query string convention). */
  probeMode: boolean
  /** When ResultsClient detects `?unlocked=<id>&stripe_session=<sid>` in the
   *  URL after a Stripe redirect, it opens the drawer for that offer with
   *  this prop set. Drawer then calls /api/checkout/verify and morphs into
   *  the booking-link state. Null on the normal pre-unlock open path. */
  verifyStripeSession?: string | null
  /** True when the SSR cookie check (or a successful in-session verify)
   *  has confirmed this search is already unlocked. The drawer skips the
   *  Stripe flow entirely and fetches the booking link directly. */
  isAlreadyUnlocked: boolean
  /** Called once /api/checkout/verify succeeds — lets ResultsClient flip
   *  its own isUnlocked flag so the NEXT drawer open (different offer in
   *  the same search) also skips the Stripe flow without a page refresh. */
  onUnlocked: () => void
  onMonitor?: () => void
  onClose: () => void
}

interface BookingLinkResponse {
  booking_url: string
  booking_site?: string
  booking_options?: Array<{
    leg?: string
    airline?: string
    airline_code?: string
    booking_url?: string
    booking_site?: string
  }>
}

function fmtTime(iso: string, _locale: string): string {
  // Routes through the shared lib/flight-datetime formatter — required by
  // tests/flight-time-surfaces.test.ts. The flight-time formatter is
  // locale-independent by design (UTC, 24h) so we ignore the locale arg.
  return formatFlightTime(iso)
}

function fmtDate(iso: string, locale: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString(locale, { day: 'numeric', month: 'long' })
  } catch {
    return ''
  }
}

function fmtDuration(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

function stopsLabel(stops: number, t: ReturnType<typeof useTranslations>): string {
  if (stops === 0) return t('stops_direct')
  if (stops === 1) return t('stops_one')
  return t('stops_many', { count: stops })
}

const BAG_OPTED_IN = new Set(['1_bag', '2_bags'])
const SEAT_OPTED_IN = new Set(['pick', 'together'])

// Must match the CSS transition duration in globals.css (.udrw-sheet).
// Used to delay the unmount so the slide-down transition gets to play out.
const SHEET_TRANSITION_MS = 320

export default function UnlockDrawer({
  offer,
  searchId,
  displayCurrency,
  fxRates,
  baggageChoice,
  seatChoice,
  locale,
  probeMode,
  verifyStripeSession,
  isAlreadyUnlocked,
  onUnlocked,
  onMonitor,
  onClose,
}: UnlockDrawerProps) {
  const t = useTranslations('Drawer')
  // stopsLabel reads from the Results namespace (shared across cards).
  const tResults = useTranslations('Results')
  // Animation state machine — CSS transitions drive the motion (not
  // keyframes; keyframes were swapping mid-flight when the user opened+
  // closed quickly, causing a visible snap to translateY(0) before the
  // close slide began). With a transition, the close slide-down always
  // interpolates from the sheet's *current computed transform*, so even
  // mid-open closes are smooth.
  //
  //   - `mounted` controls whether the DOM nodes exist at all.
  //   - `open` controls the --open modifier (transform: translateY(0)).
  //
  // Open path:
  //   1. offer set → setMounted(true) → React inserts the sheet with the
  //      default closed transform (translateY(100%)).
  //   2. useLayoutEffect forces a reflow (offsetHeight read) so the
  //      browser commits the initial closed style to the layout tree.
  //   3. setOpen(true) → React re-renders with --open class →
  //      transform changes to translateY(0) → transition interpolates.
  //
  // Close path:
  //   1. offer cleared → setOpen(false) → transform reverts to
  //      translateY(100%) → transition interpolates from current value.
  //   2. After 320ms (matches the CSS duration) → setMounted(false).
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)
  const lastOfferRef = useRef<BasicOffer | null>(null)
  if (offer) lastOfferRef.current = offer  // keep last offer for the close animation
  const offerForRender = offer ?? lastOfferRef.current

  // High-level state machine driven by the `offer` prop.
  useEffect(() => {
    if (offer) {
      setMounted(true)
      // setOpen(true) happens in useLayoutEffect below, AFTER the initial
      // closed state is committed via forced reflow. Setting it here would
      // batch the open + closed states into a single commit and the
      // transition would have nothing to interpolate from.
      return
    }
    // Closing: animate the existing element off-screen, then unmount.
    setOpen(false)
    const t = setTimeout(() => setMounted(false), SHEET_TRANSITION_MS)
    return () => clearTimeout(t)
  }, [offer])

  const sheetRef = useRef<HTMLDivElement>(null)
  // Two-step open: insertion paints the closed state, then we flip --open
  // in a useLayoutEffect after forcing a reflow. The reflow is the magic
  // that decouples the two paints so the transition actually fires.
  useLayoutEffect(() => {
    if (mounted && offer && !open && sheetRef.current) {
      // Reading offsetHeight forces the browser to flush layout for the
      // just-inserted element in its closed (translateY(100%)) position.
      // Without this, React's next render would batch the open state into
      // the same commit and the transition would have no starting point.
      void sheetRef.current.offsetHeight
      setOpen(true)
    }
  }, [mounted, offer, open])

  const [isUnlocking, setIsUnlocking] = useState(false)
  const [unlockError, setUnlockError] = useState<string | null>(null)
  // Stable ref so the verify/link effects don't need onUnlocked in their
  // deps — inline arrow functions in JSX create a new reference every render,
  // which would cancel the in-flight verify on every polling update.
  const onUnlockedRef = useRef(onUnlocked)
  onUnlockedRef.current = onUnlocked

  // Post-Stripe-redirect lifecycle:
  //   'idle'      — pre-unlock state, breakdown + CTA visible
  //   'verifying' — calling /api/checkout/verify with the stripe_session ID
  //   'unlocked'  — verify succeeded, booking link revealed
  //   'failed'    — verify failed (rare: cookie missing, Stripe error)
  const [unlockState, setUnlockState] = useState<'idle' | 'verifying' | 'unlocked' | 'failed'>('idle')
  const [bookingLink, setBookingLink] = useState<BookingLinkResponse | null>(null)
  const [verifyError, setVerifyError] = useState<string | null>(null)

  // Reset state whenever the targeted offer changes. No separate fetch
  // needed — the offer payload from /api/results already includes
  // ancillaries + flight_number, so the breakdown renders instantly.
  useEffect(() => {
    if (!offer) {
      setIsUnlocking(false)
      setUnlockError(null)
      setUnlockState('idle')
      setBookingLink(null)
      setVerifyError(null)
      // Reset single-fire refs so the next open of a different offer
      // can run verify / fetch-booking-link cleanly.
      verifyStartedForRef.current = null
      linkStartedForRef.current = null
    }
  }, [offer])

  // Post-Stripe-redirect: when the drawer opens with a `verifyStripeSession`,
  // call /api/checkout/verify to record the unlock cookie server-side, then
  // fetch the booking link(s) and morph the drawer into the unlocked state.
  //
  // CRITICAL: `offer` must NOT be in deps. The Stripe-return flow opens the
  // drawer with a lightweight placeholder first, then a background fetch
  // swaps in the real offer data. If `offer` were a dep, that swap would run
  // the effect cleanup → set `cancelled = true` → kill the in-flight verify,
  // leaving the drawer stuck on "Confirming…" forever. We capture offer.id
  // at fire-time and read the latest offer_ref from lastOfferRef so we get
  // the real ref once the background fetch lands.
  const verifyStartedForRef = useRef<string | null>(null)
  useEffect(() => {
    if (!offer || !verifyStripeSession) return
    const offerId = offer.id
    const key = `${offerId}|${verifyStripeSession}`
    if (verifyStartedForRef.current === key) return
    verifyStartedForRef.current = key
    let cancelled = false
    setUnlockState('verifying')
    setVerifyError(null)
    ;(async () => {
      try {
        const verifyRes = await fetch('/api/checkout/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stripeSessionId: verifyStripeSession }),
        })
        const verifyData = await verifyRes.json().catch(() => null) as { unlocked?: boolean; error?: string } | null
        if (cancelled) return
        if (!verifyRes.ok || !verifyData?.unlocked) {
          setVerifyError(verifyData?.error ?? t('couldNotVerify'))
          setUnlockState('failed')
          return
        }
        // Unlock cookie is now set — fetch the booking link.
        // Read offer_ref from lastOfferRef so we pick up the real ref if the
        // background fetch finished while verify was in-flight (placeholder
        // won't have offer_ref; the real offer will).
        const linkParams = new URLSearchParams({ from: searchId, view: 'booking-link' })
        const latestRef = lastOfferRef.current?.offer_ref
        if (latestRef) linkParams.set('ref', latestRef)
        const linkRes = await fetch(
          `/api/offer/${encodeURIComponent(offerId)}?${linkParams.toString()}`,
          { cache: 'no-store' },
        )
        const linkData = await linkRes.json().catch(() => null) as BookingLinkResponse | null
        if (cancelled) return
        if (!linkRes.ok || !linkData?.booking_url) {
          setVerifyError(t('errorPaymentConfirmed'))
          setUnlockState('failed')
          return
        }
        setBookingLink(linkData)
        setUnlockState('unlocked')
        // Tell parent so subsequent drawer opens for other offers in the
        // same search skip the Stripe flow without a refresh.
        onUnlockedRef.current()
      } catch (e) {
        if (cancelled) return
        setVerifyError(e instanceof Error ? e.message : t('errorVerifyNetwork'))
        setUnlockState('failed')
      }
    })()
    return () => {
      cancelled = true
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verifyStripeSession, searchId])

  // Search already unlocked (from a previous successful Stripe payment in
  // this browser): skip the breakdown + CTA entirely, fetch the booking
  // link directly. Only fires when there's NO verifyStripeSession (that
  // path is handled by the verify-then-fetch effect above).
  // Same single-fire ref pattern to avoid self-cancellation.
  const linkStartedForRef = useRef<string | null>(null)
  useEffect(() => {
    if (!offer || !isAlreadyUnlocked || verifyStripeSession) return
    if (linkStartedForRef.current === offer.id) return
    linkStartedForRef.current = offer.id
    let cancelled = false
    setUnlockState('verifying')
    ;(async () => {
      try {
        // Same offer_ref forwarding as the post-Stripe path above — this
        // effect fires for every offer the user opens once the search is
        // unlocked, so missing the ref was the exact bug behind the wave
        // of "Offer not found" 404s after returning from Stripe.
        const linkParams = new URLSearchParams({ from: searchId, view: 'booking-link' })
        if (offer.offer_ref) linkParams.set('ref', offer.offer_ref)
        const linkRes = await fetch(
          `/api/offer/${encodeURIComponent(offer.id)}?${linkParams.toString()}`,
          { cache: 'no-store' },
        )
        const linkData = await linkRes.json().catch(() => null) as BookingLinkResponse | null
        if (cancelled) return
        if (!linkRes.ok || !linkData?.booking_url) {
          setVerifyError(t('errorFetchBookingLink'))
          setUnlockState('failed')
          return
        }
        setBookingLink(linkData)
        setUnlockState('unlocked')
      } catch (e) {
        if (cancelled) return
        setVerifyError(e instanceof Error ? e.message : t('errorNetwork'))
        setUnlockState('failed')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [offer, isAlreadyUnlocked, verifyStripeSession, searchId])

  // ESC dismisses; body scroll locks while open. Standard modal hygiene.
  useEffect(() => {
    if (!mounted) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [mounted, onClose])

  // Click outside the sheet (on the backdrop) dismisses.
  const onBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) onClose()
    },
    [onClose],
  )

  // ── Price math (all in displayCurrency, fxConverted from offer currency) ──
  // Uses offerForRender so the breakdown stays visible during the 320ms
  // slide-down animation when `offer` has already gone null.
  const breakdown = useMemo(() => {
    if (!offerForRender) return null
    const src = offerForRender
    const offerCur = (src.currency || displayCurrency).toUpperCase()
    const conv = (amount: number, fromCur: string) =>
      convertCurrencyAmount(amount, fromCur || offerCur, displayCurrency, fxRates)

    const baseFare = conv(src.price, offerCur)
    const anc = src.ancillaries
    const bagAnc = anc?.checked_bag
    const seatAnc = anc?.seat_selection
    const bagAvail = !!bagAnc && bagAnc.included !== true && typeof bagAnc.price === 'number' && bagAnc.price > 0
    const seatAvail = !!seatAnc && seatAnc.included !== true && typeof seatAnc.price === 'number' && seatAnc.price > 0

    const bagCost = bagAvail ? conv(bagAnc!.price!, bagAnc!.currency || offerCur) : 0
    const seatCost = seatAvail ? conv(seatAnc!.price!, seatAnc!.currency || offerCur) : 0

    const bagOptedIn = baggageChoice != null && BAG_OPTED_IN.has(baggageChoice)
    const seatOptedIn = seatChoice != null && SEAT_OPTED_IN.has(seatChoice)

    const bagInTotal = bagOptedIn && bagAvail
    const seatInTotal = seatOptedIn && seatAvail

    const airlineSubtotal = Math.round(
      (baseFare + (bagInTotal ? bagCost : 0) + (seatInTotal ? seatCost : 0)) * 100,
    ) / 100
    const unlockFee = Math.round(calculateFee(airlineSubtotal, displayCurrency) * 100) / 100
    // Grand total shown in the breakdown — everything the user will pay
    // across both Stripe (unlock fee) AND the airline (ticket + ancillaries).
    const grandTotal = Math.round((airlineSubtotal + unlockFee) * 100) / 100

    return {
      baseFare,
      bagAvail,
      bagCost,
      bagInTotal,
      seatAvail,
      seatCost,
      seatInTotal,
      airlineSubtotal,
      unlockFee,
      grandTotal,
    }
  }, [offerForRender, displayCurrency, fxRates, baggageChoice, seatChoice])

  // Savings vs Google Flights — shown as the green banner in the unlocked
  // state. We compare what the user actually pays (grandTotal = airline
  // total + LetsFG concierge fee) against the Google Flights price (also
  // an all-in airline total per their convention). Only positive savings
  // surface; if we'd cost more we just don't show the banner.
  const googleSavings = useMemo(() => {
    if (!offerForRender || !breakdown) return null
    const gf = offerForRender.google_flights_price
    if (typeof gf !== 'number' || gf <= 0) return null
    const offerCur = (offerForRender.currency || displayCurrency).toUpperCase()
    const gfInDisplay = convertCurrencyAmount(gf, offerCur, displayCurrency, fxRates)
    const diff = Math.round(gfInDisplay - breakdown.grandTotal)
    if (diff <= 0) return null
    return { amount: diff, comparedTo: 'Google Flights' as const }
  }, [offerForRender, breakdown, displayCurrency, fxRates])

  // Share — uses the native Web Share API where available (mobile, Safari,
  // newer Chrome). Falls back to clipboard copy + a toast-like alert.
  const handleShare = async () => {
    if (!bookingLink?.booking_url || !offerForRender) return
    const summary =
      `${offerForRender.airline} ${offerForRender.origin}→${offerForRender.destination}` +
      (breakdown ? ` for ${formatCurrencyAmount(breakdown.grandTotal, displayCurrency)}` : '')
    const text = `${summary}. Book here: ${bookingLink.booking_url}`
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        await navigator.share({ title: 'LetsFG flight', text, url: bookingLink.booking_url })
        return
      }
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(text)
        alert(t('alertCopied'))
      }
    } catch {
      // User cancelled native share — ignore.
    }
  }

  const handleMonitor = () => {
    onClose()
    onMonitor?.()
  }

  // Click → POST /api/checkout/create-session with return_to=drawer →
  // backend creates a Stripe Checkout Session whose success_url points
  // back to /results/<searchId>?unlocked=<offerId>&stripe_session=...
  // and cancel_url points back to /results/<searchId> with no extra params.
  // We then send the user to Stripe; the rest of the flow resumes when
  // they come back and ResultsClient re-opens the drawer with verifyStripeSession.
  const handleUnlock = async () => {
    if (!offerForRender) return
    setIsUnlocking(true)
    setUnlockError(null)
    try {
      const res = await fetch('/api/checkout/create-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offerId: offerForRender.id,
          searchId,
          // Snapshot ref lets the backend reconstruct this exact offer even
          // if the in-memory cache has been evicted or FSW has dropped the
          // search session. Without it, create-session 404s on cache misses.
          ...(offerForRender.offer_ref ? { offerRef: offerForRender.offer_ref } : {}),
          returnTo: 'drawer',
          ...(probeMode ? { probe: '1' } : {}),
        }),
      })
      const data = await res.json().catch(() => null) as { url?: string; error?: string } | null
      if (!res.ok || !data?.url) {
        setUnlockError(data?.error ?? t('errorCheckoutStart'))
        setIsUnlocking(false)
        return
      }
      // Full-page redirect to Stripe's hosted checkout.
      window.location.href = data.url
    } catch (e) {
      setUnlockError(e instanceof Error ? e.message : t('errorNetwork'))
      setIsUnlocking(false)
    }
  }

  if (!mounted || !offerForRender) return null

  const src = offerForRender
  const dateHeadline = fmtDate(src.departure_time, locale)
  const flightNumber = src.flight_number
  const airlineLine = flightNumber
    ? `${src.airline} ${flightNumber}${dateHeadline ? ` · ${dateHeadline}` : ''}`
    : `${src.airline}${dateHeadline ? ` · ${dateHeadline}` : ''}`
  const routeLine =
    `${src.origin} ${fmtTime(src.departure_time, locale)} → ${src.destination} ${fmtTime(src.arrival_time, locale)} · ` +
    `${stopsLabel(src.stops, tResults)} · ${fmtDuration(src.duration_minutes)}`

  return (
    <div
      className={`udrw-backdrop${open ? ' udrw-backdrop--open' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="udrw-title"
      onClick={onBackdropClick}
    >
      <div ref={sheetRef} className={`udrw-sheet${open ? ' udrw-sheet--open' : ''}`}>
        <div className="udrw-grabber" aria-hidden="true" />

        {/* Pre-unlock state shows the call-to-action title; once unlocked
            (or verifying after Stripe return) we drop it — the new
            "Your flight is unlocked!" hero takes over below the flight
            summary and the old title would read odd next to it. */}
        {!isAlreadyUnlocked && !verifyStripeSession && unlockState !== 'unlocked' ? (
          <h2 id="udrw-title" className="udrw-title">
            {t('unlockTitle')}
          </h2>
        ) : (
          <span id="udrw-title" className="sr-only">{t('bookingDetailsSr')}</span>
        )}

        {/* ── Flight summary: outbound + (optional) return ───────────── */}
        <div className="udrw-flight">
          <div className="udrw-flight-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />
            </svg>
          </div>
          <div className="udrw-flight-meta">
            <div className="udrw-flight-headline">{airlineLine}</div>
            <div className="udrw-flight-sub">{routeLine}</div>
          </div>
        </div>
        {src.inbound && src.inbound.departure_time && src.inbound.arrival_time ? (
          <div className="udrw-flight udrw-flight--return">
            <div className="udrw-flight-icon udrw-flight-icon--return" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />
              </svg>
            </div>
            <div className="udrw-flight-meta">
              <div className="udrw-flight-headline">
                {t('returnLabel')} · {fmtDate(src.inbound.departure_time, locale)}
              </div>
              <div className="udrw-flight-sub">
                {(src.inbound.origin ?? src.destination)} {fmtTime(src.inbound.departure_time, locale)}
                {' → '}
                {(src.inbound.destination ?? src.origin)} {fmtTime(src.inbound.arrival_time, locale)}
                {' · '}
                {stopsLabel(src.inbound.stops ?? 0, tResults)}
                {typeof src.inbound.duration_minutes === 'number' && src.inbound.duration_minutes > 0
                  ? ` · ${fmtDuration(src.inbound.duration_minutes)}`
                  : ''}
              </div>
            </div>
          </div>
        ) : null}

        {/* ── Price breakdown — hidden when the user has already paid
              (either previously unlocked OR mid-flight verify from a fresh
              Stripe return). In both cases the breakdown is past-context
              and showing "0 USD base fare" with a placeholder offer is
              actively confusing. ─────────────────────────────────────── */}
        {!isAlreadyUnlocked && !verifyStripeSession ? (
          <div className="udrw-section-heading">{t('priceBreakdown')}</div>
        ) : null}

        {breakdown && !isAlreadyUnlocked && !verifyStripeSession ? (
          <div className="udrw-breakdown">
            <BreakdownRow
              label={t('rowBaseFare')}
              amount={breakdown.baseFare}
              currency={displayCurrency}
              included
            />
            {breakdown.bagAvail ? (
              <BreakdownRow
                label={t('rowCheckedBag')}
                amount={breakdown.bagCost}
                currency={displayCurrency}
                included={breakdown.bagInTotal}
                mutedNote={!breakdown.bagInTotal ? t('notAdded') : undefined}
              />
            ) : null}
            {breakdown.seatAvail ? (
              <BreakdownRow
                label={t('rowSeatSelection')}
                amount={breakdown.seatCost}
                currency={displayCurrency}
                included={breakdown.seatInTotal}
                mutedNote={!breakdown.seatInTotal ? t('notAdded') : undefined}
              />
            ) : null}
            <BreakdownRow
              label={t('rowConciergeFee')}
              amount={breakdown.unlockFee}
              currency={displayCurrency}
              included
            />

            <div className="udrw-total-row">
              <span className="udrw-total-label">{t('rowTotal')}</span>
              <span className="udrw-total-amount">
                {formatCurrencyAmount(breakdown.grandTotal, displayCurrency)}
              </span>
            </div>

            <p className="udrw-split-note">
              {t('paymentSplit', {
                fee: formatCurrencyAmount(breakdown.unlockFee, displayCurrency),
                airline: formatCurrencyAmount(breakdown.airlineSubtotal, displayCurrency),
              })}
            </p>
          </div>
        ) : null}

        {/* ── CTA / verifying / unlocked / failed states ─────────────── */}
        {unlockState === 'verifying' ? (
          <div className="udrw-status udrw-status--verifying">
            {verifyStripeSession ? t('confirmingStripe') : t('loadingBookingLink')}
          </div>
        ) : unlockState === 'unlocked' && bookingLink ? (
          <>
            {/* Hero: big checkmark + "Your flight is unlocked!" + a friendly
                line of context. Replaces the old single-line green banner. */}
            <div className="udrw-unlocked-hero">
              <div className="udrw-unlocked-check" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <h3 className="udrw-unlocked-title">{t('unlockedHeroTitle')}</h3>
              <p className="udrw-unlocked-sub">{t('unlockedHeroSubtitle')}</p>
            </div>

            {breakdown ? (
              <div className="udrw-unlocked-total">
                {t('totalAtAirline')}{' '}
                <strong>{formatCurrencyAmount(breakdown.airlineSubtotal, displayCurrency)}</strong>
              </div>
            ) : null}

            {/* Single booking link: one primary CTA.
                Virtual-interlining (multiple legs, multiple links): drop
                the single CTA entirely and use the leg-specific buttons
                AS the primary CTAs — same orange-filled style, stacked.
                Avoids the confusing "Open booking link" + "Or open each
                leg separately" double-stack the user flagged. */}
            {Array.isArray(bookingLink.booking_options) && bookingLink.booking_options.length > 1 ? (
              <div className="udrw-leg-ctas">
                {bookingLink.booking_options.map((opt, i) =>
                  opt.booking_url ? (
                    <a
                      key={i}
                      href={opt.booking_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="udrw-cta"
                    >
                      {opt.leg
                        ? `${opt.leg === 'outbound' ? tResults('legOutbound') : t('returnLabel')} · `
                        : ''}
                      {opt.airline ?? t('bookingLinkFallback')}
                      {opt.booking_site ? ` · ${opt.booking_site}` : ''}
                    </a>
                  ) : null,
                )}
              </div>
            ) : (
              <a
                href={bookingLink.booking_url}
                target="_blank"
                rel="noopener noreferrer"
                className="udrw-cta"
              >
                {t('openBookingLink')}
                {bookingLink.booking_site ? ` · ${bookingLink.booking_site}` : ''}
              </a>
            )}

            {/* Secondary utility buttons — share / monitor. Stubbed for
                clipboard + alert for now; hook into real implementations
                in a follow-up. */}
            <div className="udrw-utility-row">
              <button type="button" className="udrw-utility-btn" onClick={handleShare}>
                <span aria-hidden="true">📤</span>
                {t('shareWithPartner')}
              </button>
              <button type="button" className="udrw-utility-btn" onClick={handleMonitor}>
                <span aria-hidden="true">🔔</span>
                {t('monitorPriceChanges')}
              </button>
            </div>

            {googleSavings ? (
              <div className="udrw-unlocked-savings">
                <span className="udrw-unlocked-savings-main">
                  {t('savedVsGoogleFlights', {
                    amount: formatCurrencyAmount(googleSavings.amount, displayCurrency),
                  })}
                </span>
                <span className="udrw-unlocked-savings-sub">{t('allFeesIncluded')}</span>
              </div>
            ) : null}

            <p className="udrw-caption">{t('linkValid15Min')}</p>
          </>
        ) : unlockState === 'failed' ? (
          <>
            <div className="udrw-status udrw-status--failed">
              {verifyError ?? t('couldNotVerify')}
            </div>
            <button
              type="button"
              className="udrw-cta"
              onClick={() => {
                setUnlockState('idle')
                setVerifyError(null)
              }}
            >
              {t('tryAgain')}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="udrw-cta"
              onClick={handleUnlock}
              disabled={isUnlocking || !breakdown}
            >
              <span className="udrw-cta-icon" aria-hidden="true">🔓</span>
              {isUnlocking
                ? t('openingPayment')
                : t('unlockGetLink', {
                    fee: breakdown ? formatCurrencyAmount(breakdown.unlockFee, displayCurrency) : '…',
                  })}
            </button>
            {unlockError ? (
              <p className="udrw-error" style={{ marginTop: 10 }}>{unlockError}</p>
            ) : null}
            <p className="udrw-caption">{t('oneTimeUnlockCaption')}</p>
          </>
        )}
      </div>
    </div>
  )
}

// ── Internal row component ──────────────────────────────────────────────

interface BreakdownRowProps {
  label: string
  amount: number
  currency: string
  /** True = added to total (normal styling). False = available but user opted
   *  out, shown muted with "not added" tag. */
  included: boolean
  mutedNote?: string
}

function BreakdownRow({ label, amount, currency, included, mutedNote }: BreakdownRowProps) {
  return (
    <div className={`udrw-row${included ? '' : ' udrw-row--muted'}`}>
      <span className="udrw-row-label">
        {label}
        {mutedNote ? <span className="udrw-row-note"> ({mutedNote})</span> : null}
      </span>
      <span className="udrw-row-amount">{formatCurrencyAmount(amount, currency)}</span>
    </div>
  )
}
