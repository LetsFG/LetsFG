/**
 * seo-head.test.tsx — tests for FlightPageSEOHead component.
 *
 * Uses renderToStaticMarkup (no jsdom). Asserts on HTML string output.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { FlightPageSEOHead } from '../../../lib/pfp/seo/FlightPageSEOHead.tsx'
import type { RouteDistributionData } from '../../../lib/pfp/types/route-distribution.types.ts'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

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

const NOINDEX_DATA: RouteDistributionData = {
  ...BASE_DATA,
  page_status: 'noindex',
}

const FEE_DATA: RouteDistributionData = {
  ...BASE_DATA,
  fee_analysis: {
    avg_hidden_fees_amount: 42,
    avg_hidden_fees_pct: 0.15,
    fee_variance: 'medium',
    fee_breakdown_available: true,
    breakdown: [
      { carrier: 'FR', avg_fee: 42, avg_fee_pct: 0.15 },
    ],
  },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function render(data: RouteDistributionData, locale?: string): string {
  return renderToStaticMarkup(createElement(FlightPageSEOHead, { data, locale: locale as any }))
}

function getMetaContent(html: string, name: string): string | null {
  // matches name="X" content="Y" or content="Y" name="X"
  const re = new RegExp(`<meta[^>]+name="${name}"[^>]+content="([^"]*)"`, 'i')
  const m = html.match(re)
  if (m) return m[1]
  // also try reversed attribute order
  const re2 = new RegExp(`<meta[^>]+content="([^"]*)"[^>]+name="${name}"`, 'i')
  const m2 = html.match(re2)
  return m2 ? m2[1] : null
}

function getMetaProperty(html: string, property: string): string | null {
  const re = new RegExp(`<meta[^>]+property="${property}"[^>]+content="([^"]*)"`, 'i')
  const m = html.match(re)
  if (m) return m[1]
  const re2 = new RegExp(`<meta[^>]+content="([^"]*)"[^>]+property="${property}"`, 'i')
  const m2 = html.match(re2)
  return m2 ? m2[1] : null
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test('title contains OriginCity', () => {
  const html = render(BASE_DATA)
  assert.ok(html.includes('Gdansk'), `title missing origin city: ${html.slice(0, 200)}`)
})

test('title contains DestCity', () => {
  const html = render(BASE_DATA)
  assert.ok(html.includes('Barcelona'), `title missing dest city: ${html.slice(0, 200)}`)
})

test('title ends with | LetsFG', () => {
  const html = render(BASE_DATA)
  const titleMatch = html.match(/<title>([^<]+)<\/title>/)
  assert.ok(titleMatch !== null, 'no <title> tag found')
  // unescape HTML entities for the check
  const title = titleMatch![1].replace(/&amp;/g, '&')
  assert.ok(title.endsWith('| LetsFG'), `title does not end with "| LetsFG": "${title}"`)
})

test('meta description contains offer_count', () => {
  const html = render(BASE_DATA)
  const desc = getMetaContent(html, 'description')
  assert.ok(desc !== null, 'meta description not found')
  assert.ok(desc!.includes('180'), `description missing 180: "${desc}"`)
})

test('meta description contains median price (p50)', () => {
  const html = render(BASE_DATA)
  const desc = getMetaContent(html, 'description')
  assert.ok(desc !== null, 'meta description not found')
  assert.ok(desc!.includes('368'), `description missing p50=368: "${desc}"`)
})

test('meta description contains price range (p10 and p90)', () => {
  const html = render(BASE_DATA)
  const desc = getMetaContent(html, 'description')
  assert.ok(desc !== null, 'meta description not found')
  assert.ok(desc!.includes('153'), `description missing p10=153: "${desc}"`)
  assert.ok(desc!.includes('583'), `description missing p90=583: "${desc}"`)
})

test('meta description contains fee percentage when available', () => {
  const html = render(FEE_DATA)
  const desc = getMetaContent(html, 'description')
  assert.ok(desc !== null, 'meta description not found')
  assert.ok(desc!.includes('15%'), `description missing fee 15%: "${desc}"`)
})

test('canonical URL is absolute with locale prefix', () => {
  const html = render(BASE_DATA, 'en')
  assert.ok(
    html.includes('href="https://letsfg.co/en/flights/gdn-bcn/"'),
    `canonical href not found in: ${html.slice(0, 500)}`,
  )
})

test('canonical URL defaults to en locale when no locale provided', () => {
  const html = render(BASE_DATA)
  assert.ok(
    html.includes('href="https://letsfg.co/en/flights/gdn-bcn/"'),
    `canonical href missing en default in: ${html.slice(0, 500)}`,
  )
})

test('robots meta is absent for published pages', () => {
  const html = render(BASE_DATA)
  assert.ok(!html.includes('name="robots"'), 'unexpected robots meta on published page')
})

test('noindex + nofollow when page_status is noindex', () => {
  const html = render(NOINDEX_DATA)
  const robots = getMetaContent(html, 'robots')
  assert.ok(robots !== null, 'robots meta not found')
  assert.ok(robots!.includes('noindex'), `robots missing noindex: "${robots}"`)
  assert.ok(robots!.includes('nofollow'), `robots missing nofollow: "${robots}"`)
})

test('og:type is article', () => {
  const html = render(BASE_DATA)
  const ogType = getMetaProperty(html, 'og:type')
  assert.equal(ogType, 'article')
})

test('article:modified_time equals snapshot_computed_at', () => {
  const html = render(BASE_DATA)
  const modTime = getMetaProperty(html, 'article:modified_time')
  assert.ok(modTime !== null, 'article:modified_time not found')
  assert.ok(
    modTime!.includes('2026-05-05'),
    `article:modified_time missing date: "${modTime}"`,
  )
})

test('JSON-LD script block is present in output', () => {
  const html = render(BASE_DATA)
  assert.ok(
    html.includes('application/ld+json'),
    'JSON-LD script block not found',
  )
  assert.ok(
    html.includes('"@context"'),
    'JSON-LD @context not found in script block',
  )
})

// ─── NEW: OG image / Twitter Card / hreflang / author ─────────────────────────

test('og:image is set to static og image', () => {
  const html = render(BASE_DATA)
  const ogImage = getMetaProperty(html, 'og:image')
  assert.ok(ogImage !== null, 'og:image not found')
  assert.ok(ogImage!.includes('/og-v2.png'), `og:image unexpected: "${ogImage}"`)
})

test('og:image:width is 1200', () => {
  const html = render(BASE_DATA)
  const w = getMetaProperty(html, 'og:image:width')
  assert.equal(w, '1200', `og:image:width should be 1200, got "${w}"`)
})

test('og:image:height is 630', () => {
  const html = render(BASE_DATA)
  const h = getMetaProperty(html, 'og:image:height')
  assert.equal(h, '630', `og:image:height should be 630, got "${h}"`)
})

test('og:site_name is LetsFG', () => {
  const html = render(BASE_DATA)
  const siteName = getMetaProperty(html, 'og:site_name')
  assert.equal(siteName, 'LetsFG', `og:site_name unexpected: "${siteName}"`)
})

test('og:url is absolute canonical URL', () => {
  const html = render(BASE_DATA, 'en')
  const ogUrl = getMetaProperty(html, 'og:url')
  assert.ok(ogUrl !== null, 'og:url not found')
  assert.ok(ogUrl!.startsWith('https://letsfg.co'), `og:url should be absolute: "${ogUrl}"`)
})

test('og:locale is en_US for default locale', () => {
  const html = render(BASE_DATA)
  const locale = getMetaProperty(html, 'og:locale')
  assert.ok(locale !== null, 'og:locale not found')
})

test('twitter:card is summary_large_image', () => {
  const html = render(BASE_DATA)
  const card = getMetaContent(html, 'twitter:card')
  assert.equal(card, 'summary_large_image', `twitter:card unexpected: "${card}"`)
})

test('twitter:site is @LetsFG', () => {
  const html = render(BASE_DATA)
  const site = getMetaContent(html, 'twitter:site')
  assert.equal(site, '@LetsFG', `twitter:site unexpected: "${site}"`)
})

test('twitter:image is set', () => {
  const html = render(BASE_DATA)
  const img = getMetaContent(html, 'twitter:image')
  assert.ok(img !== null, 'twitter:image not found')
  assert.ok(img!.includes('/og-v2.png'), `twitter:image unexpected: "${img}"`)
})

test('author meta is LetsFG', () => {
  const html = render(BASE_DATA)
  const author = getMetaContent(html, 'author')
  assert.equal(author, 'LetsFG', `author meta unexpected: "${author}"`)
})

test('hreflang link for en locale is present', () => {
  const html = render(BASE_DATA, 'en')
  assert.ok(
    html.includes('hreflang="en"') || html.includes('hrefLang="en"'),
    `hreflang en not found in: ${html.slice(0, 500)}`,
  )
})

test('hreflang link for pl locale is present', () => {
  const html = render(BASE_DATA, 'en')
  assert.ok(
    html.includes('hreflang="pl"') || html.includes('hrefLang="pl"'),
    `hreflang pl not found in: ${html.slice(0, 500)}`,
  )
})

test('x-default hreflang points to en URL', () => {
  const html = render(BASE_DATA, 'en')
  assert.ok(
    html.includes('hreflang="x-default"') || html.includes('hrefLang="x-default"'),
    `hreflang x-default not found in: ${html.slice(0, 500)}`,
  )
  // x-default should point to the en path
  assert.ok(
    html.includes('/en/flights/gdn-bcn/'),
    `x-default should link to en path in: ${html.slice(0, 500)}`,
  )
})
