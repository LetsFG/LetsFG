import { hasLocale } from 'next-intl'

import { routing } from '../i18n/routing'

const LOCALE_COOKIE_NAMES = ['LETSFG_LOCALE', 'NEXT_LOCALE'] as const
type SupportedLocale = (typeof routing.locales)[number]

export function normalizeSupportedLocale(value?: string | null): SupportedLocale | null {
  const normalized = value?.trim().toLowerCase()
  return normalized && hasLocale(routing.locales, normalized)
    ? normalized as SupportedLocale
    : null
}

export function resolveLocaleCookieValue(
  getCookieValue: (name: (typeof LOCALE_COOKIE_NAMES)[number]) => string | undefined,
): SupportedLocale | null {
  for (const cookieName of LOCALE_COOKIE_NAMES) {
    const locale = normalizeSupportedLocale(getCookieValue(cookieName))
    if (locale) {
      return locale
    }
  }

  return null
}

export function buildLocaleHomePath(locale?: string | null, probeMode = false): string {
  const resolvedLocale = normalizeSupportedLocale(locale) || routing.defaultLocale
  return probeMode ? `/${resolvedLocale}?probe=1` : `/${resolvedLocale}`
}