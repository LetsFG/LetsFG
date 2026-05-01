import type { MetadataRoute } from 'next'
import { routing } from '../i18n/routing'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://letsfg.co'

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()

  return routing.locales.flatMap((locale) => {
    const localeBase = `${SITE_URL}/${locale}`

    return [
      {
        url: localeBase,
        lastModified: now,
        changeFrequency: 'daily',
        priority: 1,
      },
      {
        url: `${localeBase}/developers`,
        lastModified: now,
        changeFrequency: 'weekly',
        priority: 0.7,
      },
    ]
  })
}