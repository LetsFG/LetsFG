import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildFallbackSearchShareSummaryFromLabels,
  extractShareLabelsFromQuery,
} from '../app/results/[searchId]/search-share-model.ts'
import {
  extractShareLabelsFromResultsPathname,
  isPublicShareAssetPath,
  normalizeShareLabelParam,
} from '../lib/share-preview.ts'

test('extractShareLabelsFromResultsPathname parses slugged results URLs', () => {
  assert.deepEqual(
    extractShareLabelsFromResultsPathname(
      '/results/ws_123/zurich-to-tokyo-narita-next-month-travelling-solo-round-trip',
      'ws_123',
    ),
    { fromLabel: 'Zurich', toLabel: 'Tokyo Narita' },
  )

  assert.deepEqual(
    extractShareLabelsFromResultsPathname('/results/ws_456/paris-to-new-york', 'ws_456'),
    { fromLabel: 'Paris', toLabel: 'New York' },
  )
})

test('public share asset detection covers OG image routes only', () => {
  assert.equal(isPublicShareAssetPath('/api/og/results/ws_123'), true)
  assert.equal(isPublicShareAssetPath('/results/ws_123/opengraph-image'), true)
  assert.equal(isPublicShareAssetPath('/results/ws_123/twitter-image'), true)
  assert.equal(isPublicShareAssetPath('/results/ws_123/paris-to-new-york'), false)
})

test('fallback share summaries preserve route labels and offers count', () => {
  const summary = buildFallbackSearchShareSummaryFromLabels('London Heathrow', 'Tokyo Narita', 401)

  assert.equal(summary.routeLabel, 'London → Tokyo')
  assert.equal(summary.offersMetric.value, '401')
  assert.match(summary.description, /401 offers analyzed/i)
})

test('query fallback resolves IATA codes into readable labels', () => {
  assert.deepEqual(
    extractShareLabelsFromQuery('LHR NRT 2026 06 01'),
    { fromLabel: 'London', toLabel: 'Tokyo' },
  )

  assert.deepEqual(
    extractShareLabelsFromQuery('lhr to nrt next month'),
    { fromLabel: 'London', toLabel: 'Tokyo' },
  )
})

test('share label params are normalized', () => {
  assert.equal(normalizeShareLabelParam('  Tokyo Narita  '), 'Tokyo Narita')
  assert.equal(normalizeShareLabelParam('   '), null)
})