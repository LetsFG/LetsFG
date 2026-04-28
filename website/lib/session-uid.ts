import type { NextRequest } from 'next/server'

export const HOSTING_SESSION_COOKIE_NAME = '__session'
export const LEGACY_UID_COOKIE_NAME = 'lfg_uid'

const MAX_UID_LENGTH = 128

function normalizeUid(value: string | null | undefined): string | null {
  if (!value) return null

  const uid = value.trim()
  if (!uid || uid.length > MAX_UID_LENGTH) {
    return null
  }

  return uid
}

export function getSessionUid(req: NextRequest): string | null {
  return (
    normalizeUid(req.cookies.get(HOSTING_SESSION_COOKIE_NAME)?.value)
    ?? normalizeUid(req.cookies.get(LEGACY_UID_COOKIE_NAME)?.value)
  )
}