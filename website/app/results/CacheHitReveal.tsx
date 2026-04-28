'use client'

import { useEffect, useState } from 'react'

export default function CacheHitReveal({ children }: { children: React.ReactNode }) {
  const [hiding, setHiding] = useState(false)
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    const t1 = setTimeout(() => setHiding(true), 2500)
    const t2 = setTimeout(() => setRevealed(true), 3100)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [])

  return (
    <div className="cache-reveal-wrapper">
      {!revealed && (
        <div className={`cache-hit-overlay${hiding ? ' cache-hit-overlay--hiding' : ''}`} role="status" aria-live="polite">
          <div className="cache-hit-inner">
            <svg className="cache-hit-bolt" viewBox="0 0 24 24" fill="none" aria-hidden="true" width="40" height="40">
              <path d="M13 2L4.5 13.5H11L10 22L20.5 9.5H14L13 2Z" fill="#f47a1c" stroke="#f47a1c" strokeWidth="1" strokeLinejoin="round" />
            </svg>
            <p className="cache-hit-headline">Someone searched this route recently</p>
            <p className="cache-hit-sub">You&apos;re getting instant results — no wait needed</p>
          </div>
        </div>
      )}
      <div className={`cache-reveal-content${revealed ? '' : ' cache-reveal-content--hidden'}`}>
        {children}
      </div>
    </div>
  )
}
