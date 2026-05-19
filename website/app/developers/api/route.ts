import { NextRequest, NextResponse } from 'next/server'

import { getPublicDeveloperUrls, resolvePublicOrigin } from '../../../lib/public-developer-api'

export async function GET(request: NextRequest) {
  const urls = getPublicDeveloperUrls(resolvePublicOrigin(request))

  return NextResponse.json({
    name: 'LetsFG Developer API',
    base_url: urls.apiBase,
    openapi_url: urls.openApiUrl,
    swagger_url: urls.docsUrl,
    mcp_url: urls.mcpUrl,
    llms_url: urls.llmsUrl,
    agent_manifest_url: urls.agentManifestUrl,
    ai_plugin_url: urls.aiPluginUrl,
    authentication:
      'API-only agents can register first, then send their developer key in the X-API-Key header on authenticated routes. Setup-payment accepts only Stripe-generated payment_method_id or token on the public API.',
    note:
      'This public endpoint is served through letsfg.co. Agents can either onboard with hosted checkout or stay API-only: register, attach a Stripe payment method or token, top up prepaid balance, then search.',
    endpoints: [
      { method: 'POST', path: `${urls.apiBase}/agents/register`, requires_api_key: false },
      { method: 'POST', path: `${urls.apiBase}/agents/hosted-checkout`, requires_api_key: false },
      { method: 'POST', path: `${urls.apiBase}/agents/hosted-checkout/complete`, requires_api_key: false },
      {
        method: 'POST',
        path: `${urls.apiBase}/agents/setup-payment`,
        accepted_fields: ['payment_method_id', 'token'],
      },
      { method: 'POST', path: `${urls.apiBase}/agents/billing-portal` },
      { method: 'POST', path: `${urls.apiBase}/flights/search` },
      { method: 'GET', path: `${urls.apiBase}/flights/locations/{query}` },
      { method: 'GET', path: `${urls.apiBase}/flights/providers` },
      { method: 'GET', path: `${urls.apiBase}/agents/me` },
      { method: 'POST', path: `${urls.apiBase}/agents/top-up` },
      { method: 'POST', path: `${urls.apiBase}/agents/billing-settings` },
      { method: 'POST', path: `${urls.apiBase}/agents/rotate-key` },
      { method: 'POST', path: urls.mcpUrl, requires_api_key: false },
      { method: 'GET', path: urls.mcpUrl, requires_api_key: false },
    ],
  })
}