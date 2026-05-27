import createMiddleware from 'next-intl/middleware'
import { routing } from './i18n/routing'
import { NextResponse, type NextRequest } from 'next/server'
import { randomUUID } from 'crypto'
import { resolveLocaleCookieValue, resolveLocaleSearchParamValue, setResultsLocaleSearchParam } from './lib/locale-routing'
import { getSessionUid, HOSTING_SESSION_COOKIE_NAME, LEGACY_UID_COOKIE_NAME, SESSION_UID_HEADER_NAME } from './lib/session-uid'
import {
  buildRateLimitClientKey,
  checkRateLimit,
  getGlobalRateLimitStore,
  getRateLimitPolicy,
} from './lib/rate-limit'
import { isBlockedUserAgent } from './lib/ua-blocklist'
import { extractClientIp, ipMatchesBlockedCidr, pathIsAbuseProtected } from './lib/ip-blocklist'
import { isPublicShareAssetPath } from './lib/share-preview'
import { checkSearchAbuse, getGlobalSearchAbuseStore, isSearchAbuseTarget } from './lib/search-abuse'
import { isAllowedHost } from './lib/host-allowlist'
import { validateAgentToken } from './lib/agent-access'

const intlMiddleware = createMiddleware(routing)
const ANON_USER_COOKIE_MAX_AGE_SECONDS = 10 * 365 * 24 * 60 * 60
const RATE_LIMIT_DISABLED = process.env.LETSFG_RATE_LIMIT_DISABLED === '1'
const SEARCH_ABUSE_DISABLED = process.env.LETSFG_SEARCH_ABUSE_DISABLED === '1'
const rateLimitStore = getGlobalRateLimitStore()
// New agent tokens (< 48 h old) get 20 % of normal rate-limit capacity.
// Makes Twitter account farming uneconomical: 50 throwaway accounts still
// only get 50× 20% = 10 effective tokens' worth of burst.
const AGENT_COOLOFF_MS = 48 * 60 * 60 * 1000
const AGENT_COOLOFF_FRACTION = 0.2
const searchAbuseStore = getGlobalSearchAbuseStore()

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

function resolveRequestHost(req: NextRequest) {
  return (
    req.headers.get('x-forwarded-host')?.split(',')[0]?.trim().toLowerCase() ||
    req.headers.get('host')?.split(',')[0]?.trim().toLowerCase() ||
    req.nextUrl.host.toLowerCase()
  )
}

