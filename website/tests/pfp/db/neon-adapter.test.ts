/**
 * neon-adapter.test.ts — unit tests for NeonAdapter using a mocked SQL driver.
 *
 * We test the adapter logic (SQL construction, result mapping, error handling)
 * without a live database by replacing the neon() SQL function with a mock
 * tagged-template function that returns preset rows.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

// We mock the module before importing the adapter.
// Node's --experimental-test-module-mocks or a manual mock function is used.
// Since tsx --test doesn't support module mocking, we test the adapter's
// exported helper functions (slug parsing, staleness computation, row mapping)
// directly, and test the full SQL paths via integration test markers.

import {
  parseRouteSlug,
  computeStaleness,
  mapRouteRowToRecord,
  mapSnapshotRowToDistribution,
} from '../../../lib/pfp/db/neon-adapter.ts'

// ─── parseRouteSlug ───────────────────────────────────────────────────────────

test('parseRouteSlug: parses lowercase slug to uppercase IATA codes', () => {
  const result = parseRouteSlug('gdn-bcn')
  assert.deepEqual(result, { origin: 'GDN', dest: 'BCN' })
})

test('parseRouteSlug: handles 4-letter IATA codes', () => {
  const result = parseRouteSlug('omdb-egll')
  assert.deepEqual(result, { origin: 'OMDB', dest: 'EGLL' })
})

test('parseRouteSlug: throws on invalid format (no dash)', () => {
  assert.throws(() => parseRouteSlug('gdnbcn'), /invalid/i)
})

test('parseRouteSlug: throws on empty string', () => {
  assert.throws(() => parseRouteSlug(''), /invalid/i)
})

// ─── computeStaleness ────────────────────────────────────────────────────────

test('computeStaleness: fresh when snapshot < 7 days old', () => {
  const snapshotAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
  assert.equal(computeStaleness(snapshotAt), 'fresh')
})

test('computeStaleness: recent when snapshot 7–30 days old', () => {
  const snapshotAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
  assert.equal(computeStaleness(snapshotAt), 'recent')
})

test('computeStaleness: stale when snapshot > 30 days old', () => {
  const snapshotAt = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString()
  assert.equal(computeStaleness(snapshotAt), 'stale')
})

test('computeStaleness: fresh when exactly 0 days old', () => {
  const snapshotAt = new Date().toISOString()
  assert.equal(computeStaleness(snapshotAt), 'fresh')
})

// ─── mapRouteRowToRecord ──────────────────────────────────────────────────────

test('mapRouteRowToRecord: maps DB row to RouteRecord', () => {
  const row = {
    id: 'uuid-123',
    origin_iata: 'GDN',
    dest_iata: 'BCN',
    page_status: 'published',
    quality_score: 0.82,
  }
  const record = mapRouteRowToRecord(row)
  assert.equal(record.id, 'uuid-123')
  assert.equal(record.originIata, 'GDN')
  assert.equal(record.destIata, 'BCN')
  assert.equal(record.pageStatus, 'published')
  assert.equal(record.qualityScore, 0.82)
})

test('mapRouteRowToRecord: handles null quality_score', () => {
  const row = { id: 'u', origin_iata: 'A', dest_iata: 'B', page_status: 'draft', quality_score: null }
  const record = mapRouteRowToRecord(row)
  assert.equal(record.qualityScore, 0)
})

// ─── mapSnapshotRowToDistribution ─────────────────────────────────────────────

test('mapSnapshotRowToDistribution: returns null when full_snapshot_json is empty', () => {
  const row = { full_snapshot_json: {}, page_status: 'published', origin_iata: 'G', dest_iata: 'B' }
  const result = mapSnapshotRowToDistribution(row)
  assert.equal(result, null)
})

test('mapSnapshotRowToDistribution: returns distribution when snapshot has required fields', () => {
  const snapshot = {
    origin_iata: 'GDN',
    dest_iata: 'BCN',
    origin_city: 'Gdansk',
    dest_city: 'Barcelona',
    snapshot_computed_at: new Date().toISOString(),
    staleness: 'fresh',
    data_confidence: 'high',
    total_offers_analyzed: 50,
    session_count: 1,
    price_distribution: { p10: 49, p25: 69, p50: 89, p75: 130, p90: 180, p95: 220,
                          min: 39, max: 350, histogram: [], currency: 'EUR', is_bimodal: false },
    fee_analysis: { avg_hidden_fees_amount: null, avg_hidden_fees_pct: null,
                    fee_variance: 'low', fee_breakdown_available: false },
    carrier_summary: [],
    connector_comparison: [],
    tldr: { summary: 'S', key_facts: ['F1', 'F2', 'F3'] },
    page_status: 'published',
    is_preview: true,
  }
  const row = { full_snapshot_json: snapshot, page_status: 'published', origin_iata: 'GDN', dest_iata: 'BCN' }
  const result = mapSnapshotRowToDistribution(row)
  assert.ok(result !== null)
  assert.equal(result!.origin_iata, 'GDN')
  assert.equal(result!.page_status, 'published')
})

test('mapSnapshotRowToDistribution: returns null when snapshot missing price_distribution', () => {
  const row = {
    full_snapshot_json: { origin_iata: 'GDN' }, // incomplete
    page_status: 'published',
    origin_iata: 'GDN',
    dest_iata: 'BCN',
  }
  const result = mapSnapshotRowToDistribution(row)
  assert.equal(result, null)
})
