'use client'

import { useEffect, useRef, useState } from 'react'

interface MonitorModalProps {
  origin: string
  originName: string
  destination: string
  destinationName: string
  departureDate: string
  returnDate?: string
  adults?: number
  cabinClass?: string
  onClose: () => void
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" width="18" height="18" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" width="14" height="14" aria-hidden="true">
      <path d="M5 12l5 5L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" width="14" height="14" aria-hidden="true">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function fmtDate(iso: string) {
  try {
    return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    })
  } catch {
    return iso
  }
}

export default function MonitorModal({
  origin,
  originName,
  destination,
  destinationName,
  departureDate,
  returnDate,
  adults = 1,
  cabinClass,
  onClose,
}: MonitorModalProps) {
  const [email, setEmail] = useState('')
  const [weeks, setWeeks] = useState(2)
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const dialogRef = useRef<HTMLDialogElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    dialogRef.current?.showModal()
    emailRef.current?.focus()
    // Prevent body scroll while modal is open
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  const handleBackdropClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === dialogRef.current) onClose()
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim() || state === 'loading') return
    setState('loading')
    setErrorMsg('')

    try {
      const payload: Record<string, unknown> = {
        origin,
        destination,
        departure_date: departureDate,
        notify_email: email.trim(),
        weeks,
        adults,
      }
      if (returnDate) payload.return_date = returnDate
      if (cabinClass) payload.cabin_class = cabinClass

      const res = await fetch('/api/monitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data = await res.json() as { checkout_url?: string; monitor_id?: string; error?: string }

      if (!res.ok || !data.checkout_url) {
        setErrorMsg(data.error || 'Something went wrong. Please try again.')
        setState('error')
        return
      }

      // Persist monitor_id so the success page can set up push/Telegram
      if (data.monitor_id) {
        try { sessionStorage.setItem('letsfg_monitor_id', data.monitor_id) } catch { /* ignore */ }
      }

      // Redirect to Stripe Checkout
      window.location.href = data.checkout_url
    } catch {
      setErrorMsg('Network error. Please check your connection and try again.')
      setState('error')
    }
  }

  const totalPrice = weeks * 5
  const routeLabel = `${originName || origin} → ${destinationName || destination}`
  const isRoundTrip = Boolean(returnDate)
  const tripTypeLabel = isRoundTrip ? 'Round trip' : 'One way'

  return (
    <dialog
      ref={dialogRef}
      className="mon-dialog"
      onClick={handleBackdropClick}
      onKeyDown={e => { if (e.key === 'Escape') onClose() }}
      aria-modal="true"
      aria-labelledby="mon-title"
    >
      <div className="mon-card" role="document">
        {/* Header */}
        <div className="mon-header">
          <div className="mon-header-text">
            <span className="mon-kicker">Flight Monitor</span>
            <h2 id="mon-title" className="mon-title">Track this route</h2>
          </div>
          <button className="mon-close" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        {/* Route info */}
        <div className="mon-route-card">
          <div className="mon-route-main">
            <span className="mon-route-airports">{routeLabel}</span>
            <span className="mon-route-meta">
              {fmtDate(departureDate)}
              {returnDate && ` — ${fmtDate(returnDate)}`}
              {' · '}{tripTypeLabel}
              {adults > 1 && ` · ${adults} adults`}
            </span>
          </div>
          <span className="mon-route-badge">Verified search</span>
        </div>

        {/* What you get */}
        <ul className="mon-features" aria-label="What's included">
          <li className="mon-feature">
            <span className="mon-feature-icon mon-feature-icon--on" aria-hidden="true"><CheckIcon /></span>
            Daily price alerts from Google Flights, Kayak, Kiwi, direct airlines, over 200 websites
          </li>
          <li className="mon-feature">
            <span className="mon-feature-icon mon-feature-icon--on" aria-hidden="true"><CheckIcon /></span>
            Uncovers hidden fees — baggage pricing, seat selection & more
          </li>
          <li className="mon-feature">
            <span className="mon-feature-icon mon-feature-icon--on" aria-hidden="true"><CheckIcon /></span>
            1 booking unlock / week <span className="mon-feature-note">(refreshes weekly)</span>
          </li>
          <li className="mon-feature">
            <span className="mon-feature-icon mon-feature-icon--on" aria-hidden="true"><CheckIcon /></span>
            $5 / week · non-recurring · cancel any time
          </li>
          <li className="mon-feature">
            <span className="mon-feature-icon mon-feature-icon--on" aria-hidden="true"><CheckIcon /></span>
            Browser push &amp; Telegram alerts <span className="mon-feature-note">(set up after payment)</span>
          </li>
        </ul>

        {/* Form */}
        <form onSubmit={handleSubmit} className="mon-form" noValidate>
          {/* Email */}
          <div className="mon-field">
            <label className="mon-label" htmlFor="mon-email">Your email</label>
            <input
              ref={emailRef}
              id="mon-email"
              type="email"
              className="mon-input"
              placeholder="you@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
              disabled={state === 'loading'}
            />
            <p className="mon-field-hint">Price alerts and unlock credits are sent here.</p>
          </div>

          {/* Weeks */}
          <div className="mon-field">
            <label className="mon-label" htmlFor="mon-weeks">Weeks to monitor</label>
            <div className="mon-weeks-row">
              <button
                type="button"
                className="mon-weeks-btn"
                onClick={() => setWeeks(w => Math.max(1, w - 1))}
                disabled={weeks <= 1 || state === 'loading'}
                aria-label="Decrease weeks"
              >
                −
              </button>
              <div className="mon-weeks-display">
                <span className="mon-weeks-num">{weeks}</span>
                <span className="mon-weeks-label">{weeks === 1 ? 'week' : 'weeks'}</span>
              </div>
              <button
                type="button"
                className="mon-weeks-btn"
                onClick={() => setWeeks(w => Math.min(52, w + 1))}
                disabled={weeks >= 52 || state === 'loading'}
                aria-label="Increase weeks"
              >
                +
              </button>
            </div>
            <p className="mon-field-hint">You can stop at any time — no auto-renewal.</p>
          </div>

          {/* Error */}
          {state === 'error' && errorMsg && (
            <p className="mon-error" role="alert">{errorMsg}</p>
          )}

          {/* CTA */}
          <button
            type="submit"
            className="mon-submit"
            disabled={!email.trim() || state === 'loading'}
          >
            {state === 'loading' ? (
              'Preparing checkout…'
            ) : (
              <>
                Start monitoring · <span className="mon-submit-price">${totalPrice} total</span>
              </>
            )}
          </button>
          <p className="mon-footer-note">
            Proceeds to Stripe Checkout. One-time payment — nothing else required after payment.
          </p>
        </form>
      </div>
    </dialog>
  )
}
