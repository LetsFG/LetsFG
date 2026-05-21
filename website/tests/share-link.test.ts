/**
 * Tests for share-link pure utilities.
 *
 * Covers:
 *   buildShareSlug    — label → kebab slug
 *   generateShareUrl  — canonical shareable URL
 *   isValidShareId    — search ID format guard
 *   extractShareSource — ?ref= param extraction
 *   buildShareVisitAttribution — analytics payload for share visits
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildShareSlug,
  generateShareUrl,
  isValidShareId,
  extractShareSource,
  buildShareVisitAttribution,
} from '../lib/share-link.ts'

// ── buildShareSlug ────────────────────────────────────────────────────────────

test('buildShareSlug produces kebab-case slug with "to" separator', () => {
  assert.equal(buildShareSlug('London', 'Tokyo'), 'london-to-tokyo')
})

test('buildShareSlug lowercases and strips spaces', () => {
  assert.equal(buildShareSlug('New York', 'Los Angeles'), 'new-york-to-los-angeles')
})

test('buildShareSlug strips non-alphanumeric characters (except spaces)', () => {
  const slug = buildShareSlug('São Paulo', 'Zürich')
  assert.ok(/^[a-z0-9-]+$/.test(slug), `slug should be URL-safe: ${slug}`)
})

test('buildShareSlug handles single-word labels', () => {
  assert.equal(buildShareSlug('Paris', 'Berlin'), 'paris-to-berlin')
})

test('buildShareSlug collapses consecutive hyphens', () => {
  const slug = buildShareSlug('A B  C', 'D')
  assert.ok(!slug.includes('--'), `no consecutive hyphens: ${slug}`)
})

// ── generateShareUrl ──────────────────────────────────────────────────────────

test('generateShareUrl includes searchId in the path', () => {
  const url = generateShareUrl('ws_abc123')
  assert.ok(url.includes('ws_abc123'), `expected ws_abc123 in: ${url}`)
})

test('generateShareUrl includes /results/ in the path', () => {
  const url = generateShareUrl('ws_abc123')
  assert.ok(url.includes('/results/'), `expected /results/ in: ${url}`)
})

test('generateShareUrl with labels appends slug after searchId', () => {
  const url = generateShareUrl('ws_abc123', { fromLabel: 'London', toLabel: 'Tokyo' })
  assert.ok(url.includes('/london-to-tokyo'), `expected slug in: ${url}`)
  assert.ok(url.includes('ws_abc123'), `expected searchId in: ${url}`)
})

test('generateShareUrl uses siteUrl option when provided', () => {
  const url = generateShareUrl('ws_abc123', { siteUrl: 'https://test.letsfg.co' })
  assert.ok(url.startsWith('https://test.letsfg.co'), `expected custom siteUrl prefix: ${url}`)
})

test('generateShareUrl without siteUrl defaults to letsfg.co', () => {
  const url = generateShareUrl('ws_abc123')
  assert.ok(url.startsWith('https://letsfg.co'), `expected letsfg.co prefix: ${url}`)
})

// ── isValidShareId ────────────────────────────────────────────────────────────

test('isValidShareId accepts ws_xxx format', () => {
  assert.equal(isValidShareId('ws_abc123'), true)
})

test('isValidShareId accepts s_xxx format', () => {
  assert.equal(isValidShareId('s_xyz456'), true)
})

test('isValidShareId accepts generic alphanumeric IDs', () => {
  assert.equal(isValidShareId('abc123'), true)
})

test('isValidShareId rejects empty string', () => {
  assert.equal(isValidShareId(''), false)
})

test('isValidShareId rejects non-string values', () => {
  assert.equal(isValidShareId(null), false)
  assert.equal(isValidShareId(undefined), false)
  assert.equal(isValidShareId(123), false)
})

test('isValidShareId rejects strings with spaces', () => {
  assert.equal(isValidShareId('ws abc'), false)
})

// ── extractShareSource ────────────────────────────────────────────────────────

test('extractShareSource reads ?ref= from URLSearchParams', () => {
  const params = new URLSearchParams('ref=ws_original')
  assert.equal(extractShareSource(params), 'ws_original')
})

test('extractShareSource reads ?source_search_id= from URLSearchParams', () => {
  const params = new URLSearchParams('source_search_id=ws_original')
  assert.equal(extractShareSource(params), 'ws_original')
})

test('extractShareSource prefers ref over source_search_id when both present', () => {
  const params = new URLSearchParams('ref=ws_ref&source_search_id=ws_sid')
  assert.equal(extractShareSource(params), 'ws_ref')
})

test('extractShareSource returns null when no share params present', () => {
  const params = new URLSearchParams('q=flights&date=2026-07-01')
  assert.equal(extractShareSource(params), null)
})

test('extractShareSource reads from plain object', () => {
  const params: Record<string, string | undefined> = { ref: 'ws_abc' }
  assert.equal(extractShareSource(params), 'ws_abc')
})

test('extractShareSource returns null for empty ref', () => {
  const params = new URLSearchParams('ref=')
  assert.equal(extractShareSource(params), null)
})

// ── buildShareVisitAttribution ────────────────────────────────────────────────

test('buildShareVisitAttribution sets source_search_id', () => {
  const payload = buildShareVisitAttribution('ws_original')
  assert.equal(payload.source_search_id, 'ws_original')
})

test('buildShareVisitAttribution sets source to "share"', () => {
  const payload = buildShareVisitAttribution('ws_original')
  assert.equal(payload.source, 'share')
})

test('buildShareVisitAttribution returns object with only expected fields', () => {
  const payload = buildShareVisitAttribution('ws_original')
  const keys = Object.keys(payload)
  assert.ok(keys.includes('source_search_id'), 'must include source_search_id')
  assert.ok(keys.includes('source'), 'must include source')
  assert.equal(keys.length, 2, 'should have exactly 2 fields')
})
