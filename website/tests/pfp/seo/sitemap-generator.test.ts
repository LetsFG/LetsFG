/**
 * sitemap-generator.test.ts — tests for generateFlightSitemap()
 * and its helper functions.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  computeSitemapPriority,
  computeChangefreq,
  generateFlightSitemap,
} from '../../../lib/pfp/seo/sitemap-generator.ts'
import type { SitemapRoute } from '../../../lib/pfp/seo/sitemap-generator.ts'

// ─── Fixture factory ──────────────────────────────────────────────────────────

function makeRoute(overrides: Partial<SitemapRoute> = {}): SitemapRoute {
  return {
    slug: 'gdn-bcn',
    page_status: 'published',
    staleness: 'fresh',
    session_count: 150,
    snapshot_computed_at: '2026-05-05T10:00:00Z',
    ...overrides,
  }
}

// ─── computeSitemapPriority ────────────────────────────────────────────────────

test('noindex route always gets priority 0.3 regardless of session_count', () => {
  const route = makeRoute({ page_status: 'noindex', session_count: 999 })
  assert.equal(computeSitemapPriority(route), 0.3)
})

test('session_count > 100 gets priority 0.9', () => {
  assert.equal(computeSitemapPriority(makeRoute({ session_count: 101 })), 0.9)
  assert.equal(computeSitemapPriority(makeRoute({ session_count: 200 })), 0.9)
})

test('session_count = 100 does NOT get 0.9 (boundary: strict >100)', () => {
  assert.equal(computeSitemapPriority(makeRoute({ session_count: 100 })), 0.7)
})

test('session_count > 20 gets priority 0.7', () => {
  assert.equal(computeSitemapPriority(makeRoute({ session_count: 21 })), 0.7)
  assert.equal(computeSitemapPriority(makeRoute({ session_count: 50 })), 0.7)
})

test('session_count = 20 does NOT get 0.7 (boundary: strict >20)', () => {
  assert.equal(computeSitemapPriority(makeRoute({ session_count: 20 })), 0.5)
})

test('session_count > 5 gets priority 0.5', () => {
  assert.equal(computeSitemapPriority(makeRoute({ session_count: 6 })), 0.5)
  assert.equal(computeSitemapPriority(makeRoute({ session_count: 10 })), 0.5)
})

test('session_count = 5 does NOT get 0.5 (boundary: strict >5), gets 0.4', () => {
  assert.equal(computeSitemapPriority(makeRoute({ session_count: 5 })), 0.4)
  assert.equal(computeSitemapPriority(makeRoute({ session_count: 1 })), 0.4)
})

// ─── computeChangefreq ────────────────────────────────────────────────────────

test('fresh staleness maps to daily', () => {
  assert.equal(computeChangefreq('fresh'), 'daily')
})

test('recent staleness maps to weekly', () => {
  assert.equal(computeChangefreq('recent'), 'weekly')
})

test('stale staleness maps to monthly', () => {
  assert.equal(computeChangefreq('stale'), 'monthly')
})

// ─── generateFlightSitemap — filtering ────────────────────────────────────────

test('published routes are included in sitemap', () => {
  const xml = generateFlightSitemap([makeRoute({ page_status: 'published', slug: 'gdn-bcn' })])
  assert.ok(xml.includes('gdn-bcn'), 'published route not found in sitemap')
})

test('noindex routes are included in sitemap (at priority 0.3)', () => {
  const xml = generateFlightSitemap([makeRoute({ page_status: 'noindex', slug: 'ams-dxb' })])
  assert.ok(xml.includes('ams-dxb'), 'noindex route not found in sitemap')
  assert.ok(xml.includes('0.3'), 'noindex priority not 0.3 in sitemap')
})

test('draft routes are excluded from sitemap', () => {
  const xml = generateFlightSitemap([makeRoute({ page_status: 'draft', slug: 'lhr-jfk' })])
  assert.ok(!xml.includes('lhr-jfk'), 'draft route should not appear in sitemap')
})

test('archived routes are excluded from sitemap', () => {
  const xml = generateFlightSitemap([makeRoute({ page_status: 'archived', slug: 'cdg-ord' })])
  assert.ok(!xml.includes('cdg-ord'), 'archived route should not appear in sitemap')
})

// ─── generateFlightSitemap — XML structure ────────────────────────────────────

test('XML contains urlset root element', () => {
  const xml = generateFlightSitemap([makeRoute()])
  assert.ok(xml.includes('<urlset'), 'urlset element missing')
  assert.ok(xml.includes('sitemaps.org'), 'sitemap namespace missing')
})

test('all lastmod values are valid W3C Datetime (YYYY-MM-DD)', () => {
  const routes = [
    makeRoute({ slug: 'gdn-bcn', snapshot_computed_at: '2026-05-05T10:00:00Z' }),
    makeRoute({ slug: 'waw-bcn', snapshot_computed_at: '2026-04-20T08:30:00Z' }),
    makeRoute({ slug: 'krk-bcn', snapshot_computed_at: '2026-03-15T12:00:00Z' }),
  ]
  const xml = generateFlightSitemap(routes)
  const lastmodValues = [...xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map(m => m[1])
  assert.ok(lastmodValues.length >= 3, `expected >= 3 lastmod values, got ${lastmodValues.length}`)
  for (const val of lastmodValues) {
    assert.match(val, /^\d{4}-\d{2}-\d{2}$/, `invalid W3C Datetime: "${val}"`)
  }
})

// ─── generateFlightSitemap — sitemap index ────────────────────────────────────

test('sitemap index is generated when eligible routes exceed chunkThreshold', () => {
  const routes = Array.from({ length: 6 }, (_, i) => makeRoute({
    slug: `${String.fromCharCode(65 + i)}xx-bcn`.toLowerCase(),
    page_status: 'published',
    session_count: 10,
  }))
  const xml = generateFlightSitemap(routes, { chunkThreshold: 4 })
  assert.ok(xml.includes('<sitemapindex'), `expected sitemapindex root, got: ${xml.slice(0, 200)}`)
  assert.ok(!xml.includes('<urlset'), 'urlset should not appear in sitemap index')
})

test('regular urlset is generated when eligible routes are within chunkThreshold', () => {
  const routes = [makeRoute({ slug: 'gdn-bcn' }), makeRoute({ slug: 'waw-fra' })]
  const xml = generateFlightSitemap(routes, { chunkThreshold: 10 })
  assert.ok(xml.includes('<urlset'), 'expected urlset root')
  assert.ok(!xml.includes('<sitemapindex'), 'sitemapindex should not appear')
})
