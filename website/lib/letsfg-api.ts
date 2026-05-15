const DEFAULT_API_BASE = 'https://api.letsfg.co'
const DEFAULT_ANALYTICS_API_BASE = 'https://letsfg-api-qryvus4jia-uc.a.run.app'

function normalizeBase(url: string): string {
  return url.replace(/\/$/, '')
}

export function getLetsfgApiBase(): string {
  return normalizeBase(process.env.LETSFG_API_URL || DEFAULT_API_BASE)
}

export function getLetsfgAnalyticsApiBase(): string {
  return normalizeBase(
    process.env.LETSFG_ANALYTICS_API_URL || process.env.LETSFG_API_URL || DEFAULT_ANALYTICS_API_BASE,
  )
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