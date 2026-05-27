import { NextResponse } from 'next/server'
import { generateChallenge } from '../../../../lib/agent-access'

// POST /api/agent-access/request
// Returns a short-lived signed challenge code the developer must include in a tweet.
export async function POST() {
  if (!process.env.LETSFG_AGENT_ACCESS_SECRET) {
    return NextResponse.json({ error: 'agent access not configured' }, { status: 503 })
  }
  try {
    const { code, signed, expiresAt } = generateChallenge()
    return NextResponse.json({
      challenge_code: code,
      challenge_signed: signed,
      expires_at: expiresAt,
      tweet_template: `I'm getting free programmatic flight search from @letsFG_ ✈️\n\nChallenge: ${code}\n\nhttps://letsfg.co/for-agents`,
    })
  } catch {
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
