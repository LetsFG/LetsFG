'use client'

import { useRef, useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'

interface HomeMonitorNavProps {
  locale: string
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" width="18" height="18" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" width="14" height="14" aria-hidden="true">
      <path d="M5 12l5 5L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" width="38" height="38" aria-hidden="true" className="home-mon-teaser-icon">
      <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="1.8" />
      <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

export default function HomeMonitorNav({ locale }: HomeMonitorNavProps) {
  const [open, setOpen] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const t = useTranslations('Results')

  useEffect(() => {
    if (open) {
      dialogRef.current?.showModal()
      document.body.style.overflow = 'hidden'
    } else {
      try { dialogRef.current?.close() } catch (_) { /* ignore */ }
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [open])

  const handleBackdrop = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === dialogRef.current) setOpen(false)
  }

  return (
    <>
      <nav className="lp-nav" aria-label="Main navigation">
        <Link href={`/${locale}`} className="lp-nav-link">
          {t('navSearch')}
        </Link>
        <button
          type="button"
          className="lp-nav-link lp-nav-link-btn"
          onClick={() => setOpen(true)}
        >
          {t('navMonitor')}
        </button>
      </nav>

      {open && (
        <dialog
          ref={dialogRef}
          className="mon-dialog"
          onClick={handleBackdrop}
          onKeyDown={e => { if (e.key === 'Escape') setOpen(false) }}
          aria-modal="true"
          aria-labelledby="home-mon-title"
        >
          <div className="mon-card" role="document">
            {/* Header */}
            <div className="mon-header">
              <div className="mon-header-text">
                <span className="mon-kicker">Flight Monitor</span>
                <h2 id="home-mon-title" className="mon-title">Track any route</h2>
              </div>
              <button className="mon-close" onClick={() => setOpen(false)} aria-label="Close">
                <CloseIcon />
              </button>
            </div>

            {/* Teaser body */}
            <div className="home-mon-teaser">
              <div className="home-mon-teaser-search-first">
                <SearchIcon />
                <div>
                  <p className="home-mon-teaser-heading">Search for a flight first</p>
                  <p className="home-mon-teaser-sub">
                    Once you see results, click <strong>Track this route</strong> to start monitoring that specific flight.
                  </p>
                </div>
              </div>

              <ul className="mon-features" aria-label="What's included">
                <li className="mon-feature">
                  <span className="mon-feature-icon mon-feature-icon--on" aria-hidden="true"><CheckIcon /></span>
                  Daily price alerts from Google Flights, Kayak, Kiwi, 200+ websites
                </li>
                <li className="mon-feature">
                  <span className="mon-feature-icon mon-feature-icon--on" aria-hidden="true"><CheckIcon /></span>
                  Uncovers hidden fees — baggage, seat selection &amp; more
                </li>
                <li className="mon-feature">
                  <span className="mon-feature-icon mon-feature-icon--on" aria-hidden="true"><CheckIcon /></span>
                  1 booking unlock / week · browser push &amp; Telegram alerts
                </li>
                <li className="mon-feature">
                  <span className="mon-feature-icon mon-feature-icon--on" aria-hidden="true"><CheckIcon /></span>
                  $5 / week · non-recurring · cancel any time
                </li>
              </ul>

              <Link
                href={`/${locale}`}
                className="mon-submit"
                onClick={() => setOpen(false)}
              >
                Search flights →
              </Link>
              <p className="mon-footer-note">
                Start a search above, then click "Track this route" on the results page.
              </p>
            </div>
          </div>
        </dialog>
      )}
    </>
  )
}
