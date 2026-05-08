'use client'

import { useState, useEffect, useRef, useCallback, useId } from 'react'
import { trackSearchSessionEvent } from '../../../lib/search-session-analytics'

export const RESULTS_FRICTION_EXPERIMENT_ID = 'exp_results-friction-survey-v1'

const BANNER_DELAY_MS = 3 * 60 * 1000 // 3 minutes

// Session key: dismissed this browser session (survives remounts, not new tabs)
const SS_KEY_DISMISSED = 'lfg_survey_dismissed'
// Persistent key: user already answered — never show again
const LS_KEY_DONE = 'lfg_survey_done'

const REASONS = [
  { key: 'price_too_high',    label: 'Price too high' },
  { key: 'need_direct',       label: 'Need direct flight' },
  { key: 'need_bags',         label: 'Need bags included' },
  { key: 'wrong_dates',       label: 'Wrong dates' },
  { key: 'just_browsing',     label: 'Just browsing' },
  { key: 'other',             label: 'Other' },
] as const

type ReasonKey = (typeof REASONS)[number]['key']

interface Props {
  searchId: string
  isTestSearch?: boolean
  /** Timestamp (Date.now()) when all results finished loading. Null while still searching. */
  resultsCompletedAt: number | null
  /** Pass true once user has engaged with an offer (clicked Select) — hides the survey */
  hasUnlocked: boolean
}

type Trigger = 'banner' | 'exit_intent'

