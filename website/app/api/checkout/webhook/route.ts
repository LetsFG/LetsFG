import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getStripe } from '../../../../lib/stripe'

/**
 * POST /api/checkout/webhook
 *
 * Stripe webhook receiver. Every event is signature-verified before processing.
 *
 * Register this URL in the Stripe Dashboard:
 *   https://letsfg-website-qryvus4jia-ew.a.run.app/api/checkout/webhook
 *
 * Required events to subscribe to in the dashboard:
 *   - checkout.session.completed
 *   - payment_intent.payment_failed
 *
 * Set STRIPE_WEBHOOK_SECRET to the signing secret shown on the endpoint page.
 * For local testing:  stripe listen --forward-to localhost:3000/api/checkout/webhook
 */

// Must run on Node.js to access the raw request body for signature verification.
export const runtime = 'nodejs'

const ANALYTICS_API_BASE = (
  process.env.LETSFG_ANALYTICS_API_URL || 'https://letsfg-api-876385716101.us-central1.run.app'
).replace(/\/$/, '')

/**
 * Fire the payment_verified analytics event from the server side.
 * This is the authoritative source — reliable regardless of client-side issues
 * (browser closed, JS error, slow network on the success redirect).
 * Fire-and-forget: failures are logged but never bubble up to Stripe.
 */
async function trackPaymentVerified(session: Stripe.Checkout.Session) {
  const searchId = session.metadata?.search_id
  if (!searchId) {
    console.warn('[webhook] checkout.session.completed missing search_id in metadata — skipping analytics')
    return
  }

  const fee = session.amount_total != null ? session.amount_total / 100 : undefined

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
    ...(fee != null ? { revenue: fee } : {}),
  }

  try {
    const res = await fetch(`${ANALYTICS_API_BASE}/api/v1/analytics/search-sessions/upsert`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://letsfg.co',
        'Referer': 'https://letsfg.co/',
        'User-Agent': 'LetsFG Webhook/1.0',
      },
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
          console.log('[webhook] Payment confirmed:', {
            sessionId: session.id,
            searchId: session.metadata?.search_id,
            offerId: session.metadata?.offer_id,
            lfgUid: session.metadata?.lfg_uid,
            amount: session.amount_total,
            currency: session.currency,
          })
          // Fire analytics from the server side so the purchase is always recorded,
          // even if the Stripe redirect fails or client-side JS doesn't execute
          // (browser closed, network error, JS exception).
          await trackPaymentVerified(session)
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
