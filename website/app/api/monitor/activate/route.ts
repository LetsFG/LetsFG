import { NextRequest, NextResponse } from 'next/server'
import { getMonitorStripe } from '../../../../lib/stripe'

const API_BASE = process.env.LETSFG_API_URL || 'https://api.letsfg.co'
const WEBSITE_API_KEY = process.env.LETSFG_WEBSITE_API_KEY || ''

/**
 * POST /api/monitor/activate
 * Body: { cs: string, monitor_id: string }
 *
 * Verifies a Stripe Checkout Session is paid, then calls the backend
 * record-payment endpoint to activate the monitor.
 *
 * Used in test mode (sk_test_...) where the local Stripe webhook is not
 * running. In production the webhook handles activation automatically;
 * calling this again is harmless since record-payment is idempotent.
 */
export async function POST(req: NextRequest) {
  let body: { cs?: unknown; monitor_id?: unknown }
  try {
    body = await req.json()
  } catch (_) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const cs = typeof body.cs === 'string' ? body.cs.trim() : ''
  const monitorId = typeof body.monitor_id === 'string' ? body.monitor_id.trim() : ''

  if (!cs.startsWith('cs_') || !monitorId) {
    return NextResponse.json({ error: 'cs and monitor_id are required' }, { status: 400 })
  }

  try {
    const stripe = getMonitorStripe()
    const session = await stripe.checkout.sessions.retrieve(cs)

    if (session.payment_status !== 'paid') {
      return NextResponse.json({ error: 'Payment not completed' }, { status: 402 })
    }

    // Call backend record-payment to activate the monitor
    const backendResp = await fetch(
      `${API_BASE}/api/v1/monitors/${encodeURIComponent(monitorId)}/record-payment`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': WEBSITE_API_KEY },
        body: JSON.stringify({
          stripe_payment_intent_id: session.payment_intent ?? '',
          amount_usd: (session.amount_total ?? 0) / 100,
        }),
        signal: AbortSignal.timeout(10_000),
      }
    )

    // 200 = activated now, 409 = already active — both are success
    if (backendResp.ok || backendResp.status === 409) {
      return NextResponse.json({ activated: true })
    }

    const detail = await backendResp.json().catch(() => ({})) as { detail?: string }
    // Already active (404 with "already activated" message) is also OK
    if (backendResp.status === 404 && typeof detail.detail === 'string' && detail.detail.includes('already')) {
      return NextResponse.json({ activated: true })
    }

    return NextResponse.json({ error: detail.detail || 'Activation failed' }, { status: backendResp.status })
  } catch (err) {
    console.error('[monitor/activate]', err)
    return NextResponse.json({ error: 'Activation request failed' }, { status: 500 })
  }
}
