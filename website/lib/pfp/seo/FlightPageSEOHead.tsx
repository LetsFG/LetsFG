/**
 * FlightPageSEOHead.tsx — SEO head metadata component for flight route pages.
 *
 * Renders the full set of SEO signals as React elements:
 * - <title>, <meta name="description">, <link rel="canonical">
 * - robots noindex when page_status is 'noindex' or 'archived'
 * - Open Graph (og:title, og:description, og:url, og:image, og:type, og:site_name, og:locale)
 * - Twitter Card (summary_large_image) tags
 * - article:modified_time for LLM freshness signals
 * - <meta name="author"> for E-E-A-T signals
 * - hreflang alternate links for all supported locales + x-default
 * - JSON-LD structured data via dangerouslySetInnerHTML
 *
 * In Next.js App Router, use generateMetadata() for the actual <head>.
 * This component is used for:
 *   1. Testing (renderToStaticMarkup)
 *   2. Injecting the JSON-LD <script> block into the page body
 */

import type { RouteDistributionData } from '../types/route-distribution.types.ts'
import { buildFlightPageJsonLd } from './json-ld-generator.ts'
import React from 'react'

// ─── Constants ────────────────────────────────────────────────────────────────

const DOMAIN = 'https://letsfg.co'
const BRAND = 'LetsFG'
const OG_IMAGE = `${DOMAIN}/og/flights.png`
const OG_IMAGE_WIDTH = 1200
const OG_IMAGE_HEIGHT = 630

/** All locales supported by the website (from i18n/routing.ts). */
export const SUPPORTED_LOCALES = ['en', 'pl', 'de', 'es', 'fr', 'it', 'pt', 'nl', 'sq', 'hr', 'sv'] as const
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

/** og:locale format (BCP 47 language tag → IETF/OG territory tag). */
const OG_LOCALE_MAP: Record<SupportedLocale, string> = {
  en: 'en_US', pl: 'pl_PL', de: 'de_DE', es: 'es_ES', fr: 'fr_FR',
  it: 'it_IT', pt: 'pt_PT', nl: 'nl_NL', sq: 'sq_AL', hr: 'hr_HR', sv: 'sv_SE',
}

// ─── Public types ─────────────────────────────────────────────────────────────

export interface FlightPageSEOHeadProps {
  data: RouteDistributionData
  /** Current page locale — used for canonical URL, og:locale, and hreflang. Default: 'en'. */
  locale?: SupportedLocale
}

// ─── String builders ──────────────────────────────────────────────────────────

export function buildSEOTitle(data: RouteDistributionData): string {
  return `Flights ${data.origin_city} → ${data.dest_city} — Distribution & Hidden Fees | LetsFG`
}

export function buildSEODescription(data: RouteDistributionData): string {
  const { price_distribution, total_offers_analyzed, fee_analysis, snapshot_computed_at } = data
  const currency = price_distribution.currency

  const feePart =
    fee_analysis.avg_hidden_fees_pct != null
      ? `Hidden fees avg ${Math.round(fee_analysis.avg_hidden_fees_pct * 100)}%. `
      : `Hidden fees: data not available. `

  return (
    `${total_offers_analyzed} offers analyzed via AI agent search. ` +
    `Median total ${Math.round(price_distribution.p50)} ${currency}, ` +
    `range ${Math.round(price_distribution.p10)}–${Math.round(price_distribution.p90)}. ` +
    feePart +
    `Updated ${snapshot_computed_at.slice(0, 10)}.`
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export function FlightPageSEOHead({ data, locale = 'en' }: FlightPageSEOHeadProps) {
  const { origin_iata, dest_iata, page_status, snapshot_computed_at } = data

  const isNoindex = page_status === 'noindex' || page_status === 'archived'
  const routeSlug = `${origin_iata.toLowerCase()}-${dest_iata.toLowerCase()}`
  const canonical = `${DOMAIN}/${locale}/flights/${routeSlug}/`
  const title = buildSEOTitle(data)
  const description = buildSEODescription(data)
  const jsonLd = buildFlightPageJsonLd(data)
  const ogLocale = OG_LOCALE_MAP[locale] ?? OG_LOCALE_MAP.en

  return (
    <>
      <title>{title}</title>
      <meta name="description" content={description} />
      <meta name="author" content={BRAND} />
      <link rel="canonical" href={canonical} />
      {isNoindex && <meta name="robots" content="noindex,nofollow" />}

      {/* Open Graph ── */}
      <meta property="og:type" content="article" />
      <meta property="og:site_name" content={BRAND} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={canonical} />
      <meta property="og:image" content={OG_IMAGE} />
      <meta property="og:image:width" content={String(OG_IMAGE_WIDTH)} />
      <meta property="og:image:height" content={String(OG_IMAGE_HEIGHT)} />
      <meta property="og:locale" content={ogLocale} />
      <meta property="article:modified_time" content={snapshot_computed_at} />

      {/* Twitter Card ── */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:site" content="@LetsFG" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={OG_IMAGE} />

      {/* hreflang — all locales + x-default ── */}
      {SUPPORTED_LOCALES.map(loc => (
        <link
          key={loc}
          rel="alternate"
          hrefLang={loc}
          href={`${DOMAIN}/${loc}/flights/${routeSlug}/`}
        />
      ))}
      <link rel="alternate" hrefLang="x-default" href={`${DOMAIN}/en/flights/${routeSlug}/`} />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd }}
      />
    </>
  )
}
