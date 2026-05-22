import type { MetadataRoute } from 'next'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://letsfg.co'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/book/', '/results/'],
    },
    // Standard sitemaps + AI-agent discovery URLs surfaced here so crawlers
    // that read robots.txt first can find the native search guide and llms.txt.
    sitemap: [
      `${SITE_URL}/sitemap.xml`,
      `${SITE_URL}/sitemap-flights.xml`,
      `${SITE_URL}/llms.txt`,
      `${SITE_URL}/for-agents`,
    ],
    host: SITE_URL,
  }
}