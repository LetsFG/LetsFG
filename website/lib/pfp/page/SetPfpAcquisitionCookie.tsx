'use client'

import { useEffect } from 'react'
import {
  PFP_ACQUISITION_COOKIE,
  PFP_ACQUISITION_COOKIE_MAX_AGE,
} from '../analytics/pfp-acquisition.ts'

/**
 * Invisible client component that writes the PFP acquisition cookie when a
 * visitor lands on a flight page. The cookie is short-lived (30 min) and is
 * read by the results API to label the next search as pfp_organic-sourced.
 */
export function SetPfpAcquisitionCookie({ routeSlug }: { routeSlug: string }) {
  useEffect(() => {
    document.cookie =
      `${PFP_ACQUISITION_COOKIE}=${encodeURIComponent(routeSlug)}` +
      `; max-age=${PFP_ACQUISITION_COOKIE_MAX_AGE}` +
      `; path=/; SameSite=Lax`
  }, [routeSlug])
  return null
}
