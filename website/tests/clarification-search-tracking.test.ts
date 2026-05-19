import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { buildClarificationSearchSessionPayload } from '../lib/search-session-analytics.ts'

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url))
const WEBSITE_ROOT = path.resolve(TEST_DIR, '..')

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(WEBSITE_ROOT, relativePath), 'utf8')
}

test('buildClarificationSearchSessionPayload stamps a blocked attempt without worker-search metrics', () => {
  const payload = buildClarificationSearchSessionPayload({
    query: 'from Fort myers to RSW, September 30',
    origin: 'RSW',
    origin_name: 'Fort Myers',
    date_from: '2026-09-30',
    adults: 1,
    currency: 'EUR',
    source: 'website-home-form',
    source_path: '/en',
    follow_up_topics: ['destination', 'date'],
    missing_origin: false,
    missing_destination: true,
    needs_date_clarification: false,
    same_route: true,
  })

  assert.match(payload.search_id, /^clarify:/)
  assert.equal(payload.status, 'clarification_required')
  assert.equal(payload.decision, 'clarification_required')
  assert.equal(payload.results_count, 0)
  assert.equal(payload.cost_per_search, 0)
  assert.equal(payload.event?.type, 'clarification_required')
  assert.deepEqual(payload.event?.data, {
    follow_up_topics: ['destination', 'date'],
    missing_origin: false,
    missing_destination: true,
    needs_date_clarification: false,
    same_route: true,
  })
})

test('home search form records clarification-required submits before opening the follow-up convo', () => {
  const source = readSource('app/home-search-form.tsx')

  assert.doesNotMatch(source, /const needsLaunchClarification = !isSearchLaunchReady\(trimmed, _nlp\)/)
  assert.match(source, /const aiFollowUpPlanPromise = fetch\('\/api\/parse-query'/)
  assert.doesNotMatch(source, /parseNLQuery\(trimmed\)/)
  assert.match(source, /trackSearchSession\(buildClarificationSearchSessionPayload\(/)
  assert.match(source, /source: window\.location\.pathname\.includes\('\/results'\) \? 'website-results-form' : 'website-home-form'/)
})

test('home search hands pre-fired launches to the pending results route without blocking the submit navigation', () => {
  const source = readSource('app/home-search-form.tsx')

  assert.match(source, /const prefiredSearchGenerationRef = useRef\(0\)/)
  assert.match(source, /launchPrefiredSearch\(partialQuery\)/)
  assert.match(source, /launchPrefiredSearch\(trimmed\)/)
  assert.match(source, /createClientSearchHandoffToken/)
  assert.match(source, /startClientSearchHandoff\(handoffToken, \{/)
  assert.match(source, /router\.prefetch\('\/results\/pending'\)/)
  assert.doesNotMatch(source, /await awaitPrefiredSearch\(\)/)
  assert.match(source, /\/results\/pending\?\$\{params\.toString\(\)\}/)
})

test('/api/search records clarification-required attempts before returning 422', () => {
  const source = readSource('app/api/search/route.ts')

  assert.match(source, /await upsertSearchSessionServer\(buildClarificationSearchSessionPayload\(/)
  assert.match(source, /status: 'clarification_required'/)
  assert.match(source, /follow_up_topics: followUpTopics/)
  assert.match(source, /if \(aiFollowUpTopics\.length > 0\) \{/) 
  assert.match(source, /follow_up_questions: aiFollowUpQuestions/)
})
