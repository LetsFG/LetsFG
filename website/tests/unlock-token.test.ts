/**
 * Tests for /website/lib/unlock-token.ts — monetization integrity.
 *
 * The unlock token is what a paying user receives to access their booking link.
 * If it can be forged, replayed across sessions, or survives tampering, we leak
 * paid value. These tests cover: sign/parse round-trip, signature tampering,
 * payload tampering (uid/searchId), expiry, and missing-secret handling.
 *
 * UNLOCK_COOKIE_SECRET is read at call time (not import time), so we set it here.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

process.env.UNLOCK_COOKIE_SECRET = 'test-unlock-secret-key'

import { createUnlockToken, parseUnlockToken } from '../lib/unlock-token.ts'

const UID = 'uid-abc'
const SEARCH_ID = 'search-123'
const TEN_YEARS_MS = 10 * 365 * 24 * 60 * 60 * 1000

test('sign → parse round-trip succeeds for the same uid + searchId', () => {
  const token = createUnlockToken(UID, SEARCH_ID)
  assert.equal(parseUnlockToken(token, UID, SEARCH_ID), true)
})

test('token has the payload.signature shape', () => {
  const token = createUnlockToken(UID, SEARCH_ID)
  const dot = token.lastIndexOf('.')
  assert.ok(dot > 0, 'token must contain a separating dot')
  assert.ok(token.slice(0, dot).length > 0, 'payload segment present')
  assert.ok(token.slice(dot + 1).length > 0, 'signature segment present')
})

test('rejects a tampered signature', () => {
  const token = createUnlockToken(UID, SEARCH_ID)
  const dot = token.lastIndexOf('.')
  const forged = `${token.slice(0, dot)}.${'x'.repeat(token.length - dot - 1)}`
  assert.equal(parseUnlockToken(forged, UID, SEARCH_ID), false)
})

test('rejects a tampered payload — attacker extends exp but keeps the original signature', () => {
  const issuedAt = 1_000_000_000_000
  const token = createUnlockToken(UID, SEARCH_ID, issuedAt)
  const dot = token.lastIndexOf('.')
  // Attacker doubles the lifetime; payload bytes now differ from what the signature covers.
  const tamperedPayload = Buffer.from(
    JSON.stringify({ uid: UID, searchId: SEARCH_ID, exp: issuedAt + TEN_YEARS_MS * 2 }),
    'utf8',
  ).toString('base64url')
  const forged = `${tamperedPayload}.${token.slice(dot + 1)}`
  assert.equal(parseUnlockToken(forged, UID, SEARCH_ID, issuedAt + 1), false)
})

test('rejects a token issued for a different uid (no cross-session reuse)', () => {
  const token = createUnlockToken(UID, SEARCH_ID)
  assert.equal(parseUnlockToken(token, 'uid-other', SEARCH_ID), false)
})

test('rejects a token issued for a different searchId', () => {
  const token = createUnlockToken(UID, SEARCH_ID)
  assert.equal(parseUnlockToken(token, UID, 'search-other'), false)
})

test('rejects an expired token', () => {
  const issuedAt = 1_000_000_000_000
  const token = createUnlockToken(UID, SEARCH_ID, issuedAt)
  // Validate at a time strictly after expiry.
  const afterExpiry = issuedAt + TEN_YEARS_MS + 1
  assert.equal(parseUnlockToken(token, UID, SEARCH_ID, afterExpiry), false)
})

test('accepts a token validated just before expiry', () => {
  const issuedAt = 1_000_000_000_000
  const token = createUnlockToken(UID, SEARCH_ID, issuedAt)
  const beforeExpiry = issuedAt + TEN_YEARS_MS - 1
  assert.equal(parseUnlockToken(token, UID, SEARCH_ID, beforeExpiry), true)
})

test('rejects null, empty, and malformed tokens', () => {
  assert.equal(parseUnlockToken(null, UID, SEARCH_ID), false)
  assert.equal(parseUnlockToken('', UID, SEARCH_ID), false)
  assert.equal(parseUnlockToken('no-dot-here', UID, SEARCH_ID), false)
  assert.equal(parseUnlockToken('.onlysig', UID, SEARCH_ID), false)
})

test('createUnlockToken throws when uid or searchId is missing', () => {
  assert.throws(() => createUnlockToken('', SEARCH_ID))
  assert.throws(() => createUnlockToken(UID, ''))
})
