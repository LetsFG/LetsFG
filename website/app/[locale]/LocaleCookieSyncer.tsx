'use client'

import { useEffect } from 'react'

/**
 * Syncs the URL locale (from the [locale] segment) to the LETSFG_LOCALE
 * cookie so that non-locale pages (/results, /book, /probe) pick it up.
 *
 * Runs client-side on every render of a locale-prefixed page — including
 * direct URL visits where the user never touched the globe-button.
 */
export default function LocaleCookieSyncer({ locale }: { locale: string }) {
  useEffect(() => {
    const cookieOpts = 'path=/; max-age=31536000; SameSite=Lax'
    document.cookie = `LETSFG_LOCALE=${locale}; ${cookieOpts}`
    document.cookie = `NEXT_LOCALE=${locale}; ${cookieOpts}`
  }, [locale])

  return null
}
