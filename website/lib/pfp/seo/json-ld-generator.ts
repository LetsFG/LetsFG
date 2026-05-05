/**
 * json-ld-generator.ts — JSON-LD schema generator for flight route pages.
 *
 * GEO citation research shows that stacked schema (Article + Dataset +
 * FAQPage + BreadcrumbList) achieves a 3.1x LLM citation rate compared to
 * no structured data. All four types are always included.
 *
 * Exports:
 *   buildFlightPageJsonLd(data)    → raw JSON string (for dangerouslySetInnerHTML)
 *   generateFlightPageSchema(data) → full <script> tag string (for direct embedding)
 */

import type { RouteDistributionData } from '../types/route-distribution.types.ts'

const BASE_URL = 'https://letsfg.co'

// ─── FAQ builder (mirrors FlightPage FAQ content) ─────────────────────────────

function buildFaqItems(data: RouteDistributionData): Array<{ q: string; a: string }> {
  const {
    origin_iata, dest_iata, origin_city, dest_city,
    price_distribution, fee_analysis, carrier_summary, connector_comparison,
    total_offers_analyzed, session_count,
  } = data
  const currency = price_distribution.currency
  const cheapestCarrier = carrier_summary[0]
  const cheapestConnector = connector_comparison[0]

  return [
    {
      q: `How much does a flight from ${origin_city} to ${dest_city} cost?`,
      a:
        `Based on ${total_offers_analyzed} offers analyzed, ${origin_iata}→${dest_iata} flights ` +
        `range from ${currency} ${Math.round(price_distribution.min)} to ` +
        `${currency} ${Math.round(price_distribution.max)}, ` +
        `with a median price of ${currency} ${Math.round(price_distribution.p50)}.`,
    },
    {
      q: `What hidden fees should I expect on ${origin_iata}→${dest_iata} flights?`,
      a:
        fee_analysis.fee_breakdown_available && fee_analysis.avg_hidden_fees_amount != null
          ? `On average, ancillary fees add ${currency} ${Math.round(fee_analysis.avg_hidden_fees_amount)} ` +
            `to the base fare on ${origin_iata}→${dest_iata} flights.`
          : `Most connectors did not expose itemized fee data on ${origin_iata}→${dest_iata} ` +
            `across our ${session_count} search session${session_count !== 1 ? 's' : ''}. Run a live search for current fees.`,
    },
    {
      q: `Which airline is cheapest on ${origin_iata}→${dest_iata} including all fees?`,
      a:
        cheapestCarrier
          ? `${cheapestCarrier.carrier} has the lowest median fare on ${origin_iata}→${dest_iata} ` +
            `at ${currency} ${Math.round(cheapestCarrier.price_p50)} ` +
            `(median across ${cheapestCarrier.offer_count} offers in our snapshot).`
          : `Carrier price data is not yet available for this route. Run a search to see current prices.`,
    },
    {
      q: `Which booking connector finds the best deals on ${origin_iata}→${dest_iata}?`,
      a:
        cheapestConnector
          ? `Our ${cheapestConnector.connector_name} search agent surfaced the lowest median prices ` +
            `on ${origin_iata}→${dest_iata} — ` +
            `${Math.abs(Math.round(cheapestConnector.delta_vs_avg_pct))}% below the route average ` +
            `across all connectors searched.`
          : `Connector comparison data is not yet available. Run a search to see which channels find the best deals.`,
    },
    {
      q: `Why do prices vary so much on ${origin_iata}→${dest_iata}?`,
      a:
        `${origin_iata}→${dest_iata} has ${carrier_summary.length} airlines competing, ` +
        `creating a price range from ${currency} ${Math.round(price_distribution.min)} ` +
        `to ${currency} ${Math.round(price_distribution.max)}.` +
        (price_distribution.is_bimodal
          ? ` There are two distinct fare clusters on this route: budget and premium options.`
          : ``) +
        ` Prices vary based on cabin class, booking timing, and ancillary fees.`,
    },
  ]
}

// ─── Schema builders ──────────────────────────────────────────────────────────

function buildArticleNode(data: RouteDistributionData): Record<string, unknown> {
  const { origin_iata, dest_iata, origin_city, dest_city, snapshot_computed_at } = data
  return {
    '@type': 'Article',
    headline: `Flights ${origin_city} → ${dest_city} — Distribution & Hidden Fees`,
    datePublished: snapshot_computed_at,
    dateModified: snapshot_computed_at,
    author: {
      '@type': 'Organization',
      name: 'LetsFG',
    },
    about: {
      '@type': 'Trip',
      departureLocation: {
        '@type': 'Airport',
        iataCode: origin_iata,
      },
      arrivalLocation: {
        '@type': 'Airport',
        iataCode: dest_iata,
      },
    },
  }
}

function buildDatasetNode(data: RouteDistributionData): Record<string, unknown> {
  const { origin_iata, dest_iata, snapshot_computed_at, price_distribution, total_offers_analyzed } = data
  const currency = price_distribution.currency
  return {
    '@type': 'Dataset',
    name: `Flight distribution ${origin_iata}→${dest_iata}`,
    description:
      `${total_offers_analyzed} offers analyzed. ` +
      `Range ${Math.round(price_distribution.min)}–${Math.round(price_distribution.max)} ${currency}.`,
    dateModified: snapshot_computed_at,
    measurementTechnique:
      'Aggregated from AI agent searches across all available flight connectors',
    variableMeasured: ['base_fare', 'grand_total', 'hidden_fees', 'carrier', 'connector_name'],
  }
}

function buildFaqPageNode(data: RouteDistributionData): Record<string, unknown> {
  const faqItems = buildFaqItems(data)
  return {
    '@type': 'FAQPage',
    mainEntity: faqItems.map(item => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.a,
      },
    })),
  }
}

function buildBreadcrumbNode(data: RouteDistributionData): Record<string, unknown> {
  const { origin_iata, dest_iata, origin_city } = data
  const originSlug = origin_iata.toLowerCase()
  const routeSlug = `${origin_iata.toLowerCase()}-${dest_iata.toLowerCase()}`
  return {
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Home',
        item: BASE_URL,
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Flights',
        item: `${BASE_URL}/flights`,
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: origin_city,
        item: `${BASE_URL}/flights/${originSlug}`,
      },
      {
        '@type': 'ListItem',
        position: 4,
        name: `${origin_iata}→${dest_iata}`,
        item: `${BASE_URL}/flights/${routeSlug}`,
      },
    ],
  }
}

// ─── Public exports ───────────────────────────────────────────────────────────

/**
 * Returns the JSON-LD object serialized as a string (no script tags).
 * Use this with dangerouslySetInnerHTML in React components.
 */
export function buildFlightPageJsonLd(data: RouteDistributionData): string {
  const graph = [
    buildArticleNode(data),
    buildDatasetNode(data),
    buildFaqPageNode(data),
    buildBreadcrumbNode(data),
  ]
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph })
}

/**
 * Returns a full <script type="application/ld+json"> block.
 * Use this for direct HTML embedding (e.g., in _document or for testing).
 */
export function generateFlightPageSchema(data: RouteDistributionData): string {
  return `<script type="application/ld+json">${buildFlightPageJsonLd(data)}</script>`
}