export default function ResultsFrictionSurvey({ searchId, isTestSearch, resultsCompletedAt, hasUnlocked }: Props) {
  // If user already answered (ever) or dismissed this session, suppress entirely.
  // Must start as false (SSR-safe) and be set in useEffect to avoid hydration mismatch.
  const [suppressed, setSuppressed] = useState(false)
  useEffect(() => {
    try {
      if (localStorage.getItem(LS_KEY_DONE) || sessionStorage.getItem(SS_KEY_DISMISSED)) {
        setSuppressed(true)
      }
    } catch { /* ignore */ }
  }, [])

  const [bannerVisible, setBannerVisible] = useState(false)
  const [overlayVisible, setOverlayVisible] = useState(false)
  const [bannerDismissed, setBannerDismissed] = useState(false)
  const [overlayDismissed, setOverlayDismissed] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [otherSelected, setOtherSelected] = useState(false)
  const [otherText, setOtherText] = useState('')
  const triggeredRef = useRef<Trigger | null>(null)
  const otherId = useId()

  // Banner: show 3 min after ALL results have finished loading.
  // The timer only starts once resultsCompletedAt is set (non-null),
  // so it never fires while the search is still in progress.
  useEffect(() => {
    if (suppressed || hasUnlocked || bannerDismissed || resultsCompletedAt === null) return
    const elapsed = Date.now() - resultsCompletedAt
    const remaining = Math.max(0, BANNER_DELAY_MS - elapsed)
    const id = window.setTimeout(() => {
      if (!hasUnlocked && !bannerDismissed) setBannerVisible(true)
    }, remaining)
    return () => window.clearTimeout(id)
  }, [suppressed, hasUnlocked, bannerDismissed, resultsCompletedAt])

  // Exit intent: mouse leaves viewport from the top.
  // Only attach after results have finished loading — no point showing
  // while the search is still running.
  useEffect(() => {
    if (suppressed || hasUnlocked || overlayDismissed || resultsCompletedAt === null) return
    const handler = (e: MouseEvent) => {
      if (e.clientY < 20 && !overlayDismissed && !submitted) {
        triggeredRef.current = 'exit_intent'
        setBannerVisible(false) // hide banner so only one UI shows at a time
        setOverlayVisible(true)
      }
    }
    document.addEventListener('mouseleave', handler)
    return () => document.removeEventListener('mouseleave', handler)
  }, [suppressed, hasUnlocked, overlayDismissed, submitted, resultsCompletedAt])

  const submitReason = useCallback((key: ReasonKey, trigger: Trigger, text?: string) => {
    if (submitted) return
    trackSearchSessionEvent(searchId, 'friction_survey_response', {
      experiment_id: RESULTS_FRICTION_EXPERIMENT_ID,
      reason_key: key,
      trigger,
      ...(key === 'other' && text ? { response_text: text.slice(0, 500) } : {}),
    }, {
      source: 'website-results',
      is_test_search: isTestSearch || undefined,
    })
    setSubmitted(true)
    setBannerVisible(false)
    setOverlayVisible(false)
    // Permanently suppress — answered once, never ask again
    try { localStorage.setItem(LS_KEY_DONE, '1') } catch { /* ignore */ }
  }, [submitted, searchId, isTestSearch])

  const dismissBanner = () => {
    setBannerVisible(false)
    setBannerDismissed(true)
    // Also prevent the exit-intent overlay this session — user already saw the survey
    setOverlayDismissed(true)
    try { sessionStorage.setItem(SS_KEY_DISMISSED, '1') } catch { /* ignore */ }
  }

  const dismissOverlay = () => {
    setOverlayVisible(false)
    setOverlayDismissed(true)
    setBannerDismissed(true)
    try { sessionStorage.setItem(SS_KEY_DISMISSED, '1') } catch { /* ignore */ }
  }

  if (suppressed || hasUnlocked) return null

  const activeTrigger: Trigger = overlayVisible ? 'exit_intent' : 'banner'

  const reasonButtons = REASONS.map((r) => {
    if (r.key === 'other') {
      return (
        <span key="other">
          {!otherSelected ? (
            <button
              className="rf-option"
              onClick={() => setOtherSelected(true)}
              type="button"
            >
              {r.label}
            </button>
          ) : (
            <span className="rf-other-wrap">
              <input
                id={otherId}
                className="rf-other-input"
                type="text"
                autoFocus
                maxLength={500}
                placeholder="Tell us more…"
                value={otherText}
                onChange={(e) => setOtherText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && otherText.trim()) submitReason('other', activeTrigger, otherText.trim())
                }}
              />
              <button
                className="rf-option rf-option--send"
                disabled={!otherText.trim()}
                onClick={() => submitReason('other', activeTrigger, otherText.trim())}
                type="button"
              >
                Send
              </button>
            </span>
          )}
        </span>
      )
    }
    return (
      <button
        key={r.key}
        className="rf-option"
        onClick={() => submitReason(r.key, activeTrigger)}
        type="button"
      >
        {r.label}
      </button>
    )
  })

  return (
    <>
      {/* Bottom banner — appears after 3 min */}
      {bannerVisible && !submitted && (
        <div className="rf-banner" role="complementary" aria-label="Feedback banner">
          <div className="rf-banner-inner">
            <span className="rf-banner-q">Not finding what you&apos;re looking for?</span>
            <div className="rf-banner-options">{reasonButtons}</div>
          </div>
          <button className="rf-banner-close" onClick={dismissBanner} aria-label="Dismiss" type="button">✕</button>
        </div>
      )}

      {/* Exit-intent overlay */}
      {overlayVisible && !submitted && (
        <div className="rf-overlay-backdrop" onClick={dismissOverlay}>
          <div className="rf-overlay" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="rf-overlay-q">What&apos;s stopping you from booking?</div>
            <div className="rf-overlay-options">{reasonButtons}</div>
            <button className="rf-overlay-close" onClick={dismissOverlay} type="button">Maybe later</button>
          </div>
        </div>
      )}

      {/* Submitted thank-you (inline, no backdrop) */}
      {submitted && bannerVisible && (
        <div className="rf-banner rf-banner--thankyou" role="complementary">
          <span className="rf-banner-q">Thanks — that helps a lot 🙏</span>
        </div>
      )}
    </>
  )
}
