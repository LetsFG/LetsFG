'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useLocale, useTranslations } from 'next-intl'
import Link from 'next/link'
import Image from 'next/image'
import CurrencyButton from '../../currency-button'
import GlobeButton from '../../globe-button'
import ResultsSearchForm from '../ResultsSearchForm'
import ResultsPanel from './ResultsPanel'
import { SearchProgressBarFull } from './SearchProgressBar'
import { CURRENCY_CHANGE_EVENT, readBrowserCurrencyPreference, type CurrencyCode } from '../../../lib/currency-preference'
import { formatOfferDisplayPrice, getOfferDisplayTotalPrice, type FxRateTable } from '../../../lib/display-price'
import { trackSearchSession, trackSearchSessionEvent } from '../../../lib/search-session-analytics'
import { useExperiment } from '../../../lib/ab-testing'
import { readBrowserCachedResults, writeBrowserCachedResults } from '../../../lib/browser-offer-cache'
import { setResultsLocaleSearchParam } from '../../../lib/locale-routing'
import { appendProbeParam, getTrackedSourcePath } from '../../../lib/probe-mode'
import { useRouter, useSearchParams } from 'next/navigation'
import BookingFrictionSurvey, { BOOKING_FRICTION_EXPERIMENT_ID, BOOKING_FRICTION_RESULTS_EXPERIMENT, SS_KEY_CHECKOUT_VISITED } from '../../BookingFrictionSurvey'
import { parseNLQuery } from '../../lib/searchParsing'
import { normalizeTripPurposes, type TripPurpose } from '../../lib/trip-purpose'
import { getOfferInstanceKey } from '../../lib/rankOffers'

const REPO_URL = 'https://github.com/LetsFG/LetsFG'
const INSTAGRAM_URL = 'https://www.instagram.com/letsfg_'
const TIKTOK_URL = 'https://www.tiktok.com/@letsfg_'
const X_URL = 'https://x.com/LetsFG_'

function slugifyResultsQuery(query: string): string {
  const words = query
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .filter(Boolean)

  const slugParts: string[] = []
  let length = 0

  for (const word of words) {
    const nextLength = length + word.length + (slugParts.length > 0 ? 1 : 0)
    if (slugParts.length >= 10 || nextLength > 64) break
    slugParts.push(word)
    length = nextLength
  }

  return slugParts.join('-')
}

function buildResultsSharePath({
  searchId,
  query,
  locale,
  isTestSearch,
  offersCountOverride,
  fswSession,
  startedAt,
  preserveQuery,
}: {
  searchId: string
  query: string
  locale: string
  isTestSearch: boolean
  offersCountOverride?: number
  fswSession?: string
  startedAt?: string
  preserveQuery?: boolean
}) {
  const slug = slugifyResultsQuery(query)
  const pathname = slug
    ? `/results/${encodeURIComponent(searchId)}/${slug}`
    : `/results/${encodeURIComponent(searchId)}`
  const params = new URLSearchParams()

  if (isTestSearch) {
    params.set('probe', '1')
  }

  if (typeof offersCountOverride === 'number' && offersCountOverride > 0) {
    params.set('oc', String(Math.round(offersCountOverride)))
  }

  if (fswSession) {
    params.set('_fss', fswSession)
  }

  if (startedAt) {
    params.set('started', startedAt)
  }

  if (preserveQuery) {
    params.set('q', query)
  }

  setResultsLocaleSearchParam(params, locale)

  const queryString = params.toString()
  return queryString ? `${pathname}?${queryString}` : pathname
}

function normalizeStartedAtParam(value?: string) {
  if (!value) return undefined

  if (/^\d+$/.test(value)) {
    const numeric = Number.parseInt(value, 10)
    if (Number.isFinite(numeric) && numeric > 0) {
      return String(numeric)
    }
  }

  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : undefined
}

// ── Monitor confirmed overlay ─────────────────────────────────────────────────

interface TelegramUser {
  id: number
  first_name: string
  last_name?: string
  username?: string
  photo_url?: string
  auth_date: number
  hash: string
}

