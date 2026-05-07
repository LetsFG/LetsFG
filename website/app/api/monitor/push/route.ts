import { NextRequest, NextResponse } from 'next/server'

const API_BASE = process.env.LETSFG_API_URL || 'https://api.letsfg.co'
const WEBSITE_API_KEY = process.env.LETSFG_WEBSITE_API_KEY || ''

export async function POST(req: NextRequest) {
  if (!WEBSITE_API_KEY) {
    return NextResponse.json({ error: 'Monitor service not configured' }, { status: 503 })
  }

  let body: { monitor_id?: unknown; subscription?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { monitor_id, subscription } = body

  if (typeof monitor_id !== 'string' || !monitor_id.trim()) {
    return NextResponse.json({ error: 'Missing monitor_id' }, { status: 400 })
  }
  if (!subscription || typeof subscription !== 'object') {
    return NextResponse.json({ error: 'Missing subscription object' }, { status: 400 })
  }

  try {
    const resp = await fetch(
      `${API_BASE}/api/v1/monitors/${encodeURIComponent(monitor_id)}/subscribe-push`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': WEBSITE_API_KEY,
        },
        body: JSON.stringify({ subscription }),
        signal: AbortSignal.timeout(10_000),
      }
    )

    const data = await resp.json()
    if (!resp.ok) {
      const message = typeof data?.detail === 'string' ? data.detail : 'Failed to save subscription'
      return NextResponse.json({ error: message }, { status: resp.status })
    }

    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 })
  }
}
