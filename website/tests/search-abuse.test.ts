import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  checkSearchAbuse,
  isSearchAbuseTarget,
  type SearchAbuseStore,
} from '../lib/search-abuse'

function makeStore(): SearchAbuseStore {
  return new Map()
}

const ENV = {}  // no overrides — uses defaults (threshold=5, window=10min)

describe('checkSearchAbuse — under threshold', () => {
  it('allows the first 5 searches in a window', () => {
    const store = makeStore()
    const now = 1_000_000
    for (let i = 0; i < 5; i++) {
      const result = checkSearchAbuse(store, 'ip:1.2.3.4', ENV, now + i * 1000)
      assert.equal(result.blocked, false)
    }
  })

  it('blocks on the 6th search (> threshold of 5)', () => {
    const store = makeStore()
    const now = 1_000_000
    for (let i = 0; i < 5; i++) {
      checkSearchAbuse(store, 'ip:1.2.3.4', ENV, now + i * 1000)
    }
    const result = checkSearchAbuse(store, 'ip:1.2.3.4', ENV, now + 5_000)
    assert.equal(result.blocked, true)
    assert.equal(result.strikes, 1)
    assert.ok(result.retryAfterMs! > 0)
  })
})

describe('checkSearchAbuse — block duration escalation', () => {
  it('1st offense blocks for ~30 minutes', () => {
    const store = makeStore()
    const now = 1_000_000
    // 6 calls: block fires on the 6th (i=5) at now+5000
    for (let i = 0; i <= 5; i++) checkSearchAbuse(store, 'ip:1.2.3.4', ENV, now + i * 1000)
    const entry = store.get('ip:1.2.3.4')!
    const triggerTime = now + 5 * 1000
    const remaining = entry.blockedUntil - triggerTime
    assert.ok(remaining >= 30 * 60 * 1000 - 100, `remaining ${remaining} too short`)
    assert.ok(remaining <= 30 * 60 * 1000 + 100, `remaining ${remaining} too long`)
  })

  it('2nd offense blocks for ~6 hours', () => {
    const store = makeStore()
    const now = 1_000_000
    // First offense
    for (let i = 0; i <= 5; i++) checkSearchAbuse(store, 'ip:1.2.3.4', ENV, now + i * 1000)
    // Advance past the 30-min block
    const afterBlock1 = now + 31 * 60 * 1000
    for (let i = 0; i <= 5; i++) checkSearchAbuse(store, 'ip:1.2.3.4', ENV, afterBlock1 + i * 1000)
    const entry = store.get('ip:1.2.3.4')!
    assert.equal(entry.strikes, 2)
    const remaining = entry.blockedUntil - (afterBlock1 + 5000)
    assert.ok(remaining >= 6 * 60 * 60 * 1000 - 1000)
    assert.ok(remaining <= 6 * 60 * 60 * 1000 + 1000)
  })

  it('3rd offense blocks for ~24 hours (max escalation)', () => {
    const store = makeStore()
    const now = 1_000_000
    // Offense 1
    for (let i = 0; i <= 5; i++) checkSearchAbuse(store, 'ip:1.2.3.4', ENV, now + i * 1000)
    // Offense 2
    const t2 = now + 31 * 60 * 1000
    for (let i = 0; i <= 5; i++) checkSearchAbuse(store, 'ip:1.2.3.4', ENV, t2 + i * 1000)
    // Offense 3
    const t3 = t2 + 7 * 60 * 60 * 1000
    for (let i = 0; i <= 5; i++) checkSearchAbuse(store, 'ip:1.2.3.4', ENV, t3 + i * 1000)
    const entry = store.get('ip:1.2.3.4')!
    assert.equal(entry.strikes, 3)
    const remaining = entry.blockedUntil - (t3 + 5000)
    assert.ok(remaining >= 24 * 60 * 60 * 1000 - 1000)
    assert.ok(remaining <= 24 * 60 * 60 * 1000 + 1000)
  })
})

