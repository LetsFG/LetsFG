import { NextRequest, NextResponse } from 'next/server'

import { developerApiError, developerApiFetch } from '../../../../lib/developer-api'

export async function POST(request: NextRequest) {
  let body: { apiKey?: unknown }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
  if (!apiKey) {
    return NextResponse.json({ error: 'API key is required.' }, { status: 400 })
  }

  const { response, data } = await developerApiFetch('/api/v1/agents/me', {
    method: 'GET',
    apiKey,
  })

  if (!response.ok) {
    return NextResponse.json(
      { error: developerApiError(data, 'Could not load developer account.') },
      { status: response.status },
    )
  }

  return NextResponse.json(data)
}