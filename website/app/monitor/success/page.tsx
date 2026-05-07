'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

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
  const [monitorId, setMonitorId] = useState<string | null>(null)

  // Push notification state
  const [pushState, setPushState] = useState<'idle' | 'loading' | 'done' | 'denied' | 'error'>('idle')

  // Telegram state
  const [tgState, setTgState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [tgName, setTgName] = useState('')
  const tgContainerRef = useRef<HTMLDivElement>(null)

  // Read monitor_id from sessionStorage
  useEffect(() => {
    try {
      const mid = sessionStorage.getItem('letsfg_monitor_id')
      if (mid) setMonitorId(mid)
    } catch { /* ignore */ }
  }, [])

  // Register service worker
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw.js').catch(() => { /* non-fatal */ })
  }, [])

  // Inject Telegram Login Widget once we have a monitor_id
  useEffect(() => {
    if (!monitorId || !tgContainerRef.current) return

    window.onTelegramAuth = async (user: TelegramUser) => {
      setTgState('loading')
      try {
        const resp = await fetch('/api/monitor/telegram', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ monitor_id: monitorId, user }),
        })
        const data = await resp.json() as { ok?: boolean; first_name?: string; error?: string }
        if (!resp.ok || !data.ok) {
          setTgState('error')
          return
        }
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

    return () => {
      delete window.onTelegramAuth
    }
  }, [monitorId])

  async function handleEnablePush() {
    if (!monitorId) return
    setPushState('loading')

    try {
      // 1. Get VAPID public key
      const keyResp = await fetch('/api/monitor/vapid-key')
      if (!keyResp.ok) { setPushState('error'); return }
      const { public_key } = await keyResp.json() as { public_key?: string }
      if (!public_key) { setPushState('error'); return }

      // 2. Request notification permission
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setPushState('denied')
        return
      }

      // 3. Subscribe via PushManager
      const reg = await navigator.serviceWorker.ready
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(public_key),
      })

      // 4. Send subscription to backend
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

  return (
    <main className="mon-redirect-page">
      <div className="mon-redirect-card mon-redirect-card--success">
        <div className="mon-redirect-icon" aria-hidden="true">✅</div>
        <h1 className="mon-redirect-title">Your monitoring is active!</h1>
        <p className="mon-redirect-body">
          Check your email for a confirmation with your first daily update. You&apos;ll get
          price alerts and one booking unlock per week for the route you selected.
        </p>

        {monitorId && (
          <div className="mon-notif-stack">
            {/* Browser push notifications */}
            <div className="mon-notif-card">
              <div className="mon-notif-icon" aria-hidden="true">🔔</div>
              <div className="mon-notif-body">
                <div className="mon-notif-title">Browser notifications</div>
                <div className="mon-notif-desc">Get push alerts directly in Chrome, Firefox, or Edge — no app needed.</div>
              </div>
              <div className="mon-notif-action">
                {pushState === 'idle' && (
                  <button className="mon-notif-btn" onClick={handleEnablePush}>
                    Enable
                  </button>
                )}
                {pushState === 'loading' && (
                  <span className="mon-notif-status mon-notif-status--loading">Setting up…</span>
                )}
                {pushState === 'done' && (
                  <span className="mon-notif-status mon-notif-status--done">✓ On</span>
                )}
                {pushState === 'denied' && (
                  <span className="mon-notif-status mon-notif-status--muted">Blocked by browser</span>
                )}
                {pushState === 'error' && (
                  <button className="mon-notif-btn mon-notif-btn--retry" onClick={handleEnablePush}>
                    Retry
                  </button>
                )}
              </div>
            </div>

            {/* Telegram */}
            <div className="mon-notif-card">
              <div className="mon-notif-icon" aria-hidden="true">✈️</div>
              <div className="mon-notif-body">
                <div className="mon-notif-title">Telegram alerts</div>
                <div className="mon-notif-desc">Receive daily price updates via @letsfg_bot on Telegram.</div>
              </div>
              <div className="mon-notif-action">
                {tgState === 'idle' && (
                  <div ref={tgContainerRef} className="mon-tg-widget" />
                )}
                {tgState === 'loading' && (
                  <span className="mon-notif-status mon-notif-status--loading">Linking…</span>
                )}
                {tgState === 'done' && (
                  <span className="mon-notif-status mon-notif-status--done">✓ {tgName ? `Hi ${tgName}!` : 'Linked'}</span>
                )}
                {tgState === 'error' && (
                  <span className="mon-notif-status mon-notif-status--muted">Try again later</span>
                )}
              </div>
            </div>
          </div>
        )}

        <Link href="/en" className="mon-redirect-btn">
          Search more flights
        </Link>
      </div>
    </main>
  )
}
