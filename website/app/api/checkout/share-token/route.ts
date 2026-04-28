import { createHmac } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getSessionUid } from '../../../../lib/session-uid'

/**
 * GET /api/checkout/share-token?searchId=...
 *
 * Generates a short-lived HMAC token tied to the current user's session uid
 * and the given searchId. The token is later submitted to /api/checkout/verify-share
 * to prove the user clicked the share intent and unlock without payment.
 *
 * Token validity: current + previous 15-minute window (~15–30 min total).
 * No external API calls — zero cost.
 */

function getSecret(): string {
  return process.env.UNLOCK_COOKIE_SECRET || process.env.FSW_SECRET || ''
}

function windowIndex(now = Date.now()): number {
  return Math.floor(now / (15 * 60 * 1000))
}

function generateToken(uid: string, searchId: string, now = Date.now()): string {
  const secret = getSecret()
  const w = windowIndex(now)
  return createHmac('sha256', secret)
    .update(`${uid}:${searchId}:${w}`)
    .digest('base64url')
}

export async function GET(req: NextRequest) {
  const uid = getSessionUid(req)
  if (!uid) {
    return NextResponse.json({ error: 'No session' }, { status: 400 })
  }

  const searchId = new URL(req.url).searchParams.get('searchId')
  if (!searchId || searchId.length > 128) {
    return NextResponse.json({ error: 'Missing or invalid searchId' }, { status: 400 })
  }

  const now = Date.now()
  const token = generateToken(uid, searchId, now)
  // Valid through end of next window (between 15 and 30 minutes from now)
  const expiresAt = (windowIndex(now) + 2) * 15 * 60 * 1000

  return NextResponse.json({ token, expiresAt })
}
