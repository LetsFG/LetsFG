import { createHmac, timingSafeEqual } from 'crypto'
import type { NextRequest, NextResponse } from 'next/server'
import { getSessionUid } from './session-uid'

const UNLOCK_COOKIE_NAME = 'lfg_unlocks'
const UNLOCK_COOKIE_MAX_AGE_SECONDS = 10 * 365 * 24 * 60 * 60
const UNLOCK_COOKIE_MAX_AGE_MS = UNLOCK_COOKIE_MAX_AGE_SECONDS * 1000
const MAX_UNLOCK_COOKIE_VALUE_LENGTH = 3500

interface UnlockCookiePayload {
  uid: string
  unlocks: Record<string, unknown>
}

function getUnlockSecret(): string {
  return process.env.UNLOCK_COOKIE_SECRET || process.env.FSW_SECRET || ''
}

function normalizeUnlockEntries(entries: Record<string, unknown>, now = Date.now()): Record<string, true> {
  const normalized: Record<string, true> = {}
  for (const [searchId, unlockValue] of Object.entries(entries)) {
    if (!searchId) continue
    if (unlockValue === true) {
      normalized[searchId] = true
      continue
    }

    // Upgrade legacy timestamp-based unlocks to the new permanent format
    // while still dropping already-expired entries.
    if (typeof unlockValue === 'number' && Number.isFinite(unlockValue) && unlockValue > now) {
      normalized[searchId] = true
    }
  }
  return normalized
}

function signUnlockPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

function parseUnlockCookie(rawValue: string | undefined, uid: string, now = Date.now()): Record<string, true> {
  const secret = getUnlockSecret()
  if (!rawValue || !secret || !uid) return {}

  const dotIndex = rawValue.lastIndexOf('.')
  if (dotIndex <= 0) return {}

  const encodedPayload = rawValue.slice(0, dotIndex)
  const signature = rawValue.slice(dotIndex + 1)

  try {
    const expectedSignature = signUnlockPayload(encodedPayload, secret)
    const actualBuffer = Buffer.from(signature)
    const expectedBuffer = Buffer.from(expectedSignature)
    if (
      actualBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(actualBuffer, expectedBuffer)
    ) {
      return {}
    }

    const payload = Buffer.from(encodedPayload, 'base64url').toString('utf8')
    const parsed = JSON.parse(payload) as UnlockCookiePayload
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      parsed.uid !== uid ||
      typeof parsed.unlocks !== 'object'
    ) {
      return {}
    }
    return normalizeUnlockEntries(parsed.unlocks, now)
  } catch {
    return {}
  }
}

function serializeUnlockCookie(uid: string, unlocks: Record<string, true>): string {
  const secret = getUnlockSecret()
  if (!secret || !uid) {
    throw new Error('Missing UNLOCK_COOKIE_SECRET/FSW_SECRET or session uid')
  }

  const payload = Buffer.from(JSON.stringify({ uid, unlocks }), 'utf8').toString('base64url')
  const signature = signUnlockPayload(payload, secret)
  return `${payload}.${signature}`
}

function trimUnlockEntriesToCookieBudget(
  uid: string,
  unlocks: Record<string, true>,
): Record<string, true> {
  const entries = Object.entries(unlocks)
  while (entries.length > 0) {
    const candidate = Object.fromEntries(entries) as Record<string, true>
    if (serializeUnlockCookie(uid, candidate).length <= MAX_UNLOCK_COOKIE_VALUE_LENGTH) {
      return candidate
    }
    entries.shift()
  }
  return {}
}

export function hasActiveUnlock(req: NextRequest, searchId: string): boolean {
  const uid = getSessionUid(req)
  if (!uid) return false

  const unlocks = parseUnlockCookie(req.cookies.get(UNLOCK_COOKIE_NAME)?.value, uid)
  return unlocks[searchId] === true
}

export function setUnlockCookie(
  res: NextResponse,
  req: NextRequest,
  searchId: string,
): void {
  const uid = getSessionUid(req)
  if (!uid) {
    throw new Error('Missing session uid')
  }

  const now = Date.now()
  const unlocks = parseUnlockCookie(req.cookies.get(UNLOCK_COOKIE_NAME)?.value, uid, now)
  delete unlocks[searchId]
  unlocks[searchId] = true

  const normalized = trimUnlockEntriesToCookieBudget(uid, normalizeUnlockEntries(unlocks, now))

  res.cookies.set(UNLOCK_COOKIE_NAME, serializeUnlockCookie(uid, normalized), {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    expires: new Date(now + UNLOCK_COOKIE_MAX_AGE_MS),
    maxAge: UNLOCK_COOKIE_MAX_AGE_SECONDS,
    path: '/',
  })
}