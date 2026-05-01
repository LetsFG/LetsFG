'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import {
  CURRENCY_CHANGE_EVENT,
  DISPLAY_CURRENCIES,
  LETSFG_CURRENCY_COOKIE,
  normalizeCurrencyCode,
  readBrowserCurrencyPreference,
  type SupportedCurrencyCode,
} from '../lib/currency-preference'
import { getTrackedSourcePath } from '../lib/probe-mode'

function CoinsIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6" />
      <path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </svg>
  )
}

export type CurrencyButtonBehavior = 'refresh' | 'rerun-search'

export interface CurrencyButtonProps {
  inline?: boolean
  behavior: CurrencyButtonBehavior
  /** Natural-language query — required for rerun-search when non-empty */
  searchQuery?: string
  probeMode?: boolean
}

export default function CurrencyButton({
  inline = false,
  behavior,
  searchQuery = '',
  probeMode = false,
}: CurrencyButtonProps) {
  const router = useRouter()
  const [current, setCurrent] = useState<SupportedCurrencyCode>('EUR')
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '')
    const fromUrl = normalizeCurrencyCode(params.get('cur'))
    if (fromUrl) {
      document.cookie = `${LETSFG_CURRENCY_COOKIE}=${encodeURIComponent(fromUrl)}; path=/; max-age=31536000; SameSite=Lax`
      setCurrent(fromUrl)
      window.dispatchEvent(new CustomEvent(CURRENCY_CHANGE_EVENT))
    } else {
      setCurrent(readBrowserCurrencyPreference())
    }

    const onChange = () => setCurrent(readBrowserCurrencyPreference())
    window.addEventListener(CURRENCY_CHANGE_EVENT, onChange)
    return () => window.removeEventListener(CURRENCY_CHANGE_EVENT, onChange)
  }, [])

  const updateMenuPosition = () => {
    const btn = buttonRef.current
    if (!btn) return
    const r = btn.getBoundingClientRect()
    setMenuPos({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) })
  }

  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null)
      return
    }
    updateMenuPosition()
    window.addEventListener('resize', updateMenuPosition)
    return () => window.removeEventListener('resize', updateMenuPosition)
  }, [open])

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      const t = e.target as Node
      if (wrapRef.current?.contains(t)) return
      if (menuRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const persistAndNavigate = (code: SupportedCurrencyCode) => {
    document.cookie = `${LETSFG_CURRENCY_COOKIE}=${encodeURIComponent(code)}; path=/; max-age=31536000; SameSite=Lax`
    setCurrent(code)
    window.dispatchEvent(new CustomEvent(CURRENCY_CHANGE_EVENT))
    setOpen(false)

    if (behavior === 'rerun-search' && searchQuery.trim()) {
      const path = `/results?q=${encodeURIComponent(searchQuery.trim())}&cur=${encodeURIComponent(code)}`
      router.push(getTrackedSourcePath(path, probeMode))
      return
    }

    router.refresh()
  }

  const dropdown =
    open &&
    menuPos &&
    typeof document !== 'undefined' &&
    createPortal(
      <div
        ref={menuRef}
        className="lp-lang-dropdown lp-lang-dropdown--portal"
        style={{ top: menuPos.top, right: menuPos.right }}
        role="listbox"
        aria-label="Select currency"
      >
        {DISPLAY_CURRENCIES.map((row) => (
          <button
            key={row.code}
            role="option"
            aria-selected={row.code === current}
            className={`lp-lang-option${row.code === current ? ' lp-lang-option--active' : ''}`}
            type="button"
            onClick={() => persistAndNavigate(row.code)}
          >
            <span className="lp-lang-flag" aria-hidden="true">{row.code}</span>
            <span className="lp-lang-name">{row.label}</span>
            {row.code === current && (
              <svg className="lp-lang-check" viewBox="0 0 16 16" fill="currentColor" width="13" height="13" aria-hidden="true">
                <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z"/>
              </svg>
            )}
          </button>
        ))}
      </div>,
      document.body
    )

  return (
    <div ref={wrapRef} className={`lp-globe-wrap${inline ? ' lp-globe-wrap--inline' : ''}`}>
      <button
        ref={buttonRef}
        type="button"
        className={`lp-globe-btn lp-currency-btn${open ? ' lp-globe-btn--open' : ''}`}
        aria-label={`Currency: ${current}. Change currency`}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="lp-currency-btn-inner" aria-hidden="true">
          <CoinsIcon />
          <span className="lp-currency-btn-code">{current}</span>
        </span>
      </button>
      {dropdown}
    </div>
  )
}
