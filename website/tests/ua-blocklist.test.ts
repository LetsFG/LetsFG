import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getBlockedUserAgentSubstrings,
  isBlockedUserAgent,
} from '../lib/ua-blocklist.ts'

test('with no env var, nothing is blocked', () => {
  assert.equal(isBlockedUserAgent('any-bot/1.0', {}), false)
  assert.equal(isBlockedUserAgent('Mozilla/5.0', {}), false)
  assert.equal(isBlockedUserAgent(null, {}), false)
  assert.equal(isBlockedUserAgent('', {}), false)
  assert.deepEqual(getBlockedUserAgentSubstrings({}), [])
})

test('env-supplied needles match as case-insensitive substrings', () => {
  const env = { LETSFG_BLOCKED_USER_AGENTS: 'needle-one, NeedleTwo/2' }
  assert.equal(isBlockedUserAgent('needle-one/1.0', env), true)
  assert.equal(isBlockedUserAgent('SomeApp NEEDLE-ONE x', env), true)
  assert.equal(isBlockedUserAgent('also-needletwo/2-variant', env), true)
  assert.equal(isBlockedUserAgent('unrelated/agent', env), false)
})

test('empty / whitespace-only env entries are ignored', () => {
  assert.deepEqual(getBlockedUserAgentSubstrings({ LETSFG_BLOCKED_USER_AGENTS: '' }), [])
  assert.deepEqual(getBlockedUserAgentSubstrings({ LETSFG_BLOCKED_USER_AGENTS: ' , ,' }), [])
  const env = { LETSFG_BLOCKED_USER_AGENTS: ' real-needle , ,extra ' }
  assert.deepEqual(getBlockedUserAgentSubstrings(env), ['real-needle', 'extra'])
})

test('legitimate user agents pass through even with an active blocklist', () => {
  const env = { LETSFG_BLOCKED_USER_AGENTS: 'some-needle' }
  assert.equal(
    isBlockedUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
      env,
    ),
    false,
  )
  assert.equal(isBlockedUserAgent('curl/8.4.0', env), false)
})
