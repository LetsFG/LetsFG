'use client'

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter, useSearchParams } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import CurrencyButton from '../../currency-button'
import GlobeButton from '../../globe-button'
import SearchingLoadingScene from '../SearchingLoadingScene'
import { normalizeCurrencyCode } from '../../../lib/currency-preference'
import { buildLocaleHomePath, setResultsLocaleSearchParam } from '../../../lib/locale-routing'
import {
  clearClientSearchHandoff,
  createClientSearchHandoffToken,
  startClientSearchHandoff,
  waitForClientSearchHandoff,
} from '../../../lib/client-search-handoff'
import { parseNLQuery } from '../../lib/searchParsing'

const PREFIRE_ROUTE_WAIT_MS = 2500

// Read by both /refine and /pending — populated by /confirm with the latest
// Gemini parse so we don't re-fetch /api/parse-query on every page.
const REFINE_HANDOFF_KEY = 'lfg_refine_handoff'

// Reveal the agent question card this long after mount so it doesn't compete
// with the rotating headline and graphic for the user's first glance.
const AGENT_REVEAL_DELAY_MS = 1200

// Poll /api/results/{searchId} this often once we have a searchId, until the
// first offers arrive (or the search completes / errors out). Keeps the user
// on the loading page — answering the agent question — while the backend
// connectors actually find something worth showing.
const OFFER_POLL_FIRST_PHASE_MS = 1500
const OFFER_POLL_LATER_PHASE_MS = 3000
const OFFER_POLL_FIRST_PHASE_DURATION_MS = 15000
// Hard cap so a totally stuck search never traps the user on /pending.
const OFFER_POLL_HARD_TIMEOUT_MS = 90_000

interface LoadingSuggestedAnswer {
  key: string
  label?: string | null
}

interface LoadingQuestion {
  topic: string
  question?: string | null
  multi_choice?: boolean | null
  suggested_answers?: LoadingSuggestedAnswer[] | null
}

// Icon + sublabel key hardcoded by topic+key — sublabels resolve to
// translations at render time. Backend only knows label/key.
const OPTION_META: Record<string, { emoji: string; sublabelKey: string }> = {
  'baggage:carry_on': { emoji: '🎒', sublabelKey: 'optCarryOnSub' },
  'baggage:1_bag': { emoji: '🧳', sublabelKey: 'opt1BagSub' },
  'baggage:2_bags': { emoji: '🧳🧳', sublabelKey: 'opt2BagsSub' },
  'baggage:unsure': { emoji: '❓', sublabelKey: 'optUnsureSub' },
  'seat_selection:together': { emoji: '👫', sublabelKey: 'optSeatTogetherSub' },
  'seat_selection:pick': { emoji: '🎯', sublabelKey: 'optSeatPickSub' },
  'seat_selection:any_window_aisle': { emoji: '🪟', sublabelKey: 'optSeatWindowAisleSub' },
  'seat_selection:auto': { emoji: '🎲', sublabelKey: 'optSeatAutoSub' },
}

function readCachedLoadingQuestions(query: string): LoadingQuestion[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = sessionStorage.getItem(REFINE_HANDOFF_KEY)
    if (!raw) return []
    const handoff = JSON.parse(raw) as {
      query?: string
      parsed?: { loading_questions?: LoadingQuestion[] | null }
    }
    if ((handoff?.query ?? '').trim() !== query.trim()) return []
    const list = handoff.parsed?.loading_questions
    if (!Array.isArray(list)) return []
    return list.filter((q): q is LoadingQuestion =>
      !!q && typeof q.question === 'string' && q.question.trim().length > 0,
    )
  } catch {
    return []
  }
}

