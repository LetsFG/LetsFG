'use client'

import { useState, useEffect, useRef } from 'react'

export const CHECKOUT_COUNTDOWN_EXPERIMENT_ID = 'exp_checkout-countdown-v1'

// Countdown duration: 15 minutes from mount
const COUNTDOWN_SECONDS = 15 * 60

interface Props {
  isUnlocked: boolean
}

export default function CheckoutCountdown({ isUnlocked }: Props) {
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SECONDS)
  const [expired, setExpired] = useState(false)
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

  // Don't show once unlocked or if somehow already expired at mount
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
        <span className="ck-countdown-label">Search results may have expired — prices could have changed</span>
      ) : (
        <>
          <span className="ck-countdown-label">Search results valid for</span>
          <span className="ck-countdown-timer">{timeStr}</span>
        </>
      )}
    </div>
  )
}
