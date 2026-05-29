/**
 * Tests for /website/lib/flags.ts — Q1 sample rate flag + shouldSample gate.
 *
 * Covers:
 * - shouldSample(1.0) always true
 * - shouldSample(0.0) always false
 * - shouldSample(0.5) statistically ~50%
 * - boundary values (above 1.0, below 0.0) are clamped
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { shouldSample } from '../lib/flags.ts'

test('shouldSample — rate 1.0 always returns true', () => {
  for (let i = 0; i < 20; i++) {
    assert.equal(shouldSample(1.0), true, `iteration ${i} returned false`)
  }
})

test('shouldSample — rate 0.0 always returns false', () => {
  for (let i = 0; i < 20; i++) {
    assert.equal(shouldSample(0.0), false, `iteration ${i} returned true`)
  }
})

test('shouldSample — rate 0.5 returns approximately 50% over many trials', () => {
  let trues = 0
  const N = 2_000
  for (let i = 0; i < N; i++) if (shouldSample(0.5)) trues++
  const pct = trues / N
  // Wide tolerance to prevent flakiness: 35%–65%
  assert.ok(pct >= 0.35 && pct <= 0.65, `expected ~50%, got ${(pct * 100).toFixed(1)}%`)
})

test('shouldSample — rate > 1.0 treated as always-sample', () => {
  for (let i = 0; i < 10; i++) {
    assert.equal(shouldSample(2.0), true)
  }
})

test('shouldSample — rate < 0.0 treated as never-sample', () => {
  for (let i = 0; i < 10; i++) {
    assert.equal(shouldSample(-0.5), false)
  }
})
