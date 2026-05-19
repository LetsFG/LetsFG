const DEFAULT_INTERNAL_API_BASE = 'https://letsfg-api-qryvus4jia-uc.a.run.app'
const DEFAULT_ANALYTICS_API_BASE = DEFAULT_INTERNAL_API_BASE
const DEFAULT_PUBLIC_SITE_URL = 'https://letsfg.co'

function normalizeBase(url: string): string {
  return url.replace(/\/$/, '')
}

export function getLetsfgApiBase(): string {
  return normalizeBase(process.env.LETSFG_API_URL || DEFAULT_INTERNAL_API_BASE)
}

export function getLetsfgAnalyticsApiBase(): string {
  return normalizeBase(
    process.env.LETSFG_ANALYTICS_API_URL || process.env.LETSFG_API_URL || DEFAULT_ANALYTICS_API_BASE,
  )
}

export function getLetsfgPublicSiteUrl(): string {
  return normalizeBase(process.env.NEXT_PUBLIC_SITE_URL || DEFAULT_PUBLIC_SITE_URL)
}

export function getLetsfgPublicDeveloperHostRoot(): string {
  return `${getLetsfgPublicSiteUrl()}/developers`
}

export function getLetsfgPublicDeveloperApiRoot(): string {
  return `${getLetsfgPublicDeveloperHostRoot()}/api`
}

export function getLetsfgPublicDeveloperApiBase(): string {
  return `${getLetsfgPublicDeveloperApiRoot()}/v1`
}

export function getLetsfgPublicDeveloperDocsUrl(): string {
  return `${getLetsfgPublicDeveloperApiRoot()}/docs`
}

export function getLetsfgPublicDeveloperOpenApiUrl(): string {
  return `${getLetsfgPublicDeveloperApiRoot()}/openapi.json`
}

export function getLetsfgPublicDeveloperMcpUrl(): string {
  return `${getLetsfgPublicDeveloperApiRoot()}/mcp`
}

export function withLetsfgWebsiteApiHeaders(headers: Record<string, string> = {}): Record<string, string> {
  const websiteApiKey = process.env.LETSFG_WEBSITE_API_KEY?.trim()
  if (!websiteApiKey) {
    return headers
  }

  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === 'x-api-key') {
      return headers
    }
  }

  return {
    ...headers,
    'X-API-Key': websiteApiKey,
  }
}