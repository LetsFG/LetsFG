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

test('home search form merges Gemini trip_purposes and uses normalized purpose presence for convo gating', () => {
  const source = readSource('app/home-search-form.tsx')

  assert.match(source, /import \{ applyVertexIntent \} from '\.\/lib\/vertex-intent'/)
  assert.match(source, /normalizeTripPurposes/)
  assert.match(source, /trip_purposes\?: TripPurpose\[\] \| null/)
  assert.doesNotMatch(source, /const needsGeminiAssist =/)
  assert.match(source, /await fetch\('\/api\/parse-query'/)
  assert.match(source, /const appliedAi = applyVertexIntent\(base, ai, base\.adults \|\| 1\)/)
  assert.match(source, /const mergedTripPurposes = normalizeTripPurposes\(/)
  assert.match(source, /base\.trip_purposes = mergedTripPurposes/)
  assert.match(source, /const hasTripPurpose = normalizeTripPurposes\(\{ tripPurpose: _nlp\?\.trip_purpose, tripPurposes: _nlp\?\.trip_purposes \}\)\.length > 0/)
})