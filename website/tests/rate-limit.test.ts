import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildRateLimitClientKey,
  checkRateLimit,
  checkRouteBurst,
  createRateLimitStore,
  createRouteBurstStore,
  getRateLimitPolicy,
  getRouteBurstPolicy,
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

test('route-burst blocks N+ distinct destinations from same origin in window', () => {
  // Reproduces the 2026-05-24 POA spam pattern: one client firing POA→{many} in seconds.
  const store = createRouteBurstStore()
  const policy = { windowMs: 60_000, maxDestinations: 5 }

  const dests = ['MIA', 'JFK', 'MCO', 'LIS', 'MAD']
  const allowed = dests.map((dest, i) =>
    checkRouteBurst(store, 'ip:1.2.3.4', 'POA', dest, policy, 1_000 + i * 1_000),
  )
  for (const d of allowed) assert.equal(d.allowed, true)
  assert.equal(allowed.at(-1)!.distinctDestinations, 5)

  const sixth = checkRouteBurst(store, 'ip:1.2.3.4', 'POA', 'YYZ', policy, 6_000)
  assert.equal(sixth.allowed, false)
  assert.equal(sixth.distinctDestinations, 6)
  assert.ok(sixth.retryAfterMs >= 1_000)
})

test('route-burst resets when window expires', () => {
  const store = createRouteBurstStore()
  const policy = { windowMs: 60_000, maxDestinations: 2 }

  checkRouteBurst(store, 'ip:1.2.3.4', 'POA', 'MIA', policy, 0)
  checkRouteBurst(store, 'ip:1.2.3.4', 'POA', 'JFK', policy, 1_000)
  const blocked = checkRouteBurst(store, 'ip:1.2.3.4', 'POA', 'LIS', policy, 2_000)
  assert.equal(blocked.allowed, false)

  // After the window elapses the bucket resets and a new burst starts fresh.
  const afterWindow = checkRouteBurst(store, 'ip:1.2.3.4', 'POA', 'MAD', policy, 80_000)
  assert.equal(afterWindow.allowed, true)
  assert.equal(afterWindow.distinctDestinations, 1)
})

test('route-burst does not penalize same destination repeated', () => {
  // Legitimate retry/refresh on one route should never count as breadth.
  const store = createRouteBurstStore()
  const policy = { windowMs: 60_000, maxDestinations: 3 }

  for (let i = 0; i < 10; i++) {
    const d = checkRouteBurst(store, 'ip:1.2.3.4', 'LHR', 'JFK', policy, i * 500)
    assert.equal(d.allowed, true)
    assert.equal(d.distinctDestinations, 1)
  }
})

test('route-burst resets when client switches origin', () => {
  // A user exploring from LHR after exhausting POA-based picks is not the spam pattern.
  const store = createRouteBurstStore()
  const policy = { windowMs: 60_000, maxDestinations: 2 }

  checkRouteBurst(store, 'ip:1.2.3.4', 'POA', 'MIA', policy, 0)
  checkRouteBurst(store, 'ip:1.2.3.4', 'POA', 'JFK', policy, 1_000)
  const newOrigin = checkRouteBurst(store, 'ip:1.2.3.4', 'LHR', 'JFK', policy, 2_000)
  assert.equal(newOrigin.allowed, true)
  assert.equal(newOrigin.origin, 'LHR')
  assert.equal(newOrigin.distinctDestinations, 1)
})

test('default route-burst policy targets the observed POA-spam shape', () => {
  const policy = getRouteBurstPolicy({})
  assert.equal(policy.maxDestinations, 5)
  assert.equal(policy.windowMs, 60_000)
})