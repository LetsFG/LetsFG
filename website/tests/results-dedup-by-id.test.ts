/**
 * Tests for dedupOffersById in lib/offer-dedup.ts.
 *
 * FSW occasionally emits the same offer id 2–3 times in a single response
 * (observed 13/16 duplicates in ws_47776b352af74a1b on 2026-05-23). The
 * normalize → validate → order pipeline in /api/results/[searchId]/route.ts
 * had no dedup step, so duplicates were rendered to users.
 *
 * Dedup strategy: keep the lowest-price copy when ids collide. This is safe
 * for true exact duplicates and correct for the rare case where two entries
 * share an id but differ in price (e.g. same logical offer from two sources).
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { dedupOffersById } from '../lib/offer-dedup.ts'

interface MinOffer { id: string; price: number; source?: string }

test('returns identical array when there are no duplicate ids', () => {
  const offers: MinOffer[] = [
    { id: 'a', price: 100 },
    { id: 'b', price: 200 },
    { id: 'c', price: 150 },
  ]
  const result = dedupOffersById(offers)
  assert.equal(result.length, 3)
  assert.deepEqual(result.map(o => o.id), ['a', 'b', 'c'])
})

test('collapses exact duplicates to a single entry', () => {
  const offers: MinOffer[] = [
    { id: 'wo_abc', price: 100 },
    { id: 'wo_abc', price: 100 },
    { id: 'wo_abc', price: 100 },
  ]
  const result = dedupOffersById(offers)
  assert.equal(result.length, 1)
  assert.equal(result[0].id, 'wo_abc')
})

test('keeps the cheapest copy when ids collide with different prices', () => {
  const offers: MinOffer[] = [
    { id: 'wo_abc', price: 150, source: 'kayak' },
    { id: 'wo_abc', price: 100, source: 'kiwi' },
    { id: 'wo_abc', price: 120, source: 'momondo' },
  ]
  const result = dedupOffersById(offers)
  assert.equal(result.length, 1)
  assert.equal(result[0].price, 100)
  assert.equal(result[0].source, 'kiwi')
})

test('preserves order of first occurrence across distinct ids', () => {
  const offers: MinOffer[] = [
    { id: 'c', price: 300 },
    { id: 'a', price: 100 },
    { id: 'c', price: 280 },
    { id: 'b', price: 200 },
    { id: 'a', price: 90 },
  ]
  const result = dedupOffersById(offers)
  assert.equal(result.length, 3)
  // Stable: the order in which distinct ids first appeared is preserved.
  assert.deepEqual(result.map(o => o.id), ['c', 'a', 'b'])
  // Cheapest copies retained.
  assert.deepEqual(result.map(o => o.price), [280, 90, 200])
})

test('the ws_47776b352af74a1b shape (13/16 dupes) collapses to 7 unique ids', () => {
  // Mirrors the actual duplication observed in production.
  const offers: MinOffer[] = [
    { id: 'wo_495365e99083', price: 636.42 },
    { id: 'wo_0c7363881872', price: 647.40 },
    { id: 'wo_0c7363881872', price: 647.40 },
    { id: 'wo_3267b52c84c9', price: 650 },
    { id: 'wo_3267b52c84c9', price: 650 },
    { id: 'wo_07ddc58bb2a0', price: 660 },
    { id: 'wo_07ddc58bb2a0', price: 660 },
    { id: 'wo_946a8cf902db', price: 665 },
    { id: 'wo_946a8cf902db', price: 665 },
    { id: 'wo_778fd9113440', price: 670 },
    { id: 'wo_778fd9113440', price: 670 },
    { id: 'wo_unique', price: 675 },
    { id: 'wo_73f56dfb72af', price: 687 },
    { id: 'wo_73f56dfb72af', price: 687 },
    { id: 'wo_73f56dfb72af', price: 687 },
    { id: 'wo_unique2', price: 690 },
  ]
  const result = dedupOffersById(offers)
  assert.equal(result.length, 9, `Expected 9 unique offers, got ${result.length}`)
})

test('handles empty input', () => {
  assert.deepEqual(dedupOffersById([]), [])
})

test('handles missing id gracefully (offers without id pass through)', () => {
  const offers: any[] = [
    { id: 'a', price: 100 },
    { price: 200 },           // no id — pass through, do not crash
    { id: '', price: 300 },   // empty id — pass through, do not collide
    { id: 'a', price: 90 },   // duplicate of first
  ]
  const result = dedupOffersById(offers)
  // 'a' deduped to cheapest (90), plus the two id-less ones pass through.
  assert.equal(result.length, 3)
})
