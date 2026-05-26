'use client'

import { useEffect, useState } from 'react'
import { Skyline, FlightArc, hashStr } from './[searchId]/SearchingTasks'

// Cross-faded above the graphic. Edit freely — pure copy.
const ROTATING_PHRASES = [
  'Comparing every fee, seat cost, and baggage charge…',
  'Checking baggage prices across carriers…',
  'Hunting cheaper one-way combos…',
  'Comparing change & cancellation policies…',
  'Surfacing hidden ancillary costs…',
]
const PHRASE_INTERVAL_MS = 3400

// Loading bar ease horizon. Pure visual — search takes ~60–120s.
const BAR_HORIZON_S = 95
const BAR_MAX_PERCENT = 95

interface SearchingLoadingSceneProps {
  originCode?: string
  originName?: string
  destinationCode?: string
  destinationName?: string
}

/**
 * Shared loading visual used by /pending and by /results/[id] while it's
 * still waiting for the first offer. Renders the rotating headline, the
 * London→Barcelona-style skyline graphic, and a slim eased progress bar.
 *
 * Does NOT include the agent-question card — that's specific to /pending,
 * where it collects answers before the search has a searchId. On the
 * results page, those answers are already in the URL as r_* params.
 */
export default function SearchingLoadingScene({
  originCode,
  originName,
  destinationCode,
  destinationName,
}: SearchingLoadingSceneProps) {
  const [phraseIdx, setPhraseIdx] = useState(0)
  useEffect(() => {
    const id = setInterval(
      () => setPhraseIdx((i) => (i + 1) % ROTATING_PHRASES.length),
      PHRASE_INTERVAL_MS,
    )
    return () => clearInterval(id)
  }, [])

  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const startedAt = Date.now()
    const id = setInterval(() => setElapsed((Date.now() - startedAt) / 1000), 200)
    return () => clearInterval(id)
  }, [])
  const barWidth = (() => {
    const tNorm = Math.min(elapsed / BAR_HORIZON_S, 1)
    const eased = 1 - Math.pow(1 - tNorm, 3)
    return Math.min(BAR_MAX_PERCENT, eased * BAR_MAX_PERCENT)
  })()

  const oName = originName || originCode || 'Origin'
  const dName = destinationName || destinationCode || 'Destination'

  return (
    <>
      <div className="pend-headline" aria-live="polite">
        {ROTATING_PHRASES.map((phrase, i) => (
          <span
            key={phrase}
            className={`pend-headline-phrase${i === phraseIdx ? ' pend-headline-phrase--active' : ''}`}
          >
            {phrase}
          </span>
        ))}
      </div>

      <div
        className="pend-graphic st-scene"
        aria-label={`Searching flights from ${oName} to ${dName}`}
      >
        <div className="st-city st-city--origin">
          <div className="st-city-meta">
            <span className="st-city-name">{oName}</span>
            {originCode ? <span className="st-city-code">{originCode}</span> : null}
          </div>
          <Skyline seed={hashStr(originCode ?? oName)} cityCode={originCode ?? ''} />
        </div>

        <div className="st-flight-path">
          <FlightArc />
        </div>

        <div className="st-city st-city--destination">
          <div className="st-city-meta st-city-meta--right">
            <span className="st-city-name">{dName}</span>
            {destinationCode ? <span className="st-city-code">{destinationCode}</span> : null}
          </div>
          <Skyline
            mirrored
            seed={hashStr(destinationCode ?? dName)}
            cityCode={destinationCode ?? ''}
          />
        </div>
      </div>

      <div
        className="pend-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(barWidth)}
        aria-label="Searching"
      >
        <div className="pend-bar-fill" style={{ width: `${barWidth}%` }} />
      </div>
    </>
  )
}
