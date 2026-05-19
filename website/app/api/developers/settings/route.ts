import { NextRequest, NextResponse } from 'next/server'

import { developerApiError, developerApiFetch } from '../../../../lib/developer-api'

export async function POST(request: NextRequest) {
  let body: {
    apiKey?: unknown
    autoRefillEnabled?: unknown
    autoRefillAmountCents?: unknown
  }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
  const autoRefillEnabled = Boolean(body.autoRefillEnabled)
  const autoRefillAmountCents = body.autoRefillAmountCents == null ? undefined : Number(body.autoRefillAmountCents)

  if (!apiKey) {
    return NextResponse.json({ error: 'API key is required.' }, { status: 400 })
  }

  const { response, data } = await developerApiFetch('/api/v1/agents/billing-settings', {
    method: 'POST',
    apiKey,
    body: {
      auto_refill_enabled: autoRefillEnabled,
      auto_refill_amount_cents: autoRefillEnabled ? autoRefillAmountCents : undefined,
    },
  })

  if (!response.ok) {
    return NextResponse.json(
      { error: developerApiError(data, 'Could not update automatic refill settings.') },
      { status: response.status },
    )
  }

  return NextResponse.json(data)
}