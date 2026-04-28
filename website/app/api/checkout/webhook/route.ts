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
          // NOTE: Unlocks are cookie-based (set by /api/checkout/verify on redirect).
          // This webhook is the production audit trail and handles cases where the
          // Stripe redirect back to success_url fails (browser closed, network error).
          // If you add a DB later, persist the unlock here keyed on lfg_uid + search_id.
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
