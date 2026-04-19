import createMiddleware from 'next-intl/middleware'
import { routing } from './i18n/routing'

export default createMiddleware(routing)

export const config = {
  // Match the root and all locale-prefixed paths.
  // Do NOT match /api/*, /results/*, /_next/*, /public/*
  matcher: ['/', '/(en|pl|de|es|fr|it|pt|nl|sq|hr|sv)/:path*'],
}
