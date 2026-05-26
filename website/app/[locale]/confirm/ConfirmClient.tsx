'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import CurrencyButton from '../../currency-button'
import GlobeButton from '../../globe-button'
import type { CurrencyCode } from '../../../lib/currency-preference'
import { parseNLQuery } from '../../lib/searchParsing'

interface SuggestedAnswer {
  key: string
  label?: string | null
}

interface FollowUpQuestion {
  topic: string
  question?: string | null
  free_hint?: string | null
  multi_choice?: boolean | null
  is_essential?: boolean | null
  suggested_answers?: SuggestedAnswer[] | null
}

interface ParseResponse {
  origin: string | null
  origin_name: string | null
  origin_city: string | null
  destination: string | null
  destination_name: string | null
  destination_city: string | null
  anywhere_destination?: boolean
  departure_date: string | null
  return_date: string | null
  passengers: number | null
  cabin_class: 'economy' | 'premium_economy' | 'business' | 'first' | null
  is_round_trip: boolean | null
  trip_purpose?: string | null
  follow_up_questions?: FollowUpQuestion[] | null
  // Gemini-driven decision (null when Vertex is unavailable).
  skip_refine_question?: boolean | null
  skip_refine_question_reason?: string | null
  // Internal marker — true when produced by localFallbackParse instead of Gemini.
  _fallback?: boolean
}

// sessionStorage key used to hand off the parse data to /refine without
// re-fetching from the API.
const REFINE_HANDOFF_KEY = 'lfg_refine_handoff'

