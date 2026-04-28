import { NextRequest, NextResponse } from 'next/server'
import { hasActiveUnlock, setUnlockCookie } from '../../../lib/unlock-cookie'
import { getSessionUid } from '../../../lib/session-uid'
import { hasValidUnlockToken } from '../../../lib/unlock-token'

function jsonNoStore(body: { unlocked: boolean }) {
  return NextResponse.json(body, {
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    },
  })
}

/**
 * GET /api/unlock-status?searchId=...
 *
 * Returns whether the current user (identified by their httpOnly session cookie)
 * has an active unlock for the given searchId.
 */
export async function GET(req: NextRequest) {
  const uid = getSessionUid(req)
  if (!uid) {
    return jsonNoStore({ unlocked: false })
  }

  const searchId = req.nextUrl.searchParams.get('searchId')
  if (!searchId) {
    return jsonNoStore({ unlocked: false })
  }

  const unlockedByCookie = hasActiveUnlock(req, searchId)
  const unlockedByToken = !unlockedByCookie && hasValidUnlockToken(req, searchId)
  const response = jsonNoStore({ unlocked: unlockedByCookie || unlockedByToken })

  if (unlockedByToken) {
    setUnlockCookie(response, req, searchId)
  }

  return response
}
