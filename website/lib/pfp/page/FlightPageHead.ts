/**
 * FlightPageHead.ts — builds the <head> content for a FlightPage.
 *
 * Separated from FlightPage.tsx so that SEO head content is injected into
 * <head> by the Next.js App Router (generateMetadata) or by the static render
 * shell — not rendered inside <article> in <body>.
 */

import type { RouteDistributionData } from '../types/route-distribution.types.ts'

const DOMAIN: string = (() => {
  try { return (process.env['NEXT_PUBLIC_SITE_URL'] as string | undefined) ?? 'https://letsfg.co' }
  catch { return 'https://letsfg.co' }
})()

const BRAND = 'LetsFG'
const OG_IMAGE = `${DOMAIN}/og/flights.png`

/** All locales supported by the website (kept in sync with i18n/routing.ts). */
const SUPPORTED_LOCALES = ['en', 'pl', 'de', 'es', 'fr', 'it', 'pt', 'nl', 'sq', 'hr', 'sv'] as const
type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

const OG_LOCALE_MAP: Record<SupportedLocale, string> = {
  en: 'en_US', pl: 'pl_PL', de: 'de_DE', es: 'es_ES', fr: 'fr_FR',
  it: 'it_IT', pt: 'pt_PT', nl: 'nl_NL', sq: 'sq_AL', hr: 'hr_HR', sv: 'sv_SE',
}

// ─── Public types ─────────────────────────────────────────────────────────────

export interface FlightPageSeoHead {
  title: string
  metaDescription: string
  canonicalUrl: string
  jsonLdString: string
  locale: string
}

// ─── Main export ──────────────────────────────────────────────────────────────

/** Returns a raw HTML string suitable for injection inside <head>. */
export function buildFlightPageHeadHtml(data: RouteDistributionData, locale: SupportedLocale = 'en'): string {
  const { title, metaDescription, canonicalUrl, jsonLdString } = buildFlightPageSeoHead(data, locale)
  const robotsContent = (data.page_status === 'noindex' || data.page_status === 'archived')
    ? 'noindex,nofollow'
    : 'index, follow'
  const ogLocale = OG_LOCALE_MAP[locale] ?? OG_LOCALE_MAP.en
  const routeSlug = `${data.origin_iata.toLowerCase()}-${data.dest_iata.toLowerCase()}`
  const hreflangLinks = [
    ...SUPPORTED_LOCALES.map(loc =>
      `<link rel="alternate" hreflang="${loc}" href="${_escAttr(`${DOMAIN}/${loc}/flights/${routeSlug}/`)}">`,
    ),
    `<link rel="alternate" hreflang="x-default" href="${_escAttr(`${DOMAIN}/en/flights/${routeSlug}/`)}">`,
  ].join('\n')
  return [
    `<meta charset="UTF-8" />`,
    `<meta name="viewport" content="width=device-width, initial-scale=1.0" />`,
    `<title>${_escHtml(title)}</title>`,
    `<meta name="description" content="${_escAttr(metaDescription)}">`,
    `<link rel="canonical" href="${_escAttr(canonicalUrl)}">`,
    `<meta name="robots" content="${robotsContent}">`,
    `<meta name="author" content="${BRAND}">`,
    // Open Graph
    `<meta property="og:type" content="article">`,
    `<meta property="og:site_name" content="${BRAND}">`,
    `<meta property="og:title" content="${_escAttr(title)}">`,
    `<meta property="og:description" content="${_escAttr(metaDescription)}">`,
    `<meta property="og:url" content="${_escAttr(canonicalUrl)}">`,
    `<meta property="og:image" content="${_escAttr(OG_IMAGE)}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:locale" content="${ogLocale}">`,
    // Twitter Card
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:site" content="@LetsFG">`,
    `<meta name="twitter:title" content="${_escAttr(title)}">`,
    `<meta name="twitter:description" content="${_escAttr(metaDescription)}">`,
    `<meta name="twitter:image" content="${_escAttr(OG_IMAGE)}">`,
    // hreflang
    hreflangLinks,
    // JSON-LD
    `<script type="application/ld+json">${jsonLdString}</script>`,
  ].join('\n')
}

