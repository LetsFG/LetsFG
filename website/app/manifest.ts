import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'LetsFG',
    short_name: 'LetsFG',
    description: 'Find cheap flights with natural language search and raw airline prices.',
    start_url: '/en',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#ff9116',
    icons: [
      {
        src: '/logo.png',
        sizes: '512x512',
        type: 'image/png',
      },
      {
        src: '/logo.png',
        sizes: '192x192',
        type: 'image/png',
      },
    ],
  }
}