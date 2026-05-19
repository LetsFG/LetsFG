import { NextRequest, NextResponse } from 'next/server'

import { getLetsfgAnalyticsApiBase, getLetsfgApiBase, withLetsfgWebsiteApiHeaders } from '../../../../../lib/letsfg-api'

const API_BASE = getLetsfgApiBase()
const ANALYTICS_API_BASE = getLetsfgAnalyticsApiBase()
const ANALYTICS_CORS_ORIGINS = new Set([
  'https://stats.letsfg.co',
  'https://clistats-boostedchat.web.app',
])

const ALLOWED_ROUTES: Array<{ method: string; pattern: RegExp; requiresApiKey?: boolean }> = [
  { method: 'POST', pattern: /^\/api\/v1\/agents\/register$/, requiresApiKey: false },
  { method: 'POST', pattern: /^\/api\/v1\/agents\/hosted-checkout$/, requiresApiKey: false },
  { method: 'POST', pattern: /^\/api\/v1\/agents\/hosted-checkout\/complete$/, requiresApiKey: false },
  { method: 'POST', pattern: /^\/api\/v1\/agents\/setup-payment$/ },
  { method: 'POST', pattern: /^\/api\/v1\/agents\/billing-portal$/ },
  { method: 'POST', pattern: /^\/api\/v1\/flights\/search$/ },
  { method: 'GET', pattern: /^\/api\/v1\/flights\/locations\/[^/]+$/ },
  { method: 'GET', pattern: /^\/api\/v1\/flights\/providers$/ },
  { method: 'GET', pattern: /^\/api\/v1\/agents\/me$/ },
  { method: 'POST', pattern: /^\/api\/v1\/agents\/top-up$/ },
  { method: 'POST', pattern: /^\/api\/v1\/agents\/billing-settings$/ },
  { method: 'POST', pattern: /^\/api\/v1\/agents\/rotate-key$/ },
  { method: 'POST', pattern: /^\/api\/v1\/analytics\/stats\/record-search$/, requiresApiKey: false },
  { method: 'POST', pattern: /^\/api\/v1\/analytics\/stats\/record-local-search$/, requiresApiKey: false },
  { method: 'POST', pattern: /^\/api\/v1\/analytics\/search-sessions\/upsert$/, requiresApiKey: false },
  { method: 'POST', pattern: /^\/api\/v1\/analytics\/telemetry\/connector-results$/, requiresApiKey: false },
  { method: 'GET', pattern: /^\/api\/v1\/analytics\/stats\/public$/, requiresApiKey: false },
  { method: 'GET', pattern: /^\/api\/v1\/analytics\/dashboard$/, requiresApiKey: false },
  { method: 'GET', pattern: /^\/api\/v1\/analytics\/connectors\/health$/, requiresApiKey: false },
  { method: 'GET', pattern: /^\/api\/v1\/analytics\/connectors\/health\/badge$/, requiresApiKey: false },
  { method: 'GET', pattern: /^\/api\/v1\/analytics\/ga4\/summary$/, requiresApiKey: false },
  { method: 'GET', pattern: /^\/api\/v1\/analytics\/clients$/, requiresApiKey: false },
  { method: 'GET', pattern: /^\/api\/v1\/analytics\/experiments$/, requiresApiKey: false },
  { method: 'GET', pattern: /^\/api\/v1\/analytics\/search-sessions\/summary$/, requiresApiKey: false },
]

function extractDeveloperApiKey(request: NextRequest) {
  const headerKey = request.headers.get('x-api-key')?.trim()
  if (headerKey) return headerKey

  const authorization = request.headers.get('authorization') || ''
  if (authorization.toLowerCase().startsWith('bearer ')) {
    const bearerKey = authorization.slice(7).trim()
    if (bearerKey) return bearerKey
  }

  return request.nextUrl.searchParams.get('api_key')?.trim() || ''
}

function findAllowedRoute(method: string, path: string) {
  return ALLOWED_ROUTES.find((route) => route.method === method && route.pattern.test(path))
}

function getUpstreamBase(upstreamPath: string) {
  if (upstreamPath.startsWith('/api/v1/analytics/')) {
    return ANALYTICS_API_BASE
  }

  return API_BASE
}

function appendVaryHeader(headers: Headers, value: string) {
  const existing = headers.get('Vary')
  if (!existing) {
    headers.set('Vary', value)
    return
  }

  const values = existing.split(',').map((item) => item.trim()).filter(Boolean)
  if (!values.includes(value)) {
    values.push(value)
    headers.set('Vary', values.join(', '))
  }
}

function applyAnalyticsCorsHeaders(request: NextRequest, upstreamPath: string, headers: Headers) {
  if (!upstreamPath.startsWith('/api/v1/analytics/')) {
    return
  }

  const origin = request.headers.get('origin')?.trim() || ''
  if (!ANALYTICS_CORS_ORIGINS.has(origin)) {
    return
  }

  headers.set('Access-Control-Allow-Origin', origin)
  headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS')
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key, X-Client-Type')
  appendVaryHeader(headers, 'Origin')
}