interface ConfirmClientProps {
  query: string
  locale: string
  initialCurrency: CurrencyCode
  probeMode: boolean
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function formatDate(iso: string | null): string | null {
  if (!iso) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  const year = parseInt(m[1], 10)
  const month = parseInt(m[2], 10) - 1
  const day = parseInt(m[3], 10)
  if (month < 0 || month > 11) return iso
  return `${day} ${MONTHS_FULL[month]} ${year}`
}

function nightsBetween(from: string | null, to: string | null): number | null {
  if (!from || !to) return null
  const a = Date.parse(from + 'T00:00:00Z')
  const b = Date.parse(to + 'T00:00:00Z')
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  const nights = Math.round((b - a) / 86_400_000)
  return nights > 0 ? nights : null
}

function cabinLabel(cabin: ParseResponse['cabin_class']): string {
  switch (cabin) {
    case 'business': return 'business class'
    case 'first': return 'first class'
    case 'premium_economy': return 'premium economy'
    case 'economy': return 'economy'
    default: return 'economy'
  }
}

// When the refine step is skipped (Gemini said nothing to ask), the user
// is sent straight from /confirm to /results/pending which fires the search.
const FIRE_SEARCH_ON_SKIP_REFINE = true

// Decide whether to surface the date-flexibility refine step.
// Long-term: the backend's ai-intent endpoint should return a boolean
// `skip_refine_question` driven by Gemini. Until that lands, this heuristic
// mirrors the same intent: skip when the user is already flexible (no concrete
// dates / vague month phrasing) or when they explicitly opted out ("only",
// "exactly", "must be"). Show the question otherwise.
function shouldSkipRefineQuestion(query: string, parsed: ParseResponse): boolean {
  // No concrete dates → user is already flexible, no point asking
  if (!parsed.departure_date && !parsed.return_date) return true

  const q = query.toLowerCase()

  // Explicit "only / exactly / fixed" signals near date intent
  if (/\b(only|exact(?:ly)?|specifically|must be|fixed dates?|no flex|no flexibility)\b/.test(q)) {
    return true
  }

  // User explicitly said they're flexible in the raw query
  if (/\b(anywhere|wherever|whenever|flexible dates?|flexible times?|any time|any date|sometime)\b/.test(q)) {
    return true
  }

  // Vague month-only phrasing ("somewhere in June", "in June", "during May")
  if (/\b(?:somewhere\s+in|sometime\s+in|in|during)\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(q)) {
    return true
  }

  return false
}

// Local fallback: derive a ParseResponse from the existing regex-based parser
// when the Gemini API is unavailable (e.g. dev without Vertex credentials).
function localFallbackParse(query: string): ParseResponse {
  const local = parseNLQuery(query)
  const cabinMap: Record<string, ParseResponse['cabin_class']> = {
    M: 'economy', W: 'premium_economy', C: 'business', F: 'first',
  }
  return {
    origin: local.origin ?? null,
    origin_name: local.origin_name ?? null,
    origin_city: local.origin_name ?? null,
    destination: local.destination ?? null,
    destination_name: local.destination_name ?? null,
    destination_city: local.destination_name ?? null,
    anywhere_destination: local.anywhere_destination ?? false,
    departure_date: local.date && !local.date_is_default ? local.date : null,
    return_date: local.return_date ?? null,
    passengers: local.adults ?? 1,
    cabin_class: local.cabin ? cabinMap[local.cabin] ?? 'economy' : 'economy',
    is_round_trip: Boolean(local.return_date),
    trip_purpose: null,
    _fallback: true,
  }
}

function formatRoute(side: 'origin' | 'destination', parsed: ParseResponse): string {
  const city = side === 'origin' ? parsed.origin_city : parsed.destination_city
  const code = side === 'origin' ? parsed.origin : parsed.destination
  const name = side === 'origin' ? parsed.origin_name : parsed.destination_name
  if (side === 'destination' && parsed.anywhere_destination) return 'Anywhere'
  if (city && code) return `${city} (${code})`
  if (name && code) return `${name} (${code})`
  if (city) return city
  if (name) return name
  if (code) return code
  return '—'
}

// Curated brand-voice variants for the agent greeting + summary intro.
// Picked deterministically by a hash of the query so reloads don't flicker.
// When the backend's ai-intent endpoint starts returning these from Gemini,
// replace this with parsed.confirm_greeting / parsed.confirm_intro.
const AGENT_GREETINGS = [
  'Let me confirm I understood your request correctly:',
  'Just to make sure I got that right —',
  'Quick check — here’s what I picked up:',
  'Let me play it back to you:',
  'Reading what you told me — does this look right?',
  'Alright, here’s what I’m hearing:',
  'Got the gist — let me confirm:',
  'Before I start hunting, want to confirm:',
] as const

const AGENT_INTROS = [
  'Got it! I’ll search for:',
  'Here’s what I’ll look up:',
  'Ready to search:',
  'Looking for:',
  'On it:',
  'Your request:',
] as const

function hashString(input: string): number {
  let h = 0
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) - h + input.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

function pickAgentCopy(query: string): { greeting: string; intro: string } {
  if (!query) return { greeting: AGENT_GREETINGS[0], intro: AGENT_INTROS[0] }
  const h = hashString(query)
  return {
    greeting: AGENT_GREETINGS[h % AGENT_GREETINGS.length],
    intro: AGENT_INTROS[Math.floor(h / AGENT_GREETINGS.length) % AGENT_INTROS.length],
  }
}

function RoutePlaneIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor">
      <path d="M21 16v-2l-8-5V3.5C13 2.67 12.33 2 11.5 2S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1L15 22v-1.5L13 19v-5.5l8 2.5z" />
    </svg>
  )
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  )
}

function PersonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-4.5 5-7 8-7s6.5 2.5 8 7" />
    </svg>
  )
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15.5 3.5l5 5L7.5 21.5l-5.5 1 1-5.5L15.5 3.5z" />
    </svg>
  )
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

