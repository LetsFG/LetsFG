// Agent access tokens — lets AI agents (OpenClaw, ChatGPT, etc.) make
// programmatic requests to letsfg.co without browser automation.
//
// Flow:
//   POST /api/agent-access/request  → { challenge_code, challenge_signed, expires_at }
//   Developer tweets: "Challenge: <code> @LetsFG https://letsfg.co/for-agents"
//   POST /api/agent-access/verify   → { tweet_url, challenge_signed }
//                                   → { token, handle, expires_at }
//   API calls: Authorization: Bearer <token>
//
// Tokens are HMAC-signed and self-validating — no DB needed.
// To revoke ALL tokens (e.g. if secret leaks): rotate LETSFG_AGENT_ACCESS_SECRET.
// Tokens expire after 90 days; developers re-tweet a new challenge to renew.

import { createHmac, randomBytes, timingSafeEqual } from 'crypto'

const TOKEN_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000
const CHALLENGE_LIFETIME_MS = 30 * 60 * 1000
// Omit ambiguous chars (I, O, 0, 1) so codes are easy to read/type on any device
const CHALLENGE_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export type AgentTokenValidation =
  | { valid: true; handle: string; issuedAt: number; expiresAt: number }
  | { valid: false; reason: string }

function hmacDigest(data: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(data).digest()
}

function b64uEncode(obj: object): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url')
}

function b64uDecode<T>(s: string): T | null {
  try {
    return JSON.parse(Buffer.from(s, 'base64url').toString('utf8')) as T
  } catch {
    return null
  }
}

function verifySig(payloadB64: string, sigB64: string, secret: string): boolean {
  const expectedBuf = hmacDigest(payloadB64, secret)
  let actualBuf: Buffer
  try {
    actualBuf = Buffer.from(sigB64, 'base64url')
  } catch {
    return false
  }
  if (actualBuf.length !== expectedBuf.length) return false
  return timingSafeEqual(actualBuf, expectedBuf)
}

export function generateChallenge(
  env: Record<string, string | undefined> = process.env,
  now = Date.now(),
): { code: string; signed: string; expiresAt: number } {
  const secret = env.LETSFG_AGENT_ACCESS_SECRET ?? ''
  const bytes = randomBytes(8)
  const code = Array.from(bytes, b => CHALLENGE_CHARSET[b % CHALLENGE_CHARSET.length]).join('')
  const expiresAt = now + CHALLENGE_LIFETIME_MS
  const payload = b64uEncode({ code, exp: expiresAt })
  const sig = hmacDigest(payload, secret).toString('base64url')
  return { code, signed: `${payload}.${sig}`, expiresAt }
}

export function validateChallengeSignature(
  signed: string,
  env: Record<string, string | undefined> = process.env,
  now = Date.now(),
): { code: string } | null {
  if (!signed) return null
  const dotIdx = signed.lastIndexOf('.')
  if (dotIdx < 1) return null
  const payloadB64 = signed.slice(0, dotIdx)
  const sigB64 = signed.slice(dotIdx + 1)

  const secret = env.LETSFG_AGENT_ACCESS_SECRET ?? ''
  if (!verifySig(payloadB64, sigB64, secret)) return null

  const payload = b64uDecode<{ code: string; exp: number }>(payloadB64)
  if (!payload?.code || !payload?.exp) return null
  if (now > payload.exp) return null
  return { code: payload.code }
}

export function issueAgentToken(
  handle: string,
  env: Record<string, string | undefined> = process.env,
  now = Date.now(),
): string {
  const secret = env.LETSFG_AGENT_ACCESS_SECRET ?? ''
  const normalizedHandle = handle.toLowerCase().replace(/^@/, '')
  const payload = b64uEncode({
    h: normalizedHandle,
    iat: Math.floor(now / 1000),
    exp: Math.floor((now + TOKEN_LIFETIME_MS) / 1000),
  })
  const sig = hmacDigest(payload, secret).toString('base64url')
  return `${payload}.${sig}`
}

export function validateAgentToken(
  token: string,
  env: Record<string, string | undefined> = process.env,
  now = Date.now(),
): AgentTokenValidation {
  if (!token) return { valid: false, reason: 'malformed' }
  const dotIdx = token.lastIndexOf('.')
  if (dotIdx < 1) return { valid: false, reason: 'malformed' }
  const payloadB64 = token.slice(0, dotIdx)
  const sigB64 = token.slice(dotIdx + 1)

  const secret = env.LETSFG_AGENT_ACCESS_SECRET ?? ''
  if (!verifySig(payloadB64, sigB64, secret)) return { valid: false, reason: 'invalid_signature' }

  const payload = b64uDecode<{ h: string; iat: number; exp: number }>(payloadB64)
  if (!payload?.h || !payload?.exp) return { valid: false, reason: 'malformed_payload' }
  if (now > payload.exp * 1000) return { valid: false, reason: 'expired' }

  return {
    valid: true,
    handle: payload.h,
    issuedAt: payload.iat * 1000,
    expiresAt: payload.exp * 1000,
  }
}

export function extractHandleFromAuthorUrl(authorUrl: string): string {
  try {
    const url = new URL(authorUrl)
    const parts = url.pathname.replace(/\/$/, '').split('/')
    return parts[parts.length - 1]?.toLowerCase() ?? ''
  } catch {
    return ''
  }
}

export function tweetContainsChallenge(tweetText: string, challengeCode: string): boolean {
  return tweetText.toUpperCase().includes(challengeCode.toUpperCase())
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Fetches tweet text via the Twitter oEmbed API (free, no auth required).
// Only called once at agent-token registration time — not on every request.
export async function fetchTweetContent(
  tweetUrl: string,
): Promise<{ text: string; handle: string } | null> {
  // Normalize x.com → twitter.com for oEmbed compatibility
  const normalized = tweetUrl.replace(/^https?:\/\/x\.com\//, 'https://twitter.com/')
  const oembed = `https://publish.twitter.com/oembed?url=${encodeURIComponent(normalized)}&omit_script=true`
  try {
    const res = await fetch(oembed, {
      headers: { 'User-Agent': 'LetsFG/1.0 (+https://letsfg.co)' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const data = await res.json() as { html?: string; author_url?: string }
    if (!data.html || !data.author_url) return null
    const handle = extractHandleFromAuthorUrl(data.author_url)
    if (!handle) return null
    return { text: stripHtml(data.html), handle }
  } catch {
    return null
  }
}
