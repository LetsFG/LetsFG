'use client'

import { useState, useCallback, useTransition } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'

// ── Chevron icon ──────────────────────────────────────────────────────────────
function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      width="15"
      height="15"
      aria-hidden="true"
      style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
    >
      <path d="M5 7.5l5 5 5-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ── Dual-handle range slider ──────────────────────────────────────────────────
function DualRange({
  min,
  max,
  low: initLow,
  high: initHigh,
  formatLabel,
}: {
  min: number
  max: number
  low: number
  high: number
  formatLabel: (v: number) => string
}) {
  const [low, setLow] = useState(initLow)
  const [high, setHigh] = useState(initHigh)
  const range = max - min || 1
  const loPct = ((low - min) / range) * 100
  const hiPct = ((high - min) / range) * 100

  return (
    <div className="rf-dual">
      <div className="rf-dual-vals">
        <span>{formatLabel(low)}</span>
        <span>{formatLabel(high)}</span>
      </div>
      <div
        className="rf-dual-track"
        style={{ '--lo': `${loPct}%`, '--hi': `${hiPct}%` } as React.CSSProperties}
      >
        <input
          type="range"
          className="rf-dual-input"
          min={min}
          max={max}
          value={low}
          onChange={e => setLow(Math.min(Number(e.target.value), high - 1))}
        />
        <input
          type="range"
          className="rf-dual-input"
          min={min}
          max={max}
          value={high}
          onChange={e => setHigh(Math.max(Number(e.target.value), low + 1))}
        />
      </div>
    </div>
  )
}

// ── Props ─────────────────────────────────────────────────────────────────────
export interface FilterProps {
  stopsStats: Record<string, { count: number; min: number }>
  airlineOptions: { airline: string; minPrice: number }[]
  currency: string
  priceMin: number
  priceMax: number
  activeStops: string[]
  activeAirlines: string[]
  hasActiveFilters: boolean
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ResultsFilters({
  stopsStats,
  airlineOptions,
  currency,
  priceMin,
  priceMax,
  activeStops,
  activeAirlines,
  hasActiveFilters,
}: FilterProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()
  const [airlinesOpen, setAirlinesOpen] = useState(true)

  const buildUrl = useCallback(
    (overrides: { stops?: string; airlines?: string }) => {
      const params = new URLSearchParams(searchParams.toString())
      if (overrides.stops !== undefined) {
        if (!overrides.stops) params.delete('stops')
        else params.set('stops', overrides.stops)
      }
      if (overrides.airlines !== undefined) {
        if (!overrides.airlines) params.delete('airlines')
        else params.set('airlines', overrides.airlines)
      }
      const str = params.toString()
      return `${pathname}${str ? `?${str}` : ''}`
    },
    [pathname, searchParams]
  )

  const navigate = useCallback(
    (url: string) => startTransition(() => router.push(url, { scroll: false })),
    [router]
  )

  const toggleStops = (key: string) => {
    const next = activeStops.includes(key)
      ? activeStops.filter(s => s !== key)
      : [...activeStops, key]
    navigate(buildUrl({ stops: next.join(',') }))
  }

  const toggleAirline = (airline: string) => {
    const next = activeAirlines.includes(airline)
      ? activeAirlines.filter(a => a !== airline)
      : [...activeAirlines, airline]
    navigate(buildUrl({ airlines: next.join(',') }))
  }

  const clearAll = () => navigate(buildUrl({ stops: '', airlines: '' }))

  const fmtPrice = (p: number) =>
    p === Infinity || p === -Infinity ? '—' : `${currency}${Math.round(p)}`

  const fmtTime = (mins: number) => {
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }

  const stopsOptions = [
    { key: '0', label: 'Direct' },
    { key: '1', label: '1 stop' },
    { key: '2plus', label: '2+ stops' },
  ] as const

  return (
    <aside className="rf-filters">
      <div className="rf-filters-header">
        <span className="rf-filters-title">Filters</span>
        {hasActiveFilters && (
          <button className="rf-filters-clear" onClick={clearAll}>
            Clear all
          </button>
        )}
      </div>

      {/* ── Stops ── */}
      <div className="rf-filter-section">
        <div className="rf-filter-heading">
          <span>Stops</span>
        </div>
        {stopsOptions.map(({ key, label }) => {
          const stat = stopsStats[key]
          if (!stat || stat.count === 0) return null
          const active = activeStops.includes(key)
          return (
            <button
              key={key}
              className={`rf-filter-row${active ? ' rf-filter-row--on' : ''}`}
              onClick={() => toggleStops(key)}
            >
              <span className={`rf-filter-check${active ? ' rf-filter-check--on' : ''}`} aria-hidden="true" />
              <span className="rf-filter-label">{label}</span>
              {stat.min !== Infinity && <span className="rf-filter-price">{fmtPrice(stat.min)}</span>}
            </button>
          )
        })}
      </div>

      {/* ── Price range ── */}
      <div className="rf-filter-section">
        <div className="rf-filter-heading">
          <span>Price range</span>
        </div>
        <DualRange min={priceMin} max={priceMax} low={priceMin} high={priceMax} formatLabel={fmtPrice} />
      </div>

      {/* ── Departure time ── */}
      <div className="rf-filter-section">
        <div className="rf-filter-heading">
          <span>Departure time</span>
        </div>
        <div className="rf-filter-sub">outbound</div>
        <DualRange min={0} max={1439} low={0} high={1439} formatLabel={fmtTime} />
      </div>

      {/* ── Return time ── */}
      <div className="rf-filter-section">
        <div className="rf-filter-heading">
          <span>Return time</span>
        </div>
        <DualRange min={0} max={1439} low={0} high={1439} formatLabel={fmtTime} />
      </div>

      {/* ── Airlines ── */}
      <div className="rf-filter-section">
        <button
          className="rf-filter-heading rf-filter-heading--btn"
          onClick={() => setAirlinesOpen(o => !o)}
        >
          <span>Airlines</span>
          <ChevronIcon open={airlinesOpen} />
        </button>
        {airlinesOpen &&
          airlineOptions.map(({ airline, minPrice }) => {
            const active = activeAirlines.includes(airline)
            return (
              <button
                key={airline}
                className={`rf-filter-row${active ? ' rf-filter-row--on' : ''}`}
                onClick={() => toggleAirline(airline)}
              >
                <span className={`rf-filter-check${active ? ' rf-filter-check--on' : ''}`} aria-hidden="true" />
                <span className="rf-filter-label">{airline}</span>
                <span className="rf-filter-price">{fmtPrice(minPrice)}</span>
              </button>
            )
          })}
      </div>

      {/* ── Amenities (placeholder) ── */}
      <div className="rf-filter-section rf-filter-section--last">
        <div className="rf-filter-heading rf-filter-heading--muted">
          <span>Amenities</span>
        </div>
      </div>
    </aside>
  )
}