export default function ConfirmClient({ query, locale, initialCurrency, probeMode }: ConfirmClientProps) {
  const router = useRouter()
  const [parsed, setParsed] = useState<ParseResponse | null>(null)
  const [parseError, setParseError] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [testNotice, setTestNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!query) {
      router.replace(`/${locale}`)
      return
    }
    let cancelled = false
    const ctrl = new AbortController()
    const timer = window.setTimeout(() => ctrl.abort(), 12_000)
    fetch('/api/parse-query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: ctrl.signal,
    })
      .then(async (res) => {
        if (!res.ok) return null
        const data = await res.json().catch(() => null)
        // Server returns { error } when Vertex AI is unavailable — treat as null.
        if (!data || typeof (data as { error?: string }).error === 'string') return null
        return data as ParseResponse
      })
      .then((data) => {
        if (cancelled) return
        if (data) {
          setParsed(data)
        } else {
          // Graceful fallback: parse the query client-side so the user still
          // sees a confirmation summary even if Gemini is unavailable.
          setParsed(localFallbackParse(query))
        }
      })
      .catch(() => {
        if (cancelled) return
        setParsed(localFallbackParse(query))
      })
      .finally(() => window.clearTimeout(timer))
    return () => {
      cancelled = true
      ctrl.abort()
      window.clearTimeout(timer)
    }
  }, [query, locale, router])

  const handleLetsGo = () => {
    const params = new URLSearchParams()
    params.set('q', query)
    if (initialCurrency) params.set('cur', initialCurrency)
    if (probeMode) params.set('probe', '1')

    // Prefer Gemini's decision on date-flex; fall back to the heuristic
    // when Vertex is unavailable.
    const geminiSkipDate = parsed?.skip_refine_question
    const heuristicSkipDate = parsed ? shouldSkipRefineQuestion(query, parsed) : false
    const skipDateFlex: boolean = geminiSkipDate ?? heuristicSkipDate
    const dateSource: 'gemini' | 'heuristic' = geminiSkipDate === null || geminiSkipDate === undefined ? 'heuristic' : 'gemini'

    const followUps = (parsed?.follow_up_questions ?? []).filter(q => q?.topic)
    const hasDateFlexStep = !skipDateFlex && Boolean(parsed?.departure_date)
    const hasAnyQuestion = hasDateFlexStep || followUps.length > 0

    // Hand the parsed payload off via sessionStorage so /refine doesn't
    // need to re-call the API. Skip when it was the local fallback — refine
    // should refetch fresh in case Gemini is now reachable.
    if (parsed && !parsed._fallback && typeof window !== 'undefined') {
      try {
        sessionStorage.setItem(REFINE_HANDOFF_KEY, JSON.stringify({ query, parsed }))
      } catch {
        // ignore quota / private mode errors
      }
    }

    if (!hasAnyQuestion && !FIRE_SEARCH_ON_SKIP_REFINE) {
      const reason = parsed?.skip_refine_question_reason ? ` (${parsed.skip_refine_question_reason})` : ''
      setTestNotice(
        `Decision via ${dateSource}: nothing to ask${reason} → would go straight to results. Search firing disabled while testing.`,
      )
      window.setTimeout(() => setTestNotice(null), 4500)
      return
    }

    setSubmitting(true)
    if (!hasAnyQuestion) {
      router.push(`/results/pending?${params.toString()}`)
    } else {
      router.push(`/${locale}/refine?${params.toString()}`)
    }
  }

  const handleAdjust = () => {
    const params = new URLSearchParams()
    params.set('qfill', query)
    router.push(`/${locale}?${params.toString()}`)
  }

  const loading = !parsed && !parseError

  const nights = parsed ? nightsBetween(parsed.departure_date, parsed.return_date) : null
  const isRoundTrip = parsed?.is_round_trip ?? Boolean(parsed?.return_date)
  const passengers = parsed?.passengers ?? 1

  return (
    <main className="cf-page">
      <header className="lp-topbar">
        <HomeLogo locale={locale} />
        <div className="lp-topbar-side">
          <GlobeButton inline />
          <CurrencyButton inline behavior="persist" initialCurrency={initialCurrency} probeMode={probeMode} />
        </div>
      </header>

      <section className="cf-body">
        {loading && (
          <div className="cf-loading" aria-live="polite" aria-busy="true">
            <p className="cf-greeting">Reading what you wrote...</p>
            <div className="cf-skeleton">
              <div className="cf-skeleton-line cf-skeleton-line--xl" />
              <div className="cf-skeleton-line cf-skeleton-line--md" />
              <div className="cf-skeleton-line cf-skeleton-line--sm" />
              <div className="cf-skeleton-line cf-skeleton-line--md" />
            </div>
          </div>
        )}

        {parseError && (
          <div className="cf-error">
            <p className="cf-greeting">Hmm, I couldn&apos;t quite read that.</p>
            <p className="cf-tip">Mind giving it another go? Try something like &quot;London to Barcelona in April&quot;.</p>
            <div className="cf-actions">
              <button type="button" className="cf-btn cf-btn--primary" onClick={handleAdjust}>
                Let me try again
              </button>
            </div>
          </div>
        )}

        {parsed && (() => {
          const copy = pickAgentCopy(query)
          return (
          <>
            <p className="cf-greeting">{copy.greeting}</p>

            <div className="cf-summary-tag">
              <span>{copy.intro}</span>
            </div>

            <ul className="cf-rows">
              <li className="cf-row">
                <span className="cf-row-icon" aria-hidden="true"><RoutePlaneIcon /></span>
                <div className="cf-row-body">
                  <p className="cf-row-title">
                    <strong>{formatRoute('origin', parsed)}</strong>
                    <span className="cf-arrow" aria-hidden="true">→</span>
                    <strong>{formatRoute('destination', parsed)}</strong>
                  </p>
                  {parsed.anywhere_destination && (
                    <p className="cf-row-meta">Open to wherever&apos;s cheapest</p>
                  )}
                </div>
              </li>

              <li className="cf-row">
                <span className="cf-row-icon" aria-hidden="true"><CalendarIcon /></span>
                <div className="cf-row-body">
                  {parsed.departure_date && parsed.return_date ? (
                    <p className="cf-row-title">
                      <strong>{formatDate(parsed.departure_date)} – {formatDate(parsed.return_date)}</strong>
                      {nights ? <span className="cf-row-meta-inline"> · {nights} nights</span> : null}
                    </p>
                  ) : parsed.departure_date ? (
                    <p className="cf-row-title"><strong>{formatDate(parsed.departure_date)}</strong></p>
                  ) : (
                    <p className="cf-row-title cf-row-title--soft">Dates flexible</p>
                  )}
                  <p className="cf-row-meta">{isRoundTrip ? 'Round-trip flight' : 'One-way flight'}</p>
                </div>
              </li>

              <li className="cf-row">
                <span className="cf-row-icon" aria-hidden="true"><PersonIcon /></span>
                <div className="cf-row-body">
                  <p className="cf-row-title"><strong>{passengers} {passengers === 1 ? 'adult' : 'adults'}</strong></p>
                  <p className="cf-row-meta">{cabinLabel(parsed.cabin_class).replace(/\b\w/, c => c.toUpperCase())} class</p>
                </div>
              </li>
            </ul>

            <div className="cf-actions">
              <button
                type="button"
                className="cf-btn cf-btn--primary"
                onClick={handleLetsGo}
                disabled={submitting}
              >
                {submitting ? 'Starting search…' : "That's right, let's go"}
              </button>
              <button
                type="button"
                className="cf-btn cf-btn--ghost"
                onClick={handleAdjust}
                disabled={submitting}
              >
                <PencilIcon />
                <span>Let me adjust</span>
              </button>
            </div>
          </>
          )
        })()}
      </section>

      {testNotice && (
        <div className="rf-test-toast" role="status" aria-live="polite">
          {testNotice}
        </div>
      )}
    </main>
  )
}
