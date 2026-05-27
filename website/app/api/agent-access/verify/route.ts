import { NextRequest, NextResponse } from 'next/server'
import {
  validateChallengeSignature,
  fetchTweetContent,
  tweetContainsChallenge,
  issueAgentToken,
} from '../../../../lib/agent-access'

const TWEET_URL_RE = /^https?:\/\/(twitter|x)\.com\/[a-zA-Z0-9_]+\/status\/\d+/

// POST /api/agent-access/verify
// Body: { tweet_url: string, challenge_signed: string }
// Returns: { token, handle, expires_at } on success.
export async function POST(req: NextRequest) {
  if (!process.env.LETSFG_AGENT_ACCESS_SECRET) {
    return NextResponse.json({ error: 'agent access not configured' }, { status: 503 })
  }
  try {
    const body = await req.json() as { tweet_url?: string; challenge_signed?: string }
    const { tweet_url: tweetUrl, challenge_signed: challengeSigned } = body ?? {}

    if (!tweetUrl || !challengeSigned) {
      return NextResponse.json(
        { error: 'tweet_url and challenge_signed are required' },
        { status: 400 },
      )
    }

    if (!TWEET_URL_RE.test(tweetUrl)) {
      return NextResponse.json(
        { error: 'tweet_url must be a valid twitter.com or x.com status URL' },
        { status: 400 },
      )
    }

    const challenge = validateChallengeSignature(challengeSigned)
    if (!challenge) {
      return NextResponse.json(
        { error: 'challenge_signed is expired or invalid — request a new one' },
        { status: 400 },
      )
    }

    const tweet = await fetchTweetContent(tweetUrl)
    if (!tweet) {
      return NextResponse.json(
        { error: 'tweet not found or inaccessible — make sure the tweet is public' },
        { status: 400 },
      )
    }

    if (!tweetContainsChallenge(tweet.text, challenge.code)) {
      return NextResponse.json(
        { error: 'challenge code not found in tweet text' },
        { status: 400 },
      )
    }

    const token = issueAgentToken(tweet.handle)
    const expiresAt = Date.now() + 90 * 24 * 60 * 60 * 1000

    return NextResponse.json({
      token,
      handle: tweet.handle,
      expires_at: expiresAt,
      usage: 'Add to requests: Authorization: Bearer <token>',
    })
  } catch {
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
