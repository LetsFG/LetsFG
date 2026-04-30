import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildRateLimitClientKey,
  checkRateLimit,
  createRateLimitStore,
  getRateLimitPolicy,
} from '../lib/rate-limit.ts'

test('search creation is throttled more tightly than results polling', () => {
  const searchPolicy = getRateLimitPolicy('/api/search')
  const resultsPolicy = getRateLimitPolicy('/api/results/ws_123')
  const webhookPolicy = getRateLimitPolicy('/api/checkout/webhook')

  assert.ok(searchPolicy)
  assert.ok(resultsPolicy)
  assert.equal(webhookPolicy, null)
  assert.ok(searchPolicy.capacity < resultsPolicy.capacity)
  assert.ok(searchPolicy.refillPerMinute < resultsPolicy.refillPerMinute)
})

test('token bucket blocks bursts and refills over time', () => {
  const store = createRateLimitStore()
  const policy = { name: 'test', capacity: 2, refillPerMinute: 60 }

  const first = checkRateLimit(store, 'client-a', policy, 0)
  const second = checkRateLimit(store, 'client-a', policy, 10)
  const denied = checkRateLimit(store, 'client-a', policy, 20)
  const allowedAgain = checkRateLimit(store, 'client-a', policy, 1_020)

  assert.equal(first.allowed, true)
  assert.equal(first.remaining, 1)
  assert.equal(second.allowed, true)
  assert.equal(second.remaining, 0)
  assert.equal(denied.allowed, false)
  assert.ok(denied.retryAfterMs >= 900)
  assert.equal(allowedAgain.allowed, true)
})

test('client keys prefer forwarded IPs and fall back to session IDs', () => {
  const forwardedHeaders = new Headers({
    'x-forwarded-for': '203.0.113.7, 10.0.0.8',
  })
  const anonymousHeaders = new Headers()

  assert.equal(buildRateLimitClientKey(forwardedHeaders, 'session-1'), 'ip:203.0.113.7')
  assert.equal(buildRateLimitClientKey(anonymousHeaders, 'session-1'), 'sid:session-1')
})