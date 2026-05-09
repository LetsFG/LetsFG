'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { trackSearchSessionEvent } from '../lib/search-session-analytics'
import { useExperiment } from '../lib/ab-testing'
import type { ExperimentConfig } from '../lib/ab-testing'

export const BOOKING_FRICTION_EXPERIMENT_ID = 'exp_booking-friction-survey-v1'

const BOOKING_FRICTION_EXPERIMENT: ExperimentConfig<'control' | 'survey'> = {
  id: BOOKING_FRICTION_EXPERIMENT_ID,
  variants: { control: 0.5, survey: 0.5 },
}

// Results page: show 3.5 minutes after search fully completes
const RESULTS_DELAY_MS = 3.5 * 60 * 1000
// Checkout page: show 3 minutes after arriving on checkout
const CHECKOUT_DELAY_MS = 3 * 60 * 1000

// Session key: dismissed this browser session
const SS_KEY_DISMISSED = 'lfg_bfs_dismissed'
// Persistent key: user already answered once — never show again
const LS_KEY_DONE = 'lfg_bfs_done'
// Set by CheckoutPanel on mount so results page can detect "came back from checkout"
export const SS_KEY_CHECKOUT_VISITED = 'lfg_checkout_visited'

// Keys used in analytics — never translate these, stats dashboard maps them to English labels
const OPTION_KEYS = [
  'dont_trust',
  'price_might_drop',
  'not_looking',
  'better_elsewhere',
  'no_bnpl',
  'concierge_fee',
  'other',
] as const

type OptionKey = (typeof OPTION_KEYS)[number]

// Keys that have a follow-up question (other = submit immediately)
const KEYS_WITH_FOLLOWUP = new Set<OptionKey>([
  'dont_trust',
  'price_might_drop',
  'not_looking',
  'better_elsewhere',
  'no_bnpl',
  'concierge_fee',
])

interface Props {
  searchId: string | null
  /** Pass for analytics when rendered on the checkout page */
  offerId?: string
  isTestSearch?: boolean
  /** Which page this is rendered on — affects timer duration */
  context: 'results' | 'checkout'
  /**
   * Results context only: timestamp (Date.now()) when all results finished loading.
   * Null means search is still in progress — timer won't start yet.
   */
  resultsCompletedAt?: number | null
  /**
   * Results context only: show the survey immediately (user came back from checkout
   * without booking). Skips the 3.5-minute timer.
   */
  showImmediately?: boolean
}