function HomeLogo({ locale }: { locale: string }) {
  const t = useTranslations('Pending')
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

function PendingResultsInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const locale = useLocale()
  const t = useTranslations('Pending')
  const searchParamString = searchParams.toString()
  const query = searchParams.get('q')?.trim() || ''
  const probeMode = searchParams.get('probe') === '1'
  const initialCurrency = normalizeCurrencyCode(searchParams.get('cur')) || 'EUR'
  const launchToken = searchParams.get('launch')?.trim() || ''
  const homeHref = buildLocaleHomePath(locale, probeMode)
  const parsed = useMemo(() => {
    try {
      return parseNLQuery(query)
    } catch {
      return null
    }
  }, [query])

  // Loading-page agent answers keyed by question topic. Carried into the
  // results URL as r_<topic>=<value>, matching the refine page convention so
  // the ranking layer (ai_bags_included / require_seat_selection → defaultSort
  // = 'price_with_all') picks them up without a separate code path.
  const [loadingAnswers, setLoadingAnswers] = useState<Record<string, string>>({})
  const loadingAnswersRef = useRef(loadingAnswers)
  useEffect(() => {
    loadingAnswersRef.current = loadingAnswers
  }, [loadingAnswers])

  const loadingQuestions = useMemo(() => readCachedLoadingQuestions(query), [query])
  const [questionIdx, setQuestionIdx] = useState(0)
  const [questionVisible, setQuestionVisible] = useState(false)
  const [questionsSkipped, setQuestionsSkipped] = useState(false)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  useEffect(() => {
    if (loadingQuestions.length === 0 || questionsSkipped) return
    const t = setTimeout(() => setQuestionVisible(true), AGENT_REVEAL_DELAY_MS)
    return () => clearTimeout(t)
  }, [loadingQuestions.length, questionsSkipped])

  // Phrase rotation, loading bar, graphic — all owned by SearchingLoadingScene now.

  // Two-phase navigation. Phase 1 (handoff) resolves a searchId. Phase 2
  // polls /api/results/{searchId} and only redirects once the first partial
  // offers arrive (or the search terminates) so the loading page actually
  // serves a purpose instead of flashing past on the way to an empty list.
  const [searchId, setSearchId] = useState<string | null>(null)
  const [fswSession, setFswSession] = useState<string | undefined>(undefined)
  const navigatedRef = useRef(false)
  // Module-level Map in client-search-handoff dedups concurrent calls on the
  // same token, so we deliberately DON'T guard re-entry here. A guard here
  // combined with React-StrictMode's double-invoke would cause the first
  // invocation to be cancelled by its cleanup, the second to bail on the
  // guard, and setSearchId to never fire → no polling.

  useEffect(() => {
    router.prefetch(homeHref)
  }, [homeHref, router])

  // Phase 1 — resolve searchId via the existing handoff helpers.
  useEffect(() => {
    if (!query) {
      router.replace(homeHref)
      return
    }

    let cancelled = false
    const activeToken = launchToken || createClientSearchHandoffToken()

    async function resolveSearch() {
      let result = await waitForClientSearchHandoff(activeToken, PREFIRE_ROUTE_WAIT_MS)
      if (!result?.searchId) {
        result = await startClientSearchHandoff(activeToken, {
          query,
          currency: initialCurrency,
          probeMode,
        })
      }
      if (cancelled) return

      if (result?.searchId) {
        setSearchId(result.searchId)
        setFswSession(result.fswSession)
        return
      }

      clearClientSearchHandoff(activeToken)
      // Search start failed entirely — bail to /results so the existing
      // not-found / error UI handles it instead of trapping the user here.
      const fallbackParams = new URLSearchParams(searchParamString)
      fallbackParams.delete('launch')
      fallbackParams.set('q', query)
      navigatedRef.current = true
      router.replace(`/results?${fallbackParams.toString()}`)
    }

    void resolveSearch()
    return () => {
      cancelled = true
    }
  }, [homeHref, initialCurrency, launchToken, probeMode, query, router, searchParamString])

  // Phase 2 — once we have a searchId, poll until the first offers arrive
  // (or the search ends / hard-times-out), then redirect carrying any loading
  // answers the user has clicked into r_* params.
  useEffect(() => {
    if (!searchId || navigatedRef.current) return

    let cancelled = false
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const pollStart = Date.now()

    const redirect = (extra?: Partial<{ fss?: string }>) => {
      if (navigatedRef.current) return
      const nextParams = new URLSearchParams(searchParamString)
      nextParams.delete('launch')
      nextParams.set('q', query)
      nextParams.set('cur', initialCurrency)
      if (!nextParams.get('started')) {
        nextParams.set('started', String(pollStart))
      }
      setResultsLocaleSearchParam(nextParams, locale)
      for (const [topic, value] of Object.entries(loadingAnswersRef.current)) {
        if (value) nextParams.set(`r_${topic}`, value)
      }
      const fss = extra?.fss ?? fswSession
      if (fss) nextParams.set('_fss', fss)
      navigatedRef.current = true
      router.replace(`/results/${encodeURIComponent(searchId)}?${nextParams.toString()}`)
    }

    const poll = async () => {
      if (cancelled || navigatedRef.current) return

      const elapsedMs = Date.now() - pollStart
      if (elapsedMs >= OFFER_POLL_HARD_TIMEOUT_MS) {
        redirect()
        return
      }

      try {
        const params = new URLSearchParams()
        if (probeMode) params.set('probe', '1')
        if (fswSession) params.set('_fss', fswSession)
        if (query) params.set('q', query)
        if (initialCurrency) params.set('cur', initialCurrency)
        const queryString = params.toString()
        const res = await fetch(
          `/api/results/${encodeURIComponent(searchId)}${queryString ? `?${queryString}` : ''}`,
          { cache: 'no-store' },
        )
        if (!cancelled && res.ok) {
          const data = await res.json() as {
            status?: string
            offers?: unknown[]
          }
          const offerCount = Array.isArray(data.offers) ? data.offers.length : 0
          const finished = data.status && data.status !== 'searching'
          if (offerCount > 0 || finished) {
            redirect()
            return
          }
        }
      } catch (_) {
        // Network blip — retry on next tick. Hard-timeout still bounds us.
      }

      if (cancelled || navigatedRef.current) return
      const interval = elapsedMs < OFFER_POLL_FIRST_PHASE_DURATION_MS
        ? OFFER_POLL_FIRST_PHASE_MS
        : OFFER_POLL_LATER_PHASE_MS
      timeoutId = setTimeout(poll, interval)
    }

    timeoutId = setTimeout(poll, OFFER_POLL_FIRST_PHASE_MS)

    return () => {
      cancelled = true
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [fswSession, initialCurrency, locale, probeMode, query, router, searchId, searchParamString])

  const currentQuestion: LoadingQuestion | undefined = loadingQuestions[questionIdx]

  const handleAnswer = (value: string) => {
    if (!currentQuestion || selectedKey) return
    setSelectedKey(value)
    setLoadingAnswers(prev => ({ ...prev, [currentQuestion.topic]: value }))
    const hasNext = questionIdx + 1 < loadingQuestions.length
    if (hasNext) {
      setTimeout(() => setQuestionVisible(false), 240)
      setTimeout(() => {
        setQuestionIdx(idx => idx + 1)
        setSelectedKey(null)
        setQuestionVisible(true)
      }, 540)
    } else {
      setTimeout(() => setQuestionVisible(false), 540)
    }
  }

  const handleSkipAll = () => {
    setQuestionsSkipped(true)
    setQuestionVisible(false)
  }

  const originCode = parsed?.origin || undefined
  const destinationCode = parsed?.destination || undefined
  const originName = parsed?.origin_name || parsed?.origin || 'Origin'
  const destinationName = parsed?.destination_name || parsed?.destination || 'Destination'

  const showAgent = !questionsSkipped && !!currentQuestion

  return (
    <main className="pend-page">
      <header className="lp-topbar">
        <HomeLogo locale={locale} />
        <div className="lp-topbar-side">
          <GlobeButton inline />
          <CurrencyButton
            inline
            behavior={query ? 'rerun-search' : 'persist'}
            initialCurrency={initialCurrency}
            searchQuery={query}
            probeMode={probeMode}
          />
        </div>
      </header>

      <section className="pend-body">
        <SearchingLoadingScene
          originCode={originCode}
          originName={originName}
          destinationCode={destinationCode}
          destinationName={destinationName}
        />

        {showAgent ? (
          <div className={`pend-agent${questionVisible ? ' pend-agent--in' : ''}`}>
            <div className="pend-agent-card">
              <div className="pend-agent-prelude">{t('agentPrelude')}</div>
              <p className="pend-agent-question">{currentQuestion!.question}</p>
              <div className="pend-agent-grid">
                {(currentQuestion!.suggested_answers ?? []).map(opt => {
                  const meta = OPTION_META[`${currentQuestion!.topic}:${opt.key}`]
                  const isSelected = selectedKey === opt.key
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      className={`pend-agent-opt${isSelected ? ' pend-agent-opt--selected' : ''}`}
                      onClick={() => handleAnswer(opt.key)}
                      aria-pressed={isSelected}
                      disabled={!!selectedKey && !isSelected}
                    >
                      {meta?.emoji ? (
                        <span className="pend-agent-opt-emoji" aria-hidden="true">{meta.emoji}</span>
                      ) : null}
                      <span className="pend-agent-opt-body">
                        <span className="pend-agent-opt-label">{opt.label || opt.key}</span>
                        {meta?.sublabelKey ? (
                          <span className="pend-agent-opt-sub">{t(meta.sublabelKey)}</span>
                        ) : null}
                      </span>
                    </button>
                  )
                })}
              </div>
              <button type="button" className="pend-agent-skip" onClick={handleSkipAll}>
                {t('skipAllQuestions')}
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  )
}

export default function PendingResultsPage() {
  return (
    <Suspense>
      <PendingResultsInner />
    </Suspense>
  )
}
