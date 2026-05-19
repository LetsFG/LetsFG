import { NextRequest } from 'next/server'

export type PublicDeveloperUrls = {
  siteUrl: string
  developerHostRoot: string
  apiRoot: string
  apiBase: string
  docsUrl: string
  openApiUrl: string
  mcpUrl: string
  llmsUrl: string
  agentManifestUrl: string
  aiPluginUrl: string
}

export function resolvePublicOrigin(request: NextRequest): string {
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const forwardedHost =
    request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() ||
    request.headers.get('host')?.split(',')[0]?.trim()

  if (forwardedHost) {
    return `${forwardedProto || 'https'}://${forwardedHost}`
  }

  return process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin
}

export function getPublicDeveloperUrls(origin: string): PublicDeveloperUrls {
  const developerHostRoot = `${origin}/developers`
  const apiRoot = `${developerHostRoot}/api`

  return {
    siteUrl: origin,
    developerHostRoot,
    apiRoot,
    apiBase: `${apiRoot}/v1`,
    docsUrl: `${apiRoot}/docs`,
    openApiUrl: `${apiRoot}/openapi.json`,
    mcpUrl: `${apiRoot}/mcp`,
    llmsUrl: `${apiRoot}/llms.txt`,
    agentManifestUrl: `${apiRoot}/.well-known/agent.json`,
    aiPluginUrl: `${apiRoot}/.well-known/ai-plugin.json`,
  }
}

export function buildPublicDeveloperAiPluginManifest(origin: string) {
  const urls = getPublicDeveloperUrls(origin)

  return {
    schema_version: 'v1',
    name_for_human: 'LetsFG Developer API',
    name_for_model: 'letsfg',
    description_for_human:
      'Public letsfg.co developer API for agent registration, browserless Stripe setup, prepaid top-ups, flight search, and MCP access.',
    description_for_model:
      'Use the LetsFG public developer API for agent registration, browserless Stripe payment setup with payment_method_id or token, prepaid top-ups, flight search, and MCP access. Canonical REST base: ' +
      `${urls.apiBase}. Canonical MCP endpoint: ${urls.mcpUrl}. Local Python SDK searches remain free and do not require public developer signup.`,
    auth: {
      type: 'service_http',
      authorization_type: 'bearer',
      verification_tokens: {},
    },
    api: {
      type: 'openapi',
      url: urls.openApiUrl,
    },
    logo_url: `${origin}/logo.png`,
    contact_email: 'api@letsfg.co',
    legal_info_url: `${origin}/terms`,
  }
}

export function buildPublicDeveloperAgentManifest(origin: string) {
  const urls = getPublicDeveloperUrls(origin)

  return {
    name: 'LetsFG',
    description:
      'Public developer API for agent-native flight search, prepaid billing, and MCP access. Local SDK searches remain free and do not require public developer signup.',
    url: urls.apiRoot,
    capabilities: ['flight_search', 'location_resolve', 'developer_billing', 'mcp'],
    authentication: {
      type: 'api_key',
      header: 'X-API-Key',
      registration_url: `${urls.apiBase}/agents/register`,
      note: 'Register, attach a Stripe payment_method_id or token, top up prepaid balance, then search.',
    },
    openapi_url: urls.openApiUrl,
    mcp_url: urls.mcpUrl,
    documentation_url: urls.docsUrl,
    llms_txt: urls.llmsUrl,
    pricing: {
      search: 'Public developer search consumes prepaid balance; local SDK search stays free.',
      unlock: 'Booking unlocks use your saved payment method when required.',
    },
  }
}

export function buildPublicDeveloperLlmsText(origin: string): string {
  const urls = getPublicDeveloperUrls(origin)

  return `# LetsFG Developer API

Canonical public developer API root: ${urls.apiRoot}
Canonical public REST base: ${urls.apiBase}
OpenAPI JSON: ${urls.openApiUrl}
Swagger UI: ${urls.docsUrl}
MCP endpoint: ${urls.mcpUrl}

## Public developer flow

1. Register: POST ${urls.apiBase}/agents/register
2. Attach a Stripe payment_method_id or token: POST ${urls.apiBase}/agents/setup-payment
3. Top up prepaid balance: POST ${urls.apiBase}/agents/top-up
4. Search flights: POST ${urls.apiBase}/flights/search

Public developer search debits prepaid balance.

## Local SDK flow

Local Python SDK searches remain free and do not require public developer signup.
Use:\n  pip install letsfg\n  letsfg search-local LHR BCN 2026-06-15

## Discovery

Agent manifest: ${urls.agentManifestUrl}
AI plugin manifest: ${urls.aiPluginUrl}
LLMs.txt: ${urls.llmsUrl}`
}