function withAnalyticsCors(request: NextRequest, upstreamPath: string, response: NextResponse) {
  applyAnalyticsCorsHeaders(request, upstreamPath, response.headers)
  return response
}

function rejectUnsafeSetupPaymentPayload(payload: Record<string, unknown>) {
  const forbiddenFields = ['card_number', 'exp_month', 'exp_year', 'cvc', 'success_url', 'cancel_url']
  const forbiddenField = forbiddenFields.find((field) => field in payload)
  if (forbiddenField) {
    return NextResponse.json(
      {
        error:
          'Public setup-payment only accepts Stripe-generated payment_method_id or token. Raw card details and browser checkout fields are not accepted on this endpoint.',
      },
      { status: 400 },
    )
  }

  const paymentMethodId = typeof payload.payment_method_id === 'string' ? payload.payment_method_id.trim() : ''
  const token = typeof payload.token === 'string' ? payload.token.trim() : ''
  if (!paymentMethodId && !token) {
    return NextResponse.json(
      {
        error:
          'Provide a Stripe payment_method_id or token for API-only setup. Hosted checkout remains available separately for browser-based onboarding.',
      },
      { status: 400 },
    )
  }

  return {
    payment_method_id: paymentMethodId || undefined,
    token: token || undefined,
  }
}

async function resolveUpstreamBody(request: NextRequest, upstreamPath: string) {
  if (request.method === 'GET') {
    return { bodyText: '', contentType: '' }
  }

  const contentType = request.headers.get('content-type') || ''
  if (upstreamPath !== '/api/v1/agents/setup-payment') {
    return {
      bodyText: await request.text(),
      contentType,
    }
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const sanitized = rejectUnsafeSetupPaymentPayload(payload as Record<string, unknown>)
  if (sanitized instanceof NextResponse) {
    return sanitized
  }

  return {
    bodyText: JSON.stringify(sanitized),
    contentType: 'application/json',
  }
}

async function proxyRequest(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params
  const upstreamPath = `/api/v1/${path.join('/')}`
  const allowedRoute = findAllowedRoute(request.method, upstreamPath)

  if (!allowedRoute) {
    return withAnalyticsCors(request, upstreamPath, NextResponse.json({ error: 'This developer API route is not public.' }, { status: 404 }))
  }

  const apiKey = extractDeveloperApiKey(request)
  if (allowedRoute.requiresApiKey !== false && !apiKey) {
    return withAnalyticsCors(request, upstreamPath, NextResponse.json({ error: 'API key is required.' }, { status: 401 }))
  }

  const websiteApiKey = process.env.LETSFG_WEBSITE_API_KEY?.trim()
  const upstreamHeaders = new Headers(withLetsfgWebsiteApiHeaders({ Accept: 'application/json' }))
  if (apiKey) {
    upstreamHeaders.set('X-API-Key', apiKey)
  }
  if (websiteApiKey) {
    upstreamHeaders.set('Authorization', `Bearer ${websiteApiKey}`)
  }

  const upstreamBody = await resolveUpstreamBody(request, upstreamPath)
  if (upstreamBody instanceof NextResponse) {
    return upstreamBody
  }

  if (upstreamBody.contentType && upstreamBody.bodyText) {
    upstreamHeaders.set('Content-Type', upstreamBody.contentType)
  }

  const upstreamBase = getUpstreamBase(upstreamPath)

  const response = await fetch(`${upstreamBase}${upstreamPath}${request.nextUrl.search}`, {
    method: request.method,
    headers: upstreamHeaders,
    body: upstreamBody.bodyText || undefined,
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  })

  const text = await response.text()
  const headers = new Headers({ 'Cache-Control': 'no-store' })
  const responseContentType = response.headers.get('content-type')
  if (responseContentType) {
    headers.set('Content-Type', responseContentType)
  }
  const retryAfter = response.headers.get('retry-after')
  if (retryAfter) {
    headers.set('Retry-After', retryAfter)
  }
  const wwwAuthenticate = response.headers.get('www-authenticate')
  if (wwwAuthenticate) {
    headers.set('WWW-Authenticate', wwwAuthenticate)
  }

  return withAnalyticsCors(request, upstreamPath, new NextResponse(text, {
    status: response.status,
    headers,
  }))
}

export async function OPTIONS(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params
  const upstreamPath = `/api/v1/${path.join('/')}`
  const allowedRoute = ALLOWED_ROUTES.find((route) => route.pattern.test(upstreamPath))

  if (!allowedRoute) {
    return withAnalyticsCors(request, upstreamPath, NextResponse.json({ error: 'This developer API route is not public.' }, { status: 404 }))
  }

  const response = new NextResponse(null, {
    status: 204,
    headers: new Headers({ 'Cache-Control': 'no-store' }),
  })
  applyAnalyticsCorsHeaders(request, upstreamPath, response.headers)
  return response
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  return proxyRequest(request, context)
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  return proxyRequest(request, context)
}