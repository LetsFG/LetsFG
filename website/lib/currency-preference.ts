/** Cookie storing preferred ISO 4217 code for new flight searches (website UI). */
export const LETSFG_CURRENCY_COOKIE = 'LETSFG_CURRENCY'

export const DEFAULT_SEARCH_CURRENCY = 'EUR'

export const DISPLAY_CURRENCIES = [
  { code: 'EUR', label: 'Euro' },
  { code: 'USD', label: 'US Dollar' },
  { code: 'GBP', label: 'British Pound' },
  { code: 'PLN', label: 'Polish Złoty' },
  { code: 'CHF', label: 'Swiss Franc' },
] as const

export type SupportedCurrencyCode = (typeof DISPLAY_CURRENCIES)[number]['code']

const ALLOWED = new Set<string>(DISPLAY_CURRENCIES.map((c) => c.code))

/** Broadcast after the cookie is updated so forms can sync hidden fields without a full reload. */
export const CURRENCY_CHANGE_EVENT = 'letsfg-currency-change'

export function normalizeCurrencyCode(raw: string | undefined | null): SupportedCurrencyCode | null {
  if (!raw || typeof raw !== 'string') return null
  const u = raw.trim().toUpperCase()
  return ALLOWED.has(u) ? (u as SupportedCurrencyCode) : null
}

export function resolveSearchCurrency(input: {
  queryParam?: string | null
  cookieValue?: string | null
}): SupportedCurrencyCode {
  const fromQuery = normalizeCurrencyCode(input.queryParam ?? undefined)
  if (fromQuery) return fromQuery
  const fromCookie = normalizeCurrencyCode(input.cookieValue ?? undefined)
  if (fromCookie) return fromCookie
  return DEFAULT_SEARCH_CURRENCY
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return ''
  }
}

export function readBrowserCurrencyPreference(): SupportedCurrencyCode {
  if (typeof document === 'undefined') return DEFAULT_SEARCH_CURRENCY
  const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${LETSFG_CURRENCY_COOKIE}=([^;]*)`))
  const raw = m?.[1] ? safeDecodeURIComponent(m[1].trim()) : ''
  return normalizeCurrencyCode(raw) ?? DEFAULT_SEARCH_CURRENCY
}
