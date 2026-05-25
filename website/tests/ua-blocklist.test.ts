import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getBlockedUserAgentSubstrings,
  isBlockedUserAgent,
} from '../lib/ua-blocklist.ts'

test('default list blocks the known passagens-monitor abuser', () => {
  assert.equal(isBlockedUserAgent('passagens-monitor/0.2', {}), true)
  assert.equal(isBlockedUserAgent('PASSAGENS-MONITOR/1.0', {}), true)
})

test('legitimate user agents pass through', () => {
  assert.equal(
    isBlockedUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
      {},
    ),
    false,
  )
  assert.equal(isBlockedUserAgent('curl/8.4.0', {}), false)
  assert.equal(isBlockedUserAgent(null, {}), false)
  assert.equal(isBlockedUserAgent('', {}), false)
})

test('env overrides extend the denylist without a deploy', () => {
  const env = { LETSFG_BLOCKED_USER_AGENTS: 'badbot, OtherBot/2' }
  assert.equal(isBlockedUserAgent('badbot/1.0', env), true)
  assert.equal(isBlockedUserAgent('Some-OtherBot/2', env), true)
  assert.equal(isBlockedUserAgent('GoodAgent/1', env), false)
  const list = getBlockedUserAgentSubstrings(env)
  assert.ok(list.includes('passagens-monitor'))
  assert.ok(list.includes('badbot'))
  assert.ok(list.includes('otherbot/2'))
})

test('empty env value does not break the default list', () => {
  assert.equal(
    isBlockedUserAgent('passagens-monitor/0.2', { LETSFG_BLOCKED_USER_AGENTS: '' }),
    true,
  )
})
