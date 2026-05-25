'use client'

import { useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import CurrencyButton from '../../currency-button'
import GlobeButton from '../../globe-button'
import type { CurrencyCode } from '../../../lib/currency-preference'
import { parseNLQuery } from '../../lib/searchParsing'

// TESTING MODE — set to false to actually fire the search.
const FIRE_SEARCH_ON_SUBMIT = false

const REFINE_HANDOFF_KEY = 'lfg_refine_handoff'

interface RefineClientProps {
  query: string
  locale: string
  initialCurrency: CurrencyCode
  probeMode: boolean
}

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

interface ParsedData {
  departure_date: string | null
  return_date: string | null
  origin: string | null
  destination: string | null
  is_round_trip: boolean | null
  skip_refine_question?: boolean | null
  follow_up_questions?: FollowUpQuestion[] | null
  // Internal marker — true when produced by localFallbackParse instead of Gemini.
  // Used so we don't poison the sessionStorage cache with fallback data.
  _fallback?: boolean
}

type DateFlex = 'fixed' | 'plus_minus_3' | 'whole_month'

interface BaseStep {
  topic: string
  question: string
}

interface DateFlexStep extends BaseStep {
  kind: 'date_flexibility'
}

interface ChipsStep extends BaseStep {
  kind: 'chips'
  options: { key: string; label: string }[]
  multiChoice: boolean
  freeHint?: string
}

type Step = DateFlexStep | ChipsStep

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s7-7.58 7-13a7 7 0 1 0-14 0c0 5.42 7 13 7 13z" />
      <circle cx="12" cy="9" r="2.5" />
    </svg>
  )
}

function FlexIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 12H17" />
      <path d="M10 9l-3 3 3 3" />
      <path d="M14 9l3 3-3 3" />
    </svg>
  )
}

function MonthIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  )
}

function SearchGlassIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.3-4.3" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12l5 5L20 7" />
    </svg>
  )
}

function ArrowRightIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M14 6l6 6-6 6" />
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

// ─── Date-flexibility helpers ──────────────────────────────────────────────

interface DayCell {
  iso: string
  weekday: string
  day: number
  price: number
  tier: 'cheap' | 'avg' | 'pricy'
  selected: boolean
  currency: string | null
}

interface DateGridGridCell {
  outbound: string
  return: string
  price: number
  currency: string
  is_cheaper: boolean
}

interface DateGridResponse {
  origin: string
  destination: string
  currency: string | null
  selected_outbound: string
  selected_return: string | null
  scraped_at: string
  grid: DateGridGridCell[]
  source: 'backend' | 'subprocess'
}

function formatMonthShort(m: number): string {
  return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m]
}

// Build a 7-day strip for one axis (outbound or return) from the 7×7 grid.
// Prices on each cell = cheapest available combo for that day on the chosen
// axis. ``selectedIso`` flags which cell is currently chosen by the user.
function buildAxisStrip(
  resp: DateGridResponse,
  axis: 'outbound' | 'return',
  centerIso: string,
  selectedIso: string | null,
): { days: DayCell[]; spread: number | null } {
  const cheapestByAxis = new Map<string, DateGridGridCell>()
  for (const cell of resp.grid) {
    if (cell.price <= 0) continue
    const key = axis === 'outbound' ? cell.outbound : cell.return
    const existing = cheapestByAxis.get(key)
    if (!existing || cell.price < existing.price) {
      cheapestByAxis.set(key, cell)
    }
  }
  const center = new Date(centerIso + 'T00:00:00Z')
  if (Number.isNaN(center.getTime())) return { days: [], spread: null }
  const days: DayCell[] = []
  for (let i = -3; i <= 3; i++) {
    const d = new Date(center)
    d.setUTCDate(center.getUTCDate() + i)
    const iso = d.toISOString().slice(0, 10)
    const cell = cheapestByAxis.get(iso)
    if (!cell) continue
    days.push({
      iso,
      weekday: WEEKDAYS[d.getUTCDay()],
      day: d.getUTCDate(),
      price: cell.price,
      currency: cell.currency,
      tier: 'avg',
      selected: iso === selectedIso,
    })
  }
  if (days.length === 0) return { days: [], spread: null }
  const prices = days.map(d => d.price)
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const spread = max - min
  const lo = min + spread / 3
  const hi = min + (spread * 2) / 3
  for (const d of days) {
    d.tier = d.price <= lo ? 'cheap' : d.price >= hi ? 'pricy' : 'avg'
  }
  return { days, spread }
}

function formatSingleDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00Z')
  if (Number.isNaN(d.getTime())) return ''
  return `${formatMonthShort(d.getUTCMonth())} ${d.getUTCDate()}`
}

function formatDateRange(dep: string | null, ret: string | null): string {
  if (!dep) return 'your dates'
  const d = new Date(dep + 'T00:00:00Z')
  if (Number.isNaN(d.getTime())) return 'your dates'
  if (!ret) return `${formatMonthShort(d.getUTCMonth())} ${d.getUTCDate()}`
  const r = new Date(ret + 'T00:00:00Z')
  if (Number.isNaN(r.getTime())) return `${formatMonthShort(d.getUTCMonth())} ${d.getUTCDate()}`
  if (d.getUTCMonth() === r.getUTCMonth()) {
    return `${formatMonthShort(d.getUTCMonth())} ${d.getUTCDate()}–${r.getUTCDate()}`
  }
  return `${formatMonthShort(d.getUTCMonth())} ${d.getUTCDate()} – ${formatMonthShort(r.getUTCMonth())} ${r.getUTCDate()}`
}

function inferMonthName(dep: string | null): string {
  if (!dep) return 'the month'
  const d = new Date(dep + 'T00:00:00Z')
  if (Number.isNaN(d.getTime())) return 'the month'
  return MONTHS_FULL[d.getUTCMonth()]
}

function formatRouteShort(parsed: ParsedData): string | null {
  if (!parsed.origin || !parsed.destination) return null
  return `${parsed.origin} → ${parsed.destination}`
}

// Local fallback when the Gemini parse-query is unavailable (dev without
// Vertex, or transient outage). Yields just the date-flexibility step.
function localFallbackParse(query: string): ParsedData {
  const local = parseNLQuery(query)
  return {
    origin: local.origin ?? null,
    destination: local.destination ?? null,
    departure_date: local.date && !local.date_is_default ? local.date : null,
    return_date: local.return_date ?? null,
    is_round_trip: Boolean(local.return_date),
    skip_refine_question: null,
    follow_up_questions: null,
    _fallback: true,
  }
}

// ─── Step assembly ─────────────────────────────────────────────────────────

function buildSteps(parsed: ParsedData): Step[] {
  const steps: Step[] = []

  // Date-flexibility step — only when Gemini didn't tell us to skip AND
  // the user actually gave us a concrete outbound date to work with.
  const skipDate = parsed.skip_refine_question === true
  if (!skipDate && parsed.departure_date) {
    steps.push({
      kind: 'date_flexibility',
      topic: 'date_flexibility',
      question: 'How flexible are you with your travel dates?',
    })
  }

  // All other follow-up questions Gemini suggested.
  for (const q of parsed.follow_up_questions ?? []) {
    if (!q?.topic) continue
    const options = (q.suggested_answers ?? [])
      .filter((s): s is SuggestedAnswer => Boolean(s?.key))
      .map(s => ({ key: s.key.trim(), label: (s.label ?? s.key).trim() }))
    if (options.length === 0 && !q.free_hint) continue
    steps.push({
      kind: 'chips',
      topic: q.topic,
      question: q.question?.trim() || q.topic,
      options,
      multiChoice: q.multi_choice === true,
      freeHint: q.free_hint?.trim() || undefined,
    })
  }

  return steps
}

// ─── Component ─────────────────────────────────────────────────────────────

