'use client'

import { useState, useCallback } from 'react'
import { trackSearchSessionEvent } from '../../../lib/search-session-analytics'

export const BEST_PICK_FEEDBACK_EXP_ID = 'exp_best-pick-feedback-v1'

interface Props {
  vote: 'thumbs_up' | 'thumbs_down'
  searchId: string | null
  isTestSearch?: boolean
  onClose: () => void
}

export default function BestPickFeedbackPopup({ vote, searchId, isTestSearch, onClose }: Props) {
  const [text, setText] = useState('')
  const [sent, setSent] = useState(false)

  const handleSend = useCallback(() => {
    if (sent || !text.trim()) return
    trackSearchSessionEvent(searchId, 'best_pick_feedback', {
      experiment_id: BEST_PICK_FEEDBACK_EXP_ID,
      response_key: vote === 'thumbs_up' ? 'thumbs_up_followup' : 'thumbs_down_followup',
      response_text: text.trim().slice(0, 500),
    }, {
      source: 'website-results',
      is_test_search: isTestSearch || undefined,
    })
    setSent(true)
    setTimeout(onClose, 1000)
  }, [sent, searchId, vote, text, isTestSearch, onClose])

  const question =
    vote === 'thumbs_up'
      ? 'What did you like about this pick?'
      : "What didn't you like about this pick?"

  if (sent) {
    return (
      <div className="bfs-bar bfs-bar--thanks" role="status" aria-live="polite">
        <span className="bfs-thanks-check" aria-hidden="true">✓</span>
        Thanks for the feedback!
      </div>
    )
  }

  return (
    <div className="bfs-bar bpf-popup" role="complementary" aria-label="Pick feedback">
      <div className="bfs-inner">
        <div className="bfs-header">
          <span className="bfs-question">{question}</span>
          <button className="bfs-close" type="button" aria-label="Dismiss" onClick={onClose}>✕</button>
        </div>
        <div className="bpf-row">
          <input
            className="bpf-input"
            type="text"
            placeholder="Optional — tell us more"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={500}
            onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) handleSend() }}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
          />
          <button
            className="bpf-send"
            type="button"
            onClick={handleSend}
            disabled={!text.trim()}
          >
            Send
          </button>
          <button className="bpf-skip" type="button" onClick={onClose}>
            Skip
          </button>
        </div>
      </div>
    </div>
  )
}
