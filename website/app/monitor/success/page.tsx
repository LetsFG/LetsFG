'use client'

import Link from 'next/link'
import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

declare global {
  interface Window {
    onTelegramAuth?: (user: TelegramUser) => void
  }
}

interface TelegramUser {
  id: number
  first_name: string
  last_name?: string
  username?: string
  photo_url?: string
  auth_date: number
  hash: string
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return new Uint8Array([...rawData].map(c => c.charCodeAt(0)))
}

export default function MonitorSuccessPage() {
  return (
    <Suspense fallback={
      <main className="mon-redirect-page">
        <div className="mon-redirect-card">
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', textAlign: 'center' }}>Setting up your monitor…</p>
        </div>
      </main>
    }>
      <MonitorSuccessInner />
    </Suspense>
  )
}

function MonitorSuccessInner() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [monitorId, setMonitorId] = useState<string | null>(null)
  const [redirecting, setRedirecting] = useState(false)

  // Push state — only used in the fallback (no return URL) path
  const [pushState, setPushState] = useState<'idle' | 'loading' | 'done' | 'denied' | 'error'>('idle')

  // Telegram state — only used in the fallback path
  const [tgState, setTgState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [tgName, setTgName] = useState('')
  const tgContainerRef = useRef<HTMLDivElement>(null)

  // Resolve monitor_id — three sources in priority order:
  // 1. sessionStorage (set by the modal before Stripe redirect — normal same-tab path)
  // 2. ?mid= query param (email CTAs / direct links)
  // 3. ?cs= Stripe checkout session ID → look up monitor_id server-side
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem('letsfg_monitor_id')
      if (stored) { setMonitorId(stored); return }
    } catch { /* ignore */ }

    const mid = searchParams.get('mid')
    if (mid) { setMonitorId(mid); return }

    const cs = searchParams.get('cs')
    if (cs && cs.startsWith('cs_')) {
      fetch(`/api/monitor/session-info?cs=${encodeURIComponent(cs)}`)
        .then(r => r.ok ? r.json() as Promise<{ monitor_id?: string }> : Promise.resolve(null))
        .then(data => { if (data?.monitor_id) setMonitorId(data.monitor_id) })
        .catch(() => { /* non-fatal */ })
    }
  }, [searchParams])

  // Once monitorId is resolved, redirect back to search results if possible.
  // If no return URL, stay on this page and handle push registration here.
  useEffect(() => {
    if (!monitorId || redirecting) return

    let returnUrl: string | null = null
    try {
      returnUrl = sessionStorage.getItem('letsfg_monitor_return_url')
      if (returnUrl) sessionStorage.removeItem('letsfg_monitor_return_url')
    } catch { /* ignore */ }

    if (returnUrl) {
      // Redirect — leave letsfg_push_pending_sub for the overlay to handle
      setRedirecting(true)
      try {
        const url = new URL(returnUrl)
        url.searchParams.set('monitor_active', monitorId)
        router.replace(url.toString())
      } catch {
        router.replace('/en')
      }
      return
    }

    // No return URL — fallback path. Register any pending push sub here.
    try {
      const pending = sessionStorage.getItem('letsfg_push_pending_sub')
      if (pending) {
        sessionStorage.removeItem('letsfg_push_pending_sub')
        const sub = JSON.parse(pending) as object
        setPushState('loading')
        fetch('/api/monitor/push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ monitor_id: monitorId, subscription: sub }),
        })
          .then(r => r.ok ? setPushState('done') : setPushState('error'))
          .catch(() => setPushState('error'))
      }
    } catch { /* ignore */ }
  }, [monitorId, redirecting, router])

  // Service worker registration
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw.js').catch(() => { /* non-fatal */ })
  }, [])

  // Telegram widget — injected in the fallback path once monitorId is known
  const isLocalhost = typeof window !== 'undefined' && window.location.hostname === 'localhost'
  useEffect(() => {
    if (isLocalhost || !monitorId || !tgContainerRef.current) return

    window.onTelegramAuth = async (user: TelegramUser) => {
      setTgState('loading')
      try {
        const resp = await fetch('/api/monitor/telegram', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ monitor_id: monitorId, user }),
        })
        const data = await resp.json() as { ok?: boolean; first_name?: string; error?: string }
        if (!resp.ok || !data.ok) { setTgState('error'); return }
        setTgName(data.first_name || user.first_name)
        setTgState('done')
      } catch {
        setTgState('error')
      }
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
  }, [monitorId])

  async function handleEnablePush() {
    if (!monitorId || pushState === 'loading') return
    setPushState('loading')
    try {
      const keyResp = await fetch('/api/monitor/vapid-key')
      if (!keyResp.ok) { setPushState('error'); return }
      const body = await keyResp.json() as { public_key?: string; vapid_public_key?: string }
      const public_key = body.public_key ?? body.vapid_public_key
      if (!public_key) { setPushState('error'); return }
      if (!('serviceWorker' in navigator)) { setPushState('error'); return }
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') { setPushState('denied'); return }
      const reg = await navigator.serviceWorker.ready
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
    } catch {
      setPushState('error')
    }
  }

  // Loading / redirecting state
  if (redirecting || !monitorId) {
    return (
      <main className="mon-redirect-page">
        <div className="mon-redirect-card">
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
            {redirecting ? 'Redirecting…' : 'Setting up your monitor…'}
          </p>
        </div>
      </main>
    )
  }

  // Fallback: no return URL (user came from email, direct link, etc.)
  return (
    <main className="mon-redirect-page">
      <div className="mon-redirect-card">
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <svg width="44" height="44" viewBox="0 0 44 44" fill="none" aria-hidden="true">
            <circle cx="22" cy="22" r="20" fill="rgba(34,197,94,0.12)" stroke="#22c55e" strokeWidth="2" />
            <path d="M12 22l7 7 13-13" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h1 className="mon-redirect-title">Monitoring active</h1>
        <p className="mon-redirect-body">
          Daily price alerts are now tracking your route. Add notification channels below to stay informed when prices drop.
        </p>

        <div className="mon-notif-stack">
          {/* Browser push */}
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
              {pushState === 'idle' && (
                <button className="mon-notif-btn" onClick={handleEnablePush}>Enable</button>
              )}
              {pushState === 'loading' && (
                <span className="mon-notif-status mon-notif-status--loading">Setting up…</span>
              )}
              {pushState === 'done' && (
                <span className="mon-notif-status mon-notif-status--done">On</span>
              )}
              {pushState === 'denied' && (
                <span className="mon-notif-status mon-notif-status--muted">Blocked</span>
              )}
              {pushState === 'error' && (
                <button className="mon-notif-btn mon-notif-btn--retry" onClick={handleEnablePush}>Retry</button>
              )}
            </div>
          </div>

          {/* Telegram */}
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
              {tgState === 'idle' && (
                <div ref={tgContainerRef} className="mon-tg-widget" />
              )}
              {tgState === 'loading' && (
                <span className="mon-notif-status mon-notif-status--loading">Linking…</span>
              )}
              {tgState === 'done' && (
                <span className="mon-notif-status mon-notif-status--done">{tgName ? `Hi ${tgName}!` : 'Linked'}</span>
              )}
              {tgState === 'error' && (
                <span className="mon-notif-status mon-notif-status--muted">Try again later</span>
              )}
            </div>
          </div>
        </div>

        <Link href="/en" className="mon-redirect-btn">Search more flights</Link>
      </div>
    </main>
  )
}