/** Returns a structured object suitable for Next.js App Router generateMetadata(). */
export function buildFlightPageSeoHead(data: RouteDistributionData, locale: SupportedLocale = 'en'): FlightPageSeoHead {
  const {
    origin_iata, dest_iata, origin_city, dest_city,
    snapshot_computed_at, price_distribution, fee_analysis,
    carrier_summary, connector_comparison, total_offers_analyzed,
  } = data

  const currency = price_distribution.currency
  const routeSlug = `${origin_iata.toLowerCase()}-${dest_iata.toLowerCase()}`
  const canonicalUrl = `${DOMAIN}/${locale}/flights/${routeSlug}/`
  const monthYear = _fmtMonthYear(snapshot_computed_at)

  const title = `Flights ${origin_city} to ${dest_city} — Price Distribution & Hidden Fees | ${BRAND}`

  // Meta description: 140–160 chars, contains route, offer count, median, range, connector count
  const connectorNote = fee_analysis.avg_hidden_fees_pct != null
    ? ''
    : ` across ${connector_comparison.length} connectors`
  const feePart = fee_analysis.avg_hidden_fees_pct != null
    ? ` Hidden fees avg ${Math.round(fee_analysis.avg_hidden_fees_pct * 100)}%.`
    : ''
  const metaDescription =
    `${total_offers_analyzed} ${origin_city}–${dest_city} flight offers analyzed by AI agents${connectorNote}.` +
    ` Median ${currency} ${Math.round(price_distribution.p50)}, typical range ${currency} ${Math.round(price_distribution.p10)}–${Math.round(price_distribution.p90)}.` +
    feePart +
    ` ${carrier_summary.length} airlines compared · ${monthYear}.`

  const faqItems = _buildFaqSchemaText(data)
  const jsonLd = _buildJsonLd(data, faqItems, canonicalUrl, title)
  const jsonLdString = JSON.stringify(jsonLd)

  return { title, metaDescription, canonicalUrl, jsonLdString, locale }
}

// ─── FAQ plain-string text builder (schema.org requires plain strings, not JSX) ─

