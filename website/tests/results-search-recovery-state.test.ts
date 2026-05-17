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

test('active results URLs keep recent search context while the search is still running', () => {
  const source = readSource('app/results/[searchId]/SearchPageClient.tsx')

  assert.match(source, /function normalizeStartedAtParam\(/)
  assert.match(source, /if \(\/\^\\d\+\$\/\.test\(value\)\) \{\s*const numeric = Number\.parseInt\(value, 10\)/s)
  assert.match(source, /if \(startedAt\) \{\s*params\.set\('started', startedAt\)\s*\}/s)
  assert.match(source, /if \(preserveQuery\) \{\s*params\.set\('q', query\)\s*\}/s)
  assert.match(source, /startedAt: status === 'searching' \? normalizeStartedAtParam\(searchedAt\) : undefined,/) 
  assert.match(source, /preserveQuery: status === 'searching',/)
  assert.match(source, /if \(startedParam\) params\.set\('started', startedParam\)/)
  assert.match(source, /if \(query\) params\.set\('q', query\)/)
})

test('results API recovers fresh searches as searching instead of expiring them', () => {
  const source = readSource('app/api/results/[searchId]/route.ts')

  assert.match(source, /ACTIVE_SEARCH_RECOVERY_WINDOW_MS = 15 \* 60 \* 1000/)
  assert.match(source, /if \(\/\^\\d\+\$\/\.test\(value\)\) \{\s*const numeric = Number\.parseInt\(value, 10\)/s)
  assert.match(source, /function isRecoverableActiveSearch\(/)
  assert.match(source, /function buildRecoveringSearchResult\(/)
  assert.match(source, /status: 'searching' as const/)
  assert.match(source, /if \(isRecoverableActiveSearch\(started, meta\)\) \{\s*return NextResponse\.json\(buildRecoveringSearchResult\(searchId, query, started, meta\)\)\s*\}/s)
})