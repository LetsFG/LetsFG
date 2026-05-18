import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url))
const WEBSITE_ROOT = path.resolve(TEST_DIR, '..')

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(WEBSITE_ROOT, relativePath), 'utf8')
}

test('results client backfills missing context from poll responses after fast bootstrap fallback', () => {
  const source = readSource('app/results/[searchId]/SearchPageClient.tsx')

  assert.match(source, /const \[query, setQuery\] = useState\(initialQuery\)/)
  assert.match(source, /const \[parsed, setParsed\] = useState<ParsedQuery>\(initialParsed\)/)
  assert.match(source, /const \[searchedAt, setSearchedAt\] = useState\(initialSearchedAt\)/)
  assert.match(source, /const \[expiresAt, setExpiresAt\] = useState\(initialExpiresAt\)/)
  assert.match(source, /const nextParsed = data\.parsed && typeof data\.parsed === 'object' \? data\.parsed as Partial<ParsedQuery> : null/)
  assert.match(source, /if \(nextParsed\) \{\s*setParsed\(\(current\) => mergeParsedQuery\(current, nextParsed\)\)\s*\}/s)
  assert.match(source, /const nextQuery = typeof data\.query === 'string' && data\.query\.trim\(\)\.length > 0\s*\? data\.query\.trim\(\)\s*:\s*nextParsed \? buildFallbackResultsQuery\(nextParsed\) : ''/s)
  assert.match(source, /if \(nextQuery\) \{\s*setQuery\(\(current\) => \(current\.trim\(\)\.length > 0 \? current : nextQuery\)\)\s*\}/s)
  assert.match(source, /if \(typeof data\.searched_at === 'string' && data\.searched_at\.trim\(\)\.length > 0\) \{\s*setSearchedAt\(data\.searched_at\)\s*\}/s)
  assert.match(source, /if \(typeof data\.expires_at === 'string' && data\.expires_at\.trim\(\)\.length > 0\) \{\s*setExpiresAt\(data\.expires_at\)\s*\}/s)
})

test('results metadata falls back to neutral live-results copy when the initial snapshot is unavailable', () => {
  const source = readSource('app/results/[searchId]/page.tsx')

  assert.ok(!/: buildMissingSearchShareSummary\(\)/.test(source))
  assert.match(source, /const summary = result\s*\? buildSearchShareSummary\([\s\S]*?\)\s*:\s*null/)
  assert.match(source, /'Flight search results — LetsFG'/)
  assert.match(source, /'Live LetsFG flight search results\. Route details and current fares will load shortly\.'/)
})