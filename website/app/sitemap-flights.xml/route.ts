/**
 * /sitemap-flights.xml — Next.js App Router route handler.
 *
 * Serves the flight route sitemap at /sitemap-flights.xml.
 * Revalidates every hour via ISR.
 *
 * Data source: stub (returns empty sitemap) until DB layer is wired (Session 5/6).
 * When the DB is connected, replace fetchRoutes() with a real DB query that
 * returns all routes with page_status IN ('published', 'noindex').
 */

import { NextResponse } from 'next/server'

import { generateFlightSitemap } from '../../lib/pfp/seo/sitemap-generator.ts'
import type { SitemapRoute } from '../../lib/pfp/seo/sitemap-generator.ts'

export const dynamic = 'force-dynamic'
export const revalidate = 3600 // 1 hour

async function fetchRoutes(): Promise<SitemapRoute[]> {
  // Stub — real implementation wired in Session 5/6.
  // Will query: SELECT slug, page_status, staleness, session_count, snapshot_computed_at
  //             FROM flight_routes
  //             WHERE page_status IN ('published', 'noindex')
  return []
}

export async function GET(): Promise<NextResponse> {
  const routes = await fetchRoutes()
  const xml = generateFlightSitemap(routes)

  return new NextResponse(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400',
    },
  })
}
