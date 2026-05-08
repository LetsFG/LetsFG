import type { MetadataRoute } from 'next'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://letsfg.co'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/book/', '/results/'],
    },
    sitemap: [`${SITE_URL}/sitemap.xml`, `${SITE_URL}/sitemap-flights.xml`],
    host: SITE_URL,
  }
}