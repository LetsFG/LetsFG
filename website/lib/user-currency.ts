const DEFAULT_CURRENCY = 'EUR'

const GEO_COUNTRY_HEADERS = [
  'cf-ipcountry',
  'x-vercel-ip-country',
  'x-appengine-country',
  'cloudfront-viewer-country',
  'x-country-code',
  'x-country',
  'x-geo-country',
] as const

const COUNTRY_TO_CURRENCY: Record<string, string> = {
  AE: 'AED',
  AT: 'EUR',
  AU: 'AUD',
  BE: 'EUR',
  BR: 'BRL',
  CA: 'CAD',
  CH: 'CHF',
  CY: 'EUR',
  CZ: 'CZK',
  DE: 'EUR',
  DK: 'DKK',
  EE: 'EUR',
  EG: 'EGP',
  ES: 'EUR',
  FI: 'EUR',
  FR: 'EUR',
  GB: 'GBP',
  GR: 'EUR',
  HK: 'HKD',
  HR: 'EUR',
  HU: 'HUF',
  IE: 'EUR',
  IN: 'INR',
  IT: 'EUR',
  JP: 'JPY',
  KR: 'KRW',
  LT: 'EUR',
  LU: 'EUR',
  LV: 'EUR',
  MT: 'EUR',
  MX: 'MXN',
  MY: 'MYR',
  NL: 'EUR',
  NO: 'NOK',
  NZ: 'NZD',
  PL: 'PLN',
  PT: 'EUR',
  RO: 'RON',
  SA: 'SAR',
  SE: 'SEK',
  SG: 'SGD',
  SI: 'EUR',
  SK: 'EUR',
  TH: 'THB',
  TR: 'TRY',
  US: 'USD',
  ZA: 'ZAR',
}

const LANGUAGE_TO_CURRENCY: Record<string, string> = {
  de: 'EUR',
  es: 'EUR',
  fr: 'EUR',
  hr: 'EUR',
  it: 'EUR',
  nl: 'EUR',
  pl: 'PLN',
  pt: 'EUR',
  sq: 'EUR',
  sv: 'SEK',
}

export const KNOWN_CURRENCY_CODES = Array.from(new Set([
  DEFAULT_CURRENCY,
  ...Object.values(COUNTRY_TO_CURRENCY),
  ...Object.values(LANGUAGE_TO_CURRENCY),
])).sort()

type HeaderLike = Pick<Headers, 'get'> | null | undefined

function normalizeCountryCode(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase()
  if (!normalized || normalized.length !== 2) {
    return null
  }

  return normalized
}

function getCurrencyForCountry(countryCode: string | null | undefined): string | null {
  const normalized = normalizeCountryCode(countryCode)
  if (!normalized) {
    return null
  }

  return COUNTRY_TO_CURRENCY[normalized] || null
}

function getCountryFromLocaleTag(locale: string): string | null {
  const normalized = locale.trim()
  if (!normalized) {
    return null
  }

  try {
    const region = new Intl.Locale(normalized).region
    return normalizeCountryCode(region)
  } catch {
    const match = normalized.match(/^[a-z]{2,3}(?:-[A-Za-z]{4})?-([A-Za-z]{2})$/i)
    return normalizeCountryCode(match?.[1])
  }
}

function getCurrencyFromAcceptLanguage(value: string | null | undefined): string | null {
  if (!value) {
    return null
  }

  const localeTags = value
    .split(',')
    .map((part) => part.split(';')[0]?.trim())
    .filter(Boolean) as string[]

  for (const localeTag of localeTags) {
    const countryCurrency = getCurrencyForCountry(getCountryFromLocaleTag(localeTag))
    if (countryCurrency) {
      return countryCurrency
    }

    const language = localeTag.split('-')[0]?.toLowerCase()
    if (language && LANGUAGE_TO_CURRENCY[language]) {
      return LANGUAGE_TO_CURRENCY[language]
    }
  }

  return null
}

export function detectPreferredCurrency(headers: HeaderLike, fallback = DEFAULT_CURRENCY): string {
  if (!headers) {
    return fallback
  }

  for (const headerName of GEO_COUNTRY_HEADERS) {
    const currency = getCurrencyForCountry(headers.get(headerName))
    if (currency) {
      return currency
    }
  }

  const acceptLanguageCurrency = getCurrencyFromAcceptLanguage(headers.get('accept-language'))
  if (acceptLanguageCurrency) {
    return acceptLanguageCurrency
  }

  const locale = headers.get('x-next-intl-locale')?.trim().toLowerCase()
  if (locale && LANGUAGE_TO_CURRENCY[locale]) {
    return LANGUAGE_TO_CURRENCY[locale]
  }

  return fallback
}

export function formatCurrencyAmount(amount: number, currency: string, locale?: string): string {
  const rounded = Math.round(amount * 100) / 100
  const normalizedCurrency = currency.trim().toUpperCase()

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: normalizedCurrency,
      currencyDisplay: 'symbol',
      minimumFractionDigits: Number.isInteger(rounded) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(rounded)
  } catch {
    const formatted = Number.isInteger(rounded)
      ? String(Math.round(rounded))
      : rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
    return `${normalizedCurrency} ${formatted}`
  }
}