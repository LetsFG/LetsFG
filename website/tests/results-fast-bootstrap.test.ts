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

test('results page falls back to a searching shell when the initial snapshot fetch is slow', () => {
  const serverSource = readSource('app/results/[searchId]/search-share-server.ts')
  const pageSource = readSource('app/results/[searchId]/page.tsx')

  assert.match(serverSource, /export const INITIAL_SEARCH_RESULTS_TIMEOUT_MS = 1200/)
  assert.match(serverSource, /export async function getInitialSearchResults\(/)
  assert.match(serverSource, /AbortSignal\.timeout\(timeoutMs\)/)

  assert.match(pageSource, /buildSearchingShell\(searchId, sp\?\.started, sp\?\.q\?\.trim\(\) \|\| ''\)/)
  assert.match(pageSource, /progress: \{ checked: 0, total: 180, found: 0 \}/)
  assert.match(pageSource, /if \(!searchId\.startsWith\('ws_'\) && !searchId\.startsWith\('we_'\)\) \{\s*notFound\(\)/)
})