export default function RefineClient({ query, locale, initialCurrency, probeMode }: RefineClientProps) {
  const router = useRouter()
  const [parsed, setParsed] = useState<ParsedData | null>(null)
  const [loading, setLoading] = useState(true)

  const [currentStepIdx, setCurrentStepIdx] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [dateFlex, setDateFlex] = useState<DateFlex>('fixed')
  const [multiSel, setMultiSel] = useState<string[]>([])
  const [freeText, setFreeText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [testNotice, setTestNotice] = useState<string | null>(null)

  // Load parsed data: try sessionStorage handoff first, else refetch.
  useEffect(() => {
    if (!query) {
      router.replace(`/${locale}`)
      return
    }
    let cancelled = false

    try {
      const raw = sessionStorage.getItem(REFINE_HANDOFF_KEY)
      if (raw) {
        const handoff = JSON.parse(raw) as { query: string; parsed: ParsedData }
        // Only use the cache if it's for THIS query AND it wasn't produced
        // by the local fallback (we want fresh Gemini data when possible).
        if (handoff.query === query && handoff.parsed && !handoff.parsed._fallback) {
          setParsed(handoff.parsed)
          setLoading(false)
          return
        }
        // Drop stale fallback entries so we don't keep reading them.
        if (handoff.parsed?._fallback) {
          sessionStorage.removeItem(REFINE_HANDOFF_KEY)
        }
      }
    } catch {
      // fall through to refetch
    }

    const ctrl = new AbortController()
    fetch('/api/parse-query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: ctrl.signal,
    })
      .then(async res => res.ok ? (await res.json().catch(() => null)) : null)
      .then((data: unknown) => {
        if (cancelled) return
        if (!data || typeof (data as { error?: string }).error === 'string') {
          // Gemini unavailable — fall back to a local parse so the user still
          // sees at least the date-flexibility step.
          setParsed(localFallbackParse(query))
          setLoading(false)
          return
        }
        setParsed(data as ParsedData)
        setLoading(false)
      })
      .catch(() => {
        if (!cancelled) {
          setParsed(localFallbackParse(query))
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
      ctrl.abort()
    }
  }, [query, locale, router])

  const steps = useMemo<Step[]>(() => (parsed ? buildSteps(parsed) : []), [parsed])
  const step = steps[currentStepIdx]
  const isLast = currentStepIdx >= steps.length - 1

  const [dateGrid, setDateGrid] = useState<DateGridResponse | null>(null)
  const [dateGridError, setDateGridError] = useState<string | null>(null)

  // Fetch the real Google Flights price grid once we know the route + dates.
  useEffect(() => {
    if (!parsed?.departure_date || !parsed?.origin || !parsed?.destination) return
    let cancelled = false
    const ctrl = new AbortController()
    const params = new URLSearchParams()
    params.set('origin', parsed.origin)
    params.set('destination', parsed.destination)
    params.set('dep', parsed.departure_date)
    if (parsed.return_date) params.set('ret', parsed.return_date)
    if (initialCurrency) params.set('cur', initialCurrency)
    fetch(`/api/date-grid?${params.toString()}`, { signal: ctrl.signal })
      .then(async res => {
        if (!res.ok) {
          const errText = await res.text().catch(() => '')
          throw new Error(`HTTP ${res.status} ${errText.slice(0, 120)}`)
        }
        return res.json() as Promise<DateGridResponse>
      })
      .then(data => {
        if (cancelled) return
        if (!data || !Array.isArray(data.grid) || data.grid.length === 0) {
          setDateGridError('no-data')
          return
        }
        setDateGrid(data)
        setDateGridError(null)
      })
      .catch(err => {
        if (cancelled) return
        setDateGridError(err instanceof Error ? err.message : 'unknown')
      })
    return () => { cancelled = true; ctrl.abort() }
  }, [parsed?.departure_date, parsed?.return_date, parsed?.origin, parsed?.destination, initialCurrency])

  // User's current outbound + return date selection. Defaults to the parsed
  // dates and updates when they tap a different cell on either strip.
  const [chosenDep, setChosenDep] = useState<string | null>(null)
  const [chosenRet, setChosenRet] = useState<string | null>(null)

  // Progressive disclosure: show ONE strip at a time. Click on the departure
  // strip → advance to the return strip → click there to lock in. After both,
  // the strips collapse to a compact summary (with a "change dates" affordance).
  type DateStage = 'dep' | 'ret' | 'done'
  const [dateStage, setDateStage] = useState<DateStage>('dep')

  // Re-sync when a new parsed payload arrives (e.g. different search).
  useEffect(() => {
    setChosenDep(parsed?.departure_date ?? null)
    setChosenRet(parsed?.return_date ?? null)
    setDateStage('dep')
  }, [parsed?.departure_date, parsed?.return_date])

  const { depDays, retDays, spread } = useMemo(() => {
    if (!dateGrid || !parsed?.departure_date) {
      return { depDays: [], retDays: [], spread: null }
    }
    const dep = buildAxisStrip(dateGrid, 'outbound', parsed.departure_date, chosenDep)
    const ret = parsed.return_date
      ? buildAxisStrip(dateGrid, 'return', parsed.return_date, chosenRet)
      : { days: [], spread: null }
    // Use the bigger of the two spreads for the "I found differences of up to X" line.
    const spread = Math.max(dep.spread ?? 0, ret.spread ?? 0) || null
    return { depDays: dep.days, retDays: ret.days, spread }
  }, [dateGrid, parsed?.departure_date, parsed?.return_date, chosenDep, chosenRet])

  const route = useMemo(() => (parsed ? formatRouteShort(parsed) : null), [parsed])
  const reverseRoute = useMemo(() => {
    if (!parsed?.origin || !parsed?.destination) return null
    return `${parsed.destination} → ${parsed.origin}`
  }, [parsed?.origin, parsed?.destination])
  // The "Fixed dates (May 30 - Jun 1)" label reflects the user's current pick,
  // not the original parse — so it updates as they shift the strip.
  const chosenRange = useMemo(
    () => formatDateRange(chosenDep, chosenRet),
    [chosenDep, chosenRet],
  )
  const depLabel = useMemo(
    () => formatSingleDate(chosenDep),
    [chosenDep],
  )
  const retLabel = useMemo(
    () => formatSingleDate(chosenRet),
    [chosenRet],
  )
  const monthName = useMemo(() => inferMonthName(parsed?.departure_date ?? null), [parsed])

  // If parsing finished but there's nothing to ask, bail straight to results.
  useEffect(() => {
    if (loading) return
    if (parsed && steps.length === 0) {
      if (!FIRE_SEARCH_ON_SUBMIT) {
        setTestNotice('No questions to ask — would go straight to results. Search firing disabled while testing.')
        return
      }
      goToResults({})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, parsed, steps.length])

  function goToResults(collected: Record<string, string>) {
    setSubmitting(true)
    const params = new URLSearchParams()
    params.set('q', query)
    if (initialCurrency) params.set('cur', initialCurrency)
    if (probeMode) params.set('probe', '1')
    for (const [k, v] of Object.entries(collected)) {
      if (v) params.set(`r_${k}`, v)
    }
    router.push(`/results/pending?${params.toString()}`)
  }

  function commitAndAdvance(value: string) {
    if (!step) return
    const next = { ...answers, [step.topic]: value }
    setAnswers(next)
    setMultiSel([])
    setFreeText('')
    if (isLast) {
      if (!FIRE_SEARCH_ON_SUBMIT) {
        setTestNotice(`Answers: ${JSON.stringify(next)} — would start search. Search firing disabled while testing.`)
        window.setTimeout(() => setTestNotice(null), 5000)
        return
      }
      goToResults(next)
    } else {
      setCurrentStepIdx(i => i + 1)
    }
  }

  function skipStep() {
    if (!step) return
    setMultiSel([])
    setFreeText('')
    if (isLast) {
      if (!FIRE_SEARCH_ON_SUBMIT) {
        setTestNotice(`Skipped final step. Answers: ${JSON.stringify(answers)} — would start search. Search firing disabled while testing.`)
        window.setTimeout(() => setTestNotice(null), 5000)
        return
      }
      goToResults(answers)
    } else {
      setCurrentStepIdx(i => i + 1)
    }
  }

  // ─── Loading / error states ─────────────────────────────────────────────

  if (loading) {
    return (
      <main className="rf-page">
        <header className="lp-topbar">
          <HomeLogo locale={locale} />
          <div className="lp-topbar-side">
            <GlobeButton inline />
            <CurrencyButton inline behavior="persist" initialCurrency={initialCurrency} probeMode={probeMode} />
          </div>
        </header>
        <section className="rf-body">
          <div className="rf-progress" aria-hidden="true">
            <span className="rf-progress-step rf-progress-step--done" />
            <span className="rf-progress-step rf-progress-step--active" />
            <span className="rf-progress-step" />
          </div>
          <p className="rf-question">Thinking about what to ask next…</p>
        </section>
      </main>
    )
  }

  if (!parsed) {
    return (
      <main className="rf-page">
        <header className="lp-topbar">
          <HomeLogo locale={locale} />
          <div className="lp-topbar-side">
            <GlobeButton inline />
            <CurrencyButton inline behavior="persist" initialCurrency={initialCurrency} probeMode={probeMode} />
          </div>
        </header>
        <section className="rf-body">
          <p className="rf-question">Something didn&apos;t parse right.</p>
          <p className="rf-sub">Let&apos;s start the search anyway.</p>
          <div className="rf-actions">
            <button type="button" className="rf-cta" onClick={() => goToResults({})}>
              <span>Start searching</span>
            </button>
          </div>
        </section>
      </main>
    )
  }

  // ─── Render current step ────────────────────────────────────────────────

  return (
    <main className="rf-page">
      <header className="lp-topbar">
        <HomeLogo locale={locale} />
        <div className="lp-topbar-side">
          <GlobeButton inline />
          <CurrencyButton inline behavior="persist" initialCurrency={initialCurrency} probeMode={probeMode} />
        </div>
      </header>

      <section className="rf-body">
        <div className="rf-progress" aria-label={`Step ${currentStepIdx + 1} of ${steps.length}`}>
          {steps.map((_, i) => (
            <span
              key={i}
              className={`rf-progress-step${i < currentStepIdx ? ' rf-progress-step--done' : i === currentStepIdx ? ' rf-progress-step--active' : ''}`}
            />
          ))}
        </div>

        {step && (
          <>
            <h1 className="rf-question">{step.question}</h1>

            {step.kind === 'date_flexibility' && (
              <>
                {spread !== null && spread > 0 && dateGrid?.currency && (
                  <p className="rf-sub">
                    I found price differences of up to <strong>{dateGrid.currency} {spread}</strong> within ±3 days of your chosen date.
                  </p>
                )}
                {dateGrid === null && dateGridError === null && (
                  <p className="rf-sub">Checking nearby-date prices on Google Flights…</p>
                )}
                {dateGridError !== null && (
                  <p className="rf-sub">Couldn&apos;t pull live nearby-date prices right now — pick what works for you.</p>
                )}

                {dateStage === 'dep' && depDays.length > 0 && (
                  <div className="rf-signal">
                    <div className="rf-signal-label">
                      Departure prices for {depLabel}{route ? ` (${route})` : ''}
                    </div>
                    <div className="rf-day-grid" role="list">
                      {depDays.map(day => (
                        <button
                          key={day.iso}
                          type="button"
                          role="listitem"
                          aria-pressed={day.selected}
                          aria-label={`Departure ${day.weekday} ${day.day} — ${day.currency ?? ''} ${day.price}`}
                          className={`rf-day rf-day--${day.tier}${day.selected ? ' rf-day--selected' : ''}`}
                          onClick={() => {
                            setChosenDep(day.iso)
                            // Advance to the return strip even if user clicked
                            // the date they already had — that's their signal
                            // they're done with departure.
                            if (parsed?.return_date) setDateStage('ret')
                            else setDateStage('done')
                          }}
                        >
                          <span className="rf-day-name">{day.weekday}</span>
                          <span className="rf-day-num">{day.day}</span>
                          <span className="rf-day-price">{day.currency ?? ''} {day.price}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {dateStage === 'ret' && retDays.length > 0 && (
                  <div className="rf-signal">
                    <div className="rf-signal-label">
                      Return prices for {retLabel}{reverseRoute ? ` (${reverseRoute})` : ''}
                    </div>
                    <div className="rf-day-grid" role="list">
                      {retDays.map(day => (
                        <button
                          key={day.iso}
                          type="button"
                          role="listitem"
                          aria-pressed={day.selected}
                          aria-label={`Return ${day.weekday} ${day.day} — ${day.currency ?? ''} ${day.price}`}
                          className={`rf-day rf-day--${day.tier}${day.selected ? ' rf-day--selected' : ''}`}
                          onClick={() => {
                            setChosenRet(day.iso)
                            setDateStage('done')
                          }}
                        >
                          <span className="rf-day-name">{day.weekday}</span>
                          <span className="rf-day-num">{day.day}</span>
                          <span className="rf-day-price">{day.currency ?? ''} {day.price}</span>
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="rf-signal-back"
                      onClick={() => setDateStage('dep')}
                      aria-label="Back to departure dates"
                    >
                      ← Change departure
                    </button>
                  </div>
                )}

                {dateStage === 'done' && (depDays.length > 0 || retDays.length > 0) && (
                  <div className="rf-signal rf-signal--compact">
                    <span className="rf-signal-label rf-signal-label--inline">
                      Locked in: <strong>{chosenRange}</strong>{route ? ` · ${route}` : ''}
                    </span>
                    <button
                      type="button"
                      className="rf-signal-change"
                      onClick={() => setDateStage('dep')}
                    >
                      Change dates
                    </button>
                  </div>
                )}

                {dateStage !== 'done' && (depDays.length > 0 || retDays.length > 0) && (
                  <div className="rf-legend">
                    <span><span className="rf-legend-dot rf-legend-dot--cheap" />Cheaper</span>
                    <span><span className="rf-legend-dot rf-legend-dot--avg" />Average</span>
                    <span><span className="rf-legend-dot rf-legend-dot--pricy" />Pricier</span>
                  </div>
                )}

                <div className="rf-options" role="radiogroup" aria-label="Date flexibility">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={dateFlex === 'fixed'}
                    className={`rf-option${dateFlex === 'fixed' ? ' rf-option--selected' : ''}`}
                    onClick={() => setDateFlex('fixed')}
                  >
                    <span className="rf-option-icon" aria-hidden="true"><PinIcon /></span>
                    <div className="rf-option-body">
                      <strong className="rf-option-title">Fixed dates ({chosenRange})</strong>
                      <span className="rf-option-sub">Search only these dates</span>
                    </div>
                    {dateFlex === 'fixed' && <span className="rf-option-check" aria-hidden="true"><CheckIcon /></span>}
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={dateFlex === 'plus_minus_3'}
                    className={`rf-option${dateFlex === 'plus_minus_3' ? ' rf-option--selected' : ''}`}
                    onClick={() => setDateFlex('plus_minus_3')}
                  >
                    <span className="rf-option-icon" aria-hidden="true"><FlexIcon /></span>
                    <div className="rf-option-body">
                      <strong className="rf-option-title">±3 days either side</strong>
                      <span className="rf-option-sub">Recommended · more options, often cheaper</span>
                    </div>
                    {dateFlex === 'plus_minus_3' && <span className="rf-option-check" aria-hidden="true"><CheckIcon /></span>}
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={dateFlex === 'whole_month'}
                    className={`rf-option${dateFlex === 'whole_month' ? ' rf-option--selected' : ''}`}
                    onClick={() => setDateFlex('whole_month')}
                  >
                    <span className="rf-option-icon" aria-hidden="true"><MonthIcon /></span>
                    <div className="rf-option-body">
                      <strong className="rf-option-title">Flexible, show me all of {monthName}</strong>
                      <span className="rf-option-sub">Best price anywhere in the month</span>
                    </div>
                    {dateFlex === 'whole_month' && <span className="rf-option-check" aria-hidden="true"><CheckIcon /></span>}
                  </button>
                </div>
              </>
            )}

            {step.kind === 'chips' && (
              <>
                {step.options.length > 0 && (
                  <div className="rf-q-chips" role={step.multiChoice ? undefined : 'radiogroup'} aria-label={step.topic}>
                    {step.options.map(opt => {
                      const isSelected = step.multiChoice
                        ? multiSel.includes(opt.key)
                        : answers[step.topic] === opt.key
                      return (
                        <button
                          key={opt.key}
                          type="button"
                          role={step.multiChoice ? 'checkbox' : 'radio'}
                          aria-checked={isSelected}
                          className={`rf-q-chip${isSelected ? ' rf-q-chip--selected' : ''}`}
                          onClick={() => {
                            if (step.multiChoice) {
                              setMultiSel(prev =>
                                prev.includes(opt.key)
                                  ? prev.filter(k => k !== opt.key)
                                  : [...prev, opt.key],
                              )
                            } else {
                              commitAndAdvance(opt.key)
                            }
                          }}
                        >
                          {step.multiChoice && isSelected && (
                            <span className="rf-q-chip-check" aria-hidden="true"><CheckIcon /></span>
                          )}
                          {opt.label}
                        </button>
                      )
                    })}
                  </div>
                )}

                {step.freeHint && (
                  <div className="rf-free">
                    <input
                      type="text"
                      className="rf-free-input"
                      placeholder={step.freeHint}
                      value={freeText}
                      onChange={e => setFreeText(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && freeText.trim()) {
                          e.preventDefault()
                          commitAndAdvance(freeText.trim())
                        }
                      }}
                    />
                  </div>
                )}
              </>
            )}

            <div className="rf-actions">
              <button
                type="button"
                className="rf-cta"
                onClick={() => {
                  if (step.kind === 'date_flexibility') {
                    commitAndAdvance(dateFlex)
                  } else if (step.kind === 'chips' && step.multiChoice) {
                    if (multiSel.length === 0) return
                    commitAndAdvance(multiSel.join(','))
                  } else if (step.kind === 'chips' && step.freeHint && freeText.trim()) {
                    commitAndAdvance(freeText.trim())
                  } else if (step.kind === 'chips' && answers[step.topic]) {
                    commitAndAdvance(answers[step.topic])
                  }
                }}
                disabled={
                  submitting ||
                  (step.kind === 'chips' && step.multiChoice && multiSel.length === 0) ||
                  (step.kind === 'chips' && !step.multiChoice && !step.freeHint && !answers[step.topic])
                }
              >
                {isLast ? (
                  <>
                    <SearchGlassIcon />
                    <span>{submitting ? 'Starting search…' : 'Start searching'}</span>
                  </>
                ) : (
                  <>
                    <span>Next</span>
                    <ArrowRightIcon />
                  </>
                )}
              </button>
              <button type="button" className="rf-skip" onClick={skipStep} disabled={submitting}>
                {isLast ? `Skip, use ${chosenRange} exactly` : 'Skip this question'}
              </button>
            </div>
          </>
        )}
      </section>

      {testNotice && (
        <div className="rf-test-toast" role="status" aria-live="polite">
          {testNotice}
        </div>
      )}
    </main>
  )
}
