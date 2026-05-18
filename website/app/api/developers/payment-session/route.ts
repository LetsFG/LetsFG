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

  const origin = resolveSiteOrigin(request)
  const developersUrl = resolveDevelopersUrl(origin, locale)
  const successUrl = `${developersUrl}?developerSetup=card-connected&session_id={CHECKOUT_SESSION_ID}`
  const cancelUrl = `${developersUrl}?developerSetup=card-cancelled`

  const targetPath = apiKey ? '/api/v1/agents/setup-payment' : '/api/v1/agents/hosted-checkout'
  const payload = apiKey
    ? {
        success_url: successUrl,
        cancel_url: cancelUrl,
      }
    : {
        success_url: successUrl,
        cancel_url: cancelUrl,
      }

  const { response, data } = await developerApiFetch(targetPath, {
    method: 'POST',
    apiKey: apiKey || undefined,
    body: payload,
  })

  if (!response.ok) {
    return NextResponse.json(
      { error: developerApiError(data, 'Could not create a card setup session.') },
      { status: response.status },
    )
  }

  return NextResponse.json(data)
}