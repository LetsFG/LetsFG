import { defineRouting } from 'next-intl/routing'

export const routing = defineRouting({
  locales: ['en', 'pl', 'de', 'es', 'fr', 'it', 'pt', 'nl', 'sq', 'hr', 'sv'],
  defaultLocale: 'en',
})
