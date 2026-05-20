/**
 * revalidate.ts — ISR revalidation helper for programmatic flight pages.
 *
 * Must be called only from an API route context (Next.js route handler) where
 * revalidatePath() is available. Revalidates all locale variants of a route
 * and flushes the flights sitemap cache.
 */

import { revalidatePath } from 'next/cache'
import { SUPPORTED_LOCALES } from './seo/FlightPageSEOHead.tsx'

/**
 * Trigger Next.js ISR revalidation for all locale variants of a flight route
 * and refresh the sitemap cache.
 *
 * @param routeSlug  Lowercase slug e.g. 'gdn-bcn'
 */
export async function revalidateFlightRoute(routeSlug: string): Promise<void> {
  for (const locale of SUPPORTED_LOCALES) {
    revalidatePath(`/${locale}/flights/${routeSlug}`)
  }
  revalidatePath('/sitemap-flights.xml')
}
