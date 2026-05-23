/**
 * Source-pattern guard: ensures the /api/results/[searchId] GET handler
 * keeps its cache-first read and cache-on-completion write wired up.
 *
 * Origin: ws_47776b352af74a1b reload-instability on 2026-05-23. Without
 * the cache-first read, FSW state expiry / Cloud Run instance churn
 * silently mutates the offer set between reloads. This test fails loudly
 * if either side of the wiring gets accidentally removed.
 *
 * Mirrors the source-assertion pattern from results-expired-cache-state.test.ts.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url))
const ROUTE_PATH = path.resolve(TEST_DIR, '..', 'app/results/[searchId]'.replace('/', path.sep), '..', '..', 'api', 'results', '[searchId]', 'route.ts')

function readSource(): string {
  return fs.readFileSync(ROUTE_PATH, 'utf8')
}

test('route imports the durable search cache client', () => {
  const source = readSource()
  assert.match(source, /from '\.\.\/\.\.\/\.\.\/\.\.\/lib\/durable-search-cache'/,
    'route.ts must import getDurableSearchResult/putDurableSearchResult from lib/durable-search-cache')
  assert.match(source, /getDurableSearchResult/, 'getDurableSearchResult must be imported')
  assert.match(source, /putDurableSearchResult/, 'putDurableSearchResult must be imported')
})

test('route reads durable cache BEFORE polling FSW for ws_ searches', () => {
  const source = readSource()
  const cacheReadIdx = source.indexOf('await getDurableSearchResult(searchId)')
  const fswPollIdx = source.indexOf('`${FSW_URL}/web-status/${searchId}`')
  assert.ok(cacheReadIdx > 0, 'route must call getDurableSearchResult(searchId)')
  assert.ok(fswPollIdx > 0, 'route must still poll FSW')
  assert.ok(cacheReadIdx < fswPollIdx,
    'getDurableSearchResult call must appear BEFORE the FSW poll fetch so a cache hit short-circuits')
})

test('route returns immediately on cache hit when status is completed', () => {
  const source = readSource()
  // Looking for: if (durable && durable.status === 'completed') { ... return NextResponse.json(durable | {...durable, ...}) }
  // The route may wrap `durable` to re-apply validation rules to cached
  // payloads (so cache entries written before a rule change get the
  // current quality tags), but it must still short-circuit on a hit
  // rather than falling through to the FSW poll.
  assert.match(
    source,
    /durable.*status === 'completed'[\s\S]{0,2000}return NextResponse\.json\((?:durable|\{\s*\.\.\.durable)/,
    'route must return early when durable cache returns a completed result',
  )
})

test('route writes to durable cache when FSW reports status=completed', () => {
  const source = readSource()
  // The write should sit adjacent to the existing cacheCompletedSearchResult call.
  assert.match(source, /putDurableSearchResult\(result\.search_id, result\)/,
    'route must mirror completed results to the durable cache')
})

test('route AWAITS the durable cache write (not fire-and-forget)', () => {
  const source = readSource()
  // Origin: if the write is fire-and-forget and the first write fails, no
  // future request retries — each finds an empty cache, polls FSW, writes a
  // *different* snapshot, reintroducing the original instability bug.
  assert.match(
    source,
    /await putDurableSearchResult\(result\.search_id, result\)/,
    'putDurableSearchResult must be awaited so a failed first write surfaces, not silently dropped',
  )
  assert.doesNotMatch(
    source,
    /void putDurableSearchResult/,
    'fire-and-forget would silently fail the very recovery this cache exists for',
  )
})

test('route does NOT write probe-mode searches to durable cache', () => {
  const source = readSource()
  // Probe traffic is for testing — keep it out of the prod Firestore collection.
  assert.match(
    source,
    /if \(!isProbeSearch\)[\s\S]{0,80}await putDurableSearchResult/,
    'probe-mode searches must skip the durable cache write',
  )
})
