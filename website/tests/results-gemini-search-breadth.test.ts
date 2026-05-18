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

test('Gemini rank prompt gets scanned deal breadth context without forcing a stock line', () => {
  const panelSource = readSource('app/results/[searchId]/ResultsPanel.tsx')
  const routeSource = readSource('app/api/rank/route.ts')

  assert.match(panelSource, /scannedDealsCount: allOffers\.length,/)
  assert.match(routeSource, /scannedDealsCount\?: number/)
  assert.match(routeSource, /const scannedDealsCount = typeof body\.scannedDealsCount === 'number' && Number\.isFinite\(body\.scannedDealsCount\)/)
  assert.match(routeSource, /SEARCH BREADTH:/)
  assert.match(routeSource, /matching deals so far, and more may still arrive/)
  assert.match(routeSource, /On final copy, prefer weaving in one short breadth signal when the field was meaningfully large/)
  assert.match(routeSource, /shortlist worth focusing on/)
  assert.match(routeSource, /do NOT rely on one stock tagline such as "worth your time"/i)
})