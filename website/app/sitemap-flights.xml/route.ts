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

import { getLetsfgAnalyticsApiBase, withLetsfgWebsiteApiHeaders } from '../../lib/letsfg-api'
import { generateFlightSitemap } from '../../lib/pfp/seo/sitemap-generator.ts'
import type { SitemapRoute } from '../../lib/pfp/seo/sitemap-generator.ts'

export const dynamic = 'force-dynamic'
export const revalidate = 3600 // 1 hour

const API_BASE = getLetsfgAnalyticsApiBase()

async function fetchRoutes(): Promise<SitemapRoute[]> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/flights/pfp/routes`, {
      headers: withLetsfgWebsiteApiHeaders(),
      next: { revalidate: 3600 },
    })
    if (!res.ok) return []
    const routes: Array<{
      slug: string
      page_status: string
      staleness: string
      session_count: number
      snapshot_computed_at: string
    }> = await res.json()
    return routes.map((r) => ({
      slug: r.slug,
      page_status: r.page_status as SitemapRoute['page_status'],
      staleness: r.staleness as SitemapRoute['staleness'],
      session_count: r.session_count,
      snapshot_computed_at: r.snapshot_computed_at,
    }))
  } catch (_) {
    return []
  }
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
