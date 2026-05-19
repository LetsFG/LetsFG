import { NextRequest, NextResponse } from 'next/server'

import { getLetsfgApiBase } from './letsfg-api'

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

function buildUpstreamHeaders(request: NextRequest): Headers {
  const headers = new Headers({
    Accept: request.headers.get('accept') || 'application/json',
  })

  const contentType = request.headers.get('content-type')
  if (contentType) {
    headers.set('Content-Type', contentType)
  }

  const cacheControl = request.headers.get('cache-control')
  if (cacheControl) {
    headers.set('Cache-Control', cacheControl)
  }

  const lastEventId = request.headers.get('last-event-id')
  if (lastEventId) {
    headers.set('Last-Event-ID', lastEventId)
  }

  const apiKey = extractDeveloperApiKey(request)
  if (apiKey) {
    headers.set('X-API-Key', apiKey)
  }

  const websiteApiKey = process.env.LETSFG_WEBSITE_API_KEY?.trim()
  if (websiteApiKey) {
    headers.set('Authorization', `Bearer ${websiteApiKey}`)
  }

  return headers
}

function buildResponseHeaders(response: Response): Headers {
  const headers = new Headers({ 'Cache-Control': 'no-store' })
  const passthroughHeaders = [
    'content-type',
    'retry-after',
    'www-authenticate',
    'x-accel-buffering',
    'connection',
  ]

  for (const headerName of passthroughHeaders) {
    const headerValue = response.headers.get(headerName)
    if (headerValue) {
      headers.set(headerName, headerValue)
    }
  }

  return headers
}

export async function proxyPublicDeveloperMcp(request: NextRequest, upstreamPath: string) {
  const bodyText = request.method === 'GET' ? '' : await request.text()
  const response = await fetch(`${getLetsfgApiBase()}${upstreamPath}${request.nextUrl.search}`, {
    method: request.method,
    headers: buildUpstreamHeaders(request),
    body: bodyText || undefined,
    cache: 'no-store',
    signal: AbortSignal.timeout(60_000),
  })

  return new NextResponse(response.body, {
    status: response.status,
    headers: buildResponseHeaders(response),
  })
}