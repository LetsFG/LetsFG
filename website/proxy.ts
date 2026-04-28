import createMiddleware from 'next-intl/middleware'
import { routing } from './i18n/routing'
import { NextResponse, type NextRequest } from 'next/server'
import { randomUUID } from 'crypto'
import { getSessionUid, HOSTING_SESSION_COOKIE_NAME, LEGACY_UID_COOKIE_NAME } from './lib/session-uid'

const intlMiddleware = createMiddleware(routing)
const ANON_USER_COOKIE_MAX_AGE_SECONDS = 10 * 365 * 24 * 60 * 60

// Paths that are NOT locale-prefixed — they live under app/results/ and app/book/
// directly (outside app/[locale]/). Passing them through intlMiddleware would
// cause next-intl to redirect /results → /en/results, then route /en/results
// to app/[locale]/results/ which doesn't exist → 404.
function isNonLocalePath(pathname: string): boolean {
  return (
    pathname.startsWith('/results') ||
    pathname.startsWith('/book') ||
    pathname.startsWith('/api')
  )
}

export default function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  // If someone hits a locale-prefixed path to results/book (e.g. /en/results?q=...),
  // strip the locale prefix and redirect to the canonical non-prefixed URL.
  const localePrefix = /^\/(?:en|pl|de|es|fr|it|pt|nl|sq|hr|sv)(\/(?:results|book)(?:\/.*)?)?$/
  const localePrefixMatch = pathname.match(localePrefix)
  if (localePrefixMatch && localePrefixMatch[1]) {
    const target = req.nextUrl.clone()
    target.pathname = localePrefixMatch[1]
    return NextResponse.redirect(target)
  }

  // For non-locale paths (results/book/api), skip intlMiddleware entirely.
  // intlMiddleware would redirect /results → /en/results, causing a loop.
  // Detect locale from the NEXT_LOCALE cookie so getLocale()/getMessages() still work.
  let res: NextResponse
  if (isNonLocalePath(pathname)) {
    const cookieLocale = req.cookies.get('NEXT_LOCALE')?.value
    const detectedLocale =
      cookieLocale && (routing.locales as readonly string[]).includes(cookieLocale)
        ? cookieLocale
        : routing.defaultLocale
    const requestHeaders = new Headers(req.headers)
    requestHeaders.set('x-next-intl-locale', detectedLocale)
    res = NextResponse.next({ request: { headers: requestHeaders } })
  } else {
    res = intlMiddleware(req) as NextResponse
  }

  // Firebase Hosting forwards only the specially-named `__session` cookie to
  // rewritten backends like this Cloud Run service. Keep the anonymous session
  // identity in `__session`, and mirror it to the legacy `lfg_uid` cookie for
  // direct Cloud Run access and backwards compatibility.
  const sessionUid = getSessionUid(req) || randomUUID()
  const cookieOptions = {
    httpOnly: true,
    // Stripe returns via a cross-site top-level redirect. Lax keeps the
    // anonymous session stable for that GET while still blocking most CSRF.
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: ANON_USER_COOKIE_MAX_AGE_SECONDS,
    path: '/',
  } as const

  res.cookies.set(HOSTING_SESSION_COOKIE_NAME, sessionUid, cookieOptions)
  res.cookies.set(LEGACY_UID_COOKIE_NAME, sessionUid, cookieOptions)

  return res
}

export const config = {
  // Match root, locale-prefixed paths, and key app pages (results, book, api).
  // Do NOT match /_next/*, static files.
  matcher: ['/', '/(en|pl|de|es|fr|it|pt|nl|sq|hr|sv)/:path*', '/results/:path*', '/book/:path*', '/api/:path*'],
}
