import type { NextRequest } from 'next/server'

import { getLetsfgApiBase, withLetsfgWebsiteApiHeaders } from './letsfg-api'

const API_BASE =
  process.env.LETSFG_DEVELOPER_API_URL ||
  (process.env.NODE_ENV === 'development'
    ? 'http://127.0.0.1:8080'
    : getLetsfgApiBase())
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://letsfg.co'
const DEVELOPER_API_TIMEOUT_MS = 60_000

export async function developerApiFetch(
  path: string,
  init: {
    method?: string
    apiKey?: string
    body?: unknown
  } = {},
) {
  const websiteApiKey = process.env.LETSFG_WEBSITE_API_KEY?.trim()
  const headers = new Headers(withLetsfgWebsiteApiHeaders({ Accept: 'application/json' }))
  if (init.apiKey) {
    headers.set('X-API-Key', init.apiKey)
    if (websiteApiKey) {
      headers.set('Authorization', `Bearer ${websiteApiKey}`)
    }
  }

  let body: string | undefined
  if (init.body !== undefined) {
    headers.set('Content-Type', 'application/json')
    body = JSON.stringify(init.body)
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body,
    cache: 'no-store',
    signal: AbortSignal.timeout(DEVELOPER_API_TIMEOUT_MS),
  })

  const text = await response.text()
  let data: unknown = {}
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = { detail: text }
    }
  }

  return { response, data }
}

export function developerApiError(data: unknown, fallback: string) {
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>
    if (typeof record.detail === 'string') return record.detail
    if (typeof record.message === 'string') return record.message
    if (typeof record.error === 'string') return record.error
  }
  return fallback
}

export function resolveSiteOrigin(request: NextRequest) {
  const requestOrigin = request.headers.get('origin')
  if (!requestOrigin) {
    return SITE_URL
  }

  try {
    if (new URL(requestOrigin).host === new URL(SITE_URL).host) {
      return requestOrigin
    }
  } catch {
    return SITE_URL
  }

  return SITE_URL
}