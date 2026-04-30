import createMiddleware from 'next-intl/middleware'
import { routing } from './i18n/routing'
import { NextResponse, type NextRequest } from 'next/server'
import { randomUUID } from 'crypto'
import { getSessionUid, HOSTING_SESSION_COOKIE_NAME, LEGACY_UID_COOKIE_NAME } from './lib/session-uid'
import {
  buildRateLimitClientKey,
  checkRateLimit,
  getGlobalRateLimitStore,
  getRateLimitPolicy,
} from './lib/rate-limit'

const intlMiddleware = createMiddleware(routing)
const ANON_USER_COOKIE_MAX_AGE_SECONDS = 10 * 365 * 24 * 60 * 60
const RATE_LIMIT_DISABLED = process.env.LETSFG_RATE_LIMIT_DISABLED === '1'
const rateLimitStore = getGlobalRateLimitStore()

// Paths that are NOT locale-prefixed — they live under app/results/ and app/book/
// directly (outside app/[locale]/). Passing them through intlMiddleware would
// cause next-intl to redirect /results → /en/results, then route /en/results
// to app/[locale]/results/ which doesn't exist → 404.
function isNonLocalePath(pathname: string): boolean {
  return (
    pathname.startsWith('/results') ||
    pathname.startsWith('/book') ||
    pathname.startsWith('/probe') ||
    pathname.startsWith('/api')
  )
}

function setRateLimitHeaders(
  res: NextResponse,
  pathname: string,
  rateLimit: { limit: number; remaining: number; resetAfterMs: number },
) {
  res.headers.set('X-Letsfg-RateLimit-Limit', String(rateLimit.limit))
  res.headers.set('X-Letsfg-RateLimit-Remaining', String(rateLimit.remaining))
  res.headers.set('X-Letsfg-RateLimit-Reset', String(Math.max(1, Math.ceil(rateLimit.resetAfterMs / 1000))))
  res.headers.set('X-Letsfg-RateLimit-Route', pathname)
}

function tooManyRequestsResponse(
  req: NextRequest,
  rateLimit: { limit: number; remaining: number; retryAfterMs: number; resetAfterMs: number },
) {
  const retryAfterSeconds = Math.max(1, Math.ceil(rateLimit.retryAfterMs / 1000))
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Retry-After': String(retryAfterSeconds),
    'X-Letsfg-RateLimit-Limit': String(rateLimit.limit),
    'X-Letsfg-RateLimit-Remaining': String(rateLimit.remaining),
    'X-Letsfg-RateLimit-Reset': String(Math.max(1, Math.ceil(rateLimit.resetAfterMs / 1000))),
  })

  if (req.nextUrl.pathname.startsWith('/api/')) {
    headers.set('Content-Type', 'application/json; charset=utf-8')
    return new NextResponse(
      JSON.stringify({
        error: 'Too many requests',
        code: 'RATE_LIMITED',
        retry_after_seconds: retryAfterSeconds,
      }),
      { status: 429, headers },
    )
  }

  headers.set('Content-Type', 'text/plain; charset=utf-8')
  return new NextResponse('Too many requests. Please wait a moment and try again.', {
    status: 429,
    headers,
  })
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

  const sessionUid = getSessionUid(req) || randomUUID()
  const rateLimitPolicy = RATE_LIMIT_DISABLED ? null : getRateLimitPolicy(pathname)
  const rateLimitDecision = rateLimitPolicy
    ? checkRateLimit(
        rateLimitStore,
        `${rateLimitPolicy.name}:${buildRateLimitClientKey(req.headers, sessionUid)}`,
        rateLimitPolicy,
      )
    : null

  if (rateLimitDecision && !rateLimitDecision.allowed) {
    return tooManyRequestsResponse(req, rateLimitDecision)
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

  if (rateLimitDecision) {
    setRateLimitHeaders(res, pathname, rateLimitDecision)
  }

  return res
}

export const config = {
  // Match root, locale-prefixed paths, and key app pages (results, book, api).
  // Do NOT match /_next/*, static files.
  matcher: ['/', '/(en|pl|de|es|fr|it|pt|nl|sq|hr|sv)/:path*', '/results/:path*', '/book/:path*', '/probe/:path*', '/api/:path*'],
}
