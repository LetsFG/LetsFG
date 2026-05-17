'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useLocale } from 'next-intl'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import Image from 'next/image'
import { getAirlineCodeFromName, getAirlineLogoUrl } from '../../../airlineLogos'
import { formatFlightTime } from '../../../../lib/flight-datetime'
import { buildLocaleHomePath } from '../../../../lib/locale-routing'

const SearchingTasks = dynamic(() => import('../../[searchId]/SearchingTasks'), { ssr: false })

// ── Types ─────────────────────────────────────────────────────────────────────
interface ExploreDest {
  destination: string
  destination_name: string
  price: number
  currency: string
  airline: string
  outbound_time: string | null
  arrival_time: string | null
  duration_seconds: number
  stops: number
  offer_source: string
  booking_url: string
}

interface ExploreStatus {
  status: 'searching' | 'completed' | 'error' | 'cancelled'
  mode: 'explore'
  origin: string
  origin_name?: string
  date_from: string
  currency: string
  total_results: number
  explore_destinations: ExploreDest[]
  elapsed_seconds?: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtDuration(secs: number) {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  return `${h}h ${m}m`
}

function fmtTime(iso: string | null) {
  if (!iso) return ''
  return formatFlightTime(iso)
}

function fmtDate(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function stopsLabel(n: number) {
  if (n === 0) return 'Direct'
  if (n === 1) return '1 stop'
  return `${n} stops`
}

function buildSearchQuery(origin: string, dest: string, outboundTime: string | null, dateFrom: string) {
  const date = outboundTime ? outboundTime.slice(0, 10) : dateFrom
  return date ? `${origin} to ${dest} on ${date}` : `${origin} to ${dest}`
}

// ── Destination card ──────────────────────────────────────────────────────────
function DestCard({ dest, origin, dateFrom, currency }: {
  dest: ExploreDest
  origin: string
  dateFrom: string
  currency: string
}) {
  const airlineCode = getAirlineCodeFromName(dest.airline) || ''
  const logoUrl = airlineCode ? getAirlineLogoUrl(airlineCode) : null

  const searchQ = buildSearchQuery(origin, dest.destination, dest.outbound_time, dateFrom)
  const href = `/results?q=${encodeURIComponent(searchQ)}&currency=${currency}`

  const depTime = fmtTime(dest.outbound_time)
  const arrTime = fmtTime(dest.arrival_time)
  const depDate = fmtDate(dest.outbound_time)

  const cardContent = (
    <div className="rf-card-row">
      {/* Airline */}
      <div className="rf-airline">
        <div className={`rf-airline-badge${logoUrl ? ' rf-airline-badge--img' : ''}`}>
          {logoUrl
            ? <img src={logoUrl} alt={dest.airline} width={28} height={28} />
            : <span>{airlineCode || dest.airline.slice(0, 2).toUpperCase()}</span>
          }
        </div>
        <div className="rf-airline-copy">
          <span className="rf-airline-name" style={{ fontSize: '0.84rem', fontWeight: 700, color: '#0d1e28' }}>
            {dest.airline}
          </span>
        </div>
      </div>

      {/* Route */}
      <div className="rf-route">
        <div className="rf-endpoint">
          <span className="rf-time">{depTime || '—'}</span>
          <span className="rf-iata">{origin}</span>
          {depDate && <span style={{ fontSize: '0.6rem', color: 'rgba(20,45,60,0.4)', fontWeight: 600 }}>{depDate}</span>}
        </div>
        <div className="rf-path">
          <span className="rf-duration">{fmtDuration(dest.duration_seconds)}</span>
          <div className="rf-path-line">
            <div className="rf-path-dot" />
            <div className="rf-path-track" />
            <div className="rf-path-dot" />
          </div>
          <span className={`rf-stops${dest.stops === 0 ? ' rf-stops--direct' : ''}`}>
            {stopsLabel(dest.stops)}
          </span>
        </div>
        <div className="rf-endpoint rf-endpoint--arr">
          <span className="rf-time">{arrTime || dest.destination_name}</span>
          <span className="rf-iata">{dest.destination}</span>
          {arrTime && <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#0d1e28' }}>{dest.destination_name}</span>}
        </div>
      </div>

      {/* Price + CTA */}
      <div className="rf-price-wrap" style={{ gridColumn: 'span 2', justifySelf: 'end', alignItems: 'flex-end', gap: 8 }}>
        <div className="rf-price">
          {dest.currency} {Math.round(dest.price).toLocaleString('en')}
        </div>
        <span className="rf-price-sub">avg. price</span>
        <span className="rf-book-btn" style={{ marginTop: 6, fontSize: '0.78rem', height: 36, padding: '0 14px', whiteSpace: 'nowrap' }}>
          See real results
        </span>
      </div>
    </div>
  )

  return (
    <Link href={href} className="expl-card rf-card" style={{ textDecoration: 'none', color: 'inherit' }}>
      {cardContent}
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
  const locale = useLocale()
  const [exploreStatus, setExploreStatus] = useState<ExploreStatus | null>(null)
  const [failed, setFailed] = useState(false)
  const doneRef = useRef(false)
  const homeHref = buildLocaleHomePath(locale)

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/results/${searchId}`, { cache: 'no-store' })
      if (!res.ok) return
      const data: ExploreStatus = await res.json()
      setExploreStatus(data)

      if (data.status === 'completed' || data.status === 'error' || data.status === 'cancelled') {
        doneRef.current = true
        if (!data.explore_destinations?.length) setFailed(true)
      }
    } catch (_) { /* ignore */ }
  }, [searchId])

  useEffect(() => {
    poll()
    const interval = setInterval(() => {
      if (!doneRef.current) poll()
    }, 2000)
    return () => clearInterval(interval)
  }, [poll])

  const destinations = exploreStatus?.explore_destinations ?? []
  const origin = exploreStatus?.origin ?? ''
  const originName = exploreStatus?.origin_name ?? origin
  const dateFrom = exploreStatus?.date_from ?? ''
  const isSearching = !doneRef.current || (!destinations.length && !failed)

  // ── Loading / error ──────────────────────────────────────────────────────
  if (isSearching || (failed && !destinations.length)) {
    return (
      <main className="res-page res-page--searching">
        <section className="res-hero res-hero--searching">
          <div className="res-hero-backdrop" aria-hidden="true" />
          <div className="res-hero-inner">
            <div className="res-topbar res-topbar--searching">
              <Link href={homeHref} className="res-topbar-logo-link" aria-label="LetsFG home">
                <Image src="/lfg_ban.png" alt="LetsFG" width={4990} height={1560} className="res-topbar-logo" priority />
              </Link>
            </div>
            <div className="res-searching-stage">
              <SearchingTasks
                searchId={searchId}
                originLabel={originName || undefined}
                originCode={origin || undefined}
                destinationLabel="Anywhere"
              />
            </div>
          </div>
        </section>
      </main>
    )
  }

  // ── Results ──────────────────────────────────────────────────────────────
  const dateDisplay = dateFrom
    ? new Date(dateFrom).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : ''

  return (
    <main className="res-page res-page--completed">
      <section className="res-hero res-hero--results">
        <div className="res-hero-backdrop" aria-hidden="true" />
        <div className="res-hero-inner">
          <div className="res-topbar res-topbar--results">
            <Link href={homeHref} className="res-topbar-logo-link" aria-label="LetsFG home">
              <Image src="/lfg_ban.png" alt="LetsFG" width={4990} height={1560} className="res-topbar-logo" priority />
            </Link>
          </div>
          <div className="res-meta-bar" style={{ paddingLeft: 0 }}>
            <span className="res-meta-label">EXPLORE</span>
            <span className="res-meta-sep">·</span>
            <span className="res-meta-route">{originName || origin} → Anywhere</span>
            {dateDisplay && (
              <>
                <span className="res-meta-sep">·</span>
                <span className="res-meta-detail">{dateDisplay}</span>
              </>
            )}
            <span className="res-meta-sep">·</span>
            <span className="res-meta-detail">{destinations.length} offer{destinations.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
      </section>

      <div className="res-body">
        <div className="res-results-shell" style={{ margin: '32px auto', padding: '0 20px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {destinations.map((dest, idx) => (
              <DestCard
                key={`${dest.destination}-${dest.airline}-${idx}`}
                dest={dest}
                origin={origin}
                dateFrom={dateFrom}
                currency={currency}
              />
            ))}
          </div>
        </div>
      </div>
    </main>
  )
}