declare global {
  interface Window {
    onTelegramAuth?: (user: TelegramUser) => void
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return new Uint8Array([...rawData].map(c => c.charCodeAt(0)))
}

function MonitorConfirmedOverlay({
  monitorId,
  routeLabel,
  onClose,
}: {
  monitorId: string
  routeLabel: string
  onClose: () => void
}) {
  const [pushState, setPushState] = useState<'idle' | 'loading' | 'done' | 'denied' | 'error'>('idle')
  const [tgState, setTgState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [tgName, setTgName] = useState('')
  const dialogRef = useRef<HTMLDialogElement>(null)
  const tgContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    dialogRef.current?.showModal()
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  // Auto-register any pending push subscription from before the Stripe redirect.
  // First calls /api/monitor/activate to ensure the monitor is ACTIVE (test mode
  // has no webhook, so activation must happen here before the push sub is stored).
  useEffect(() => {
    let pending: string | null = null
    try { pending = sessionStorage.getItem('letsfg_push_pending_sub') } catch (_) { /* ignore */ }
    if (!pending) return

    const sub = JSON.parse(pending) as object

    const registerPush = () => {
      try { sessionStorage.removeItem('letsfg_push_pending_sub') } catch (_) { /* ignore */ }
      setPushState('loading')
      fetch('/api/monitor/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monitor_id: monitorId, subscription: sub }),
      })
        .then(r => r.ok ? setPushState('done') : setPushState('error'))
        .catch(() => setPushState('error'))
    }

    // Activate the monitor first (needed in test mode — no webhook running locally)
    let cs: string | null = null
    try { cs = sessionStorage.getItem('letsfg_checkout_cs') } catch (_) { /* ignore */ }
    if (cs) {
      try { sessionStorage.removeItem('letsfg_checkout_cs') } catch (_) { /* ignore */ }
      fetch('/api/monitor/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cs, monitor_id: monitorId }),
      })
        .catch(() => { /* non-fatal — monitor may already be active */ })
        .finally(() => registerPush())
    } else {
      registerPush()
    }
  }, [monitorId])

  // Telegram widget — only works on registered domains (not localhost)
  const isLocalhost = typeof window !== 'undefined' && window.location.hostname === 'localhost'

  // Telegram widget
  useEffect(() => {
    if (isLocalhost || !tgContainerRef.current) return
    window.onTelegramAuth = async (user) => {
      setTgState('loading')
      try {
        const resp = await fetch('/api/monitor/telegram', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ monitor_id: monitorId, user }),
        })
        const data = await resp.json() as { ok?: boolean; first_name?: string }
        if (!resp.ok || !data.ok) { setTgState('error'); return }
        setTgName(data.first_name || user.first_name)
        setTgState('done')
      } catch (_) { setTgState('error') }
    }
    const script = document.createElement('script')
    script.src = 'https://telegram.org/js/telegram-widget.js?22'
    script.setAttribute('data-telegram-login', 'letsfg_bot')
    script.setAttribute('data-size', 'large')
    script.setAttribute('data-onauth', 'onTelegramAuth(user)')
    script.setAttribute('data-request-access', 'write')
    script.async = true
    tgContainerRef.current.appendChild(script)
    return () => { delete window.onTelegramAuth }
  }, [monitorId])

  async function handleEnablePush() {
    if (pushState === 'loading') return
    setPushState('loading')
    try {
      const keyResp = await fetch('/api/monitor/vapid-key')
      if (!keyResp.ok) { setPushState('error'); return }
      const body = await keyResp.json() as { public_key?: string; vapid_public_key?: string }
      const public_key = body.public_key ?? body.vapid_public_key
      if (!public_key) { setPushState('error'); return }
      if (!('serviceWorker' in navigator)) { setPushState('error'); return }
      await navigator.serviceWorker.register('/sw.js').catch(() => null)
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') { setPushState('denied'); return }
      const reg = await navigator.serviceWorker.ready
      // Unsubscribe any existing subscription so a rotated VAPID key doesn't throw
      const existingSub = await reg.pushManager.getSubscription()
      if (existingSub) await existingSub.unsubscribe().catch(() => null)
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(public_key),
      })
      const subResp = await fetch('/api/monitor/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monitor_id: monitorId, subscription: subscription.toJSON() }),
      })
      if (!subResp.ok) { setPushState('error'); return }
      setPushState('done')
    } catch (_) { setPushState('error') }
  }

  const handleBackdropClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === dialogRef.current) onClose()
  }

  return (
    <dialog
      ref={dialogRef}
      className="mon-dialog"
      onClick={handleBackdropClick}
      onKeyDown={e => { if (e.key === 'Escape') onClose() }}
      aria-modal="true"
      aria-labelledby="mon-confirmed-title"
    >
      <div className="mon-card" role="document">
        <div className="mon-header">
          <div className="mon-header-text">
            <span className="mon-kicker" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="10" fill="#22c55e" />
                <path d="M7 12.5l3.5 3.5 6.5-7" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Monitoring active
            </span>
            <h2 id="mon-confirmed-title" className="mon-title">{routeLabel}</h2>
          </div>
          <button className="mon-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" width="18" height="18" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <p className="mon-confirmed-desc">
          Daily price alerts are tracking this route. Add notification channels to stay informed when prices drop.
        </p>

        <div className="mon-notif-stack">
          <div className="mon-notif-card">
            <div className="mon-notif-icon" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="mon-notif-body">
              <div className="mon-notif-title">Browser notifications</div>
              <div className="mon-notif-desc">Instant alerts in Chrome, Firefox, or Edge.</div>
            </div>
            <div className="mon-notif-action">
              {pushState === 'idle' && <button className="mon-notif-btn" onClick={handleEnablePush}>Enable</button>}
              {pushState === 'loading' && <span className="mon-notif-status mon-notif-status--loading">Setting up…</span>}
              {pushState === 'done' && <span className="mon-notif-status mon-notif-status--done">On</span>}
              {pushState === 'denied' && <span className="mon-notif-status mon-notif-status--muted">Blocked</span>}
              {pushState === 'error' && <button className="mon-notif-btn mon-notif-btn--retry" onClick={handleEnablePush}>Retry</button>}
            </div>
          </div>

          <div className="mon-notif-card">
            <div className="mon-notif-icon" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.248-2.01 9.476c-.147.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.215-3.053 5.56-5.023c.242-.215-.053-.334-.373-.12L6.91 14.33l-2.953-.923c-.64-.203-.653-.64.134-.948l11.536-4.447c.534-.194 1.001.13.935.236z" />
              </svg>
            </div>
            <div className="mon-notif-body">
              <div className="mon-notif-title">Telegram alerts</div>
              <div className="mon-notif-desc">Daily updates via @letsfg_bot.</div>
            </div>
            <div className="mon-notif-action">
              {isLocalhost ? (
                <span className="mon-notif-status mon-notif-status--muted">Live site only</span>
              ) : tgState === 'idle' ? (
                <div ref={tgContainerRef} className="mon-tg-widget" />
              ) : tgState === 'loading' ? (
                <span className="mon-notif-status mon-notif-status--loading">Linking…</span>
              ) : tgState === 'done' ? (
                <span className="mon-notif-status mon-notif-status--done">{tgName ? `Hi ${tgName}!` : 'Linked'}</span>
              ) : (
                <span className="mon-notif-status mon-notif-status--muted">Try again later</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </dialog>
  )
}
const SESSION_RESULT_CACHE_LIMIT = 5000
const SearchingTasks = dynamic(() => import('./SearchingTasks'), { ssr: false })
const MonitorModal = dynamic(() => import('./MonitorModal'), { ssr: false })

function GitHubIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" width="18" height="18" className="lp-github-icon">
      <path
        fill="currentColor"
        d="M8 0C3.58 0 0 3.58 0 8a8.01 8.01 0 0 0 5.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.54 7.54 0 0 1 4.01 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
      />
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
}

interface FallbackNote {
  intended: string
  used_code: string
  used_name: string
  hub_name: string
  reason: string
}

