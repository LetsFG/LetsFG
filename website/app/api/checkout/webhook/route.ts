import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getStripe } from '../../../../lib/stripe'
import { getTrustedOffer } from '../../../../lib/trusted-offer'
import { getLetsfgAnalyticsApiBase, getLetsfgApiBase, withLetsfgWebsiteApiHeaders } from '../../../../lib/letsfg-api'

/**
 * POST /api/checkout/webhook
 *
 * Stripe webhook receiver. Every event is signature-verified before processing.
 *
 * Register this URL in the Stripe Dashboard:
 *   https://letsfg.co/api/checkout/webhook
 *
 * Required events to subscribe to in the dashboard:
 *   - checkout.session.completed
 *   - payment_intent.payment_failed
 *
 * Set STRIPE_WEBHOOK_SECRET to the signing secret shown on the endpoint page.
 * For local testing:  stripe listen --forward-to localhost:3000/api/checkout/webhook
 *
 * This webhook also handles monitor activation, because the public callback now lands
 * on the website and then forwards the paid monitor metadata to the backend.
 */

// Must run on Node.js to access the raw request body for signature verification.
export const runtime = 'nodejs'

const ANALYTICS_API_BASE = getLetsfgAnalyticsApiBase()

const API_BASE = getLetsfgApiBase()
const WEBSITE_API_KEY = process.env.LETSFG_WEBSITE_API_KEY || ''

/**
 * Fire the payment_verified analytics event from the server side.
 * This is the authoritative source — reliable regardless of client-side issues
 * (browser closed, JS error, slow network on the success redirect).
 * Fire-and-forget: failures are logged but never bubble up to Stripe.
 */