export default function BookingFrictionSurvey({
  searchId,
  offerId,
  isTestSearch,
  context,
  resultsCompletedAt,
  showImmediately,
}: Props) {
  const t = useTranslations('BookingFrictionSurvey')
  const { isControl } = useExperiment(BOOKING_FRICTION_EXPERIMENT, searchId)

  // SSR-safe suppression: hydrate from storage on client only
  const [suppressed, setSuppressed] = useState(false)
  useEffect(() => {
    try {
      if (localStorage.getItem(LS_KEY_DONE) || sessionStorage.getItem(SS_KEY_DISMISSED)) {
        setSuppressed(true)
      }
    } catch (_) { /* private mode — ignore */ }
  }, [])

  const [visible, setVisible] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  // Two-step flow: first pick an option, then optionally answer a followup
  const [pendingKey, setPendingKey] = useState<OptionKey | null>(null)
  const [followupText, setFollowupText] = useState('')

  // Results: show immediately when user came back from checkout without booking
  useEffect(() => {
    if (suppressed || dismissed || context !== 'results' || !showImmediately) return
    setVisible(true)
  }, [suppressed, dismissed, context, showImmediately])

  // Results: 3.5-minute timer — only starts once search is fully complete
  useEffect(() => {
    if (suppressed || dismissed || context !== 'results' || showImmediately) return
    if (resultsCompletedAt == null) return
    const elapsed = Date.now() - resultsCompletedAt
    const remaining = Math.max(0, RESULTS_DELAY_MS - elapsed)
    const id = window.setTimeout(() => {
      if (!dismissed) setVisible(true)
    }, remaining)
    return () => window.clearTimeout(id)
  }, [suppressed, dismissed, context, showImmediately, resultsCompletedAt])

  // Checkout: 3-minute timer from mount
  useEffect(() => {
    if (suppressed || dismissed || context !== 'checkout') return
    const id = window.setTimeout(() => {
      if (!dismissed) setVisible(true)
    }, CHECKOUT_DELAY_MS)
    return () => window.clearTimeout(id)
  }, [suppressed, dismissed, context])

  const handleDismiss = useCallback(() => {
    setVisible(false)
    setDismissed(true)
    try { sessionStorage.setItem(SS_KEY_DISMISSED, '1') } catch (_) { /* ignore */ }
  }, [])

  const handleSubmit = useCallback((key: OptionKey, text?: string) => {
    if (submitted) return
    trackSearchSessionEvent(searchId, 'booking_friction_survey_response', {
      experiment_id: BOOKING_FRICTION_EXPERIMENT_ID,
      response_key: key,
      context,
      ...(offerId ? { offer_id: offerId } : {}),
      ...(text ? { response_text: text.slice(0, 500) } : {}),
    }, {
      source: context === 'results' ? 'website-results' : 'website-checkout',
      is_test_search: isTestSearch || undefined,
    })
    setSubmitted(true)
    setVisible(false)
    try { localStorage.setItem(LS_KEY_DONE, '1') } catch (_) { /* ignore */ }
  }, [submitted, searchId, offerId, context, isTestSearch])

  // All hooks must be above any conditional returns
  if (isControl) return null
  if (suppressed || dismissed) return null

  if (submitted) {
    return (
      <div className="bfs-bar bfs-bar--thanks" role="status" aria-live="polite">
        <span className="bfs-thanks-check" aria-hidden="true">✓</span>
        {t('thanks')}
      </div>
    )
  }

  if (!visible) return null

  const hasFollowup = pendingKey !== null && KEYS_WITH_FOLLOWUP.has(pendingKey)
  const selectedLabel = pendingKey ? t(`opt_${pendingKey}`) : null

  return (
    <div className="bfs-bar" role="complementary" aria-label="Quick survey">
      <div className="bfs-inner">
        <div className="bfs-header">
          <span className="bfs-question">
            {hasFollowup ? t(`followup_${pendingKey}`) : t('headerFull')}
          </span>
          <button
            className="bfs-close"
            onClick={handleDismiss}
            aria-label="Dismiss survey"
            type="button"
          >✕</button>
        </div>

        {hasFollowup ? (
          <div className="bfs-followup">
            <p className="bfs-followup-selected">✓ {selectedLabel}</p>
            <textarea
              className="bfs-followup-input"
              autoFocus
              maxLength={500}
              rows={2}
              placeholder={t(`placeholder_${pendingKey}`)}
              value={followupText}
              onChange={(e) => setFollowupText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSubmit(pendingKey!, followupText.trim() || undefined)
                }
              }}
            />
            <div className="bfs-followup-actions">
              <button
                className="bfs-other-send"
                type="button"
                onClick={() => handleSubmit(pendingKey!, followupText.trim() || undefined)}
              >{t('send')}</button>
              <button
                className="bfs-followup-skip"
                type="button"
                onClick={() => handleSubmit(pendingKey!, undefined)}
              >{t('skip')}</button>
            </div>
          </div>
        ) : (
          <div className="bfs-options">
            {OPTION_KEYS.map((key) => (
              <button
                key={key}
                className="bfs-option"
                type="button"
                onClick={() => {
                  if (KEYS_WITH_FOLLOWUP.has(key)) {
                    setPendingKey(key)
                    setFollowupText('')
                  } else {
                    // 'other' — submit immediately, no follow-up
                    handleSubmit(key)
                  }
                }}
              >{t(`opt_${key}`)}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
