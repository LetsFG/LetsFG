import { NextRequest, NextResponse } from 'next/server'
import { getStripe } from '../../../../lib/stripe'
import { getSessionUid } from '../../../../lib/session-uid'
import { setUnlockCookie } from '../../../../lib/unlock-cookie'
import { createUnlockToken } from '../../../../lib/unlock-token'
import { getTrustedOffer } from '../../../../lib/trusted-offer'
import { getLetsfgAnalyticsApiBase, getLetsfgApiBase, withLetsfgWebsiteApiHeaders } from '../../../../lib/letsfg-api'

const ANALYTICS_API_BASE = getLetsfgAnalyticsApiBase()
const API_BASE = getLetsfgApiBase()

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
    const offerId = session.metadata?.offer_id ?? ''
    const paymentToken = session.metadata?.payment_token
    const revenue = session.amount_total != null ? session.amount_total / 100 : undefined
    const revenueCurrency = session.currency?.toUpperCase() || undefined

    // Always store the booking URL for SDK-originated payments regardless of whether
    // a searchId is present — the SDK polls /api/developers/payment-verify to retrieve it.
    // This must run before the !searchId guard so SDK users aren't left with a paid but
    // unresolved booking when the checkout was initiated without a website search context.
    if (paymentToken) {
      void resolveAndStorePaymentToken(paymentToken, offerId, searchId ?? '', session.success_url)
    }

    if (!searchId) {
      // SDK-only flow: no website search context, booking URL stored via payment_token.
      // Return unlocked:true so the website UI reflects the successful payment.
      if (paymentToken) {
        return NextResponse.json({ unlocked: true })
      }
      return NextResponse.json({ unlocked: false, error: 'Missing search ID' }, { status: 500 })
    }

    const response = NextResponse.json({
      unlocked: true,
      searchId,
      unlockToken: createUnlockToken(uid, searchId),
    })
    setUnlockCookie(response, req, searchId)

    // Server-side analytics backup: fire payment_verified without blocking the response.
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

/**
 * Resolve the booking URL from the offer snapshot embedded in the Stripe success URL,
 * then write {payment_token → booking_url} to Firestore via the backend.
 * Fire-and-forget: failures are logged but never block the verify response.
 */
async function resolveAndStorePaymentToken(
  paymentToken: string,
  offerId: string,
  searchId: string,
  successUrl: string | null,
): Promise<void> {
  try {
    // Parse the offer_ref from the success URL — it was embedded by create-session.
    let offerRef: string | null = null
    if (successUrl) {
      try {
        offerRef = new URL(successUrl).searchParams.get('ref')
      } catch {
        // Malformed URL — proceed without offer_ref.
      }
    }

    const trustedOffer = await getTrustedOffer(offerId, searchId, offerRef)
    const bookingUrl = trustedOffer?.booking_url
    if (!bookingUrl) {
      console.warn('[verify] payment_token present but could not resolve booking_url for offer', offerId)
      return
    }

    const res = await fetch(`${API_BASE}/api/v1/payment-tokens/store`, {
      method: 'POST',
      headers: withLetsfgWebsiteApiHeaders({
        'Content-Type': 'application/json',
        'User-Agent': 'LetsFG Verify/1.0',
      }),
      body: JSON.stringify({
        payment_token: paymentToken,
        booking_url: bookingUrl,
        offer_id: offerId,
        ttl: 3600,
      }),
      signal: AbortSignal.timeout(8_000),
    })

    if (!res.ok) {
      console.error('[verify] payment_token store failed:', res.status, await res.text().catch(() => ''))
    } else {
      console.log('[verify] payment_token stored for offer', offerId)
    }
  } catch (err) {
    console.error('[verify] resolveAndStorePaymentToken threw:', err)
  }
}
