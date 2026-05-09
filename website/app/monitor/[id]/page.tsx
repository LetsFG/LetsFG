'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'

interface PriceSnapshot {
  price: number
  currency: string
  cheapest_airline: string
  checked_at: string
}

interface Monitor {
  monitor_id: string
  origin: string
  destination: string
  departure_date: string
  return_date?: string | null
  adults: number
  status: string
  last_price?: number | null
  last_currency?: string | null
  last_cheapest_airline?: string | null
  last_checked_at?: string | null
  weeks_purchased: number
  days_remaining: number
  weekly_unlock_credit: number
  notify_email?: string | null
  created_at: string
  price_history?: PriceSnapshot[]
}

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch (_) {
    return iso
  }
}

function fmtDateTime(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  } catch (_) {
    return iso
  }
}

function fmtPrice(price: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(price)
  } catch (_) {
    return `${currency} ${price.toFixed(0)}`
  }
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; bg: string; color: string; border: string }> = {
    active:    { label: 'Active',    bg: 'rgba(34,197,94,0.1)',  color: '#16a34a', border: 'rgba(34,197,94,0.3)'  },
    pending:   { label: 'Pending',   bg: 'rgba(251,191,36,0.1)', color: '#d97706', border: 'rgba(251,191,36,0.3)' },
    expired:   { label: 'Expired',   bg: 'rgba(20,45,60,0.06)',  color: 'rgba(20,45,60,0.5)', border: 'rgba(20,45,60,0.15)' },
    cancelled: { label: 'Cancelled', bg: 'rgba(239,68,68,0.07)', color: '#dc2626', border: 'rgba(239,68,68,0.2)'  },
  }
  const s = map[status] ?? map['expired']
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', height: 26,
      padding: '0 10px', borderRadius: 999,
      background: s.bg, color: s.color,
      border: `1px solid ${s.border}`,
      fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
    }}>
      {s.label}
    </span>
  )
}

