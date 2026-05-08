import { NextRequest, NextResponse } from 'next/server'
import { getStripe, toStripeAmount } from '../../../lib/stripe'

const API_BASE = process.env.LETSFG_API_URL || 'https://api.letsfg.co'
const WEBSITE_API_KEY = process.env.LETSFG_WEBSITE_API_KEY || ''
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://letsfg.co'

// When STRIPE_SECRET_KEY is a test key (sk_test_...), create the Stripe checkout
// session locally in Next.js instead of letting the production backend create it.
// This lets us test the full payment flow without touching the live backend's Stripe account.
const IS_TEST_MODE = (process.env.STRIPE_SECRET_KEY || '').startsWith('sk_test_')

export async function POST(req: NextRequest) {
  if (!WEBSITE_API_KEY) {
    return NextResponse.json({ error: 'Monitor service not configured' }, { status: 503 })
  }

  let body: {
    origin?: unknown
    destination?: unknown
    departure_date?: unknown
    return_date?: unknown
    adults?: unknown
    cabin_class?: unknown
    notify_email?: unknown
    weeks?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { origin, destination, departure_date, return_date, adults, cabin_class, notify_email, weeks } = body

  // Validate required fields
  if (
    typeof origin !== 'string' || !origin.trim() ||
    typeof destination !== 'string' || !destination.trim() ||
    typeof departure_date !== 'string' || !departure_date.trim()
  ) {
    return NextResponse.json({ error: 'Missing required fields: origin, destination, departure_date' }, { status: 400 })
  }

  // Basic email format check (only if provided)
  const emailValue = typeof notify_email === 'string' ? notify_email.trim() : ''
  if (emailValue && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)) {
    return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
  }

  // Validate weeks
  const weeksNum = typeof weeks === 'number' ? weeks : parseInt(String(weeks), 10)
  if (!Number.isInteger(weeksNum) || weeksNum < 1 || weeksNum > 52) {
    return NextResponse.json({ error: 'weeks must be between 1 and 52' }, { status: 400 })
  }

  // {CHECKOUT_SESSION_ID} is a Stripe placeholder — it is substituted by Stripe
  // with the real session ID before the redirect. Do NOT URL-encode the braces.
  const successUrl = `${SITE_URL}/monitor/success?cs={CHECKOUT_SESSION_ID}`
  const cancelUrl = `${SITE_URL}/monitor/cancelled`

  try {
    const originStr = String(origin).trim().toUpperCase()
    const destStr = String(destination).trim().toUpperCase()
    const depDateStr = String(departure_date).trim()

    const payload: Record<string, unknown> = {
      origin: originStr,
      destination: destStr,
      departure_date: depDateStr,
      weeks: weeksNum,
      success_url: successUrl,
      cancel_url: cancelUrl,
    }
    if (emailValue) {
      payload.notify_email = emailValue.toLowerCase()
    }
    if (return_date && typeof return_date === 'string' && return_date.trim()) {
      payload.return_date = return_date.trim()
    }
    if (adults && typeof adults === 'number' && adults >= 1) {
      payload.adults = adults
    }
    if (cabin_class && typeof cabin_class === 'string' && cabin_class.trim()) {
      payload.cabin_class = cabin_class.trim()
    }

    // ── TEST MODE: create Stripe session in Next.js using test SK ─────────────
    // Backend creates the monitor record only (skip_checkout=true).
    // We then create the Stripe checkout session here with the test SK.
    // The website webhook (checkout.session.completed) activates the monitor.
    if (IS_TEST_MODE) {
      const backendResp = await fetch(`${API_BASE}/api/v1/monitors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': WEBSITE_API_KEY },
        body: JSON.stringify({ ...payload, skip_checkout: true }),
        signal: AbortSignal.timeout(15_000),
      })
      const backendData = await backendResp.json()
      if (!backendResp.ok) {
        const message = typeof backendData?.detail === 'string' ? backendData.detail : 'Failed to create monitor'
        return NextResponse.json({ error: message }, { status: backendResp.status })
      }

      const monitorId = backendData.monitor_id as string
      const route = `${originStr} → ${destStr}`
      const stripe = getStripe()
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [{
          price_data: {
            currency: 'usd',
            unit_amount: toStripeAmount(5, 'usd'),
            product_data: {
              name: `LetsFG Flight Monitor — ${route}`,
              description: `Daily price updates for ${route} on ${depDateStr}. ${weeksNum} week(s), 1 free unlock/week included.`,
            },
          },
          quantity: weeksNum,
        }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        ...(emailValue ? { customer_email: emailValue.toLowerCase() } : {}),
        metadata: {
          monitor_id: monitorId,
          weeks: String(weeksNum),
          origin: originStr,
          destination: destStr,
          departure_date: depDateStr,
          platform: 'letsfg',
        },
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      })

      return NextResponse.json({
        monitor_id: monitorId,
        checkout_url: session.url,
        weeks_purchased: weeksNum,
        total_usd: weeksNum * 5,
        route,
        departure_date: depDateStr,
        notify_email: emailValue || null,
      })
    }

    // ── PRODUCTION: backend creates both the monitor record and Stripe session ─
    const resp = await fetch(`${API_BASE}/api/v1/monitors`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': WEBSITE_API_KEY,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    })

    const data = await resp.json()

    if (!resp.ok) {
      const message = typeof data?.detail === 'string' ? data.detail : 'Failed to create monitor'
      return NextResponse.json({ error: message }, { status: resp.status })
    }

    return NextResponse.json(data)
  } catch (err) {
    const message = err instanceof Error && err.name === 'TimeoutError'
      ? 'Request timed out — please try again'
      : 'Service unavailable — please try again'
    return NextResponse.json({ error: message }, { status: 503 })
  }
}
