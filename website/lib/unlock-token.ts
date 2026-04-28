import { createHmac, timingSafeEqual } from 'crypto'
import type { NextRequest } from 'next/server'
import { getSessionUid } from './session-uid'

const UNLOCK_TOKEN_HEADER_NAME = 'x-letsfg-unlock-token'
const UNLOCK_TOKEN_MAX_AGE_MS = 10 * 365 * 24 * 60 * 60 * 1000

interface UnlockTokenPayload {
  uid: string
  searchId: string
  exp: number
}

function getUnlockSecret(): string {
  return process.env.UNLOCK_COOKIE_SECRET || process.env.FSW_SECRET || ''
}

function signUnlockPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

function parseUnlockToken(
  token: string | null,
  expectedUid: string,
  expectedSearchId: string,
  now = Date.now(),
): boolean {
  const secret = getUnlockSecret()
  if (!token || !secret || !expectedUid || !expectedSearchId) return false

  const dotIndex = token.lastIndexOf('.')
  if (dotIndex <= 0) return false

  const encodedPayload = token.slice(0, dotIndex)
  const signature = token.slice(dotIndex + 1)

  try {
    const expectedSignature = signUnlockPayload(encodedPayload, secret)
    const actualBuffer = Buffer.from(signature)
    const expectedBuffer = Buffer.from(expectedSignature)
    if (
      actualBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(actualBuffer, expectedBuffer)
    ) {
      return false
    }

    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as UnlockTokenPayload
    return (
      payload.uid === expectedUid
      && payload.searchId === expectedSearchId
      && typeof payload.exp === 'number'
      && payload.exp > now
    )
  } catch {
    return false
  }
}

export function createUnlockToken(uid: string, searchId: string, now = Date.now()): string {
  const secret = getUnlockSecret()
  if (!secret || !uid || !searchId) {
    throw new Error('Missing UNLOCK_COOKIE_SECRET/FSW_SECRET, session uid, or searchId')
  }

  const payload = Buffer.from(JSON.stringify({
    uid,
    searchId,
    exp: now + UNLOCK_TOKEN_MAX_AGE_MS,
  }), 'utf8').toString('base64url')
  const signature = signUnlockPayload(payload, secret)
  return `${payload}.${signature}`
}

export function getUnlockTokenFromRequest(req: NextRequest): string | null {
  return req.headers.get(UNLOCK_TOKEN_HEADER_NAME) || req.nextUrl.searchParams.get('unlockToken')
}

export function hasValidUnlockToken(req: NextRequest, searchId: string): boolean {
  const uid = getSessionUid(req)
  if (!uid || !searchId) return false

  return parseUnlockToken(getUnlockTokenFromRequest(req), uid, searchId)
}

export { UNLOCK_TOKEN_HEADER_NAME }