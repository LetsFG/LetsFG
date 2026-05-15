import { NextRequest, NextResponse } from 'next/server'
import { getSessionUid } from '../../../../lib/session-uid'
import { createUnlockToken } from '../../../../lib/unlock-token'
import { setUnlockCookie } from '../../../../lib/unlock-cookie'
import { getLetsfgApiBase, withLetsfgWebsiteApiHeaders } from '../../../../lib/letsfg-api'

const API_BASE = process.env.LETSFG_API_URL?.trim() || 'https://letsfg-api-qryvus4jia-uc.a.run.app'

/**
 * POST /api/monitor/use-email-unlock?token=...&offer_id=...&search_id=...
 *
 * Proxy for the backend use-email-unlock endpoint. Consumes a single-use
 * email/push unlock token and, on success, returns a website-format unlock
 * token that unlock-status and the offer route both understand.
 */
export async function POST(req: NextRequest) {
  const uid = getSessionUid(req)
  if (!uid) {
    return NextResponse.json({ error: 'No session' }, { status: 400 })
  }

  const token = req.nextUrl.searchParams.get('token')
  const offerId = req.nextUrl.searchParams.get('offer_id')
  const searchId = req.nextUrl.searchParams.get('search_id')

  if (!token || !offerId || !searchId) {
    return NextResponse.json({ error: 'Missing parameters' }, { status: 400 })
  }

  const backendRes = await fetch(
    `${API_BASE}/api/v1/monitors/use-email-unlock?token=${encodeURIComponent(token)}&offer_id=${encodeURIComponent(offerId)}`,
    {
      method: 'POST',
      headers: withLetsfgWebsiteApiHeaders(),
    },
  ).catch(() => null)

  if (!backendRes || !backendRes.ok) {
    const status = backendRes?.status ?? 502
    const body = await backendRes?.json().catch(() => ({})) ?? {}
    return NextResponse.json(body, { status })
  }

  const unlockToken = createUnlockToken(uid, searchId)
  const response = NextResponse.json({ unlockToken })
  setUnlockCookie(response, req, searchId)
  return response
}
