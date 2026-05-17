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

  const resolvedLocale = locale || routing.defaultLocale

  return {
    locale: resolvedLocale,
    messages: (await import(`../messages/${resolvedLocale}.json`)).default,
  }
})
