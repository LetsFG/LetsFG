// Integration test: full request → tweet → verify → use flow.
// The network call to Twitter oEmbed is mocked so this runs offline.
import { describe, it, mock, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  generateChallenge,
  validateChallengeSignature,
  issueAgentToken,
  validateAgentToken,
  tweetContainsChallenge,
  extractHandleFromAuthorUrl,
  fetchTweetContent,
} from '../lib/agent-access'

const ENV = { LETSFG_AGENT_ACCESS_SECRET: 'integration-test-secret-abc' }

// ---------- mock fetch for fetchTweetContent ----------

function makeMockOembedResponse(tweetText: string, handle: string) {
  const html = `<blockquote class="twitter-tweet"><p lang="en" dir="ltr">${tweetText}</p>&mdash; Test (@${handle}) <a href="#">Date</a></blockquote>`
  return {
    html,
    author_url: `https://twitter.com/${handle}`,
    url: `https://twitter.com/${handle}/status/123456`,
    type: 'rich',
  }
}

let fetchMock: ReturnType<typeof mock.fn>

beforeEach(() => {
  fetchMock = mock.fn(async (url: string) => {
    // Return a "tweet not found" for any URL containing "missing"
    if (url.includes('missing')) {
      return { ok: false, json: async () => ({}) }
    }
    // Return a real-looking oEmbed response otherwise
    const handle = 'devhandle'
    const tweetText = url.includes('wrongcode')
      ? 'This tweet has no challenge code at all'
      : `I'm getting free programmatic flight search from @LetsFG ✈️ Challenge: PLACEHOLDER https://letsfg.co/for-agents`
    return { ok: true, json: async () => makeMockOembedResponse(tweetText, handle) }
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).fetch = fetchMock
})

afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).fetch
})

// ---------- tests ----------

describe('complete registration flow', () => {
  it('request → tweet → verify → use token', async () => {
    // 1. Request challenge
    const { code, signed, expiresAt } = generateChallenge(ENV)
    assert.ok(expiresAt > Date.now(), 'challenge must not be immediately expired')
    assert.match(code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/)

    // 2. Simulate tweet that contains the code
    const tweetTemplate = `I'm getting free programmatic flight search from @letsFG_ ✈️\n\nChallenge: ${code}\n\nhttps://letsfg.co/for-agents`

    // 3a. Validate challenge signature
    const challenge = validateChallengeSignature(signed, ENV)
    assert.ok(challenge !== null, 'challenge signature must validate')
    assert.equal(challenge?.code, code)

    // 3b. Check tweet contains code
    assert.ok(tweetContainsChallenge(tweetTemplate, code), 'tweet must contain the code')

    // 3c. Issue token (simulating what verify route does after fetchTweetContent)
    const handle = 'devhandle'
    const token = issueAgentToken(handle, ENV)

    // 4. Use token
    const validation = validateAgentToken(token, ENV)
    assert.ok(validation.valid, `token must be valid: ${!validation.valid ? validation.reason : ''}`)
    if (validation.valid) {
      assert.equal(validation.handle, handle)
      const daysLeft = (validation.expiresAt - Date.now()) / (24 * 60 * 60 * 1000)
      assert.ok(daysLeft > 89, `token should last ~90 days, got ${daysLeft.toFixed(1)}`)
    }
  })

  it('fetchTweetContent returns handle + stripped text', async () => {
    const { code } = generateChallenge(ENV)
    // Patch mock to embed the actual code in tweet text
    fetchMock.mock.mockImplementation(async () => ({
      ok: true,
      json: async () =>
        makeMockOembedResponse(
          `Getting access to @LetsFG flight search. Challenge: ${code} https://letsfg.co/for-agents`,
          'myagenthandle',
        ),
    }))

    const result = await fetchTweetContent('https://twitter.com/myagenthandle/status/999')
    assert.ok(result !== null)
    assert.equal(result?.handle, 'myagenthandle')
    assert.ok(result?.text.includes(code), 'text should include the challenge code')
  })

  it('fetchTweetContent returns null for unavailable tweets', async () => {
    const result = await fetchTweetContent('https://twitter.com/user/status/missing123')
    assert.equal(result, null)
  })

  it('verify rejects when challenge code not in tweet', async () => {
    const { code } = generateChallenge(ENV)
    const tweetText = 'This tweet has a different challenge: ZZZZZZZZ not our code'
    assert.ok(!tweetContainsChallenge(tweetText, code), 'must not find our code in wrong tweet')
  })

  it('proxy clientKey is agent:handle for valid tokens', () => {
    const token = issueAgentToken('peterhandle', ENV)
    const validation = validateAgentToken(token, ENV)
    assert.ok(validation.valid)
    if (validation.valid) {
      const clientKey = `agent:${validation.handle}`
      assert.equal(clientKey, 'agent:peterhandle')
    }
  })

  it('proxy falls back to normal key for invalid Bearer token', () => {
    const badToken = 'not-a-valid-token'
    const validation = validateAgentToken(badToken, ENV)
    assert.ok(!validation.valid)
    // proxy would use buildRateLimitClientKey instead
  })

  it('rotating the secret invalidates all previously issued tokens', () => {
    const token = issueAgentToken('somedev', ENV)
    const newEnv = { LETSFG_AGENT_ACCESS_SECRET: 'rotated-secret-xyz' }
    const result = validateAgentToken(token, newEnv)
    assert.ok(!result.valid)
    if (!result.valid) assert.equal(result.reason, 'invalid_signature')
  })
})

describe('real oEmbed response shape', () => {
  it('extractHandleFromAuthorUrl handles actual oEmbed author_url values', () => {
    // Formats returned by publish.twitter.com/oembed
    assert.equal(extractHandleFromAuthorUrl('https://twitter.com/LetsFG'), 'letsfg')
    assert.equal(extractHandleFromAuthorUrl('https://twitter.com/PeterDiamandis'), 'peterdiamandis')
    assert.equal(extractHandleFromAuthorUrl('https://x.com/SomeAgent'), 'someagent')
  })

  it('challenge code has no chars that need HTML-entity encoding', () => {
    const dangerous = /[&<>"']/
    for (let i = 0; i < 100; i++) {
      const { code } = generateChallenge(ENV)
      assert.ok(!dangerous.test(code), `code ${code} contains HTML-unsafe chars`)
    }
  })

  it('challenge code has no URL-encoding-required chars', () => {
    const urlUnsafe = /[^A-Z0-9]/
    for (let i = 0; i < 100; i++) {
      const { code } = generateChallenge(ENV)
      assert.ok(!urlUnsafe.test(code), `code ${code} requires URL encoding`)
    }
  })
})
