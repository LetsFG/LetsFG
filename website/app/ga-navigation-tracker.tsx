'use client'

/**
 * GaNavigationTracker — fires GA4 page_view on every Next.js client-side navigation.
 *
 * The root layout's ga-init Script fires gtag('config') once on the initial page
 * load, which is enough for:
 *   - UTM attribution (session-level, read from the landing URL)
 *   - The first page_view event
 *
 * But Next.js App Router performs subsequent navigations client-side without a
 * full page reload, so GA4 never receives page_view events for those routes.
 * This component fixes that by listening to pathname + search changes.
 *
 * Must be wrapped in <Suspense> in the parent because useSearchParams() opts
 * the component into the client suspense boundary.
 */

import { useEffect, useRef } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void
  }
}

const GA_ID = 'G-C5G5EJS81G'

function GaNavigationTrackerInner() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const isFirstRender = useRef(true)

  useEffect(() => {
    // Skip the very first render — the ga-init Script already fires page_view
    // for the initial page load (including UTM attribution).
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }

    const search = searchParams.toString()
    const url = pathname + (search ? `?${search}` : '')

    if (typeof window.gtag === 'function') {
      window.gtag('config', GA_ID, {
        page_path: url,
      })
    }
  }, [pathname, searchParams])

  return null
}

import { Suspense } from 'react'

export default function GaNavigationTracker() {
  return (
    <Suspense fallback={null}>
      <GaNavigationTrackerInner />
    </Suspense>
  )
}
