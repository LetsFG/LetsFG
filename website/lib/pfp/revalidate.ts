/**
 * revalidate.ts — ISR revalidation helpers for Programmatic Flight Pages.
 *
 * After a new PFP snapshot is ingested, we call revalidatePath() to trigger
 * Next.js incremental static regeneration for the affected route pages.
 *
 * This is called from the results API route after a successful ingest rather
 * than from the trigger (which is fire-and-forget). This ensures the ISR
 * call only happens when the backend confirms the snapshot was stored.
 */

import { revalidatePath } from 'next/cache'

/**
 * Revalidate all locale variants of a flight route page.
 * The slug format is "origin-dest" e.g. "lhr-jfk".
 */
export function revalidateFlightPage(slug: string): void {
  if (!slug) return
  // Revalidate the canonical path (Next.js propagates across locales)
  revalidatePath(`/flights/${slug}`)
  // Also revalidate the sitemap so new routes appear immediately
  revalidatePath('/sitemap-flights.xml')
}
