import { NextRequest, NextResponse } from 'next/server'

import { resolveSiteOrigin } from '../../../../lib/developer-api'

export async function POST(request: NextRequest) {
  const developersUrl = `${resolveSiteOrigin(request)}/en/developers`

  return NextResponse.json(
    {
      status: 'deprecated',
      error: 'Direct website registration no longer creates API keys.',
      message:
        'Start Stripe-first onboarding with the public hosted-checkout API or through the developers portal, then the API key is issued after checkout completes.',
      developers_url: developersUrl,
      public_api_register: '/developers/api/v1/agents/register',
      public_api_setup_payment: '/developers/api/v1/agents/setup-payment',
      public_onboarding_start: '/developers/api/v1/agents/hosted-checkout',
      public_onboarding_complete: '/developers/api/v1/agents/hosted-checkout/complete',
      payment_session_path: '/api/developers/payment-session',
    },
    { status: 410 },
  )
}