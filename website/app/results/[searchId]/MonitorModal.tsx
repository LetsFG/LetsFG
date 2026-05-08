'use client'

import { useEffect, useRef, useState } from 'react'
import { trackSearchSessionEvent } from '../../../lib/search-session-analytics'

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return new Uint8Array([...rawData].map(c => c.charCodeAt(0)))
}

interface MonitorModalProps {
  searchId?: string | null
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

function TelegramIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" width="16" height="16" aria-hidden="true">
      <path d="M21.93 3.24L2.56 10.92c-1.3.52-1.29 1.24-.24 1.56l4.9 1.53 11.35-7.17c.54-.33 1.03-.15.62.21L9.63 15.54l-.28 4.99c.42 0 .6-.19.83-.41l2-1.94 4.14 3.07c.76.42 1.31.2 1.5-.7l2.72-12.82c.28-1.12-.43-1.62-1.64-1.49z" fill="currentColor"/>
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
  searchId,
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
  const [pushState, setPushState] = useState<'idle' | 'loading' | 'done' | 'denied' | 'unavailable'>('idle')
  const dialogRef = useRef<HTMLDialogElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)

  // True if user has provided at least one delivery channel (telegram is always available post-payment)
  const hasChannel = email.trim() !== '' || pushState === 'done'

  // Pre-authorise push before payment so the success page can auto-register it.
  const handleEnablePush = async () => {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      setPushState('unavailable')
      return
    }
    setPushState('loading')
    try {
      const keyResp = await fetch('/api/monitor/vapid-key')
      if (!keyResp.ok) { setPushState('unavailable'); return }
      const body = await keyResp.json() as { public_key?: string; vapid_public_key?: string }
      const public_key = body.public_key ?? body.vapid_public_key
      if (!public_key) { setPushState('unavailable'); return }

      await navigator.serviceWorker.register('/sw.js').catch(() => null)
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') { setPushState('denied'); return }

      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(public_key),
      })
      // Stash for the success page — it reads this and registers with the backend
      try { sessionStorage.setItem('letsfg_push_pending_sub', JSON.stringify(sub.toJSON())) } catch { /* ignore */ }
      setPushState('done')
      trackSearchSessionEvent(searchId, 'monitor_push_enabled', {})
    } catch {
      setPushState('unavailable')
    }
  }

  useEffect(() => {
    dialogRef.current?.showModal()
    emailRef.current?.focus()
    // Prevent body scroll while modal is open
    document.body.style.overflow = 'hidden'
    trackSearchSessionEvent(searchId, 'monitor_modal_opened', {
      origin, destination, departure_date: departureDate, is_round_trip: Boolean(returnDate),
    })
    return () => { document.body.style.overflow = '' }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleBackdropClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === dialogRef.current) onClose()
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (state === 'loading') return
    setState('loading')
    setErrorMsg('')

    trackSearchSessionEvent(searchId, 'monitor_checkout_started', {
      weeks,
      has_email: email.trim().length > 0,
      has_push: pushState === 'done',
      total_usd: weeks * 5,
    })

    try {
      const payload: Record<string, unknown> = {
        origin,
        destination,
        departure_date: departureDate,
        weeks,
        adults,
      }
      if (email.trim()) payload.notify_email = email.trim()
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

      // Persist monitor_id and return URL so the success page can redirect back
      if (data.monitor_id) {
        try { sessionStorage.setItem('letsfg_monitor_id', data.monitor_id) } catch { /* ignore */ }
        try { sessionStorage.setItem('letsfg_monitor_return_url', window.location.href) } catch { /* ignore */ }
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
        </ul>

        {/* Form */}
        <form onSubmit={handleSubmit} className="mon-form" noValidate>
          {/* Alert channels */}
          <div className="mon-channels">
            <p className="mon-channels-label">Alert channels</p>

            {/* Email row */}
            <div className={`mon-channel-row mon-channel-row--email${email.trim() ? ' mon-channel-row--on' : ''}`}>
              <span className="mon-channel-icon mon-channel-icon--email" aria-hidden="true">✉</span>
              <div className="mon-channel-body">
                <label className="mon-channel-name" htmlFor="mon-email">Email</label>
                <span className="mon-channel-sub">Price alerts and unlock credits</span>
              </div>
              <input
                ref={emailRef}
                id="mon-email"
                type="email"
                className="mon-channel-input"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoComplete="email"
                disabled={state === 'loading'}
              />
            </div>

            {/* Push row */}
            <div className={`mon-channel-row${pushState === 'done' ? ' mon-channel-row--on' : ''}`}>
              <span className="mon-channel-icon mon-channel-icon--push"><BellIcon /></span>
              <div className="mon-channel-body">
                <span className="mon-channel-name">Push notifications</span>
                <span className="mon-channel-sub">Instant alerts in this browser</span>
              </div>
              <div className="mon-channel-action">
                {pushState === 'idle' && (
                  <button type="button" className="mon-channel-btn" onClick={handleEnablePush}>
                    Enable
                  </button>
                )}
                {pushState === 'loading' && (
                  <span className="mon-channel-status">Enabling…</span>
                )}
                {pushState === 'done' && (
                  <span className="mon-channel-status mon-channel-status--on">✓ On</span>
                )}
                {pushState === 'denied' && (
                  <span className="mon-channel-status mon-channel-status--warn">Blocked in browser</span>
                )}
                {pushState === 'unavailable' && (
                  <span className="mon-channel-status mon-channel-status--muted">Unavailable</span>
                )}
              </div>
            </div>

            {/* Telegram row */}
            <div className="mon-channel-row">
              <span className="mon-channel-icon mon-channel-icon--tg"><TelegramIcon /></span>
              <div className="mon-channel-body">
                <span className="mon-channel-name">Telegram</span>
                <span className="mon-channel-sub">Link your chat after payment</span>
              </div>
              <span className="mon-channel-badge">After payment</span>
            </div>
          </div>

          {!hasChannel && (
            <p className="mon-channel-hint">
              Add email or enable push — Telegram is always available after payment.
            </p>
          )}

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
            disabled={state === 'loading'}
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
