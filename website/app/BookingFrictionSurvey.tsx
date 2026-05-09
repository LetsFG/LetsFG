'use client'

import { useState, useEffect, useCallback, useId } from 'react'
import { trackSearchSessionEvent } from '../lib/search-session-analytics'

export const BOOKING_FRICTION_EXPERIMENT_ID = 'exp_booking-friction-survey-v1'

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

const OPTIONS = [
  { key: 'dont_trust',       label: "I don't trust your results" },
  { key: 'price_might_drop', label: 'I think that when I buy now, the price might be lower later' },
  { key: 'not_looking',      label: "I'm not looking to fly, I was just curious about your website" },
  { key: 'better_elsewhere', label: 'I want to see if there are better offers elsewhere' },
  { key: 'no_bnpl',          label: "I like the option Buy now pay later, which I can't find here" },
  { key: 'concierge_fee',    label: "I don't want to pay LetsFG concierge fee" },
  { key: 'other',            label: 'Other' },
] as const

type OptionKey = (typeof OPTIONS)[number]['key']

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
  // SSR-safe suppression: hydrate from storage on client only
  const [suppressed, setSuppressed] = useState(false)
  useEffect(() => {
    try {
      if (localStorage.getItem(LS_KEY_DONE) || sessionStorage.getItem(SS_KEY_DISMISSED)) {
        setSuppressed(true)
      }
    } catch { /* private mode — ignore */ }
  }, [])

  const [visible, setVisible] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [otherSelected, setOtherSelected] = useState(false)
  const [otherText, setOtherText] = useState('')
  const otherId = useId()

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
    try { sessionStorage.setItem(SS_KEY_DISMISSED, '1') } catch { /* ignore */ }
  }, [])

  const handleSubmit = useCallback((key: OptionKey, text?: string) => {
    if (submitted) return
    trackSearchSessionEvent(searchId, 'booking_friction_survey_response', {
      experiment_id: BOOKING_FRICTION_EXPERIMENT_ID,
      response_key: key,
      context,
      ...(offerId ? { offer_id: offerId } : {}),
      ...(key === 'other' && text ? { response_text: text.slice(0, 500) } : {}),
    }, {
      source: context === 'results' ? 'website-results' : 'website-checkout',
      is_test_search: isTestSearch || undefined,
    })
    setSubmitted(true)
    setVisible(false)
    try { localStorage.setItem(LS_KEY_DONE, '1') } catch { /* ignore */ }
  }, [submitted, searchId, offerId, context, isTestSearch])

  if (suppressed || dismissed) return null

  if (submitted) {
    return (
      <div className="bfs-bar bfs-bar--thanks" role="status" aria-live="polite">
        <span className="bfs-thanks-check" aria-hidden="true">✓</span>
        Thanks — that helps a lot!
      </div>
    )
  }

  if (!visible) return null

  return (
    <div className="bfs-bar" role="complementary" aria-label="Quick survey">
      <div className="bfs-inner">
        <div className="bfs-header">
          <span className="bfs-question">Why aren&apos;t you booking?</span>
          <button
            className="bfs-close"
            onClick={handleDismiss}
            aria-label="Dismiss survey"
            type="button"
          >✕</button>
        </div>
        <div className="bfs-options">
          {OPTIONS.map((opt) => {
            if (opt.key === 'other') {
              return otherSelected ? (
                <span key="other" className="bfs-other-wrap">
                  <input
                    id={otherId}
                    className="bfs-other-input"
                    type="text"
                    autoFocus
                    maxLength={500}
                    placeholder="Tell us more…"
                    value={otherText}
                    onChange={(e) => setOtherText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && otherText.trim()) handleSubmit('other', otherText.trim())
                    }}
                  />
                  <button
                    className="bfs-other-send"
                    type="button"
                    disabled={!otherText.trim()}
                    onClick={() => handleSubmit('other', otherText.trim())}
                  >Send</button>
                </span>
              ) : (
                <button
                  key="other"
                  className="bfs-option"
                  onClick={() => setOtherSelected(true)}
                  type="button"
                >Other</button>
              )
            }
            return (
              <button
                key={opt.key}
                className="bfs-option"
                onClick={() => handleSubmit(opt.key as OptionKey)}
                type="button"
              >{opt.label}</button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
