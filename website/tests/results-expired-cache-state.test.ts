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

test('searching pages do not promote browser-cached completed results to completed state', () => {
  const source = readSource('app/results/[searchId]/SearchPageClient.tsx')

  assert.match(
    source,
    /useEffect\(\(\) => \{[\s\S]*if \(initialStatus !== 'searching'\) return[\s\S]*readBrowserCachedResults<FlightOffer>\(searchId\)/,
  )

  assert.doesNotMatch(
    source,
    /if \(cached\?\.status === 'completed'[\s\S]*setStatus\('completed'\)/,
  )
})

test('search results client deduplicates offers by instance key instead of raw id', () => {
  const source = readSource('app/results/[searchId]/SearchPageClient.tsx')

  assert.match(
    source,
    /new Map\(offers\.map\(\(offer\) => \[getOfferInstanceKey\(offer\), offer\]\)\)/,
  )

  assert.match(
    source,
    /knownOfferIdsRef = useRef<Set<string>>\(new Set\(initialOffers\.map\(\(offer\) => getOfferInstanceKey\(offer\)\)\)\)/,
  )
})

test('completed results page preserves distinct offers when upstream ids collide', () => {
  const source = readSource('app/results/[searchId]/page.tsx')

  assert.match(
    source,
    /new Map\(\(offers \|\| \[\]\)\.map\(\(offer\) => \[getOfferInstanceKey\(offer\), offer\]\)\)\.values\(\)/,
  )

  assert.doesNotMatch(
    source,
    /new Map\(\(offers \|\| \[\]\)\.map\(o => \[o\.id, o\]\)\)\.values\(\)/,
  )
})