interface ParsedQuery {
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
  // Gemini-extracted intent fields (set server-side when AI parse succeeds)
  ai_passengers?: number
  ai_depart_after?: string    // "HH:MM" 24-hour — hard departure floor
  ai_depart_before?: string   // "HH:MM" 24-hour — hard departure ceiling
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

export interface SearchPageClientProps {
  searchId: string
  trackingSearchId?: string | null
  isTestSearch?: boolean
  initialCurrency?: CurrencyCode
  fxRates?: FxRateTable
  query: string
  parsed: ParsedQuery
  initialStatus: 'searching' | 'completed' | 'expired'
  initialProgress?: { checked: number; total: number; found: number; pending_connectors?: string[] }
  initialOffers: FlightOffer[]
  searchedAt?: string
  expiresAt?: string
  fswSession?: string  // Cloud Run __session affinity token — forwarded on every poll
  initialGemini?: { title?: string; hero: string; runners: string[]; offer_ids?: string[]; ts: number; locale?: string }
}

function dedup(offers: FlightOffer[]): FlightOffer[] {
  return Array.from(new Map(offers.map((offer) => [getOfferInstanceKey(offer), offer])).values())
}

function formatDuration(mins: number) {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${h}h ${m}m`
}

function getLowestPositiveGoogleFlightsPrice(offers: FlightOffer[]): number | undefined {
  return offers.reduce<number | undefined>((lowest, offer) => {
    const googlePrice = offer.google_flights_price
    if (!Number.isFinite(googlePrice) || (googlePrice as number) <= 0) {
      return lowest
    }

    return typeof lowest !== 'number' || (googlePrice as number) < lowest
      ? (googlePrice as number)
      : lowest
  }, undefined)
}

function cancelSearch(searchId: string) {
  const cancelUrl = `/api/results/cancel/${encodeURIComponent(searchId)}`
  if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
    navigator.sendBeacon(cancelUrl)
    return
  }

  void fetch(cancelUrl, { method: 'POST', keepalive: true }).catch(() => {})
}

/**
 * Client component that owns the dynamic parts of the results page.
 *
 * Architecture: the server component (page.tsx) renders JSON-LD for SEO and
 * passes initial data here. This component then polls /api/results/{searchId}
 * every 5 s on the client — NO router.refresh() involved.
 *
 * Why this matters: router.refresh() re-renders the RSC tree which can remount
 * SearchingTasks, resetting elapsed/simChecked/animation state. With client-
 * side polling, SearchingTasks is NEVER remounted during a search. The elapsed
 * counter, the flying-plane animation, and the simulated counter all run
 * uninterrupted from the moment the page loads until results appear.
 */
export default function SearchPageClient({
  searchId,
  trackingSearchId,
  isTestSearch = false,
  initialCurrency = 'EUR',
  fxRates,
  query,
  parsed,
  initialStatus,
  initialProgress,
  initialOffers,
  searchedAt,
  expiresAt,
  fswSession,
  initialGemini,
}: SearchPageClientProps) {
  const t = useTranslations('Results')
  const locale = useLocale()
  const router = useRouter()

  const [status, setStatus] = useState(initialStatus)
  const [progress, setProgress] = useState(initialProgress)
  const [offers, setOffers] = useState(initialOffers)
  const [displayCurrency, setDisplayCurrency] = useState(initialCurrency)
  const [monitorOpen, setMonitorOpen] = useState(false)
  const [confirmedMonitorId, setConfirmedMonitorId] = useState<string | null>(null)
  const [newOfferIds, setNewOfferIds] = useState<Set<string>>(new Set())
  const knownOfferIdsRef = useRef<Set<string>>(new Set(initialOffers.map((offer) => getOfferInstanceKey(offer))))
  const trackedResultsViewRef = useRef(false)
  const trackedExpiredRef = useRef(false)
  const trackedStreamingRef = useRef(false)

  // ── Survey state ──────────────────────────────────────────────────────
  // Timestamp when all results finished loading; null while still searching.
  // Initialized to now if the page was already completed on mount (SSR/cache hit).
  const [resultsCompletedAt, setResultsCompletedAt] = useState<number | null>(
    initialStatus === 'completed' ? Date.now() : null
  )
  const completedAtSetRef = useRef(initialStatus === 'completed')
  // True once user clicks "Select" on any offer (navigates toward checkout).
  const [hasUnlockedOffer, setHasUnlockedOffer] = useState(false)
  // True if user came back to results after visiting checkout without booking.
  const [cameFromCheckout, setCameFromCheckout] = useState(false)

  const scrollMilestonesRef = useRef<Set<number>>(new Set())
  const analyticsSearchId = trackingSearchId || searchId
  const { variant: bookingFrictionVariant } = useExperiment(BOOKING_FRICTION_RESULTS_EXPERIMENT, analyticsSearchId)
  const resultsSourcePath = getTrackedSourcePath(`/results/${searchId}`, isTestSearch)
  const homeHref = isTestSearch ? `/${locale}?probe=1` : `/${locale}`
  const searchAgainHref = status === 'expired' && query
    ? `/${locale}?q=${encodeURIComponent(query)}${isTestSearch ? '&probe=1' : ''}`
    : homeHref
  const searchParams = useSearchParams()
  const canonicalSharePath = useMemo(
    () => buildResultsSharePath({
      searchId,
      query,
      locale,
      isTestSearch,
      offersCountOverride: status === 'completed' ? offers.length : undefined,
    }),
    [isTestSearch, locale, offers.length, query, searchId, status],
  )
  const activeResultsPath = useMemo(
    () => buildResultsSharePath({
      searchId,
      query,
      locale,
      isTestSearch,
      offersCountOverride: status === 'completed' ? offers.length : undefined,
      // Keep Cloud Run affinity in the address bar while the search is still
      // live so discarded/restored tabs can resume polling the owning FSW
      // instance instead of falsely rendering as expired.
      fswSession: status === 'searching' ? fswSession : undefined,
      // Keep just enough live-search context in the URL so a discarded tab can
      // rebuild the searching shell instead of landing on a false expired state.
      startedAt: status === 'searching' ? normalizeStartedAtParam(searchedAt) : undefined,
      preserveQuery: status === 'searching',
    }),
    [fswSession, isTestSearch, locale, offers.length, query, searchId, searchedAt, status],
  )
  const tripMin = searchParams.get('trip_min') ? parseInt(searchParams.get('trip_min')!, 10) : parsed.min_trip_days
  const tripMax = searchParams.get('trip_max') ? parseInt(searchParams.get('trip_max')!, 10) : parsed.max_trip_days

  const isSearching = status === 'searching'
  const isExpired = status === 'expired'
  // Streaming: still searching but partial offers have arrived — render the
  // exact same layout as the completed results page (sky bg, compact hero,
  // scrollable). Only the progress bar differs from the completed state.
  // build:2026-05-05
  const isStreaming = isSearching && offers.length > 0

  // Capture the moment all results finish loading (first transition to 'completed').
  // This is the anchor for the friction survey 3-minute timer.
  useEffect(() => {
    if (status === 'completed' && !completedAtSetRef.current) {
      completedAtSetRef.current = true
      setResultsCompletedAt(Date.now())
    }
  }, [status])

  // Detect if user came back from checkout (visited checkout but didn't complete booking)
  useEffect(() => {
    try {
      if (sessionStorage.getItem(SS_KEY_CHECKOUT_VISITED)) {
        sessionStorage.removeItem(SS_KEY_CHECKOUT_VISITED)
        setCameFromCheckout(true)
      }
    } catch (_) { /* private mode — ignore */ }
  }, [])

  useEffect(() => {
    const monitorActive = searchParams.get('monitor_active')
    if (!monitorActive) return
    setConfirmedMonitorId(monitorActive)
    // Clean the URL so the param doesn't persist on refresh
    try {
      const url = new URL(window.location.href)
      url.searchParams.delete('monitor_active')
      window.history.replaceState(null, '', url.toString())
    } catch (_) { /* ignore */ }
  }, [searchParams])

  useEffect(() => {
    if (!searchId) return
    try {
      const currentUrl = new URL(window.location.href)
      const nextUrl = new URL(activeResultsPath, currentUrl.origin)
      if (currentUrl.pathname === nextUrl.pathname && currentUrl.search === nextUrl.search) return
      window.history.replaceState(null, '', nextUrl.toString())
    } catch (_) {
      // Ignore browsers that reject history writes.
    }
  }, [activeResultsPath, searchId])

  useEffect(() => {
    trackedResultsViewRef.current = false
    trackedExpiredRef.current = false
    scrollMilestonesRef.current = new Set()
    setStatus(initialStatus)
    setProgress(initialProgress)
    setOffers(initialOffers)
    setDisplayCurrency(initialCurrency)
  }, [searchId, initialCurrency])

  useEffect(() => {
    const normalizedQuery = query.trim()
    if (!normalizedQuery) return

    trackSearchSession({
      search_id: analyticsSearchId,
      query: normalizedQuery,
      source: 'website-results-client',
      source_path: resultsSourcePath,
      is_test_search: isTestSearch || undefined,
    })
  }, [analyticsSearchId, isTestSearch, query, resultsSourcePath])

  // Reset progressive-reveal state when search changes
  useEffect(() => {
    knownOfferIdsRef.current = new Set(initialOffers.map((offer) => getOfferInstanceKey(offer)))
    setNewOfferIds(new Set())
  }, [searchId])

  // React to currency changes made via the CurrencyButton (persist behavior).
  // Immediately reconvert displayed prices without rerunning the search.
  useEffect(() => {
    const handleCurrencyChange = () => {
      const next = readBrowserCurrencyPreference(initialCurrency)
      setDisplayCurrency(next)
    }
    window.addEventListener(CURRENCY_CHANGE_EVENT, handleCurrencyChange)
    return () => window.removeEventListener(CURRENCY_CHANGE_EVENT, handleCurrencyChange)
  }, [initialCurrency])

  // If the server is still searching, a browser-cached snapshot may help avoid
  // a blank page on a transient miss. But cached storage must never mark the
  // search as completed on its own, otherwise an older same-search snapshot can
  // freeze the UI before fresh connector results finish streaming in.
  useEffect(() => {
    if (initialStatus !== 'searching') return
    try {
      const cached = readBrowserCachedResults<FlightOffer>(searchId)
      if (cached?.status === 'completed' && Array.isArray(cached.offers) && cached.offers.length > 0) {
        const seededOffers = dedup(cached.offers)
        knownOfferIdsRef.current = new Set(seededOffers.map((offer) => getOfferInstanceKey(offer)))
        setOffers((prev) => (prev.length > 0 ? prev : seededOffers))
      }
    } catch (_) { /* private mode or parse error — ignore */ }
  }, [searchId, initialStatus])

  // When search completes, persist results to sessionStorage so revisiting
  // the URL is instant even if FSW has expired the search.
  useEffect(() => {
    if (status !== 'completed') return
    try {
      writeBrowserCachedResults(searchId, offers.slice(0, SESSION_RESULT_CACHE_LIMIT))
    } catch (_) { /* storage full or unavailable */ }
  }, [status, searchId, offers])

  // Client-side poll — replaces SearchPoller + router.refresh().
  // SearchingTasks stays mounted throughout the search; its animation state is
  // never lost because we never touch the server component during the search.
  // Adaptive interval: 2 s for first 12 s, then 5 s. Partial offers are
  // merged in as they arrive, triggering progressive card reveal.
  useEffect(() => {
    if (!isSearching) return

    const pollStartTime = Date.now()
    let timeoutId: ReturnType<typeof setTimeout>
    let newIdsTimer: ReturnType<typeof setTimeout> | null = null

    const poll = async () => {
      try {
        const params = new URLSearchParams()
        appendProbeParam(params, isTestSearch)
        if (fswSession) params.set('_fss', fswSession)
        const startedParam = normalizeStartedAtParam(searchedAt)
        if (startedParam) params.set('started', startedParam)
        if (query) params.set('q', query)
        const queryString = params.toString()
        const res = await fetch(`/api/results/${searchId}${queryString ? `?${queryString}` : ''}`, { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json()
        if (data.progress) setProgress(data.progress)

        // Merge partial offers even while still searching
        if (data.offers?.length) {
          const incoming = data.offers as FlightOffer[]
          const freshIds = incoming
            .map((offer) => getOfferInstanceKey(offer))
            .filter((offerKey) => !knownOfferIdsRef.current.has(offerKey))
          freshIds.forEach((offerKey) => knownOfferIdsRef.current.add(offerKey))

          if (freshIds.length > 0) {
            setNewOfferIds(new Set(freshIds))
            if (newIdsTimer) clearTimeout(newIdsTimer)
            newIdsTimer = setTimeout(() => setNewOfferIds(new Set()), 900)
          }

          setOffers(prev => dedup([...prev, ...incoming]))
        }

        if (data.status !== 'searching') {
          setStatus(data.status)
          return // stop polling
        }
      } catch (_) {
        // Network error — silently retry next interval
      }

      const elapsed = Date.now() - pollStartTime
      const interval = elapsed < 12000 ? 2000 : 5000
      timeoutId = setTimeout(poll, interval)
    }

    timeoutId = setTimeout(poll, 1800)

    // When the user returns to this tab after switching away, browsers throttle
    // setTimeout heavily (up to 60 s). Fire an immediate poll on tab-focus-return
    // so partial results appear right away instead of waiting for the next tick.
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        clearTimeout(timeoutId)
        poll()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      clearTimeout(timeoutId)
      if (newIdsTimer) clearTimeout(newIdsTimer)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [searchId, isSearching, isTestSearch])

  // Hard client-side timeout: if the FSW keeps reporting `searching` for an
  // unreasonably long time (4 min for exotic / no-coverage routes like
  // BSB→Pretoria), force the UI to a "completed" state so the user is no
  // longer trapped on the loading screen. Whatever offers we have collected
  // by then are shown; if zero, the empty-results UI takes over.
  useEffect(() => {
    if (!isSearching) return
    const startedAtMs = searchedAt ? new Date(searchedAt).getTime() : Date.now()
    const elapsed = Date.now() - startedAtMs
    const HARD_TIMEOUT_MS = 4 * 60 * 1000  // 4 minutes
    const remaining = Math.max(HARD_TIMEOUT_MS - elapsed, 5_000)
    const id = setTimeout(() => {
      setStatus(prev => (prev === 'searching' ? 'completed' : prev))
    }, remaining)
    return () => clearTimeout(id)
  }, [isSearching, searchedAt])

  // Track when first partial results arrive while search is still running.
  // This lets stats reflect real progress counts even if the user navigates away mid-search.
  useEffect(() => {
    if (!isStreaming || trackedStreamingRef.current) return
    trackedStreamingRef.current = true
    const durationMs = searchedAt ? Date.now() - new Date(searchedAt).getTime() : undefined
    const cheapestOffer = offers.reduce<FlightOffer | null>(
      (best, o) => (!best || o.price < best.price ? o : best),
      null,
    )
    const googleFlightsPrice = getLowestPositiveGoogleFlightsPrice(offers)
    trackSearchSessionEvent(analyticsSearchId, 'partial_results_available', {
      offers_count: offers.length,
    }, {
      status: 'searching',
      source: 'website-results-client',
      source_path: resultsSourcePath,
      is_test_search: isTestSearch || undefined,
      search_duration_ms: durationMs,
      results_count: offers.length,
      cheapest_price: cheapestOffer?.price,
      google_flights_price: googleFlightsPrice,
    })
  }, [analyticsSearchId, isStreaming, isTestSearch, offers, resultsSourcePath, searchedAt])

  useEffect(() => {
    if (status !== 'completed' || trackedResultsViewRef.current) return
    trackedResultsViewRef.current = true
    const completedAt = new Date().toISOString()
    const durationMs = searchedAt ? Date.now() - new Date(searchedAt).getTime() : undefined
    const cheapestOffer = offers.reduce<FlightOffer | null>(
      (best, o) => (!best || o.price < best.price ? o : best),
      null,
    )
    const cheapestPrice = cheapestOffer?.price
    const gfPrice = getLowestPositiveGoogleFlightsPrice(offers)
    const savings =
      cheapestPrice != null && gfPrice != null ? Math.max(0, gfPrice - cheapestPrice) : undefined
    const value =
      cheapestPrice != null && gfPrice != null ? Math.round((gfPrice - cheapestPrice) * 100) / 100 : undefined
    trackSearchSessionEvent(analyticsSearchId, 'results_viewed', {
      offers_count: offers.length,
    }, {
      status: 'completed',
      source: 'website-results-client',
      source_path: resultsSourcePath,
      is_test_search: isTestSearch || undefined,
      search_completed_at: completedAt,
      search_duration_ms: durationMs,
      search_duration_seconds: durationMs != null ? Math.round(durationMs / 1000) : undefined,
      results_count: offers.length,
      cheapest_price: cheapestPrice,
      google_flights_price: gfPrice,
      value,
      savings_vs_google_flights: savings,
    })
  }, [analyticsSearchId, isTestSearch, offers.length, resultsSourcePath, searchedAt, status])

  useEffect(() => {
    if (status !== 'expired' || trackedExpiredRef.current) return
    trackedExpiredRef.current = true
    trackSearchSessionEvent(analyticsSearchId, 'search_expired', {}, {
      source: 'website-results-client',
      source_path: resultsSourcePath,
      is_test_search: isTestSearch || undefined,
      status: 'expired',
    })
  }, [analyticsSearchId, isTestSearch, resultsSourcePath, status])

  useEffect(() => {
    const handlePageHide = () => {
      if (status === 'searching') {
        const partialCheapest = offers.reduce<FlightOffer | null>(
          (best, o) => (!best || o.price < best.price ? o : best),
          null,
        )
        const partialGoogleFlightsPrice = getLowestPositiveGoogleFlightsPrice(offers)
        const durationMsSoFar = searchedAt ? Date.now() - new Date(searchedAt).getTime() : undefined
        trackSearchSessionEvent(analyticsSearchId, 'pagehide_searching', {
          progress_checked: progress?.checked ?? null,
          progress_total: progress?.total ?? null,
        }, {
          source: 'website-results-client',
          source_path: resultsSourcePath,
          is_test_search: isTestSearch || undefined,
          results_count: offers.length || undefined,
          search_duration_ms: durationMsSoFar,
          cheapest_price: partialCheapest?.price,
          google_flights_price: partialGoogleFlightsPrice,
        }, { beacon: true })
        cancelSearch(searchId)
        return
      }

      if (status === 'completed') {
        const cheapestOffer = offers.reduce<FlightOffer | null>(
          (best, o) => (!best || o.price < best.price ? o : best),
          null,
        )
        const cheapestPrice = cheapestOffer?.price
        const gfPrice = getLowestPositiveGoogleFlightsPrice(offers)
        const savings =
          cheapestPrice != null && gfPrice != null ? Math.max(0, gfPrice - cheapestPrice) : undefined
        trackSearchSessionEvent(analyticsSearchId, 'pagehide_results', {
          offers_count: offers.length,
        }, {
          status: 'completed',
          source: 'website-results-client',
          source_path: resultsSourcePath,
          is_test_search: isTestSearch || undefined,
          results_count: offers.length,
          cheapest_price: cheapestPrice,
          google_flights_price: gfPrice,
          savings_vs_google_flights: savings,
        }, { beacon: true })
      }
    }

    window.addEventListener('pagehide', handlePageHide)
    return () => window.removeEventListener('pagehide', handlePageHide)
  }, [analyticsSearchId, isTestSearch, offers.length, progress?.checked, progress?.total, resultsSourcePath, searchedAt, status])

  useEffect(() => {
    if (status !== 'completed') return

    const milestones = [25, 50, 75]
    const handleScroll = () => {
      const doc = document.documentElement
      const scrollable = doc.scrollHeight - window.innerHeight
      if (scrollable <= 0) return
      const percent = Math.min(100, Math.round((window.scrollY / scrollable) * 100))
      for (const milestone of milestones) {
        if (percent < milestone || scrollMilestonesRef.current.has(milestone)) continue
        scrollMilestonesRef.current.add(milestone)
        trackSearchSessionEvent(analyticsSearchId, 'scroll_depth', { percent: milestone }, {
          source: 'website-results-client',
          source_path: resultsSourcePath,
          is_test_search: isTestSearch || undefined,
        })
      }
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    handleScroll()
    return () => window.removeEventListener('scroll', handleScroll)
  }, [analyticsSearchId, isTestSearch, resultsSourcePath, status])

  // Derived display strings
  const routeLabel = [
    parsed.origin_name || parsed.origin,
    parsed.destination_name || parsed.destination,
  ].filter(Boolean).join(' → ')

  const fmtDate = (iso: string) => {
    try {
      return new Date(iso + 'T12:00:00').toLocaleDateString(locale, { month: 'short', day: 'numeric' })
    } catch (_) { return iso }
  }

  // Re-parse the raw NL query client-side to extract richer context
  // (passenger composition, ancillary requirements, etc.) that the API
  // parsed object doesn't expose.
  const nlParsed = useMemo(() => { try { return parseNLQuery(query) } catch { return null } }, [query])
  const resolvedTripPurposes = useMemo(() => normalizeTripPurposes({
    tripPurpose: parsed.ai_trip_purpose ?? nlParsed?.trip_purpose,
    tripPurposes: parsed.ai_trip_purposes,
  }), [parsed.ai_trip_purpose, parsed.ai_trip_purposes, nlParsed?.trip_purpose])

  // Convert AI depart_after / depart_before strings to minutes-from-midnight
  // for the hard time-floor enforcement in rankOffers.
  const aiDepartAfterMins = useMemo(() => {
    if (!parsed.ai_depart_after) return undefined
    const [h, m] = parsed.ai_depart_after.split(':').map(Number)
    return h * 60 + (m || 0)
  }, [parsed.ai_depart_after])
  const aiDepartBeforeMins = useMemo(() => {
    if (!parsed.ai_depart_before) return undefined
    const [h, m] = parsed.ai_depart_before.split(':').map(Number)
    return h * 60 + (m || 0)
  }, [parsed.ai_depart_before])

  const requireSeatPerPerson = !!(nlParsed?.require_seat_selection)
  const requireBagPerPerson = !!(parsed.ai_bags_included ?? nlParsed?.require_checked_baggage)
  const requireCancellation = !!(parsed.require_cancellation ?? nlParsed?.require_cancellation)
  const defaultSort: 'price' | 'price_with_bag' | 'price_with_seat' | 'price_with_all' =
    (requireSeatPerPerson || requireBagPerPerson) ? 'price_with_all' : 'price'

  const adultCount = parsed.ai_passengers ?? nlParsed?.adults ?? parsed.passengers ?? 1
  const childCount = nlParsed?.children ?? 0
  const travelerCount = adultCount + childCount + (nlParsed?.infants ?? 0)
  const travelerLabel = `${travelerCount} ${travelerCount === 1 ? t('traveler') : t('travelers')}`

  const durationLabel = tripMin !== undefined
    ? (tripMax !== undefined && tripMax !== tripMin ? `${tripMin}–${tripMax} days` : `${tripMin} days`)
    : null
  const detailBits = [
    parsed.date
      ? durationLabel
        // Duration-range trip: show departure date only (omit derived midpoint return)
        ? fmtDate(parsed.date)
        : parsed.return_date
          ? `${fmtDate(parsed.date)} – ${fmtDate(parsed.return_date)}`
          : fmtDate(parsed.date)
      : null,
    durationLabel,
    travelerLabel,
    parsed.cabin ?? null,
  ].filter(Boolean)
  const detailSummary = detailBits.join(' · ')

  const statusLabel = isSearching
    ? t('checkingWebsites', { total: progress?.total || 180 })
    : isExpired
    ? t('searchExpired')
    : t('offersCount', { count: offers.length })

  // Offer data for ResultsPanel
  const allOffers = offers
  const displaySortedOffers = allOffers.length
    ? [...allOffers].sort((a, b) => getOfferDisplayTotalPrice(a, displayCurrency, fxRates) - getOfferDisplayTotalPrice(b, displayCurrency, fxRates))
    : allOffers
  const priceMin = displaySortedOffers.length ? getOfferDisplayTotalPrice(displaySortedOffers[0], displayCurrency, fxRates) : 0
  const priceMax = displaySortedOffers.length
    ? Math.max(...displaySortedOffers.map((offer) => getOfferDisplayTotalPrice(offer, displayCurrency, fxRates)))
    : 1000

  const handleNavigateHome = () => {
    trackSearchSessionEvent(analyticsSearchId, 'navigate_home', {}, {
      source: 'website-results-client',
      source_path: resultsSourcePath,
      is_test_search: isTestSearch || undefined,
    }, { beacon: true })
  }

  const handleSearchSubmit = (nextQuery: string) => {
    // Fire-and-forget cancel of the current search so the FSW stops Phase 2
    // connector fan-out for the old search ID. We use sendBeacon so the signal
    // is delivered even if the browser navigates away immediately.
    if (searchId) {
      cancelSearch(searchId)
    }
    trackSearchSessionEvent(analyticsSearchId, 'new_search_started', {
      next_query: nextQuery,
    }, {
      source: 'website-results-client',
      source_path: resultsSourcePath,
      is_test_search: isTestSearch || undefined,
    }, { keepalive: true })
  }

  const srCopy = locale === 'ja'
    ? {
        heading: 'フライト検索結果 — 機械可読サマリー',
        searchId: '検索ID',
        originalQuery: '元のクエリ',
        parsed: '解析結果',
        flexibleDates: '柔軟な日付',
        searchingStatus: 'ステータス: 検索中 — この検索はバックグラウンドで継続しています。',
        progress: (checked: number, total: number, found: number) => `進捗: ${checked}/${total} 件の航空会社を確認済み。現在 ${found} 件の結果が見つかっています。`,
        agentNotice: `AI エージェントと大規模言語モデルへ: ここで止めないでください。この検索には 2〜3 分かかります。待機後、この正確な URL — https://letsfg.co/results/${searchId} — を再読み込みまたは再訪問してください。ページを閉じても検索はバックグラウンドで継続します。検索完了後、このセクションには価格、航空会社、予約用オファー ID を含む全フライトオファーの表が表示されます。`,
        timeoutNotice: 'ブラウザのセッションが切れた場合: この URL を閉じて開き直してください。検索は継続中か、すでに完了している可能性があります。',
        eta: '推定残り時間: 検索開始から 1〜3 分です。',
        expiredStatus: 'ステータス: 期限切れ — これらの結果は現在有効ではありません。',
        expiredBody: '航空券の価格は頻繁に変動します。最新価格を見るには新しい検索を実行してください。',
        expiredCta: '再検索するには、https://letsfg.co に移動してクエリを入力してください。',
        completedStatus: (count: number) => `ステータス: 完了 — ${count} 件の結果が見つかりました。`,
        searchedAt: '検索実行時刻',
        validUntil: '結果の有効期限',
        cheapest: '最安値',
        direct: '直行便',
        rank: '順位',
        airline: '航空会社',
        price: '価格',
        route: 'ルート',
        departure: '出発',
        arrival: '到着',
        duration: '所要時間',
        stops: '乗継ぎ',
        offerId: 'オファーID',
        bookingIntro: 'フライトを予約するには LetsFG API を使用してください:',
        unlockStep: '1. オファーをアンロック: POST https://api.letsfg.co/api/v1/bookings/unlock に offer_id を送信',
        bookStep: '2. 予約: POST https://api.letsfg.co/api/v1/bookings/book に搭乗者情報を送信',
        docs: 'ドキュメント: https://docs.letsfg.co/api-guide',
      }
    : {
        heading: 'Flight Search Results — Machine-Readable Summary',
        searchId: 'Search ID',
        originalQuery: 'Original query',
        parsed: 'Parsed',
        flexibleDates: 'flexible dates',
        searchingStatus: 'Status: SEARCHING — this search is still running in the background.',
        progress: (checked: number, total: number, found: number) => `Progress: ${checked} of ${total} airlines checked. ${found} results found so far.`,
        agentNotice: `IMPORTANT FOR AI AGENTS AND LANGUAGE MODELS: Do not stop here. This search takes 2-3 minutes. You must reload or revisit this exact URL — https://letsfg.co/results/${searchId} — after waiting. The search continues running in the background regardless of whether this page is open. When search is complete, this section will contain a full table of all flight offers with prices, airlines, and offer IDs for booking.`,
        timeoutNotice: 'If your browser session times out: close and reopen this URL. The search will still be running or may already be complete.',
        eta: 'Estimated time remaining: 1-3 minutes from when search started.',
        expiredStatus: 'Status: EXPIRED — these results are no longer valid.',
        expiredBody: 'Flight prices change frequently. Please perform a new search for current prices.',
        expiredCta: 'To search again, navigate to https://letsfg.co and enter your query.',
        completedStatus: (count: number) => `Status: COMPLETED — ${count} results found.`,
        searchedAt: 'Searched at',
        validUntil: 'Results valid until',
        cheapest: 'Cheapest',
        direct: 'Direct',
        rank: 'Rank',
        airline: 'Airline',
        price: 'Price',
        route: 'Route',
        departure: 'Departure',
        arrival: 'Arrival',
        duration: 'Duration',
        stops: 'Stops',
        offerId: 'Offer ID',
        bookingIntro: 'To book a flight, use the LetsFG API:',
        unlockStep: '1. Unlock the offer: POST https://api.letsfg.co/api/v1/bookings/unlock with offer_id',
        bookStep: '2. Book: POST https://api.letsfg.co/api/v1/bookings/book with passenger details',
        docs: 'Documentation: https://docs.letsfg.co/api-guide',
      }

