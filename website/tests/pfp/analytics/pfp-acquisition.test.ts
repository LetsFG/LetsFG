import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildAcquisitionSearchPayload,
  parsePfpSourceFromReferrer,
  PFP_ACQUISITION_COOKIE,
} from '../../../lib/pfp/analytics/pfp-acquisition.ts'

// ─── parsePfpSourceFromReferrer ───────────────────────────────────────────────

test('parsePfpSourceFromReferrer: detects PFP referrer', () => {
  const result = parsePfpSourceFromReferrer('/en/flights/gdn-bcn/')
  assert.equal(result?.source, 'pfp_organic')
  assert.equal(result?.route, 'gdn-bcn')
})

test('parsePfpSourceFromReferrer: handles locale variants', () => {
  const result = parsePfpSourceFromReferrer('/pl/flights/waw-lon/')
  assert.equal(result?.source, 'pfp_organic')
  assert.equal(result?.route, 'waw-lon')
})

test('parsePfpSourceFromReferrer: returns null for non-PFP path', () => {
  assert.equal(parsePfpSourceFromReferrer('/'), null)
  assert.equal(parsePfpSourceFromReferrer('/results/ws_123'), null)
  assert.equal(parsePfpSourceFromReferrer('/developers'), null)
})

test('parsePfpSourceFromReferrer: handles full URL (not just path)', () => {
  const result = parsePfpSourceFromReferrer('https://letsfg.co/en/flights/gdn-bcn/')
  assert.equal(result?.source, 'pfp_organic')
  assert.equal(result?.route, 'gdn-bcn')
})

test('parsePfpSourceFromReferrer: returns null for empty string', () => {
  assert.equal(parsePfpSourceFromReferrer(''), null)
})

// ─── buildAcquisitionSearchPayload ───────────────────────────────────────────

test('buildAcquisitionSearchPayload: attaches pfp source fields', () => {
  const payload = buildAcquisitionSearchPayload({ route: 'gdn-bcn', source: 'pfp_organic' })
  assert.equal(payload.acquisition_source, 'pfp_organic')
  assert.equal(payload.acquisition_route, 'gdn-bcn')
  assert.equal(payload.acquisition_channel, 'pfp')
})

test('buildAcquisitionSearchPayload: null input returns empty object', () => {
  const payload = buildAcquisitionSearchPayload(null)
  assert.equal(Object.keys(payload).length, 0)
})

// ─── PFP_ACQUISITION_COOKIE constant ─────────────────────────────────────────

test('PFP_ACQUISITION_COOKIE: is a non-empty string', () => {
  assert.ok(typeof PFP_ACQUISITION_COOKIE === 'string')
  assert.ok(PFP_ACQUISITION_COOKIE.length > 0)
})
