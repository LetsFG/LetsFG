/**
 * /[locale]/flights/[route]/page.tsx — App Router page for a single flight route.
 *
 * Route slug format: "{origin_iata}-{dest_iata}" (lowercase), e.g. "gdn-bcn"
 *
 * ISR: revalidate every 24 hours (86 400 s). The ingest pipeline also triggers
 * programmatic revalidation via revalidatePath('/[locale]/flights/[route]')
 * whenever a new agent session is indexed for the route.
 *
 * Data: served from route_distribution_snapshots (written by DistributionService).
 * When no snapshot exists yet, the page returns 404 — it will be published once
 * the ContentQualityGate PASS threshold is met (Session 5/6).
 */

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { FlightPage } from '../../../../lib/pfp/page/FlightPage'
import { SUPPORTED_LOCALES } from '../../../../lib/pfp/seo/FlightPageSEOHead'
import type { RouteDistributionData } from '../../../../lib/pfp/types/route-distribution.types.ts'

// ─── ISR ──────────────────────────────────────────────────────────────────────

export const revalidate = 86400

// ─── API base ─────────────────────────────────────────────────────────────────

const API_BASE = (
  process.env.LETSFG_ANALYTICS_API_URL ||
  'https://api.letsfg.co'
).replace(/\/$/, '')

// ─── Static params ────────────────────────────────────────────────────────────

export async function generateStaticParams(): Promise<{ locale: string; route: string }[]> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/flights/pfp/routes`, {
      cache: 'no-store',
    })
    if (!res.ok) return []
    const routes: Array<{ slug: string }> = await res.json()
    // Pre-render every route for every supported locale
    return SUPPORTED_LOCALES.flatMap((locale) =>
      routes.map((r) => ({ locale, route: r.slug })),
    )
  } catch {
    return []
  }
}

// ─── Data fetching ────────────────────────────────────────────────────────────

async function fetchRouteSnapshot(
  routeSlug: string,
): Promise<RouteDistributionData | null> {
  try {
    const res = await fetch(
      `${API_BASE}/api/v1/flights/pfp/${encodeURIComponent(routeSlug)}`,
      { next: { revalidate: 86400 } },
    )
    if (!res.ok) return null
    return res.json() as Promise<RouteDistributionData>
  } catch {
    return null
  }
}

// ─── Metadata ─────────────────────────────────────────────────────────────────

const DOMAIN = 'https://letsfg.co'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; route: string }>
}): Promise<Metadata> {
  const { locale, route } = await params

  // Parse "gdn-bcn" → ["GDN", "BCN"]
  const parts = route.toUpperCase().split('-')
  const origin = parts[0] ?? 'XX'
  const dest = parts[parts.length - 1] ?? 'XX'

  const data = await fetchRouteSnapshot(route)
  const noindex =
    data?.page_status === 'noindex' || data?.page_status === 'archived'

  const originCity = data?.origin_city ?? origin
  const destCity = data?.dest_city ?? dest
  const minPrice = data ? Math.round(data.price_distribution.min) : null
  const currency = data?.price_distribution.currency ?? 'EUR'
  const offerCount = data?.total_offers_analyzed ?? null

  const title = `Flights ${origin} → ${dest} — Price Distribution & Hidden Fees | LetsFG`
  const description = minPrice != null && offerCount != null
    ? `Cheapest ${originCity} → ${destCity} flight: from ${currency} ${minPrice}. ` +
      `Full price distribution across ${offerCount} offers — carrier comparison, ` +
      `hidden fees, and connector analysis from 180+ airline connectors.`
    : `See the full price distribution for ${origin} → ${dest} flights — ` +
      `percentiles, carrier comparison, hidden fees, and connector analysis ` +
      `from 180+ airline connectors.`

  const canonicalUrl = `${DOMAIN}/${locale}/flights/${route}/`
  const ogTitle = `${origin} → ${dest} Flights — Full Price Distribution | LetsFG`

  // Build hreflang alternates for all supported locales
  const languages: Record<string, string> = {}
  for (const loc of SUPPORTED_LOCALES) {
    languages[loc] = `${DOMAIN}/${loc}/flights/${route}/`
  }
  languages['x-default'] = `${DOMAIN}/en/flights/${route}/`

  return {
    title,
    description,
    authors: [{ name: 'LetsFG', url: DOMAIN }],
    robots: {
      index: !noindex,
      follow: !noindex,
    },
    alternates: {
      canonical: canonicalUrl,
      languages,
    },
    openGraph: {
      title: ogTitle,
      description,
      url: canonicalUrl,
      siteName: 'LetsFG',
      type: 'article',
      images: [
        {
          url: `${DOMAIN}/og-v2.png`,
          width: 1200,
          height: 630,
          alt: `${originCity} to ${destCity} flight prices`,
        },
      ],
      locale: locale.replace('-', '_'),
    },
    twitter: {
      card: 'summary_large_image',
      site: '@LetsFG',
      title: ogTitle,
      description,
      images: [`${DOMAIN}/og-v2.png`],
    },
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function FlightRoutePage({
  params,
}: {
  params: Promise<{ locale: string; route: string }>
}) {
  const { route } = await params
  const data = await fetchRouteSnapshot(route)

  // No snapshot yet → 404. Will return real data once DB is wired (Session 5/6).
  if (data === null) notFound()

  return <FlightPage data={data} />
}
