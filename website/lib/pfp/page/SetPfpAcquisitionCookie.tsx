'use client'

/**
 * SetPfpAcquisitionCookie — client component that writes the PFP acquisition
 * cookie on flight page load.
 *
 * When a visitor lands on /[locale]/flights/[route]/ this component fires a
 * lightweight request to /api/pfp-cookie?route=[slug] which sets the
 * HttpOnly cookie on the server side. This avoids needing the 'use client'
 * boundary in the page itself while still satisfying the cookie requirement.
 *
 * The cookie is intentionally short-lived (30 min) — only the immediate
 * next search is attributed to PFP organic acquisition.
 */

import { useEffect } from 'react'

interface Props {
  routeSlug: string
}

export function SetPfpAcquisitionCookie({ routeSlug }: Props) {
  useEffect(() => {
    if (!routeSlug) return

    // Fire-and-forget — we don't need the result
    void fetch(
      `/api/pfp-cookie?route=${encodeURIComponent(routeSlug)}`,
      { method: 'POST' },
    ).catch(() => {/* intentionally silent */})
  }, [routeSlug])

  return null
}
