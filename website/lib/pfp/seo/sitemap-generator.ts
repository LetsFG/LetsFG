/**
 * sitemap-generator.ts — XML sitemap generator for flight route pages.
 *
 * Priority rules (per spec):
 *   noindex routes         → 0.3 (always, regardless of session_count)
 *   session_count > 100    → 0.9
 *   session_count > 20     → 0.7
 *   session_count > 5      → 0.5
 *   else                   → 0.4
 *
 * Change frequency maps to staleness:
 *   fresh  → daily
 *   recent → weekly
 *   stale  → monthly
 *
 * Filtering: only 'published' and 'noindex' routes are included.
 * 'draft' and 'archived' routes are excluded.
 *
 * Sitemap index: when eligible routes exceed chunkThreshold (default 10,000),
 * a sitemapindex XML is returned instead of a urlset. Chunks are grouped by
 * the first letter of the origin IATA code (alphabetical chunking).
 */

import type { Staleness, PageStatus } from '../types/route-distribution.types.ts'

// ─── Public types ─────────────────────────────────────────────────────────────

export interface SitemapRoute {
  /** Route slug, e.g. 'gdn-bcn' (lowercase "{origin}-{dest}"). */
  slug: string
  page_status: PageStatus
  staleness: Staleness
  /** Number of agent search sessions that contributed to this route's snapshot. */
  session_count: number
  /** ISO 8601 datetime of the last computed snapshot. */
  snapshot_computed_at: string
}

export interface SitemapOptions {
  /** Base URL for absolute URLs in the sitemap. Default: 'https://letsfg.co'. */
  baseUrl?: string
  /**
   * Number of eligible routes above which a sitemapindex is returned
   * instead of a single urlset. Default: 10000.
   * Set lower in tests to exercise sitemap index generation.
   */
  chunkThreshold?: number
}

// ─── Priority & changefreq ────────────────────────────────────────────────────

export function computeSitemapPriority(
  route: Pick<SitemapRoute, 'page_status' | 'session_count'>,
): number {
  if (route.page_status === 'noindex') return 0.3
  if (route.session_count > 100) return 0.9
  if (route.session_count > 20) return 0.7
  if (route.session_count > 5) return 0.5
  return 0.4
}

export function computeChangefreq(staleness: Staleness): 'daily' | 'weekly' | 'monthly' {
  if (staleness === 'fresh') return 'daily'
  if (staleness === 'recent') return 'weekly'
  return 'monthly'
}

// ─── XML helpers ──────────────────────────────────────────────────────────────

function w3cDate(isoString: string): string {
  // W3C Datetime minimum format: YYYY-MM-DD
  return isoString.slice(0, 10)
}

function buildUrlEntry(route: SitemapRoute, baseUrl: string): string {
  const priority = computeSitemapPriority(route)
  const changefreq = computeChangefreq(route.staleness)
  const lastmod = w3cDate(route.snapshot_computed_at)
  const loc = `${baseUrl}/flights/${route.slug}/`
  return (
    `  <url>\n` +
    `    <loc>${loc}</loc>\n` +
    `    <lastmod>${lastmod}</lastmod>\n` +
    `    <changefreq>${changefreq}</changefreq>\n` +
    `    <priority>${priority.toFixed(1)}</priority>\n` +
    `  </url>`
  )
}

function buildUrlset(routes: SitemapRoute[], baseUrl: string): string {
  const eligible = routes.filter(
    r => r.page_status === 'published' || r.page_status === 'noindex',
  )
  const urlEntries = eligible.map(r => buildUrlEntry(r, baseUrl)).join('\n')
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    (urlEntries ? `${urlEntries}\n` : '') +
    `</urlset>`
  )
}

function buildSitemapIndex(
  chunks: Map<string, SitemapRoute[]>,
  baseUrl: string,
): string {
  const today = new Date().toISOString().slice(0, 10)
  const sitemapEntries = Array.from(chunks.keys())
    .sort()
    .map(letter => {
      const loc = `${baseUrl}/sitemap-flights-${letter}.xml`
      return (
        `  <sitemap>\n` +
        `    <loc>${loc}</loc>\n` +
        `    <lastmod>${today}</lastmod>\n` +
        `  </sitemap>`
      )
    })
    .join('\n')
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `${sitemapEntries}\n` +
    `</sitemapindex>`
  )
}

// ─── Public export ────────────────────────────────────────────────────────────

/**
 * Generate an XML sitemap (or sitemap index) for all flight routes.
 *
 * Only 'published' and 'noindex' routes are included.
 * Returns a <urlset> when eligible.length <= chunkThreshold,
 * or a <sitemapindex> with per-letter chunks when over the threshold.
 */
export function generateFlightSitemap(
  routes: SitemapRoute[],
  options: SitemapOptions = {},
): string {
  const baseUrl = options.baseUrl ?? 'https://letsfg.co'
  const chunkThreshold = options.chunkThreshold ?? 10000

  const eligible = routes.filter(
    r => r.page_status === 'published' || r.page_status === 'noindex',
  )

  if (eligible.length <= chunkThreshold) {
    return buildUrlset(routes, baseUrl)
  }

  // Build chunks grouped by first letter of origin IATA (slug prefix)
  const chunks = new Map<string, SitemapRoute[]>()
  for (const route of eligible) {
    const letter = route.slug.charAt(0).toUpperCase()
    if (!chunks.has(letter)) chunks.set(letter, [])
    chunks.get(letter)!.push(route)
  }

  return buildSitemapIndex(chunks, baseUrl)
}
