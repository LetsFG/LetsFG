import { NextResponse } from 'next/server'

const API_BASE = process.env.LETSFG_API_URL || 'https://api.letsfg.co'

export async function GET() {
  try {
    const resp = await fetch(`${API_BASE}/api/v1/monitors/vapid-public-key`, {
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
