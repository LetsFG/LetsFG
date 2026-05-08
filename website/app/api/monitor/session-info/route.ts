import { NextRequest, NextResponse } from 'next/server'
import { getStripe } from '../../../../lib/stripe'

/**
 * GET /api/monitor/session-info?cs=cs_...
 *
 * Looks up a Stripe Checkout Session (created for a monitor payment) and
 * returns the monitor_id stored in the session metadata.
 *
 * Used by the /monitor/success page as a fallback when sessionStorage has
 * been lost (e.g. Stripe opened in a new tab, or browser privacy settings
 * cleared storage).
 */
export async function GET(req: NextRequest) {
  const cs = req.nextUrl.searchParams.get('cs')
  if (!cs || !cs.startsWith('cs_')) {
    return NextResponse.json({ error: 'Invalid session ID' }, { status: 400 })
  }

  try {
    const stripe = getStripe()
    const session = await stripe.checkout.sessions.retrieve(cs)

    if (session.payment_status !== 'paid') {
      return NextResponse.json({ error: 'Payment not completed' }, { status: 402 })
    }

    const monitorId = session.metadata?.monitor_id
    if (!monitorId) {
      return NextResponse.json({ error: 'No monitor associated with this session' }, { status: 404 })
    }

    return NextResponse.json({ monitor_id: monitorId, paid: true })
  } catch (err) {
    console.error('[monitor/session-info]', err)
    return NextResponse.json({ error: 'Session lookup failed' }, { status: 500 })
  }
}
