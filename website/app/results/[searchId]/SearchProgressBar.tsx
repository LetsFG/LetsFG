'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'

// The connectors we actually check — ordered roughly by how fast they return results
const ALL_SOURCES = [
  'Google Flights', 'Kiwi.com', 'Skyscanner', 'Kayak', 'Momondo',
  'Ryanair', 'easyJet', 'Wizz Air', 'Norwegian', 'Vueling',
  'Transavia', 'Iberia', 'British Airways', 'Air France', 'KLM',
  'Lufthansa', 'Eurowings', 'Southwest', 'JetBlue', 'Spirit',
  'AirAsia', 'IndiGo', 'LATAM', 'flydubai', 'Air Arabia',
  'TAP Air Portugal', 'Jet2', 'Volotea', 'Corendon', 'SunExpress',
]

interface Props {
  progress?: { checked: number; total: number; found: number }
}

/** Returns which connectors are still pending based on search progress ratio */
function getRemaining(checked: number, total: number): string[] {
  const ratio = checked > 0 && total > 0 ? checked / total : 0
  const completedIdx = Math.floor(ratio * ALL_SOURCES.length)
  const remaining = ALL_SOURCES.slice(completedIdx)
  return remaining.length > 0 ? remaining : ALL_SOURCES.slice(-1)
}

/** Full-page progress bar shown on the loading screen (no offers yet) */
export function SearchProgressBarFull({ progress }: { progress?: Props['progress'] }) {
  const t = useTranslations('Results')
  const mountedAt = useRef(Date.now())
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const checked = progress?.checked ?? 0
  const total = progress?.total ?? 180
  const found = progress?.found ?? 0
  const pct = Math.min(99, checked > 0 && total > 0
    ? Math.round((checked / total) * 100)
    : Math.min(80, Math.round(100 * (1 - Math.exp(-(Date.now() - mountedAt.current) / 25000)))))

  const remaining = getRemaining(checked, total)
  const completedIdx = ALL_SOURCES.length - remaining.length
  const currentSource = remaining[tick % remaining.length]

  return (
    <div className="spb-wrap">
      <div className="spb-inner">
        <div className="spb-top">
          <span className="spb-source">
            <span className="spb-dot" aria-hidden="true" />
            {t('checking')} <span className="spb-source-name">{currentSource}</span>
          </span>
          <span className="spb-found">{found > 0 ? t('resultsFound', { count: found }) : t('scanningRoutes')}</span>
        </div>
        <div
          className="spb-bar-track"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Search progress: ${pct}%`}
        >
          <div className="spb-bar-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="spb-bottom">
          <span className="spb-progress-text">
            {completedIdx > 0 ? t('sourcesChecked', { n: completedIdx, total: ALL_SOURCES.length }) : t('connectingSources')}
          </span>
          <span className="spb-more-coming">{t('moreResultsLoading')}</span>
        </div>
      </div>
    </div>
  )
}

/** Inline progress bar — lives inside the rf-bar results header */
export function SearchProgressBarInline({ progress }: { progress?: Props['progress'] }) {
  const t = useTranslations('Results')
  const mountedAt = useRef(Date.now())
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 900)
    return () => clearInterval(id)
  }, [])

  const checked = progress?.checked ?? 0
  const total = progress?.total ?? 180
  const pct = Math.min(99, checked > 0 && total > 0
    ? Math.round((checked / total) * 100)
    : Math.min(80, Math.round(100 * (1 - Math.exp(-(Date.now() - mountedAt.current) / 25000)))))

  const remaining = getRemaining(checked, total)
  const currentSource = remaining[tick % remaining.length]

  return (
    <div className="spb-inline">
      <div className="spb-inline-left">
        <span className="spb-dot" aria-hidden="true" />
        <span className="spb-inline-label">{t('checking')} <strong>{currentSource}</strong></span>
      </div>
      <div className="spb-inline-track" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="spb-inline-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="spb-inline-pct">{pct}%</span>
    </div>
  )
}

export default SearchProgressBarFull

