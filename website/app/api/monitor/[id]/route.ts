import { NextRequest, NextResponse } from 'next/server'

const API_BASE = process.env.LETSFG_API_URL || 'https://api.letsfg.co'
const WEBSITE_API_KEY = process.env.LETSFG_WEBSITE_API_KEY || ''

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!WEBSITE_API_KEY) {
    return NextResponse.json({ error: 'Monitor service not configured' }, { status: 503 })
  }

  const resp = await fetch(`${API_BASE}/api/v1/monitors/${encodeURIComponent(id)}`, {
    headers: { 'X-API-Key': WEBSITE_API_KEY },
    signal: AbortSignal.timeout(10_000),
  })

  const data = await resp.json()
  return NextResponse.json(data, { status: resp.status })
}