describe('checkSearchAbuse — sliding window', () => {
  it('searches outside the 10-minute window do not count toward threshold', () => {
    const store = makeStore()
    const windowMs = 10 * 60 * 1000
    const now = 1_000_000
    // 5 searches spread over 15 minutes — only the last 3 fall within any 10-min window
    for (let i = 0; i < 5; i++) {
      checkSearchAbuse(store, 'ip:1.2.3.4', ENV, now + i * 3 * 60 * 1000)
    }
    // At now+12min, the first two (t=0, t=3min) are outside the window
    const laterNow = now + 12 * 60 * 1000
    const result = checkSearchAbuse(store, 'ip:1.2.3.4', ENV, laterNow)
    assert.equal(result.blocked, false, 'should not be blocked — old searches expired')
  })

  it('rapid burst within window triggers block', () => {
    const store = makeStore()
    const now = 1_000_000
    for (let i = 0; i < 5; i++) checkSearchAbuse(store, 'ip:1.2.3.4', ENV, now + i * 100)
    const result = checkSearchAbuse(store, 'ip:1.2.3.4', ENV, now + 500)
    assert.equal(result.blocked, true)
  })
})

describe('checkSearchAbuse — while blocked', () => {
  it('subsequent requests while blocked do not advance strike count', () => {
    const store = makeStore()
    const now = 1_000_000
    // Trigger first block
    for (let i = 0; i <= 5; i++) checkSearchAbuse(store, 'ip:1.2.3.4', ENV, now + i * 100)
    // Hammer while blocked
    for (let i = 0; i < 20; i++) checkSearchAbuse(store, 'ip:1.2.3.4', ENV, now + 1000 + i * 1000)
    const entry = store.get('ip:1.2.3.4')!
    assert.equal(entry.strikes, 1, 'strikes must not increase during block period')
  })

  it('returns blocked=true with retryAfterMs while blocked', () => {
    const store = makeStore()
    const now = 1_000_000
    for (let i = 0; i <= 5; i++) checkSearchAbuse(store, 'ip:1.2.3.4', ENV, now + i * 100)
    const result = checkSearchAbuse(store, 'ip:1.2.3.4', ENV, now + 2000)
    assert.equal(result.blocked, true)
    assert.ok(result.retryAfterMs! > 0)
  })
})

describe('checkSearchAbuse — client isolation', () => {
  it('two clients are tracked independently', () => {
    const store = makeStore()
    const now = 1_000_000
    for (let i = 0; i <= 5; i++) checkSearchAbuse(store, 'ip:10.0.0.1', ENV, now + i * 100)
    const result = checkSearchAbuse(store, 'ip:10.0.0.2', ENV, now + 600)
    assert.equal(result.blocked, false, 'unrelated client must not be blocked')
  })
})

describe('checkSearchAbuse — env overrides', () => {
  it('respects LETSFG_SEARCH_ABUSE_THRESHOLD override', () => {
    const store = makeStore()
    const env = { LETSFG_SEARCH_ABUSE_THRESHOLD: '2' }
    const now = 1_000_000
    checkSearchAbuse(store, 'ip:1.2.3.4', env, now)
    checkSearchAbuse(store, 'ip:1.2.3.4', env, now + 100)
    const result = checkSearchAbuse(store, 'ip:1.2.3.4', env, now + 200)
    assert.equal(result.blocked, true, 'should block after > 2 searches with custom threshold')
  })
})

describe('isSearchAbuseTarget', () => {
  it('targets /api/search', () => {
    assert.equal(isSearchAbuseTarget('/api/search', new URLSearchParams()), true)
  })

  it('targets /results only when ?q= is present', () => {
    assert.equal(isSearchAbuseTarget('/results', new URLSearchParams('q=POA-CUN')), true)
    assert.equal(isSearchAbuseTarget('/results', new URLSearchParams()), false)
  })

  it('does not target polling paths', () => {
    assert.equal(isSearchAbuseTarget('/api/results/ws_abc123', new URLSearchParams()), false)
    assert.equal(isSearchAbuseTarget('/results/ws_abc123', new URLSearchParams()), false)
    assert.equal(isSearchAbuseTarget('/api/rank', new URLSearchParams()), false)
  })
})
