import { NextRequest, NextResponse } from 'next/server'

import { developerApiError, developerApiFetch } from '../../../../../lib/developer-api'

export async function POST(request: NextRequest) {
  let body: { email?: unknown; code?: unknown }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const email = typeof body.email === 'string' ? body.email.trim() : ''
  const code = typeof body.code === 'string' ? body.code.trim() : ''
  if (!email || !code) {
    return NextResponse.json({ error: 'Billing email and login code are required.' }, { status: 400 })
  }

  const { response, data } = await developerApiFetch('/api/v1/agents/recover/verify', {
    method: 'POST',
    body: { email, code },
  })

  if (!response.ok) {
    return NextResponse.json(
      { error: developerApiError(data, 'Could not log in.') },
      { status: response.status },
    )
  }

  return NextResponse.json(data)
}
