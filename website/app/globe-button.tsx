'use client'

import { createPortal } from 'react-dom'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useRouter, useParams, usePathname } from 'next/navigation'
import { useLocale } from 'next-intl'
import GB from 'country-flag-icons/react/3x2/GB'
import PL from 'country-flag-icons/react/3x2/PL'
import DE from 'country-flag-icons/react/3x2/DE'
import ES from 'country-flag-icons/react/3x2/ES'
import FR from 'country-flag-icons/react/3x2/FR'
import IT from 'country-flag-icons/react/3x2/IT'
import PT from 'country-flag-icons/react/3x2/PT'
import NL from 'country-flag-icons/react/3x2/NL'
import SE from 'country-flag-icons/react/3x2/SE'
import HR from 'country-flag-icons/react/3x2/HR'
import AL from 'country-flag-icons/react/3x2/AL'
import JP from 'country-flag-icons/react/3x2/JP'
import CN from 'country-flag-icons/react/3x2/CN'
import { setResultsLocaleSearchParam } from '../lib/locale-routing'

type FlagComponent = (props: React.SVGProps<SVGSVGElement>) => React.JSX.Element

const LANGUAGES: { code: string; label: string; Flag: FlagComponent }[] = [
  { code: 'en', label: 'English',    Flag: GB },
  { code: 'pl', label: 'Polski',     Flag: PL },
  { code: 'de', label: 'Deutsch',    Flag: DE },
  { code: 'es', label: 'Español',    Flag: ES },
  { code: 'fr', label: 'Français',   Flag: FR },
  { code: 'it', label: 'Italiano',   Flag: IT },
  { code: 'pt', label: 'Português',  Flag: PT },
  { code: 'nl', label: 'Nederlands', Flag: NL },
  { code: 'sv', label: 'Svenska',    Flag: SE },
  { code: 'hr', label: 'Hrvatski',   Flag: HR },
  { code: 'sq', label: 'Shqip',      Flag: AL },
  { code: 'ja', label: '日本語',      Flag: JP },
  { code: 'zh', label: '中文',        Flag: CN },
]

const LANGUAGE_FLAGS: Record<string, FlagComponent> = Object.fromEntries(
  LANGUAGES.map((l) => [l.code, l.Flag]),
)

export default function GlobeButton({ inline = false }: { inline?: boolean } = {}) {
  const router = useRouter()
  const params = useParams()
  const pathname = usePathname()
  const locale = useLocale()
  const currentLocale = locale || (params?.locale as string) || 'en'

  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

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

  // Close on outside click
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

  // Close on Escape
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const dropdown = open
    ? createPortal(
        <div
          ref={menuRef}
          className="lp-lang-dropdown lp-lang-dropdown--portal"
          role="listbox"
          aria-label="Select language"
          style={{
            top: menuPos?.top ?? 0,
            left: menuPos?.left ?? 0,
            visibility: menuPos ? 'visible' : 'hidden',
          }}
        >
          {LANGUAGES.map(lang => (
            <button
              key={lang.code}
              role="option"
              aria-selected={lang.code === currentLocale}
              className={`lp-lang-option${lang.code === currentLocale ? ' lp-lang-option--active' : ''}`}
              onClick={() => {
                const cookieOpts = 'path=/; max-age=31536000; SameSite=Lax'
                document.cookie = `LETSFG_LOCALE=${lang.code}; ${cookieOpts}`
                document.cookie = `NEXT_LOCALE=${lang.code}; ${cookieOpts}`
                setOpen(false)

                // Non-locale paths (/results, /book, /probe) — hard reload so
                // the server picks up the new cookie and re-renders in the new
                // language. router.refresh() alone cannot guarantee the locale
                // context propagates correctly through NextIntlClientProvider.
                if (
                  pathname.startsWith('/results') ||
                  pathname.startsWith('/book') ||
                  pathname.startsWith('/probe')
                ) {
                  const nextUrl = new URL(window.location.href)
                  setResultsLocaleSearchParam(nextUrl.searchParams, lang.code)
                  window.location.assign(nextUrl.toString())
                  return
                }

                // Locale-prefixed paths — swap locale segment, preserve the rest
                const localeRe = /^\/(en|pl|de|es|fr|it|pt|nl|sq|hr|sv|ja|zh)(\/|$)/
                const match = pathname.match(localeRe)
                const rest = match ? pathname.slice(1 + match[1].length) : ''
                router.push(`/${lang.code}${rest}${window.location.search}`)
              }}
              type="button"
            >
              <span className="lp-lang-flag" aria-hidden="true">
                <lang.Flag className="lp-lang-flag-svg" />
              </span>
              <span className="lp-lang-name">{lang.label}</span>
              {lang.code === currentLocale && (
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
        className={`lp-globe-btn${open ? ' lp-globe-btn--open' : ''}`}
        aria-label="Language / region"
        aria-expanded={open}
        aria-haspopup="listbox"
        type="button"
        onClick={() => setOpen(v => !v)}
      >
        <span className="lp-lang-trigger-flag" aria-hidden="true">
          {(() => {
            const Flag = LANGUAGE_FLAGS[currentLocale] ?? LANGUAGE_FLAGS.en
            return <Flag className="lp-lang-flag-svg" />
          })()}
        </span>
      </button>

      {dropdown}
    </div>
  )
}