function redirectLegacyDocsHost(req: NextRequest) {
  const host = resolveRequestHost(req)
  if (host !== 'docs.letsfg.co') {
    return null
  }

  const target = req.nextUrl.clone()
  target.protocol = 'https'
  target.host = 'letsfg.co'

  const suffix = req.nextUrl.pathname === '/' ? '' : req.nextUrl.pathname
  target.pathname = suffix.startsWith('/developers/docs')
    ? suffix
    : `/developers/docs${suffix}`

  return NextResponse.redirect(target, 308)
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

  // Host-header allowlist — first gate. Public traffic must arrive via one of
  // our real domains (letsfg.co + subdomains). Raw .run.app URLs are blocked
  // here so bots can't bypass Cloudflare by hitting Cloud Run directly.
  if (!isAllowedHost(resolveRequestHost(req))) {
    return new NextResponse('Forbidden', {
      status: 403,
      headers: { 'Cache-Control': 'no-store' },
    })
  }

  if (isBlockedUserAgent(req.headers.get('user-agent'))) {
    return new NextResponse('Forbidden', {
      status: 403,
      headers: { 'Cache-Control': 'no-store' },
    })
  }

  // IP-range block scoped to expensive search endpoints.
  // extractClientIp returns CF-Connecting-IP (verified real client when CF is
  // in the path) or the leftmost XFF entry (original client for the Firebase
  // → Cloud Run path). Checking ALL XFF entries false-positives on Firebase
  // infrastructure IPs (66.249.x, 142.250.x, 74.125.x) which share the same
  // Google CIDR ranges we block for bot traffic.
  if (pathIsAbuseProtected(pathname)) {
    const clientIp = extractClientIp(req.headers)
    if (clientIp && ipMatchesBlockedCidr(clientIp)) {
      return new NextResponse('Forbidden', {
        status: 403,
        headers: { 'Cache-Control': 'no-store' },
      })
    }
  }

  const legacyDocsRedirect = redirectLegacyDocsHost(req)
  if (legacyDocsRedirect) {
    return legacyDocsRedirect
  }

  // If someone hits a locale-prefixed path to results/book (e.g. /en/results?q=...),
  // strip the locale prefix and redirect to the canonical non-prefixed URL.
  const localePrefix = /^\/(en|pl|de|es|fr|it|pt|nl|sq|hr|sv|ja|zh)(\/(?:results|book|probe)(?:\/.*)?)?$/
  const localePrefixMatch = pathname.match(localePrefix)
  if (localePrefixMatch && localePrefixMatch[2]) {
    const target = req.nextUrl.clone()
    target.pathname = localePrefixMatch[2]
    setResultsLocaleSearchParam(target.searchParams, localePrefixMatch[1])
    return NextResponse.redirect(target)
  }

  // Agent access tokens: developers tweet a challenge code to get a 90-day Bearer token.
  // Token holders get their own rate-limit/abuse bucket keyed by Twitter handle,
  // separate from anonymous session/IP buckets.
  const bearerToken = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null
  const agentValidation = bearerToken ? validateAgentToken(bearerToken) : null
  const agentHandle = agentValidation?.valid ? agentValidation.handle : null
  const agentIsNew = agentValidation?.valid
    ? (Date.now() - agentValidation.issuedAt) < AGENT_COOLOFF_MS
    : false

  const sessionUid = getSessionUid(req) || randomUUID()
  // Agent requests use a stable handle-based key; others use IP or session UID.
  const clientKey = agentHandle
    ? `agent:${agentHandle}`
    : buildRateLimitClientKey(req.headers, sessionUid)

  const basePolicy = RATE_LIMIT_DISABLED ? null : getRateLimitPolicy(pathname)
  // New agent tokens get a reduced quota to make account farming uneconomical.
  const rateLimitPolicy = basePolicy && agentIsNew
    ? {
        name: `${basePolicy.name}:new`,
        capacity: Math.max(1, Math.floor(basePolicy.capacity * AGENT_COOLOFF_FRACTION)),
        refillPerMinute: Math.max(1, Math.floor(basePolicy.refillPerMinute * AGENT_COOLOFF_FRACTION)),
      }
    : basePolicy
  const rateLimitDecision = rateLimitPolicy
    ? checkRateLimit(
        rateLimitStore,
        `${rateLimitPolicy.name}:${clientKey}`,
        rateLimitPolicy,
      )
    : null

  if (rateLimitDecision && !rateLimitDecision.allowed) {
    return tooManyRequestsResponse(req, rateLimitDecision)
  }

  if (!SEARCH_ABUSE_DISABLED && !agentHandle && isSearchAbuseTarget(pathname, req.nextUrl.searchParams)) {
    const abuseKey = clientKey
    const abuseDecision = checkSearchAbuse(searchAbuseStore, abuseKey)
    if (abuseDecision.blocked) {
      const retryAfterSeconds = Math.max(1, Math.ceil((abuseDecision.retryAfterMs ?? 0) / 1000))
      const headers = new Headers({
        'Cache-Control': 'no-store',
        'Retry-After': String(retryAfterSeconds),
      })
      if (pathname.startsWith('/api/')) {
        headers.set('Content-Type', 'application/json; charset=utf-8')
        return new NextResponse(
          JSON.stringify({
            error: 'Too many searches. Please wait before searching again.',
            code: 'SEARCH_ABUSE_BLOCKED',
            retry_after_seconds: retryAfterSeconds,
            strikes: abuseDecision.strikes,
          }),
          { status: 429, headers },
        )
      }
      headers.set('Content-Type', 'text/plain; charset=utf-8')
      return new NextResponse('Too many searches. Please wait before searching again.', {
        status: 429,
        headers,
      })
    }
  }

  // For non-locale paths (results/book/api), skip intlMiddleware entirely.
  // intlMiddleware would redirect /results → /en/results, causing a loop.
  // Hosting only forwards the special __session cookie to the backend, so
  // locale cookies are not reliable on live non-prefixed routes. Prefer an
  // explicit locale query param when present, then fall back locally.
  let res: NextResponse
  if (isNonLocalePath(pathname)) {
    const detectedLocale = resolveLocaleSearchParamValue(req.nextUrl.searchParams.get('hl'))
      || resolveLocaleCookieValue((cookieName) => req.cookies.get(cookieName)?.value)
      || routing.defaultLocale
    const requestHeaders = new Headers(req.headers)
    requestHeaders.set('x-next-intl-locale', detectedLocale)
    requestHeaders.set('x-letsfg-pathname', pathname)
    requestHeaders.set(SESSION_UID_HEADER_NAME, sessionUid)
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

  if (!isPublicShareAssetPath(pathname)) {
    res.cookies.set(HOSTING_SESSION_COOKIE_NAME, sessionUid, cookieOptions)
    res.cookies.set(LEGACY_UID_COOKIE_NAME, sessionUid, cookieOptions)
  }

  if (rateLimitDecision) {
    setRateLimitHeaders(res, pathname, rateLimitDecision)
  }

  return res
}

export const config = {
  // Match root, locale-prefixed paths, and key app pages (results, book, api).
  // Do NOT match /_next/*, static files.
  matcher: [
    {
      source: '/:path*',
      has: [{ type: 'header', key: 'host', value: 'docs\\.letsfg\\.co' }],
    },
    {
      source: '/:path*',
      has: [{ type: 'header', key: 'x-forwarded-host', value: 'docs\\.letsfg\\.co' }],
    },
    '/',
    '/(en|pl|de|es|fr|it|pt|nl|sq|hr|sv|ja|zh)/:path*',
    '/results/:path*',
    '/book/:path*',
    '/probe/:path*',
    '/api/:path*',
  ],
}