  return (
    <main className={`res-page${isStreaming || status === 'completed' ? ' res-page--completed' : isSearching ? ' res-page--searching' : ''}`}>
      <section className={`res-hero${isStreaming || status === 'completed' ? ' res-hero--results' : isSearching ? ' res-hero--searching' : ''}`}>
        <div className="res-hero-backdrop" aria-hidden="true" />

        <div className="res-hero-inner">
          <div className={`res-topbar${isStreaming || status === 'completed' ? ' res-topbar--results' : isSearching ? ' res-topbar--searching' : ''}`}>
            <Link href={homeHref} className="res-topbar-logo-link" aria-label="LetsFG home" onClick={handleNavigateHome}>
              <Image
                src="/lfg_ban.png"
                alt="LetsFG"
                width={4990}
                height={1560}
                className="res-topbar-logo"
                priority
              />
            </Link>

            <nav className="lp-nav res-topbar-nav">
              <span className="lp-nav-link">{t('navSearch')}</span>
              {parsed.origin && parsed.destination && parsed.date && (
                <button
                  className="lp-nav-link lp-nav-link-btn"
                  onClick={() => setMonitorOpen(true)}
                >
                  {t('navMonitor')}
                </button>
              )}
            </nav>

            <div className="res-topbar-actions">
              <GlobeButton inline />
              <CurrencyButton inline behavior={isSearching ? 'rerun-search' : 'persist'} initialCurrency={displayCurrency} searchQuery={query} probeMode={isTestSearch} />
              <a
                href={REPO_URL}
                target="_blank"
                rel="noreferrer"
                className="res-icon-btn"
                aria-label="GitHub"
                title="GitHub"
              >
                <GitHubIcon />
              </a>
            </div>
          </div>

          {status === 'completed' && (
            <div className="res-search-shell">
              <ResultsSearchForm initialQuery={query} initialCurrency={initialCurrency} onSearchSubmit={handleSearchSubmit} probeMode={isTestSearch} />
            </div>
          )}

          {isSearching ? (
            <>
              <div className="res-search-shell">
                <ResultsSearchForm initialQuery={query} initialCurrency={initialCurrency} onSearchSubmit={handleSearchSubmit} probeMode={isTestSearch} />
              </div>

              {offers.length > 0 && (
              <div className="res-meta-bar">
                <span className="res-meta-label">{t('searchResults')}</span>
                {routeLabel && (
                  <>
                    <span className="res-meta-sep">·</span>
                    <span className="res-meta-route">{routeLabel}</span>
                  </>
                )}
                {detailSummary && (
                  <>
                    <span className="res-meta-sep">·</span>
                    <span className="res-meta-detail">{detailSummary}</span>
                  </>
                )}
              </div>
              )}

              {offers.length === 0 && (
                <div className="res-searching-stage">
                  <SearchingTasks
                    originLabel={parsed.origin_name || parsed.origin}
                    originCode={parsed.origin}
                    destinationLabel={parsed.destination_name || parsed.destination}
                    destinationCode={parsed.destination}
                    progress={progress}
                    searchedAt={searchedAt}
                    searchId={searchId}
                  />
                </div>
              )}
            </>
          ) : status === 'completed' ? (
            <div className="res-meta-bar">
              <span className="res-meta-label">{t('searchResults')}</span>
              {routeLabel && (
                <>
                  <span className="res-meta-sep">·</span>
                  <span className="res-meta-route">{routeLabel}</span>
                </>
              )}
              {detailSummary && (
                <>
                  <span className="res-meta-sep">·</span>
                  <span className="res-meta-detail">{detailSummary}</span>
                </>
              )}
            </div>
          ) : (
            <div className="res-hero-copy">
              <p className="res-hero-kicker">{t('searchExpired')}</p>
              {routeLabel ? <h1 className="res-hero-route">{routeLabel}</h1> : null}
              {detailSummary ? <p className="res-hero-summary">{detailSummary}</p> : null}
              <p className="res-hero-status">{statusLabel}</p>
            </div>
          )}

          {isExpired && (
            <div className="res-notice-card">
              <div className="res-notice-icon" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
                  <path d="M12 8v5M12 15.5v.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </div>
              <div className="res-notice-text">
                <p className="res-notice-title">{t('expiredNoticeTitle')}</p>
                <p className="res-notice-sub">{t('expiredNoticeSub')}</p>
              </div>
              <Link href={searchAgainHref} className="res-notice-btn" onClick={handleNavigateHome}>{t('searchAgain')}</Link>
            </div>
          )}
        </div>
      </section>



      {(status === 'completed' || (isSearching && allOffers.length > 0)) && (
        <ResultsPanel
          allOffers={allOffers}
          query={query}
          sharePath={canonicalSharePath}
          currency={displayCurrency}
          fxRates={fxRates}
          travelerCount={travelerCount}
          priceMin={priceMin}
          priceMax={priceMax}
          searchId={searchId}
          trackingSearchId={analyticsSearchId}
          isTestSearch={isTestSearch}
          onTrackPrices={parsed.origin && parsed.destination && parsed.date ? () => {
            trackSearchSessionEvent(analyticsSearchId, 'monitor_strip_clicked', {
              origin: parsed.origin, destination: parsed.destination,
            })
            setMonitorOpen(true)
          } : undefined}
          onOfferSelect={undefined}
          newOfferIds={isSearching ? newOfferIds : undefined}
          isSearching={isSearching}
          progress={progress}
          defaultSort={defaultSort}
          requireSeatPerPerson={requireSeatPerPerson}
          requireBagPerPerson={requireBagPerPerson}
          requireCancellation={requireCancellation}
          initialDepTimePref={parsed.ai_dep_time_pref ?? nlParsed?.depart_time_pref}
          initialRetTimePref={parsed.ai_ret_time_pref ?? nlParsed?.return_depart_time_pref}
          initialArrTimePref={nlParsed?.arrive_time_pref}
          initialDepartAfterMins={aiDepartAfterMins ?? nlParsed?.depart_after_mins}
          initialDepartBeforeMins={aiDepartBeforeMins ?? nlParsed?.depart_before_mins}
          tripContext={parsed.ai_passenger_context ?? nlParsed?.passenger_context}
          tripPurpose={resolvedTripPurposes[0]}
          tripPurposes={resolvedTripPurposes.length > 0 ? resolvedTripPurposes : undefined}
          preferredAirline={nlParsed?.preferred_airline}
          preferQuickFlight={parsed.ai_sort_by === 'duration' || nlParsed?.prefer_quick_flight}
          preferCheapest={parsed.ai_sort_by === 'price' || nlParsed?.preferred_sort === 'price'}
          viaIata={nlParsed?.via_iata}
          maxStops={parsed.ai_direct_only === true ? 0 : (typeof nlParsed?.stops === 'number' ? nlParsed.stops : undefined)}
          fallbackNotes={parsed.fallback_notes}
          initialGemini={initialGemini}
        />
      )}

      {monitorOpen && parsed.origin && parsed.destination && parsed.date && (
        <MonitorModal
          searchId={analyticsSearchId}
          origin={parsed.origin}
          originName={parsed.origin_name || parsed.origin}
          destination={parsed.destination}
          destinationName={parsed.destination_name || parsed.destination}
          departureDate={parsed.date}
          returnDate={parsed.return_date || undefined}
          adults={parsed.passengers || 1}
          cabinClass={parsed.cabin || undefined}
          currency={displayCurrency}
          fxRates={fxRates}
          onClose={() => setMonitorOpen(false)}
        />
      )}

      {confirmedMonitorId && (
        <MonitorConfirmedOverlay
          monitorId={confirmedMonitorId}
          routeLabel={routeLabel}
          onClose={() => setConfirmedMonitorId(null)}
        />
      )}

      {(!isSearching || allOffers.length > 0) && (
        <footer className="res-search-footer" aria-label="LetsFG footer">
          <div className="res-search-footer-inner">
            <span className="res-search-footer-copy">{t('copyright')}</span>
            <div className="res-search-footer-links">
              <a href="/privacy" className="res-search-footer-link">{t('privacy')}</a>
              <a href="/terms" className="res-search-footer-link">{t('terms')}</a>
              <a href="mailto:contact@letsfg.co" className="res-search-footer-link">{t('support')}</a>
              <span className="res-search-footer-sep" aria-hidden="true" />
              <a href={INSTAGRAM_URL} className="res-search-footer-social" target="_blank" rel="noreferrer" aria-label="Instagram">
                <InstagramIcon />
              </a>
              <a href={TIKTOK_URL} className="res-search-footer-social" target="_blank" rel="noreferrer" aria-label="TikTok">
                <TikTokIcon />
              </a>
              <a href={X_URL} className="res-search-footer-social" target="_blank" rel="noreferrer" aria-label="X">
                <XIcon />
              </a>
            </div>
          </div>
        </footer>
      )}

      {/* Hidden content for AI agents */}
      <section className="sr-only" aria-hidden="true" data-agent-content>
        <h2>{srCopy.heading}</h2>

        <p>{srCopy.searchId}: {searchId}</p>
        <p>{srCopy.originalQuery}: &quot;{query}&quot;</p>
        <p>{srCopy.parsed}: {routeLabel}, {parsed.date || srCopy.flexibleDates}</p>

        {isSearching && (
          <>
            <p>{srCopy.searchingStatus}</p>
            <p>{srCopy.progress(progress?.checked || 0, progress?.total || 180, progress?.found || 0)}</p>
            <p>{srCopy.agentNotice}</p>
            <p>{srCopy.timeoutNotice}</p>
            <p>{srCopy.eta}</p>
          </>
        )}

        {isExpired && (
          <>
            <p>{srCopy.expiredStatus}</p>
            <p>{srCopy.expiredBody}</p>
            <p>{srCopy.expiredCta}</p>
          </>
        )}

        {status === 'completed' && allOffers.length > 0 && (
          <>
            <p>{srCopy.completedStatus(allOffers.length)}</p>
            <p>{srCopy.searchedAt}: {searchedAt}</p>
            <p>{srCopy.validUntil}: {expiresAt} (approximately 15 minutes)</p>
            <p>{srCopy.cheapest}: {formatOfferDisplayPrice(getOfferDisplayTotalPrice(displaySortedOffers[0], displayCurrency, fxRates), displayCurrency, displayCurrency, locale, fxRates)} on {displaySortedOffers[0]?.airline} ({displaySortedOffers[0]?.stops === 0 ? srCopy.direct : `${displaySortedOffers[0]?.stops} stop(s)`}, {formatDuration(displaySortedOffers[0]?.duration_minutes || 0)})</p>
            <table>
              <thead>
                <tr>
                  <th>{srCopy.rank}</th><th>{srCopy.airline}</th><th>{srCopy.price}</th><th>{srCopy.route}</th>
                  <th>{srCopy.departure}</th><th>{srCopy.arrival}</th><th>{srCopy.duration}</th><th>{srCopy.stops}</th><th>{srCopy.offerId}</th>
                </tr>
              </thead>
              <tbody>
                {displaySortedOffers.map((offer, i) => (
                  <tr key={`${getOfferInstanceKey(offer)}|${i}`}>
                    <td>{i + 1}</td>
                    <td>{offer.airline}</td>
                    <td>{formatOfferDisplayPrice(getOfferDisplayTotalPrice(offer, displayCurrency, fxRates), displayCurrency, displayCurrency, locale, fxRates)}</td>
                    <td>{offer.origin}→{offer.destination}</td>
                    <td>{offer.departure_time}</td>
                    <td>{offer.arrival_time}</td>
                    <td>{formatDuration(offer.duration_minutes)}</td>
                    <td>{offer.stops === 0 ? srCopy.direct : offer.stops}</td>
                    <td>{offer.id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>{srCopy.bookingIntro}</p>
            <p>{srCopy.unlockStep}</p>
            <p>{srCopy.bookStep}</p>
            <p>{srCopy.docs}</p>
          </>
        )}
      </section>

      {/* Booking friction survey — results page */}
      {!isExpired && !hasUnlockedOffer && (
        <BookingFrictionSurvey
          searchId={analyticsSearchId}
          isTestSearch={isTestSearch}
          variant={bookingFrictionVariant}
          context="results"
          resultsCompletedAt={resultsCompletedAt}
          showImmediately={cameFromCheckout}
          onMonitorUpsellClick={parsed.origin && parsed.destination && parsed.date ? () => {
            trackSearchSessionEvent(analyticsSearchId, 'monitor_strip_clicked', {
              origin: parsed.origin,
              destination: parsed.destination,
              placement: 'booking_friction_upsell',
              experiment_id: BOOKING_FRICTION_EXPERIMENT_ID,
              variant: bookingFrictionVariant || 'monitoring',
            })
            setMonitorOpen(true)
          } : undefined}
        />
      )}
    </main>
  )
}