export default function MonitorDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id

  const [monitor, setMonitor] = useState<Monitor | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!id) { setLoading(false); setNotFound(true); return }
    fetch(`/api/monitor/${encodeURIComponent(id)}`)
      .then(r => {
        if (r.status === 404) { setNotFound(true); setLoading(false); return null }
        if (!r.ok) throw new Error('fetch_error')
        return r.json() as Promise<Monitor>
      })
      .then(data => {
        if (data) setMonitor(data)
        setLoading(false)
      })
      .catch(() => {
        setNotFound(true)
        setLoading(false)
      })
  }, [id])

  if (loading) {
    return (
      <main style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', padding: 24, background: '#fff',
      }}>
        <div style={{ textAlign: 'center', display: 'grid', gap: 16 }}>
          <div style={{
            width: 44, height: 44, margin: '0 auto',
            border: '3px solid rgba(20,45,60,0.1)',
            borderTopColor: '#f47a1c',
            borderRadius: '50%',
            animation: 'mon-spin 0.9s linear infinite',
          }} />
          <p style={{ color: 'rgba(20,45,60,0.5)', fontSize: '0.9rem', margin: 0 }}>Loading monitor…</p>
          <style>{`@keyframes mon-spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </main>
    )
  }

  if (notFound || !monitor) {
    return (
      <main className="mon-redirect-page" style={{ background: '#f9fafb' }}>
        <div style={{
          width: '100%', maxWidth: 400,
          padding: '44px 32px',
          background: '#fff',
          border: '1px solid rgba(20,45,60,0.1)',
          borderRadius: 24,
          boxShadow: '0 8px 32px rgba(20,53,76,0.1)',
          display: 'grid', gap: 14, textAlign: 'center',
        }}>
          <div style={{ fontSize: '2.5rem', lineHeight: 1 }}>📭</div>
          <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 900, letterSpacing: '-0.03em', color: '#142d3e' }}>
            Monitor not found
          </h1>
          <p style={{ margin: 0, fontSize: '0.9rem', color: 'rgba(20,45,60,0.6)', lineHeight: 1.6 }}>
            This price monitor link may have expired or been removed.
          </p>
          <Link href="/en" className="mon-redirect-btn" style={{ marginTop: 4 }}>
            Search flights
          </Link>
        </div>
      </main>
    )
  }

  const history = (monitor.price_history ?? []).slice().reverse()
  const routeLabel = `${monitor.origin} → ${monitor.destination}`
  const hasMeta = monitor.departure_date || monitor.return_date
  const isActive = monitor.status === 'active'

  return (
    <main style={{
      minHeight: '100vh',
      background: '#f9fafb',
      padding: '32px 16px 72px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 0,
    }}>
      {/* Header */}
      <div style={{ width: '100%', maxWidth: 520, marginBottom: 20 }}>
        <Link href="/en" style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: '0.82rem', fontWeight: 600,
          color: 'rgba(20,45,60,0.5)', textDecoration: 'none',
          padding: '6px 0',
        }}>
          ← LetsFG
        </Link>
      </div>

      {/* Main card */}
      <div style={{
        width: '100%', maxWidth: 520,
        background: '#fff',
        border: '1px solid rgba(20,45,60,0.1)',
        borderRadius: 24,
        boxShadow: '0 8px 32px rgba(20,53,76,0.1)',
        overflow: 'hidden',
      }}>
        {/* Card header */}
        <div style={{
          padding: '24px 28px 20px',
          borderBottom: '1px solid rgba(20,45,60,0.07)',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
            <span className="mon-kicker" style={{ marginBottom: 0 }}>Flight Monitor</span>
            <StatusBadge status={monitor.status} />
          </div>
          <h1 style={{
            margin: '8px 0 0',
            fontSize: '1.7rem',
            fontWeight: 900,
            letterSpacing: '-0.04em',
            lineHeight: 1.05,
            color: '#142d3e',
          }}>
            {routeLabel}
          </h1>
          {hasMeta && (
            <p style={{ margin: '6px 0 0', fontSize: '0.84rem', color: 'rgba(20,45,60,0.5)', fontWeight: 600 }}>
              {fmtDate(monitor.departure_date)}
              {monitor.return_date ? ` – ${fmtDate(monitor.return_date)}` : ''}
              {monitor.adults > 1 ? ` · ${monitor.adults} adults` : ''}
            </p>
          )}
        </div>

        {/* Price section */}
        {monitor.last_price != null && (
          <div style={{
            padding: '20px 28px',
            borderBottom: '1px solid rgba(20,45,60,0.07)',
            background: 'linear-gradient(135deg, rgba(244,122,28,0.05), rgba(255,255,255,0))',
          }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(20,45,60,0.42)', marginBottom: 6 }}>
              Latest price
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <span style={{
                fontSize: '2.4rem',
                fontWeight: 900,
                letterSpacing: '-0.05em',
                color: '#142d3e',
                lineHeight: 1,
              }}>
                {fmtPrice(monitor.last_price, monitor.last_currency ?? 'EUR')}
              </span>
              {monitor.last_cheapest_airline && (
                <span style={{ fontSize: '0.88rem', fontWeight: 700, color: 'rgba(20,45,60,0.55)' }}>
                  {monitor.last_cheapest_airline}
                </span>
              )}
            </div>
            {monitor.last_checked_at && (
              <p style={{ margin: '6px 0 0', fontSize: '0.74rem', color: 'rgba(20,45,60,0.38)', fontWeight: 600 }}>
                Checked {fmtDateTime(monitor.last_checked_at)}
              </p>
            )}
          </div>
        )}

        {/* Stats row */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          borderBottom: '1px solid rgba(20,45,60,0.07)',
        }}>
          <div style={{ padding: '16px 28px', borderRight: '1px solid rgba(20,45,60,0.07)' }}>
            <div style={{ fontSize: '0.68rem', fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(20,45,60,0.4)', marginBottom: 4 }}>
              Days remaining
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: 900, color: isActive ? '#142d3e' : 'rgba(20,45,60,0.4)', letterSpacing: '-0.03em' }}>
              {monitor.days_remaining}
            </div>
          </div>
          <div style={{ padding: '16px 28px' }}>
            <div style={{ fontSize: '0.68rem', fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(20,45,60,0.4)', marginBottom: 4 }}>
              Unlock credits
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: 900, color: monitor.weekly_unlock_credit > 0 ? '#16a34a' : 'rgba(20,45,60,0.4)', letterSpacing: '-0.03em' }}>
              {monitor.weekly_unlock_credit}
            </div>
          </div>
        </div>

        {/* Price history */}
        {history.length > 0 && (
          <div style={{ padding: '20px 28px', borderBottom: '1px solid rgba(20,45,60,0.07)' }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(20,45,60,0.42)', marginBottom: 12 }}>
              Price history
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {history.slice(0, 7).map((snap, i) => (
                <div key={i} style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '10px 14px',
                  background: i === 0 ? 'rgba(244,122,28,0.06)' : 'rgba(20,45,60,0.02)',
                  border: `1px solid ${i === 0 ? 'rgba(244,122,28,0.2)' : 'rgba(20,45,60,0.07)'}`,
                  borderRadius: 10,
                }}>
                  <div>
                    <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'rgba(20,45,60,0.45)' }}>
                      {fmtDateTime(snap.checked_at)}
                    </div>
                    {snap.cheapest_airline && (
                      <div style={{ fontSize: '0.74rem', color: 'rgba(20,45,60,0.38)', fontWeight: 500 }}>
                        {snap.cheapest_airline}
                      </div>
                    )}
                  </div>
                  <div style={{
                    fontSize: '1.05rem',
                    fontWeight: 800,
                    color: i === 0 ? '#f47a1c' : '#142d3e',
                    letterSpacing: '-0.02em',
                    flexShrink: 0,
                  }}>
                    {fmtPrice(snap.price, snap.currency)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div style={{ padding: '20px 28px', display: 'grid', gap: 10 }}>
          <Link
            href={`/en?origin=${encodeURIComponent(monitor.origin)}&destination=${encodeURIComponent(monitor.destination)}&date=${encodeURIComponent(monitor.departure_date)}${monitor.return_date ? `&return=${encodeURIComponent(monitor.return_date)}` : ''}&adults=${monitor.adults}`}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              height: 48, borderRadius: 12,
              background: '#f47a1c', color: '#fff',
              fontWeight: 800, fontSize: '0.95rem',
              textDecoration: 'none', letterSpacing: '0.01em',
              transition: 'background 0.14s',
            }}
          >
            Search flights now
          </Link>
          <Link
            href="/en"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              height: 44, borderRadius: 12,
              background: 'rgba(20,45,60,0.05)', color: 'rgba(20,45,60,0.65)',
              fontWeight: 700, fontSize: '0.88rem',
              textDecoration: 'none',
            }}
          >
            New search
          </Link>
        </div>
      </div>

      {/* Footer */}
      <p style={{ marginTop: 24, fontSize: '0.74rem', color: 'rgba(20,45,60,0.35)', textAlign: 'center' }}>
        Monitor ID: {monitor.monitor_id}
      </p>
    </main>
  )
}
