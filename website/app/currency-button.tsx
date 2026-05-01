'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Coins, DollarSign, Euro, PoundSterling, SwissFranc, type LucideIcon } from 'lucide-react'
import {
  CURRENCY_CHANGE_EVENT,
  DISPLAY_CURRENCIES,
  LETSFG_CURRENCY_COOKIE,
  normalizeCurrencyCode,
  readBrowserCurrencyPreference,
  type SupportedCurrencyCode,
} from '../lib/currency-preference'
import { getTrackedSourcePath } from '../lib/probe-mode'

const TRIGGER_ICON_BY_CURRENCY: Record<SupportedCurrencyCode, LucideIcon> = {
  EUR: Euro,
  USD: DollarSign,
  GBP: PoundSterling,
  PLN: Coins,
  CHF: SwissFranc,
}

function SelectedCurrencyIcon({ code }: { code: SupportedCurrencyCode }) {
  const Icon = TRIGGER_ICON_BY_CURRENCY[code]
  return <Icon aria-hidden className="lp-currency-trigger-icon" size={15} strokeWidth={2} />
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
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
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

  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null)
      return
    }

    function updateMenuPosition() {
      const button = buttonRef.current
      const menu = menuRef.current
      if (!button || !menu) return

      const gap = 8
      const viewportPadding = 8
      const rect = button.getBoundingClientRect()
      const menuWidth = menu.offsetWidth || 168
      const menuHeight = menu.offsetHeight || 0

      let left = rect.right - menuWidth
      left = Math.min(left, window.innerWidth - menuWidth - viewportPadding)
      left = Math.max(viewportPadding, left)

      let top = rect.bottom + gap
      const aboveTop = rect.top - menuHeight - gap
      if (menuHeight > 0 && top + menuHeight > window.innerHeight - viewportPadding && aboveTop >= viewportPadding) {
        top = aboveTop
      }

      top = Math.max(viewportPadding, top)

      setMenuPos({ top, left })
    }

    let frameId: number | null = null
    const scheduleMenuPosition = () => {
      if (frameId !== null) return
      frameId = window.requestAnimationFrame(() => {
        frameId = null
        updateMenuPosition()
      })
    }

    updateMenuPosition()

    window.addEventListener('resize', scheduleMenuPosition)
    window.addEventListener('scroll', scheduleMenuPosition, true)
    window.visualViewport?.addEventListener('resize', scheduleMenuPosition)
    window.visualViewport?.addEventListener('scroll', scheduleMenuPosition)

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId)
      }
      window.removeEventListener('resize', scheduleMenuPosition)
      window.removeEventListener('scroll', scheduleMenuPosition, true)
      window.visualViewport?.removeEventListener('resize', scheduleMenuPosition)
      window.visualViewport?.removeEventListener('scroll', scheduleMenuPosition)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node
      if (
        wrapRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return
      }

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

  const dropdown = open
    ? createPortal(
        <div
          ref={menuRef}
          className="lp-lang-dropdown lp-lang-dropdown--portal"
          role="listbox"
          aria-label="Select currency"
          style={{
            top: menuPos?.top ?? 0,
            left: menuPos?.left ?? 0,
            visibility: menuPos ? 'visible' : 'hidden',
          }}
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
        document.body,
      )
    : null

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
          <SelectedCurrencyIcon code={current} />
          <span className="lp-currency-btn-code">{current}</span>
        </span>
      </button>
      {dropdown}
    </div>
  )
}
