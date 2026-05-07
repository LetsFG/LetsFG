'use client'

import { useState, useEffect, useRef } from 'react'

export const CHECKOUT_COUNTDOWN_EXPERIMENT_ID = 'exp_checkout-countdown-v1'

// Countdown duration: 15 minutes from mount
const COUNTDOWN_SECONDS = 15 * 60
// Grace period before redirect after expiry (ms)
const REDIRECT_DELAY_MS = 4000

interface Props {
  isUnlocked: boolean
  onExpired?: () => void
}

export default function CheckoutCountdown({ isUnlocked, onExpired }: Props) {
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SECONDS)
  const [expired, setExpired] = useState(false)
  const [redirectIn, setRedirectIn] = useState<number | null>(null)
  const startRef = useRef<number>(Date.now())

  useEffect(() => {
    startRef.current = Date.now()
    const id = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startRef.current) / 1000)
      const remaining = COUNTDOWN_SECONDS - elapsed
      if (remaining <= 0) {
        setSecondsLeft(0)
        setExpired(true)
        window.clearInterval(id)
      } else {
        setSecondsLeft(remaining)
      }
    }, 1000)
    return () => window.clearInterval(id)
  }, [])

  // Start redirect countdown once expired
  useEffect(() => {
    if (!expired || !onExpired) return
    const step = 100
    let remaining = REDIRECT_DELAY_MS
    setRedirectIn(Math.ceil(remaining / 1000))
    const id = window.setInterval(() => {
      remaining -= step
      setRedirectIn(Math.max(0, Math.ceil(remaining / 1000)))
      if (remaining <= 0) {
        window.clearInterval(id)
        onExpired()
      }
    }, step)
    return () => window.clearInterval(id)
  }, [expired, onExpired])

  // Don't show once unlocked
  if (isUnlocked) return null

  const mins = Math.floor(secondsLeft / 60)
  const secs = secondsLeft % 60
  const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`
  const urgent = secondsLeft <= 120 // last 2 min

  return (
    <div className={`ck-countdown${expired ? ' ck-countdown--expired' : urgent ? ' ck-countdown--urgent' : ''}`}>
      <svg className="ck-countdown-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
        <path d="M12 7v5l3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {expired ? (
        <span className="ck-countdown-label">
          Search results expired — redirecting in {redirectIn}s…
        </span>
      ) : (
        <>
          <span className="ck-countdown-label">Search results valid for</span>
          <span className="ck-countdown-timer">{timeStr}</span>
        </>
      )}
    </div>
  )
}
