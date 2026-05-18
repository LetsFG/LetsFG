import { NextRequest, NextResponse } from 'next/server'

import {
  developerApiError,
  developerApiFetch,
  resolveSiteOrigin,
} from '../../../../lib/developer-api'

function resolveDevelopersUrl(origin: string, locale: string) {
  const normalizedLocale = /^[a-z-]{2,10}$/i.test(locale) ? locale : 'en'
  return `${origin}/${normalizedLocale}/developers`
}

export async function POST(request: NextRequest) {
  let body: { apiKey?: unknown; locale?: unknown }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
  const locale = typeof body.locale === 'string' ? body.locale.trim() : 'en'
  if (!apiKey) {
    return NextResponse.json({ error: 'API key is required.' }, { status: 400 })
  }

  const origin = resolveSiteOrigin(request)
  const returnUrl = resolveDevelopersUrl(origin, locale)

  const { response, data } = await developerApiFetch('/api/v1/agents/billing-portal', {
    method: 'POST',
    apiKey,
    body: {
      return_url: returnUrl,
    },
  })

  if (!response.ok) {
    return NextResponse.json(
      { error: developerApiError(data, 'Could not open the Stripe billing portal.') },
      { status: response.status },
    )
  }

  return NextResponse.json(data)
}
