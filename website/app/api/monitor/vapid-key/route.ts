import { NextResponse } from 'next/server'

const API_BASE = process.env.LETSFG_API_URL || 'https://api.letsfg.co'
const WEBSITE_API_KEY = process.env.LETSFG_WEBSITE_API_KEY || ''

export async function GET() {
  // If a local VAPID key is set (local dev or explicit override), serve it directly.
  // The public key is intentionally public — safe to serve without auth.
  const localPublicKey = process.env.VAPID_PUBLIC_KEY
  if (localPublicKey) {
    return NextResponse.json({ vapid_public_key: localPublicKey })
  }

  // Otherwise proxy to the backend API.
  try {
    const resp = await fetch(`${API_BASE}/api/v1/monitors/vapid-public-key`, {
      headers: { 'X-API-Key': WEBSITE_API_KEY },
      signal: AbortSignal.timeout(5_000),
    })
    const data = await resp.json()
    if (!resp.ok) {
      return NextResponse.json({ error: 'Failed to fetch VAPID key' }, { status: resp.status })
    }
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 })
  }
}
