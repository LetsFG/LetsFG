const withNextIntl = require('next-intl/plugin')('./i18n/request.ts')
const path = require('path')

// build: 2026-05-05
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  turbopack: {
    root: path.resolve(__dirname),
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'api.letsfg.co',
      },
      {
        protocol: 'https',
        hostname: 'pics.avs.io',
      },
    ],
  },
}

module.exports = withNextIntl(nextConfig)
