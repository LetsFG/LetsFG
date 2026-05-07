'use client'

import { useState, useCallback } from 'react'
import { trackSearchSessionEvent } from '../../../lib/search-session-analytics'

// ── Experiment ID (shared between this component and CheckoutPanel) ────────────
export const CHECKOUT_SURVEY_EXPERIMENT_ID = 'checkout-objection-survey-v1'

// ── Survey options ─────────────────────────────────────────────────────────────

const SURVEY_OPTIONS = [
  { key: 'shared_not_working',  label: "Shared offer doesn't work for me" },
  { key: 'book_elsewhere',      label: 'I want to book elsewhere' },
  { key: 'want_best_offer',     label: 'I want to make sure I get the best offer' },
  { key: 'wait_better_deal',    label: 'I want to wait to get a better deal' },
  { key: 'price_drop_fear',     label: "I'm afraid the price will drop if I buy now" },
  { key: 'just_browsing',       label: "I'm not ready to travel, just browsing" },
  { key: 'other',               label: 'Other (please specify)' },
] as const

type OptionKey = (typeof SURVEY_OPTIONS)[number]['key']

// ── Props ──────────────────────────────────────────────────────────────────────

interface Props {
  searchId: string | null
  offerId: string
  isTestSearch?: boolean
  onDismiss: () => void
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function CheckoutSurvey({ searchId, offerId, isTestSearch, onDismiss }: Props) {
  const [selected, setSelected] = useState<OptionKey | null>(null)
  const [otherText, setOtherText] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const submit = useCallback((key: OptionKey, text?: string) => {
    trackSearchSessionEvent(searchId, 'survey_response', {
      experiment_id: CHECKOUT_SURVEY_EXPERIMENT_ID,
      offer_id: offerId,
      response_key: key,
      ...(key === 'other' && text ? { response_text: text.slice(0, 500) } : {}),
    }, {
      source: 'website-checkout',
      is_test_search: isTestSearch || undefined,
    })
    setSubmitted(true)
    // Auto-dismiss after showing the thank-you for 1.5 s
    window.setTimeout(onDismiss, 1500)
  }, [searchId, offerId, isTestSearch, onDismiss])

  const handleOptionClick = useCallback((key: OptionKey) => {
    if (key === 'other') {
      setSelected('other')
      return
    }
    submit(key)
  }, [submit])

  const handleOtherSubmit = useCallback(() => {
    submit('other', otherText.trim() || undefined)
  }, [submit, otherText])

  if (submitted) {
    return (
      <div className="ck-survey ck-survey--thanks" aria-live="polite">
        <span className="ck-survey-thanks-icon" aria-hidden="true">✓</span>
        Thanks for the feedback!
      </div>
    )
  }

  return (
    <div className="ck-survey">
      <div className="ck-survey-header">
        <span className="ck-survey-question">
          What would make it easier to book right now?
        </span>
        <button
          className="ck-survey-skip"
          onClick={onDismiss}
          aria-label="Skip survey"
          type="button"
        >
          ✕
        </button>
      </div>

      <div className="ck-survey-options">
        {SURVEY_OPTIONS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            className={`ck-survey-option${selected === key ? ' ck-survey-option--selected' : ''}`}
            onClick={() => handleOptionClick(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {selected === 'other' && (
        <div className="ck-survey-other">
          <textarea
            className="ck-survey-other-input"
            placeholder="Tell us more…"
            value={otherText}
            onChange={e => setOtherText(e.target.value)}
            rows={2}
            maxLength={500}
            autoFocus
          />
          <button
            type="button"
            className="ck-survey-submit"
            onClick={handleOtherSubmit}
          >
            Send
          </button>
        </div>
      )}
    </div>
  )
}
