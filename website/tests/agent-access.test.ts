import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  generateChallenge,
  validateChallengeSignature,
  issueAgentToken,
  validateAgentToken,
  tweetContainsChallenge,
  extractHandleFromAuthorUrl,
} from '../lib/agent-access'

const ENV = { LETSFG_AGENT_ACCESS_SECRET: 'test-secret-abc123' }

describe('generateChallenge', () => {
  it('returns code, signed, and expiresAt', () => {
    const c = generateChallenge(ENV)
    assert.equal(typeof c.code, 'string')
    assert.equal(typeof c.signed, 'string')
    assert.ok(c.expiresAt > Date.now())
  })

  it('code is 8 chars from safe charset (no ambiguous I/O/0/1)', () => {
    for (let i = 0; i < 20; i++) {
      const { code } = generateChallenge(ENV)
      assert.match(code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/)
    }
  })

  it('generates unique codes', () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateChallenge(ENV).code))
    assert.ok(codes.size > 1)
  })
})

describe('validateChallengeSignature', () => {
  it('validates a freshly generated challenge', () => {
    const { signed } = generateChallenge(ENV)
    const result = validateChallengeSignature(signed, ENV)
    assert.ok(result !== null)
    assert.ok(typeof result?.code === 'string')
    assert.equal(result?.code.length, 8)
  })

  it('validates signed generated at fixed time', () => {
    const now = 1_700_000_000_000
    const { signed, code } = generateChallenge(ENV, now)
    const result = validateChallengeSignature(signed, ENV, now + 1000)
    assert.ok(result !== null)
    assert.equal(result?.code, code)
  })

  it('rejects tampered signature', () => {
    const { signed } = generateChallenge(ENV)
    const [payload, sig] = signed.split('.')
    // Flip first char — first char encodes full 6 bits, always changes decoded bytes
    const badSig = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1)
    assert.equal(validateChallengeSignature(`${payload}.${badSig}`, ENV), null)
  })

  it('rejects tampered payload', () => {
    const { signed } = generateChallenge(ENV)
    const [payload, sig] = signed.split('.')
    const badPayload = payload.slice(0, -1) + (payload.endsWith('A') ? 'B' : 'A')
    assert.equal(validateChallengeSignature(`${badPayload}.${sig}`, ENV), null)
  })

  it('rejects wrong secret', () => {
    const { signed } = generateChallenge(ENV)
    assert.equal(validateChallengeSignature(signed, { LETSFG_AGENT_ACCESS_SECRET: 'wrong' }), null)
  })

  it('rejects expired challenge (>30 min old)', () => {
    const past = Date.now() - 31 * 60 * 1000
    const { signed } = generateChallenge(ENV, past)
    assert.equal(validateChallengeSignature(signed, ENV), null)
  })

  it('rejects malformed values', () => {
    assert.equal(validateChallengeSignature('', ENV), null)
    assert.equal(validateChallengeSignature('nodot', ENV), null)
    assert.equal(validateChallengeSignature('x.y.z.too.many.dots', ENV), null)
  })
})

describe('issueAgentToken + validateAgentToken', () => {
  it('issues and validates a token', () => {
    const token = issueAgentToken('testhandle', ENV)
    const result = validateAgentToken(token, ENV)
    assert.ok(result.valid)
    if (result.valid) {
      assert.equal(result.handle, 'testhandle')
      assert.ok(result.expiresAt > Date.now())
      assert.ok(result.issuedAt <= Date.now())
    }
  })

  it('normalizes handle: strips @ and lowercases', () => {
    const token = issueAgentToken('@MyHandle', ENV)
    const result = validateAgentToken(token, ENV)
    assert.ok(result.valid)
    if (result.valid) assert.equal(result.handle, 'myhandle')
  })

  it('token expires in ~90 days', () => {
    const now = Date.now()
    const token = issueAgentToken('h', ENV, now)
    const result = validateAgentToken(token, ENV, now)
    assert.ok(result.valid)
    if (result.valid) {
      const diffDays = (result.expiresAt - now) / (24 * 60 * 60 * 1000)
      assert.ok(diffDays > 89 && diffDays < 91, `expected ~90 days, got ${diffDays}`)
    }
  })

  it('rejects tampered payload', () => {
    const token = issueAgentToken('legit', ENV)
    const [payload, sig] = token.split('.')
    const bad = payload.slice(0, -1) + (payload.endsWith('A') ? 'B' : 'A')
    assert.ok(!validateAgentToken(`${bad}.${sig}`, ENV).valid)
  })

  it('rejects wrong secret', () => {
    const token = issueAgentToken('handle', ENV)
    assert.ok(!validateAgentToken(token, { LETSFG_AGENT_ACCESS_SECRET: 'other' }).valid)
  })

  it('rejects expired token', () => {
    const past = Date.now() - 91 * 24 * 60 * 60 * 1000
    const token = issueAgentToken('handle', ENV, past)
    const result = validateAgentToken(token, ENV)
    assert.ok(!result.valid)
    if (!result.valid) assert.equal(result.reason, 'expired')
  })

  it('rejects malformed tokens', () => {
    assert.ok(!validateAgentToken('', ENV).valid)
    assert.ok(!validateAgentToken('nodot', ENV).valid)
    assert.ok(!validateAgentToken('not.a.valid.token.at.all', ENV).valid)
  })
})

describe('tweetContainsChallenge', () => {
  it('finds the challenge code in a typical tweet', () => {
    const text = "Requesting programmatic access to @LetsFG flight search. Challenge: XK9AB3QR https://letsfg.co/for-agents"
    assert.ok(tweetContainsChallenge(text, 'XK9AB3QR'))
  })

  it('is case-insensitive', () => {
    assert.ok(tweetContainsChallenge('challenge: xk9ab3qr here', 'XK9AB3QR'))
    assert.ok(tweetContainsChallenge('CHALLENGE: XK9AB3QR', 'xk9ab3qr'))
  })

  it('returns false when code is absent', () => {
    assert.ok(!tweetContainsChallenge('no challenge code in this text at all', 'XK9AB3QR'))
  })

  it('works with decoded HTML content (entities stripped)', () => {
    const stripped = 'Requesting access to @LetsFG &mdash; Challenge: AB3CDEFG done'
    // After entity decoding this is fine, but even raw & mdash; won't contain our code
    assert.ok(tweetContainsChallenge(stripped, 'AB3CDEFG'))
  })
})

describe('extractHandleFromAuthorUrl', () => {
  it('extracts handle from twitter.com URL', () => {
    assert.equal(extractHandleFromAuthorUrl('https://twitter.com/someuser'), 'someuser')
  })

  it('extracts handle from x.com URL', () => {
    assert.equal(extractHandleFromAuthorUrl('https://x.com/SomeUser'), 'someuser')
  })

  it('handles trailing slash', () => {
    assert.equal(extractHandleFromAuthorUrl('https://twitter.com/handle/'), 'handle')
  })

  it('returns empty string for invalid URLs', () => {
    assert.equal(extractHandleFromAuthorUrl('not-a-url'), '')
    assert.equal(extractHandleFromAuthorUrl(''), '')
  })
})
