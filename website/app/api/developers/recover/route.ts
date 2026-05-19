import { NextRequest, NextResponse } from 'next/server'

import { developerApiError, developerApiFetch } from '../../../../lib/developer-api'

export async function POST(request: NextRequest) {
  let body: { email?: unknown }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const email = typeof body.email === 'string' ? body.email.trim() : ''
  if (!email) {
    return NextResponse.json({ error: 'Billing email is required.' }, { status: 400 })
  }

  const { response, data } = await developerApiFetch('/api/v1/agents/recover', {
    method: 'POST',
    body: { email },
  })

  if (!response.ok) {
    return NextResponse.json(
      { error: developerApiError(data, 'Could not send a login code.') },
      { status: response.status },
    )
  }

  return NextResponse.json(data)
}