async function trackPaymentVerified(session: Stripe.Checkout.Session) {
  // Never record test-mode payments as real revenue.
  // session.livemode === false means this came from a Stripe test key / test clock.
  if (!session.livemode) {
    console.warn(
      '[webhook] Ignoring test-mode payment — session:', session.id,
      'search_id:', session.metadata?.search_id ?? '(none)',
      '— set STRIPE_SECRET_KEY to a live key to record real revenue',
    )
    return
  }

  const searchId = session.metadata?.search_id
  if (!searchId) {
    console.warn('[webhook] checkout.session.completed missing search_id in metadata — skipping analytics')
    return
  }

  const fee = session.amount_total != null ? session.amount_total / 100 : undefined
  const feeCurrency = session.currency?.toUpperCase() || undefined

  const payload = {
    search_id: searchId,
    event: {
      type: 'payment_verified',
      at: new Date().toISOString(),
      data: {
        offer_id: session.metadata?.offer_id ?? '',
        stripe_session_id: session.id,
        source: 'webhook',
      },
    },
    ...(fee != null ? { revenue: fee, ...(feeCurrency ? { revenue_currency: feeCurrency } : {}) } : {}),
  }

  try {
    const res = await fetch(`${ANALYTICS_API_BASE}/api/v1/analytics/search-sessions/upsert`, {
      method: 'POST',
      headers: withLetsfgWebsiteApiHeaders({
        'Content-Type': 'application/json',
        'Origin': 'https://letsfg.co',
        'Referer': 'https://letsfg.co/',
        'User-Agent': 'LetsFG Webhook/1.0',
      }),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) {
      console.error('[webhook] analytics upsert failed:', res.status, await res.text().catch(() => ''))
    } else {
      console.log('[webhook] analytics payment_verified recorded for search_id:', searchId)
    }
  } catch (err) {
    console.error('[webhook] analytics upsert threw:', err)
  }
}

/**
 * Resolve the booking URL from the offer snapshot embedded in the Stripe success URL,
 * then store {payment_token → booking_url} in Firestore via the backend.
 * Called from both the webhook (authoritative) and verify (browser-tab path).
 */
async function resolveAndStorePaymentToken(
  paymentToken: string,
  offerId: string,
  searchId: string,
  successUrl: string | null,
): Promise<void> {
  try {
    let offerRef: string | null = null
    if (successUrl) {
      try {
        offerRef = new URL(successUrl).searchParams.get('ref')
      } catch {
        // Malformed URL — proceed without offer_ref.
      }
    }

    const trustedOffer = await getTrustedOffer(offerId, searchId || null, offerRef)
    const bookingUrl = trustedOffer?.booking_url
    if (!bookingUrl) {
      console.warn('[webhook] payment_token present but could not resolve booking_url for offer', offerId)
      return
    }

    const res = await fetch(`${API_BASE}/api/v1/payment-tokens/store`, {
      method: 'POST',
      headers: withLetsfgWebsiteApiHeaders({
        'Content-Type': 'application/json',
        'User-Agent': 'LetsFG Webhook/1.0',
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
      console.error('[webhook] payment_token store failed:', res.status, await res.text().catch(() => ''))
    } else {
      console.log('[webhook] payment_token stored for offer', offerId)
    }
  } catch (err) {
    console.error('[webhook] resolveAndStorePaymentToken threw:', err)
  }
}

export async function POST(req: NextRequest) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) {
    console.error('[webhook] STRIPE_WEBHOOK_SECRET is not set — cannot verify events')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })
  }

  const signature = req.headers.get('stripe-signature')
  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 })
  }

  // Must use the raw body string — Stripe verifies the exact bytes it sent.
  const rawBody = await req.text()

  let event: Stripe.Event
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, webhookSecret)
  } catch (err) {
    console.error('[webhook] Signature verification failed:', err)
    return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 400 })
  }

  console.log(`[webhook] ${event.type} — ${event.id}`)

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        if (session.payment_status === 'paid') {
          const monitorId = session.metadata?.monitor_id

          if (monitorId) {
            // ── Monitor payment ───────────────────────────────────────────────
            // The public Stripe webhook now lands on the website, so activate the
            // monitor here in all environments. The backend record-payment endpoint
            // is idempotent, so repeated calls are safe.
            if (WEBSITE_API_KEY) {
              const amountUsd = session.amount_total != null ? session.amount_total / 100 : 0
              try {
                const activateResp = await fetch(
                  `${API_BASE}/api/v1/monitors/${monitorId}/record-payment`,
                  {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'X-API-Key': WEBSITE_API_KEY,
                    },
                    body: JSON.stringify({
                      stripe_payment_intent_id: session.payment_intent ?? '',
                      amount_usd: amountUsd,
                    }),
                    signal: AbortSignal.timeout(10_000),
                  }
                )
                if (activateResp.ok) {
                  console.log('[webhook] Monitor activated via record-payment:', monitorId)
                } else {
                  const body = await activateResp.text().catch(() => '')
                  console.error('[webhook] record-payment failed:', activateResp.status, body)
                }
              } catch (err) {
                console.error('[webhook] record-payment threw:', err)
              }
            }
            console.log('[webhook] Monitor payment confirmed:', { monitorId, sessionId: session.id })
          } else {
            // ── Regular (unlock/book) payment — track analytics ───────────────
            console.log('[webhook] Payment confirmed:', {
              sessionId: session.id,
              searchId: session.metadata?.search_id,
              offerId: session.metadata?.offer_id,
              lfgUid: session.metadata?.lfg_uid,
              amount: session.amount_total,
              currency: session.currency,
            })
            await trackPaymentVerified(session)

            // If a payment_token is present, this was an SDK-initiated checkout.
            // Resolve the booking URL from the offer snapshot and write it to
            // Firestore so the SDK can retrieve it via GET /api/developers/payment-verify.
            // This is the authoritative path — it runs even when the browser tab is
            // closed before the verify endpoint is called.
            const paymentToken = session.metadata?.payment_token
            if (paymentToken) {
              await resolveAndStorePaymentToken(
                paymentToken,
                session.metadata?.offer_id ?? '',
                session.metadata?.search_id ?? '',
                session.success_url ?? null,
              )
            }
          }
        }
        break
      }

      case 'payment_intent.payment_failed': {
        const pi = event.data.object as Stripe.PaymentIntent
        console.warn('[webhook] Payment failed:', {
          paymentIntentId: pi.id,
          error: pi.last_payment_error?.message,
          code: pi.last_payment_error?.code,
        })
        break
      }

      default:
        // Ignore unsubscribed event types
        break
    }
  } catch (err) {
    // Log but still return 200 — Stripe would retry on non-2xx, causing duplicates.
    console.error(`[webhook] Error processing ${event.type}:`, err)
  }

  // Always acknowledge within a few seconds.
  return NextResponse.json({ received: true })
}
