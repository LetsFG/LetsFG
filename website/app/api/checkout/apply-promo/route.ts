import { NextRequest, NextResponse } from 'next/server'
import { getSessionUid } from '../../../../lib/session-uid'
import { createUnlockToken } from '../../../../lib/unlock-token'
import { setUnlockCookie } from '../../../../lib/unlock-cookie'
import { withLetsfgWebsiteApiHeaders } from '../../../../lib/letsfg-api'

const API_BASE = process.env.LETSFG_API_URL?.trim() || 'https://letsfg-api-qryvus4jia-uc.a.run.app'

/**
 * POST /api/checkout/apply-promo
 *
 * Validates a one-time promo code with the backend and, on success, returns
 * a website-format unlock token (same shape as /api/checkout/verify).
 */
export async function POST(req: NextRequest) {
  const uid = getSessionUid(req)
  if (!uid) {
    return NextResponse.json({ error: 'No session' }, { status: 400 })
  }

  let code: string, searchId: string
  try {
    ;({ code, searchId } = await req.json())
  } catch (_) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  if (!code || !searchId) {
    return NextResponse.json({ error: 'Missing parameters' }, { status: 400 })
  }

  const params = new URLSearchParams({
    code: code.trim().toUpperCase(),
    search_id: searchId,
  })

  const backendRes = await fetch(
    `${API_BASE}/api/v1/promos/apply?${params.toString()}`,
    {
      method: 'POST',
      headers: withLetsfgWebsiteApiHeaders(),
    },
  ).catch(() => null)

  if (!backendRes || !backendRes.ok) {
    const backendStatus = backendRes?.status ?? 502
    const body = await backendRes?.json().catch(() => ({})) ?? {}
    return NextResponse.json(body, { status: backendStatus })
  }

  const unlockToken = createUnlockToken(uid, searchId)
  const response = NextResponse.json({ unlocked: true, unlockToken })
  setUnlockCookie(response, req, searchId)
  return response
}
