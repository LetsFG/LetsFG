const withNextIntl = require('next-intl/plugin')('./i18n/request.ts')

// build: 2026-05-05
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'api.letsfg.co',
      },
    ],
  },
}

module.exports = withNextIntl(nextConfig)
