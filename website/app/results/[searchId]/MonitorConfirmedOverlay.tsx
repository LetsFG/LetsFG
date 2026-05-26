'use client'

import { useEffect, useRef, useState } from 'react'

interface TelegramUser {
  id: number
  first_name: string
  last_name?: string
  username?: string
  photo_url?: string
  auth_date: number
  hash: string
}

declare global {
  interface Window {
    onTelegramAuth?: (user: TelegramUser) => void
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return new Uint8Array([...rawData].map(c => c.charCodeAt(0)))
}

interface MonitorConfirmedOverlayProps {
  monitorId: string
  routeLabel: string
  onClose: () => void
}

export default function MonitorConfirmedOverlay({
  monitorId,
  routeLabel,
  onClose,
}: MonitorConfirmedOverlayProps) {
  const [pushState, setPushState] = useState<'idle' | 'loading' | 'done' | 'denied' | 'error'>('idle')
  const [tgState, setTgState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [tgName, setTgName] = useState('')
  const dialogRef = useRef<HTMLDialogElement>(null)
  const tgContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    dialogRef.current?.showModal()
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  // Auto-register any pending push subscription from before the Stripe redirect.
  // First calls /api/monitor/activate to ensure the monitor is ACTIVE (test mode
  // has no webhook, so activation must happen here before the push sub is stored).
  useEffect(() => {
    let pending: string | null = null
    try { pending = sessionStorage.getItem('letsfg_push_pending_sub') } catch (_) { /* ignore */ }
    if (!pending) return

    const sub = JSON.parse(pending) as object

    const registerPush = () => {
      try { sessionStorage.removeItem('letsfg_push_pending_sub') } catch (_) { /* ignore */ }
      setPushState('loading')
      fetch('/api/monitor/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monitor_id: monitorId, subscription: sub }),
      })
        .then(r => r.ok ? setPushState('done') : setPushState('error'))
        .catch(() => setPushState('error'))
    }

    let cs: string | null = null
    try { cs = sessionStorage.getItem('letsfg_checkout_cs') } catch (_) { /* ignore */ }
    if (cs) {
      try { sessionStorage.removeItem('letsfg_checkout_cs') } catch (_) { /* ignore */ }
      fetch('/api/monitor/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cs, monitor_id: monitorId }),
      })
        .catch(() => { /* non-fatal — monitor may already be active */ })
        .finally(() => registerPush())
    } else {
      registerPush()
    }
  }, [monitorId])

  // Telegram widget — only works on registered domains (not localhost)
  const isLocalhost = typeof window !== 'undefined' && window.location.hostname === 'localhost'

  useEffect(() => {
    if (isLocalhost || !tgContainerRef.current) return
    window.onTelegramAuth = async (user) => {
      setTgState('loading')
      try {
        const resp = await fetch('/api/monitor/telegram', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ monitor_id: monitorId, user }),
        })
        const data = await resp.json() as { ok?: boolean; first_name?: string }
        if (!resp.ok || !data.ok) { setTgState('error'); return }
        setTgName(data.first_name || user.first_name)
        setTgState('done')
      } catch (_) { setTgState('error') }
    }
    const script = document.createElement('script')
    script.src = 'https://telegram.org/js/telegram-widget.js?22'
    script.setAttribute('data-telegram-login', 'letsfg_bot')
    script.setAttribute('data-size', 'large')
    script.setAttribute('data-onauth', 'onTelegramAuth(user)')
    script.setAttribute('data-request-access', 'write')
    script.async = true
    tgContainerRef.current.appendChild(script)
    return () => { delete window.onTelegramAuth }
  }, [monitorId, isLocalhost])

  async function handleEnablePush() {
    if (pushState === 'loading') return
    setPushState('loading')
    try {
      const keyResp = await fetch('/api/monitor/vapid-key')
      if (!keyResp.ok) { setPushState('error'); return }
      const body = await keyResp.json() as { public_key?: string; vapid_public_key?: string }
      const public_key = body.public_key ?? body.vapid_public_key
      if (!public_key) { setPushState('error'); return }
      if (!('serviceWorker' in navigator)) { setPushState('error'); return }
      await navigator.serviceWorker.register('/sw.js').catch(() => null)
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') { setPushState('denied'); return }
      const reg = await navigator.serviceWorker.ready
      const existingSub = await reg.pushManager.getSubscription()
      if (existingSub) await existingSub.unsubscribe().catch(() => null)
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(public_key),
      })
      const subResp = await fetch('/api/monitor/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monitor_id: monitorId, subscription: subscription.toJSON() }),
      })
      if (!subResp.ok) { setPushState('error'); return }
      setPushState('done')
    } catch (_) { setPushState('error') }
  }

  const handleBackdropClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === dialogRef.current) onClose()
  }

  return (
    <dialog
      ref={dialogRef}
      className="mon-dialog"
      onClick={handleBackdropClick}
      onKeyDown={e => { if (e.key === 'Escape') onClose() }}
      aria-modal="true"
      aria-labelledby="mon-confirmed-title"
    >
      <div className="mon-card" role="document">
        <div className="mon-header">
          <div className="mon-header-text">
            <span className="mon-kicker" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="10" fill="#22c55e" />
                <path d="M7 12.5l3.5 3.5 6.5-7" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Monitoring active
            </span>
            <h2 id="mon-confirmed-title" className="mon-title">{routeLabel}</h2>
          </div>
          <button className="mon-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" width="18" height="18" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <p className="mon-confirmed-desc">
          Daily price alerts are tracking this route. Add notification channels to stay informed when prices drop.
        </p>

        <div className="mon-notif-stack">
          <div className="mon-notif-card">
            <div className="mon-notif-icon" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="mon-notif-body">
              <div className="mon-notif-title">Browser notifications</div>
              <div className="mon-notif-desc">Instant alerts in Chrome, Firefox, or Edge.</div>
            </div>
            <div className="mon-notif-action">
              {pushState === 'idle' && <button className="mon-notif-btn" onClick={handleEnablePush}>Enable</button>}
              {pushState === 'loading' && <span className="mon-notif-status mon-notif-status--loading">Setting up…</span>}
              {pushState === 'done' && <span className="mon-notif-status mon-notif-status--done">On</span>}
              {pushState === 'denied' && <span className="mon-notif-status mon-notif-status--muted">Blocked</span>}
              {pushState === 'error' && <button className="mon-notif-btn mon-notif-btn--retry" onClick={handleEnablePush}>Retry</button>}
            </div>
          </div>

          <div className="mon-notif-card">
            <div className="mon-notif-icon" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.248-2.01 9.476c-.147.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.215-3.053 5.56-5.023c.242-.215-.053-.334-.373-.12L6.91 14.33l-2.953-.923c-.64-.203-.653-.64.134-.948l11.536-4.447c.534-.194 1.001.13.935.236z" />
              </svg>
            </div>
            <div className="mon-notif-body">
              <div className="mon-notif-title">Telegram alerts</div>
              <div className="mon-notif-desc">Daily updates via @letsfg_bot.</div>
            </div>
            <div className="mon-notif-action">
              {isLocalhost ? (
                <span className="mon-notif-status mon-notif-status--muted">Live site only</span>
              ) : tgState === 'idle' ? (
                <div ref={tgContainerRef} className="mon-tg-widget" />
              ) : tgState === 'loading' ? (
                <span className="mon-notif-status mon-notif-status--loading">Linking…</span>
              ) : tgState === 'done' ? (
                <span className="mon-notif-status mon-notif-status--done">{tgName ? `Hi ${tgName}!` : 'Linked'}</span>
              ) : (
                <span className="mon-notif-status mon-notif-status--muted">Try again later</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </dialog>
  )
}