function _buildFaqSchemaText(data: RouteDistributionData): Array<{ q: string; a: string }> {
  const {
    origin_city, dest_city, origin_iata, dest_iata,
    price_distribution, fee_analysis, carrier_summary, connector_comparison,
    total_offers_analyzed, snapshot_computed_at,
  } = data
  const currency = price_distribution.currency
  const p50 = Math.round(price_distribution.p50)
  const pMin = Math.round(price_distribution.min)
  const pMax = Math.round(price_distribution.max)
  const monthLabel = _fmtMonthYear(snapshot_computed_at)
  const routeSlug = `${origin_iata.toLowerCase()}-${dest_iata.toLowerCase()}`
  const ctaUrl = `${DOMAIN}/flights/${routeSlug}/`

  // Cheapest carrier
  const cheapest = carrier_summary[0]
  const cheapestName = cheapest?.carrier ?? 'The top airline'
  const cheapestMedian = cheapest ? Math.round(cheapest.price_p50) : p50
  const cheapestOfferCount = cheapest?.offer_count ?? 0

  // Cheapest connector
  const cheapestConn = connector_comparison[0]
  const cheapestConnName = cheapestConn?.display_name ?? 'The top connector'
  const cheapestConnMedian = cheapestConn ? Math.round(cheapestConn.price_p50) : p50
  const connectorCount = connector_comparison.length
  const connectorSpread = connector_comparison.length >= 2
    ? Math.round(
        connector_comparison[connector_comparison.length - 1].price_p50 -
        connector_comparison[0].price_p50
      )
    : 0

  // LCC vs FSC split at overall p50
  const lccCarriers = carrier_summary.filter(c => c.price_p50 < price_distribution.p50)
  const fscCarriers = carrier_summary.filter(c => c.price_p50 >= price_distribution.p50)
  const lccMedian = lccCarriers.length > 0
    ? Math.round(lccCarriers.reduce((s, c) => s + c.price_p50, 0) / lccCarriers.length)
    : pMin
  const fscMedian = fscCarriers.length > 0
    ? Math.round(fscCarriers.reduce((s, c) => s + c.price_p50, 0) / fscCarriers.length)
    : pMax

  // Fee data
  const hasFees = fee_analysis.fee_breakdown_available && fee_analysis.avg_hidden_fees_amount != null
  const avgFees = fee_analysis.avg_hidden_fees_amount != null
    ? Math.round(fee_analysis.avg_hidden_fees_amount) : 0
  const feePct = fee_analysis.avg_hidden_fees_pct != null
    ? Math.round(fee_analysis.avg_hidden_fees_pct * 100) : 0

  // Min/max fee carrier from breakdown (if available)
  const breakdown = fee_analysis.breakdown ?? []
  const sortedFees = [...breakdown].sort((a, b) => a.avg_fee - b.avg_fee)
  const minFeeCarrier = sortedFees[0]?.carrier ?? ''
  const minFee = sortedFees[0]?.avg_fee != null ? Math.round(sortedFees[0].avg_fee) : 0
  const maxFeeCarrier = sortedFees[sortedFees.length - 1]?.carrier ?? ''
  const maxFee = sortedFees[sortedFees.length - 1]?.avg_fee != null
    ? Math.round(sortedFees[sortedFees.length - 1].avg_fee) : 0

  const route = `${origin_city}–${dest_city}`

  return [
    {
      q: `How much does a flight from ${origin_city} to ${dest_city} cost?`,
      a: `Based on ${total_offers_analyzed} offers analyzed, ${origin_city} to ${dest_city} flights ` +
        `range from ${currency} ${pMin} to ${currency} ${pMax}, ` +
        `with a median price of ${currency} ${p50}. ` +
        `Prices vary by travel date, booking timing, and airline. ` +
        `Search for current prices at ${ctaUrl}`,
    },
    {
      q: `What hidden fees should I expect on ${origin_city} to ${dest_city} flights?`,
      a: hasFees
        ? `Ancillary fees add an average of ${currency} ${avgFees} to the base fare on ${route} ` +
          `flights — ${feePct}% of the base fare. ` +
          (maxFeeCarrier && minFeeCarrier
            ? `${maxFeeCarrier} charges the most (${currency} ${maxFee}) while ` +
              `${minFeeCarrier} charges the least (${currency} ${minFee}).`
            : `Always compare total costs including bags and seat fees.`) +
          ` See itemized fees at ${ctaUrl}`
        : `Fee itemization was not available on the majority of connectors for ${route}. ` +
          `Median total fare ${currency} ${p50} — compare airline totals before booking. ` +
          `Run a search at ${ctaUrl}`,
    },
    {
      q: `Which airline is cheapest on ${origin_city} to ${dest_city} including all fees?`,
      a: cheapest
        ? `${cheapestName} has the lowest median fare on ${route} at ` +
          `${currency} ${cheapestMedian} (median across ${cheapestOfferCount} offers in ${monthLabel}). ` +
          `Check current prices at ${ctaUrl}`
        : `Carrier price data is not yet available for this route. Run a search at ${ctaUrl}`,
    },
    {
      q: `Which booking connector finds the best deals on ${origin_iata}–${dest_iata}?`,
      a: cheapestConn
        ? `${cheapestConnName} surfaced the lowest median prices on ${route} ` +
          `(${currency} ${cheapestConnMedian}) across ${connectorCount} connectors ` +
          `searched simultaneously in ${monthLabel}. ` +
          `The price spread from best to worst connector was ${currency} ${connectorSpread}. ` +
          `Run a multi-connector search at ${ctaUrl}`
        : `Connector comparison data is not yet available. Run a search at ${ctaUrl}`,
    },
    {
      q: `Why do prices vary so much on ${origin_city} to ${dest_city} routes?`,
      a: `${route} prices span ${currency} ${pMin}–${currency} ${pMax} because ` +
        `${carrier_summary.length} airlines with different pricing models compete on the route. ` +
        `Budget carriers median ${currency} ${lccMedian}; ` +
        `full-service carriers median ${currency} ${fscMedian}. ` +
        (hasFees
          ? `Ancillary fees add ${currency} ${minFee}–${currency} ${maxFee} depending on carrier.`
          : `Fee data varies by carrier — always compare total costs before booking.`) +
        ` Find where your trip lands at ${ctaUrl}`,
    },
  ]
}

// ─── JSON-LD builder ──────────────────────────────────────────────────────────

