import { NextRequest, NextResponse } from 'next/server'

import { developerApiError, developerApiFetch } from '../../../../lib/developer-api'

export async function POST(request: NextRequest) {
  let body: { sessionId?: unknown; apiKey?: unknown }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
  if (!sessionId) {
    return NextResponse.json({ error: 'Stripe session ID is required.' }, { status: 400 })
  }

  const { response, data } = await developerApiFetch('/api/v1/agents/hosted-checkout/complete', {
    method: 'POST',
    body: {
      session_id: sessionId,
      api_key: apiKey || undefined,
    },
  })

  if (!response.ok) {
    return NextResponse.json(
      { error: developerApiError(data, 'Could not finish Stripe setup.') },
      { status: response.status },
    )
  }

  return NextResponse.json(data)
}
