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

test('results client hydrates cached Gemini from poll responses and forwards display currency', () => {
  const source = readSource('app/results/[searchId]/SearchPageClient.tsx')

  assert.match(source, /const \[cachedGemini, setCachedGemini\] = useState\(initialGeminiProp\)/)
  assert.match(source, /if \(displayCurrency\) params\.set\('cur', displayCurrency\)/)
  assert.match(source, /if \(data\.gemini_justification && typeof data\.gemini_justification === 'object'\) \{\s*setCachedGemini\(data\.gemini_justification as SearchPageClientProps\['initialGemini'\]\)\s*\}/s)
  assert.match(source, /initialGemini=\{cachedGemini\}/)
})

test('cached Gemini reuse is currency-aware across server and client paths', () => {
  const panelSource = readSource('app/results/[searchId]/ResultsPanel.tsx')
  const resultsRouteSource = readSource('app/api/results/[searchId]/route.ts')
  const cacheSource = readSource('lib/results-cache.ts')
  const rankSource = readSource('app/api/rank/route.ts')
  const serverSource = readSource('app/results/[searchId]/search-share-server.ts')
  const pageSource = readSource('app/results/[searchId]/page.tsx')

  assert.match(panelSource, /display_currency\?: string/)
  assert.match(panelSource, /restoreGeminiPayload\(initialGemini, locale, currency\)/)
  assert.match(panelSource, /display_currency: currency/)
  assert.match(resultsRouteSource, /const requestedDisplayCurrency = request\.nextUrl\.searchParams\.get\('cur'\)/)
  assert.match(resultsRouteSource, /selectCachedGeminiForCurrency\(cachedResult, requestedDisplayCurrency\)/)
  assert.match(cacheSource, /display_currency\?: string/)
  assert.match(cacheSource, /display_currency: normalizedDisplayCurrency/)
  assert.match(rankSource, /updateGeminiJustification\(searchId, result, locale, displayCurrency\)/)
  assert.match(serverSource, /if \(displayCurrency\) url\.searchParams\.set\('cur', displayCurrency\)/)
  assert.match(pageSource, /getInitialSearchResults\(searchId, isProbe, sp\?\._fss, initialCurrency\)/)
})