function _buildJsonLd(
  data: RouteDistributionData,
  faqItems: { q: string; a: string }[],
  canonicalUrl: string,
  headline: string,
): object {
  const {
    origin_iata, dest_iata, origin_city, dest_city,
    snapshot_computed_at, price_distribution, fee_analysis,
    carrier_summary, connector_comparison, total_offers_analyzed,
  } = data

  const currency = price_distribution.currency
  const routeSlug = `${origin_iata.toLowerCase()}-${dest_iata.toLowerCase()}`
  const originSlug = origin_iata.toLowerCase()
  const monthYear = _fmtMonthYear(snapshot_computed_at)

  // budget_carrier_share_pct: carriers below overall p50
  const lccOffers = carrier_summary
    .filter(c => c.price_p50 < price_distribution.p50)
    .reduce((s, c) => s + c.offer_count, 0)
  const budgetSharePct = total_offers_analyzed > 0
    ? Math.round(lccOffers / total_offers_analyzed * 100) : 0

  return {
    '@context': 'https://schema.org',
    '@graph': [
      // Article (first — primary content schema)
      {
        '@type': 'Article',
        headline: headline.replace(/ \| LetsFG$/, ''),
        description: `Price distribution and hidden fee analysis for ${origin_city}–${dest_city} flights, based on ${total_offers_analyzed} offers captured by AI agents in ${monthYear}.`,
        datePublished: snapshot_computed_at,
        dateModified: snapshot_computed_at,
        author: { '@type': 'Organization', name: BRAND, url: DOMAIN },
        about: {
          '@type': 'Trip',
          departureLocation: {
            '@type': 'Airport',
            iataCode: origin_iata,
            name: `${origin_city} Airport`,
          },
          arrivalLocation: {
            '@type': 'Airport',
            iataCode: dest_iata,
            name: `${dest_city} Airport`,
          },
        },
      },
      // FAQPage
      {
        '@type': 'FAQPage',
        mainEntity: faqItems.map(item => ({
          '@type': 'Question',
          name: item.q,
          acceptedAnswer: { '@type': 'Answer', text: item.a },
        })),
      },
      // BreadcrumbList — 4 items
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: DOMAIN },
          { '@type': 'ListItem', position: 2, name: 'Flights', item: `${DOMAIN}/flights` },
          {
            '@type': 'ListItem',
            position: 3,
            name: origin_city,
            item: `${DOMAIN}/flights/${originSlug}`,
          },
          {
            '@type': 'ListItem',
            position: 4,
            name: `${origin_city} to ${dest_city}`,
            item: canonicalUrl,
          },
        ],
      },
      // Dataset — expanded variableMeasured
      {
        '@type': 'Dataset',
        name: `${origin_city}–${dest_city} Flight Price Distribution`,
        description:
          `Price distribution for ${origin_city}–${dest_city} flights based on ${total_offers_analyzed} offers` +
          ` from ${carrier_summary.length} airlines, captured via AI agent search across` +
          ` ${connector_comparison.length} connectors in ${monthYear}. Includes hidden fee analysis by carrier.`,
        dateModified: snapshot_computed_at,
        measurementTechnique:
          `AI agent search across ${connector_comparison.length} connectors including direct airline APIs, OTAs, and meta-search aggregators. Prices captured via automated Playwright and HTTP connectors.`,
        variableMeasured: [
          { '@type': 'PropertyValue', name: 'median_total_price', value: price_distribution.p50, unitCode: currency },
          { '@type': 'PropertyValue', name: 'min_price', value: price_distribution.min, unitCode: currency },
          { '@type': 'PropertyValue', name: 'max_price', value: price_distribution.max, unitCode: currency },
          { '@type': 'PropertyValue', name: 'p10_price', value: price_distribution.p10, unitCode: currency },
          { '@type': 'PropertyValue', name: 'p25_price', value: price_distribution.p25, unitCode: currency },
          { '@type': 'PropertyValue', name: 'p75_price', value: price_distribution.p75, unitCode: currency },
          { '@type': 'PropertyValue', name: 'p90_price', value: price_distribution.p90, unitCode: currency },
          { '@type': 'PropertyValue', name: 'total_offers_analyzed', value: total_offers_analyzed },
          { '@type': 'PropertyValue', name: 'airlines_compared', value: carrier_summary.length },
          { '@type': 'PropertyValue', name: 'connectors_searched', value: connector_comparison.length },
          { '@type': 'PropertyValue', name: 'avg_hidden_fees_amount', value: fee_analysis.avg_hidden_fees_amount ?? 0, unitCode: currency },
          { '@type': 'PropertyValue', name: 'avg_hidden_fees_pct', value: fee_analysis.avg_hidden_fees_pct != null ? Math.round(fee_analysis.avg_hidden_fees_pct * 100) : 0, unitText: 'percent' },
          { '@type': 'PropertyValue', name: 'budget_carrier_share_pct', value: budgetSharePct, unitText: 'percent' },
        ],
      },
    ],
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function _fmtMonthYear(isoDate: string): string {
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December']
  const d = new Date(isoDate)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

function _escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function _escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
