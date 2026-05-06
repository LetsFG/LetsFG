'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { getAirlineLogoUrl } from '../../../airlineLogos'
import { formatCurrencyAmount } from '../../../../lib/user-currency'
import { formatFlightTime } from '../../../../lib/flight-datetime'

// ── Types ─────────────────────────────────────────────────────────────────────
interface ExploreDest {
  destination: string
  destination_name: string
  price: number
  currency: string
  airline: string
  outbound_time: string | null
  duration_seconds: number
  stops: number
  offer_source: string
}

interface ExploreStatus {
  status: 'searching' | 'completed' | 'error' | 'cancelled'
  mode: 'explore'
  origin: string
  date_from: string
  currency: string
  total_results: number
  explore_destinations: ExploreDest[]
  elapsed_seconds?: number
}

// ── Helper: format duration ──────────────────────────────────────────────────
function formatDuration(seconds: number): string {
  if (!seconds) return ''
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

// ── Destination card ─────────────────────────────────────────────────────────
function DestCard({ dest, currency, query }: { dest: ExploreDest; currency: string; query: string }) {
  const depDate = dest.outbound_time ? dest.outbound_time.slice(0, 10) : ''
  const depTime = dest.outbound_time
    ? formatFlightTime(dest.outbound_time)
    : ''
  const logoUrl = getAirlineLogoUrl(dest.airline, '')
  const nextQuery = `${query.replace(/\s+anywhere.*$/i, '').replace(/\s+to$/i, '').trim()} to ${dest.destination_name}`

  return (
    <Link
      href={`/results?q=${encodeURIComponent(nextQuery)}`}
      className="explore-card"
      aria-label={`${dest.destination_name}: ${dest.currency} ${dest.price}`}
    >
      <div className="explore-card-dest">
        <span className="explore-card-iata">{dest.destination}</span>
        <span className="explore-card-name">{dest.destination_name}</span>
      </div>
      <div className="explore-card-meta">
        {logoUrl && (
          <Image src={logoUrl} alt={dest.airline} width={20} height={20} className="explore-card-logo" />
        )}
        <span className="explore-card-airline">{dest.airline}</span>
        {depTime && <span className="explore-card-time">{depTime}</span>}
        {dest.duration_seconds > 0 && (
          <span className="explore-card-dur">{formatDuration(dest.duration_seconds)}</span>
        )}
        {dest.stops === 0
          ? <span className="explore-card-stops explore-card-stops--direct">Direct</span>
          : <span className="explore-card-stops">{dest.stops} stop{dest.stops !== 1 ? 's' : ''}</span>
        }
      </div>
      <div className="explore-card-price">
        {formatCurrencyAmount(dest.price, dest.currency as Parameters<typeof formatCurrencyAmount>[1])}
      </div>
    </Link>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ExplorePageClient({
  searchId,
  query,
  currency,
}: {
  searchId: string
  query: string
  currency: string
}) {
  const router = useRouter()
  const [dests, setDests] = useState<ExploreDest[]>([])
  const [status, setStatus] = useState<'searching' | 'completed' | 'error'>('searching')
  const [origin, setOrigin] = useState('')
  const [elapsed, setElapsed] = useState(0)

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/results/${searchId}`, { cache: 'no-store' })
      if (!res.ok) return
      const data: ExploreStatus = await res.json()
      if (data.explore_destinations?.length) {
        setDests(data.explore_destinations)
      }
      setOrigin(data.origin || '')
      setElapsed(data.elapsed_seconds || 0)
      if (data.status === 'completed' || data.status === 'error' || data.status === 'cancelled') {
        setStatus(data.status === 'error' ? 'error' : 'completed')
      }
    } catch {
      // ignore
    }
  }, [searchId])

  useEffect(() => {
    poll()
    const interval = setInterval(() => {
      if (status === 'searching') poll()
      else clearInterval(interval)
    }, 2000)
    return () => clearInterval(interval)
  }, [poll, status])

  const originLabel = origin || 'your city'
  const isSearching = status === 'searching'

  return (
    <main className="res-page explore-page">
      <section className={`res-hero${dests.length > 0 ? ' res-hero--results' : isSearching ? ' res-hero--searching' : ''}`}>
        <div className="res-hero-backdrop" aria-hidden="true" />
        <div className="res-hero-inner">
          {/* Topbar */}
          <div className="res-topbar res-topbar--results">
            <Link href="/en" className="res-topbar-logo-link" aria-label="LetsFG home">
              <Image src="/lfg_ban.png" alt="LetsFG" width={4990} height={1560} className="res-topbar-logo" priority />
            </Link>
          </div>

          <div className="res-hero-copy">
            <p className="res-hero-kicker">
              {isSearching
                ? `Searching across 20+ destinations…`
                : `${dests.length} destinations found`}
            </p>
            <h1 className="res-hero-route">{originLabel} → Anywhere</h1>
            {isSearching && dests.length === 0 && (
              <p className="res-hero-status">Finding the cheapest flights from {originLabel}…</p>
            )}
          </div>
        </div>
      </section>

      <section className="explore-grid-section">
        {dests.length > 0 ? (
          <div className="explore-grid">
            {dests.map((d) => (
              <DestCard key={d.destination} dest={d} currency={currency} query={query} />
            ))}
          </div>
        ) : isSearching ? (
          <div className="explore-empty">
            <div className="explore-spinner" aria-label="Searching…" />
            <p className="explore-empty-msg">Checking fares from {originLabel}…</p>
          </div>
        ) : (
          <div className="explore-empty">
            <p className="explore-empty-msg">No destinations found. Try a different date or origin.</p>
            <Link href="/en" className="explore-back-link">← New search</Link>
          </div>
        )}
      </section>
    </main>
  )
}
