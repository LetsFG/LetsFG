import { getRequestConfig } from 'next-intl/server'
import { hasLocale } from 'next-intl'
import { routing } from './routing'
import { cookies } from 'next/headers'
import { resolveLocaleCookieValue } from '../lib/locale-routing'

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale
  let locale = hasLocale(routing.locales, requested) ? requested : null

  if (!locale) {
    // For pages outside [locale] routing (results, book), fall back to cookie
    const cookieStore = await cookies()
    locale = resolveLocaleCookieValue((cookieName) => cookieStore.get(cookieName)?.value) || routing.defaultLocale
  }

  const localeMessages = (await import(`../messages/${locale}.json`)).default
  // English-fallback merge: when a non-English locale is missing a key,
  // serve the English string instead of next-intl's default behaviour
  // (rendering the raw key path like "Results.heroTitle"). Lets us roll
  // out new keys to en.json first and translate at our pace without ever
  // shipping broken UI to non-English users.
  let messages = localeMessages
  if (locale !== 'en') {
    const enMessages = (await import('../messages/en.json')).default
    messages = deepMerge(enMessages, localeMessages)
  }

  return {
    locale,
    messages,
  }
})

/** Shallow-recursive merge: for each top-level namespace, take the English
 *  object as base and overlay the locale's translations. Non-object values
 *  at the top level (rare) are taken as-is from the locale or English. */
function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(override)) {
    const baseValue = base[key]
    if (
      value && typeof value === 'object' && !Array.isArray(value)
      && baseValue && typeof baseValue === 'object' && !Array.isArray(baseValue)
    ) {
      result[key] = deepMerge(baseValue as Record<string, unknown>, value as Record<string, unknown>)
    } else {
      result[key] = value
    }
  }
  return result
}
