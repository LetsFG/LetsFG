/**
 * json-ld-generator.test.ts — tests for generateFlightPageSchema()
 *
 * Verifies the four JSON-LD schema types required for GEO citation:
 * Article + Dataset + FAQPage + BreadcrumbList
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { generateFlightPageSchema } from '../../../lib/pfp/seo/json-ld-generator.ts'
import type { RouteDistributionData } from '../../../lib/pfp/types/route-distribution.types.ts'

// ─── Fixture ──────────────────────────────────────────────────────────────────

const BASE_DATA: RouteDistributionData = {
  origin_iata: 'GDN',
  dest_iata: 'BCN',
  origin_city: 'Gdansk',
  dest_city: 'Barcelona',
  snapshot_computed_at: '2026-05-05T10:00:00Z',
  staleness: 'fresh',
  data_confidence: 'high',
  total_offers_analyzed: 180,
  session_count: 3,
  price_distribution: {
    p10: 153, p25: 234, p50: 368, p75: 503, p90: 583, p95: 610,
    min: 100, max: 637,
    histogram: Array.from({ length: 10 }, (_, i) => ({
      from: Math.round(100 + i * 53.7),
      to: Math.round(100 + (i + 1) * 53.7),
      count: 18,
      pct: 10,
    })),
    currency: 'EUR',
    is_bimodal: false,
  },
  fee_analysis: {
    avg_hidden_fees_amount: null,
    avg_hidden_fees_pct: null,
    fee_variance: 'low',
    fee_breakdown_available: false,
  },
  carrier_summary: [
    { carrier: 'FR', offer_count: 30, price_p50: 200, hidden_fees_avg: null, hidden_fees_pct: null },
    { carrier: 'W6', offer_count: 30, price_p50: 220, hidden_fees_avg: null, hidden_fees_pct: null },
  ],
  connector_comparison: [
    { connector_name: 'ryanair_direct', offer_count: 36, price_p50: 200, delta_vs_avg_pct: -12.3 },
    { connector_name: 'wizzair_direct', offer_count: 36, price_p50: 250, delta_vs_avg_pct: 3.2 },
  ],
  tldr: {
    summary: 'GDN → BCN: from EUR 100, median EUR 368, 180 offers analyzed',
    key_facts: [
      'Cheapest offer: EUR 100 on 2026-05-05',
      'Median price EUR 368 as of 2026-05-05',
      '2 carriers competing on this route as of 2026-05-05',
    ],
  },
  page_status: 'published',
  is_preview: true,
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function extractJson(output: string): Record<string, unknown> {
  const inner = output.slice('<script type="application/ld+json">'.length, -'</script>'.length)
  return JSON.parse(inner) as Record<string, unknown>
}

type SchemaNode = Record<string, unknown>

function getGraph(output: string): SchemaNode[] {
  const parsed = extractJson(output)
  return (parsed['@graph'] as SchemaNode[]) ?? []
}

function findType(output: string, type: string): SchemaNode | undefined {
  return getGraph(output).find(n => n['@type'] === type)
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test('output is valid parseable JSON (JSON.parse does not throw)', () => {
  const result = generateFlightPageSchema(BASE_DATA)
  assert.ok(result.startsWith('<script type="application/ld+json">'), 'starts with script open tag')
  assert.ok(result.endsWith('</script>'), 'ends with script close tag')
  // Should not throw
  const parsed = extractJson(result)
  assert.ok(parsed !== null)
})

test('root @context is https://schema.org', () => {
  const parsed = extractJson(generateFlightPageSchema(BASE_DATA))
  assert.equal(parsed['@context'], 'https://schema.org')
})

test('@graph contains all four required schema types', () => {
  const graph = getGraph(generateFlightPageSchema(BASE_DATA))
  const types = graph.map(n => n['@type'])
  assert.ok(types.includes('Article'), 'missing Article')
  assert.ok(types.includes('Dataset'), 'missing Dataset')
  assert.ok(types.includes('FAQPage'), 'missing FAQPage')
  assert.ok(types.includes('BreadcrumbList'), 'missing BreadcrumbList')
})

test('Article has correct @type', () => {
  const article = findType(generateFlightPageSchema(BASE_DATA), 'Article')
  assert.ok(article !== undefined, 'Article node missing')
  assert.equal(article['@type'], 'Article')
})

test('Article.dateModified matches snapshot_computed_at', () => {
  const article = findType(generateFlightPageSchema(BASE_DATA), 'Article') ?? {}
  assert.equal(article['dateModified'], BASE_DATA.snapshot_computed_at)
})

test('Article.dateModified is ISO 8601 format', () => {
  const article = findType(generateFlightPageSchema(BASE_DATA), 'Article') ?? {}
  const dateModified = article['dateModified'] as string
  // ISO 8601: YYYY-MM-DDTHH:mm:ssZ
  assert.match(dateModified, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
})

test('Article.about has departureLocation with origin iataCode', () => {
  const article = findType(generateFlightPageSchema(BASE_DATA), 'Article') ?? {}
  const about = article['about'] as SchemaNode
  const departure = about['departureLocation'] as SchemaNode
  assert.equal(departure['@type'], 'Airport')
  assert.equal(departure['iataCode'], 'GDN')
})

test('Article.about has arrivalLocation with dest iataCode', () => {
  const article = findType(generateFlightPageSchema(BASE_DATA), 'Article') ?? {}
  const about = article['about'] as SchemaNode
  const arrival = about['arrivalLocation'] as SchemaNode
  assert.equal(arrival['@type'], 'Airport')
  assert.equal(arrival['iataCode'], 'BCN')
})

test('Dataset.description contains offer_count', () => {
  const dataset = findType(generateFlightPageSchema(BASE_DATA), 'Dataset') ?? {}
  const desc = dataset['description'] as string
  assert.ok(desc.includes('180'), `description does not contain 180: "${desc}"`)
})

test('Dataset.description contains price range min and max values', () => {
  const dataset = findType(generateFlightPageSchema(BASE_DATA), 'Dataset') ?? {}
  const desc = dataset['description'] as string
  assert.ok(desc.includes('100'), `description does not contain min 100: "${desc}"`)
  assert.ok(desc.includes('637'), `description does not contain max 637: "${desc}"`)
})

test('FAQPage answers contain actual numbers (not placeholder strings)', () => {
  const faqPage = findType(generateFlightPageSchema(BASE_DATA), 'FAQPage') ?? {}
  const entities = faqPage['mainEntity'] as SchemaNode[]
  assert.ok(entities.length >= 5, `expected >= 5 FAQ items, got ${entities.length}`)
  const allAnswers = entities.map(e => {
    const answered = e['acceptedAnswer'] as SchemaNode
    return answered['text'] as string
  })
  // Every answer should contain at least one digit
  for (const answer of allAnswers) {
    assert.match(answer, /\d/, `FAQ answer has no numbers: "${answer}"`)
  }
})

test('BreadcrumbList has 4 items with positions 1, 2, 3, 4', () => {
  const breadcrumb = findType(generateFlightPageSchema(BASE_DATA), 'BreadcrumbList') ?? {}
  const items = breadcrumb['itemListElement'] as SchemaNode[]
  assert.equal(items.length, 4)
  const positions = items.map(item => item['position'])
  assert.deepEqual(positions, [1, 2, 3, 4])
})

test('BreadcrumbList position 1=Home, 2=Flights, 3=OriginCity, 4=Route', () => {
  const breadcrumb = findType(generateFlightPageSchema(BASE_DATA), 'BreadcrumbList') ?? {}
  const items = breadcrumb['itemListElement'] as SchemaNode[]
  assert.equal(items[0]['name'], 'Home')
  assert.equal(items[1]['name'], 'Flights')
  assert.equal(items[2]['name'], 'Gdansk')     // origin_city
  assert.ok(
    (items[3]['name'] as string).includes('GDN') && (items[3]['name'] as string).includes('BCN'),
    `Route item should include GDN and BCN: "${items[3]['name']}"`,
  )
})
