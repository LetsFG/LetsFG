'use client'

/**
 * SearchDiscovery.tsx
 *
 * Conversational follow-up question panel that appears while results load.
 * Shows one question at a time, animates in smoothly, and tracks progress.
 * All answers are lifted up to SearchPageClient where they refine the results.
 */

import { useEffect, useRef, useState } from 'react'
import type { FollowUpQuestion, DiscoveryAnswers } from '../../lib/questionEngine'
import { countApplicableQuestions } from '../../lib/questionEngine'

interface SearchDiscoveryProps {
  questions: FollowUpQuestion[]
  answers: DiscoveryAnswers
  currentQuestion: FollowUpQuestion | null
  onAnswer: (questionId: string, value: string | number) => void
  onDismiss: () => void
  destName?: string
}

export default function SearchDiscovery({
  questions,
  answers,
  currentQuestion,
  onAnswer,
  onDismiss,
  destName,
}: SearchDiscoveryProps) {
  const [visible, setVisible] = useState(false)
  const [exiting, setExiting] = useState(false)
  const [selectedValue, setSelectedValue] = useState<string | null>(null)
  const [numberInput, setNumberInput] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Slide in after a short delay (so results start loading first)
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 1200)
    return () => clearTimeout(t)
  }, [])

  // Reset selected value when question changes
  useEffect(() => {
    setSelectedValue(null)
    setNumberInput('')
  }, [currentQuestion?.id])

  // Auto-focus number input
  useEffect(() => {
    if (currentQuestion?.type === 'number' && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 300)
    }
  }, [currentQuestion?.type])

  const { answered, total } = countApplicableQuestions(questions, answers)
  const allDone = !currentQuestion

  const handleDismiss = () => {
    setExiting(true)
    setTimeout(onDismiss, 350)
  }

  const handleSelect = (value: string) => {
    setSelectedValue(value)
    // Auto-advance after short delay so the selection is visible
    setTimeout(() => onAnswer(currentQuestion!.id, value), 280)
  }

  const handleNumberSubmit = () => {
    const n = parseInt(numberInput, 10)
    if (!isNaN(n) && n >= (currentQuestion?.min ?? 0) && n <= (currentQuestion?.max ?? 99)) {
      onAnswer(currentQuestion!.id, n)
    }
  }

  if (!visible) return null

  return (
    <>
      <style>{DISCOVERY_STYLES}</style>
      <div className={`disc-panel${exiting ? ' disc-panel--exit' : ' disc-panel--enter'}`} role="complementary" aria-label="Personalisation questions">

        {/* Header row */}
        <div className="disc-header">
          <div className="disc-header-left">
            <span className="disc-spark" aria-hidden="true">✦</span>
            <span className="disc-label">
              {allDone ? 'Thanks! Personalising your results…' : 'Help us find the best offer for you'}
            </span>
          </div>
          <div className="disc-header-right">
            {total > 0 && (
              <div className="disc-progress" aria-label={`Question ${answered} of ${total}`}>
                {Array.from({ length: total }).map((_, i) => (
                  <span
                    key={i}
                    className={`disc-dot${i < answered ? ' disc-dot--done' : i === answered ? ' disc-dot--active' : ''}`}
                    aria-hidden="true"
                  />
                ))}
              </div>
            )}
            <button className="disc-skip" onClick={handleDismiss} aria-label="Dismiss questions">
              Skip
            </button>
          </div>
        </div>

        {/* Answered chips — summary of what we know */}
        {answered > 0 && (
          <div className="disc-answered" role="status" aria-live="polite">
            {questions
              .filter(q => answers[q.id] !== undefined)
              .slice(-3)           // show last 3 answered
              .map(q => {
                const val = String(answers[q.id])
                const opt = q.options?.find(o => o.value === val)
                const label = opt ? `${opt.emoji ?? ''} ${opt.label}` : val
                return (
                  <span key={q.id} className="disc-chip">
                    {label.trim()}
                  </span>
                )
              })
            }
          </div>
        )}

        {/* Current question card */}
        {currentQuestion && !allDone && (
          <div className="disc-card" key={currentQuestion.id} role="group" aria-labelledby={`disc-q-${currentQuestion.id}`}>
            <p className="disc-question" id={`disc-q-${currentQuestion.id}`}>
              {currentQuestion.question}
            </p>
            {currentQuestion.subtext && (
              <p className="disc-subtext">{currentQuestion.subtext}</p>
            )}

            {/* Single choice options */}
            {currentQuestion.type === 'single_choice' && currentQuestion.options && (
              <div className="disc-options">
                {currentQuestion.options.map(opt => (
                  <button
                    key={opt.value}
                    className={`disc-opt${selectedValue === opt.value ? ' disc-opt--selected' : ''}`}
                    onClick={() => handleSelect(opt.value)}
                    aria-pressed={selectedValue === opt.value}
                  >
                    {opt.emoji && <span className="disc-opt-emoji" aria-hidden="true">{opt.emoji}</span>}
                    <span className="disc-opt-body">
                      <span className="disc-opt-label">{opt.label}</span>
                      {opt.subtext && <span className="disc-opt-sub">{opt.subtext}</span>}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* Number input */}
            {currentQuestion.type === 'number' && (
              <div className="disc-number">
                <input
                  ref={inputRef}
                  type="number"
                  className="disc-number-input"
                  placeholder="e.g. 2"
                  value={numberInput}
                  min={currentQuestion.min ?? 1}
                  max={currentQuestion.max ?? 10}
                  onChange={e => setNumberInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleNumberSubmit() }}
                  aria-label={currentQuestion.question}
                />
                <button
                  className="disc-number-submit"
                  onClick={handleNumberSubmit}
                  disabled={!numberInput || isNaN(parseInt(numberInput, 10))}
                >
                  Continue →
                </button>
              </div>
            )}
          </div>
        )}

        {/* All done state */}
        {allDone && answered > 0 && (
          <div className="disc-done" role="status">
            <span className="disc-done-icon" aria-hidden="true">✦</span>
            <span className="disc-done-text">
              Showing the best offers for {destName ?? 'your trip'} based on your answers.
            </span>
          </div>
        )}
      </div>
    </>
  )
}

// ── Recommendation pin card ────────────────────────────────────────────────────

interface BestOfferPinProps {
  reasons: string[]
  onScrollToOffer: () => void
}

export function BestOfferPin({ reasons, onScrollToOffer }: BestOfferPinProps) {
  return (
    <>
      <style>{DISCOVERY_STYLES}</style>
      <div className="disc-best-pin" role="note" aria-label="Personalised recommendation">
        <div className="disc-best-header">
          <span className="disc-spark" aria-hidden="true">✦</span>
          <span className="disc-best-title">Best for you</span>
        </div>
        <ul className="disc-reasons">
          {reasons.map((r, i) => (
            <li key={i} className="disc-reason">
              <span className="disc-reason-check" aria-hidden="true">✓</span>
              {r}
            </li>
          ))}
        </ul>
        <button className="disc-best-cta" onClick={onScrollToOffer}>
          See this offer ↓
        </button>
      </div>
    </>
  )
}

// ── Styles (self-contained, injected once via <style>) ────────────────────────

const DISCOVERY_STYLES = `
/* ── Discovery panel ─────────────────────────────────────────────────── */
.disc-panel {
  margin: 0 auto 0;
  max-width: 860px;
  padding: 0 16px;
}

.disc-panel--enter {
  animation: disc-slide-in 0.4s cubic-bezier(0.22,1,0.36,1) both;
}
.disc-panel--exit {
  animation: disc-slide-out 0.3s ease-in both;
}

@keyframes disc-slide-in {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes disc-slide-out {
  from { opacity: 1; transform: translateY(0); }
  to   { opacity: 0; transform: translateY(8px); }
}

.disc-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}
.disc-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}
.disc-header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}
.disc-spark {
  font-size: 14px;
  color: #a78bfa;
  line-height: 1;
}
.disc-label {
  font-size: 12px;
  font-weight: 600;
  color: #a78bfa;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}
.disc-skip {
  font-size: 12px;
  color: rgba(255,255,255,0.35);
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px 0;
  transition: color 0.2s;
}
.disc-skip:hover { color: rgba(255,255,255,0.65); }

.disc-progress {
  display: flex;
  gap: 5px;
  align-items: center;
}
.disc-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(255,255,255,0.18);
  transition: background 0.25s;
}
.disc-dot--done   { background: #7c3aed; }
.disc-dot--active { background: #a78bfa; }

/* ── Answered chips ───────────────────────────────────────────────────── */
.disc-answered {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.disc-chip {
  font-size: 11px;
  font-weight: 500;
  padding: 3px 10px;
  background: rgba(124,58,237,0.18);
  color: #c4b5fd;
  border-radius: 20px;
  border: 1px solid rgba(124,58,237,0.35);
  white-space: nowrap;
}

/* ── Question card ────────────────────────────────────────────────────── */
.disc-card {
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.09);
  border-radius: 14px;
  padding: 18px 20px 16px;
  animation: disc-card-in 0.35s cubic-bezier(0.22,1,0.36,1) both;
}
@keyframes disc-card-in {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

.disc-question {
  font-size: 15px;
  font-weight: 600;
  color: rgba(255,255,255,0.92);
  margin: 0 0 4px;
  line-height: 1.4;
}
.disc-subtext {
  font-size: 12px;
  color: rgba(255,255,255,0.45);
  margin: 0 0 14px;
  line-height: 1.5;
}

/* ── Options grid ─────────────────────────────────────────────────────── */
.disc-options {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 8px;
}
.disc-opt {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.18s, border-color 0.18s, transform 0.15s;
  text-align: left;
}
.disc-opt:hover {
  background: rgba(124,58,237,0.18);
  border-color: rgba(124,58,237,0.45);
  transform: translateY(-1px);
}
.disc-opt--selected {
  background: rgba(124,58,237,0.35) !important;
  border-color: #7c3aed !important;
}
.disc-opt-emoji {
  font-size: 18px;
  line-height: 1.2;
  flex-shrink: 0;
  margin-top: 1px;
}
.disc-opt-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.disc-opt-label {
  font-size: 13px;
  font-weight: 500;
  color: rgba(255,255,255,0.88);
  line-height: 1.3;
}
.disc-opt-sub {
  font-size: 11px;
  color: rgba(255,255,255,0.4);
  line-height: 1.3;
}

/* ── Number input ─────────────────────────────────────────────────────── */
.disc-number {
  display: flex;
  gap: 10px;
  align-items: center;
}
.disc-number-input {
  width: 80px;
  padding: 9px 12px;
  background: rgba(255,255,255,0.07);
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 8px;
  color: rgba(255,255,255,0.9);
  font-size: 15px;
  font-weight: 600;
  text-align: center;
  outline: none;
}
.disc-number-input:focus {
  border-color: #7c3aed;
  background: rgba(124,58,237,0.12);
}
.disc-number-submit {
  padding: 9px 16px;
  background: #7c3aed;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.18s;
}
.disc-number-submit:hover:not(:disabled) { background: #6d28d9; }
.disc-number-submit:disabled { opacity: 0.4; cursor: not-allowed; }

/* ── All done ─────────────────────────────────────────────────────────── */
.disc-done {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 0 4px;
}
.disc-done-icon { font-size: 16px; color: #a78bfa; }
.disc-done-text {
  font-size: 13px;
  color: rgba(255,255,255,0.6);
  line-height: 1.4;
}

/* ── Best offer pin ───────────────────────────────────────────────────── */
.disc-best-pin {
  background: linear-gradient(135deg, rgba(124,58,237,0.18) 0%, rgba(16,185,129,0.10) 100%);
  border: 1px solid rgba(124,58,237,0.4);
  border-radius: 14px;
  padding: 16px 20px;
  margin-bottom: 16px;
  animation: disc-slide-in 0.4s cubic-bezier(0.22,1,0.36,1) both;
}
.disc-best-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.disc-best-title {
  font-size: 13px;
  font-weight: 700;
  color: #a78bfa;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}
.disc-reasons {
  list-style: none;
  margin: 0 0 14px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.disc-reason {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 13px;
  color: rgba(255,255,255,0.75);
  line-height: 1.4;
}
.disc-reason-check {
  color: #10b981;
  font-weight: 700;
  flex-shrink: 0;
}
.disc-best-cta {
  font-size: 13px;
  font-weight: 600;
  color: #a78bfa;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  transition: color 0.18s;
}
.disc-best-cta:hover { color: #c4b5fd; }

@media (max-width: 480px) {
  .disc-options {
    grid-template-columns: 1fr 1fr;
  }
  .disc-card {
    padding: 14px 14px 12px;
  }
}
`
