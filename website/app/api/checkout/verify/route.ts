import { NextRequest, NextResponse } from 'next/server'
import { getStripe } from '../../../../lib/stripe'
import { getSessionUid } from '../../../../lib/session-uid'
import { setUnlockCookie } from '../../../../lib/unlock-cookie'
import { createUnlockToken } from '../../../../lib/unlock-token'
import { getLetsfgAnalyticsApiBase, withLetsfgWebsiteApiHeaders } from '../../../../lib/letsfg-api'

const ANALYTICS_API_BASE = getLetsfgAnalyticsApiBase()

/**
 * POST /api/checkout/verify
 *
 * Called by the client after Stripe redirects back with ?stripe_session=...
 * Verifies with Stripe that the payment succeeded, confirms the session belongs
 * to the current user (cookie check), then records the unlock in a signed cookie.
 */
export async function POST(req: NextRequest) {
  const uid = getSessionUid(req)
  if (!uid) {
    return NextResponse.json({ unlocked: false, error: 'No session' }, { status: 400 })
  }

  let stripeSessionId: string
  try {
    ;({ stripeSessionId } = await req.json())
  } catch (_) {
    return NextResponse.json({ unlocked: false, error: 'Invalid body' }, { status: 400 })
  }

  if (!stripeSessionId || !stripeSessionId.startsWith('cs_')) {
    return NextResponse.json({ unlocked: false, error: 'Invalid session ID' }, { status: 400 })
  }

  try {
    const stripe = getStripe()
    const session = await stripe.checkout.sessions.retrieve(stripeSessionId)

    if (session.mode !== 'payment' || session.status !== 'complete') {
      return NextResponse.json({ unlocked: false, error: 'Checkout incomplete' }, { status: 400 })
    }

    // Security: ensure this Stripe session was created for THIS user.
    // An attacker who knows someone else's stripe_session cannot use it to unlock
    // their own account because the metadata uid won't match their cookie.
    if (session.metadata?.lfg_uid !== uid) {
      return NextResponse.json({ unlocked: false, error: 'Session mismatch' }, { status: 403 })
    }

    if (session.payment_status !== 'paid') {
      return NextResponse.json({ unlocked: false })
    }

    const searchId = session.metadata?.search_id
    if (!searchId) {
      return NextResponse.json({ unlocked: false, error: 'Missing search ID' }, { status: 500 })
    }

    const offerId = session.metadata?.offer_id ?? ''
    const revenue = session.amount_total != null ? session.amount_total / 100 : undefined
    const revenueCurrency = session.currency?.toUpperCase() || undefined

    const response = NextResponse.json({
      unlocked: true,
      searchId,
      unlockToken: createUnlockToken(uid, searchId),
    })
    setUnlockCookie(response, req, searchId)

    // Server-side analytics backup: fire payment_verified without blocking the response.
    // This is the most reliable path — runs server-side, has all data, doesn't depend
    // on the Stripe webhook firing or the client-side tracking completing.
    void fetch(`${ANALYTICS_API_BASE}/api/v1/analytics/search-sessions/upsert`, {
      method: 'POST',
      headers: withLetsfgWebsiteApiHeaders({
        'Content-Type': 'application/json',
        'Origin': 'https://letsfg.co',
        'Referer': 'https://letsfg.co/',
        'User-Agent': 'LetsFG Verify/1.0',
      }),
      body: JSON.stringify({
        search_id: searchId,
        ...(revenue != null ? { revenue, ...(revenueCurrency ? { revenue_currency: revenueCurrency } : {}) } : {}),
        event: {
          type: 'payment_verified',
          at: new Date().toISOString(),
          data: { offer_id: offerId, stripe_session_id: stripeSessionId, source: 'verify' },
        },
      }),
      signal: AbortSignal.timeout(8000),
    }).catch((err) => console.warn('[verify] analytics tracking failed:', err))

    return response
  } catch (err) {
    console.error('[checkout] verify error:', err)
    return NextResponse.json({ unlocked: false, error: 'Stripe error' }, { status: 500 })
  }
}
