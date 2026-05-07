import { NextRequest, NextResponse } from 'next/server'

const API_BASE = process.env.LETSFG_API_URL || 'https://api.letsfg.co'
const WEBSITE_API_KEY = process.env.LETSFG_WEBSITE_API_KEY || ''
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://letsfg.co'

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

  const successUrl = `${SITE_URL}/monitor/success`
  const cancelUrl = `${SITE_URL}/monitor/cancelled`

  try {
    const payload: Record<string, unknown> = {
      origin: String(origin).trim().toUpperCase(),
      destination: String(destination).trim().toUpperCase(),
      departure_date: String(departure_date).trim(),
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
