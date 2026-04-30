export interface RateLimitPolicy {
  name: string
  capacity: number
  refillPerMinute: number
}

export interface RateLimitBucket {
  tokens: number
  lastRefillAt: number
  lastSeenAt: number
}

export interface RateLimitDecision {
  allowed: boolean
  limit: number
  remaining: number
  retryAfterMs: number
  resetAfterMs: number
}

export type RateLimitStore = Map<string, RateLimitBucket>

const STALE_BUCKET_MS = 30 * 60 * 1000
const PRUNE_INTERVAL = 128
const MAX_BUCKETS = 20_000

const SEARCH_POLICY: RateLimitPolicy = {
  name: 'search',
  capacity: 6,
  refillPerMinute: 18,
}

const RESULTS_POLICY: RateLimitPolicy = {
  name: 'results',
  capacity: 45,
  refillPerMinute: 180,
}

const OFFER_POLICY: RateLimitPolicy = {
  name: 'offer',
  capacity: 30,
  refillPerMinute: 90,
}

const ANALYTICS_POLICY: RateLimitPolicy = {
  name: 'analytics',
  capacity: 60,
  refillPerMinute: 240,
}

const CHECKOUT_POLICY: RateLimitPolicy = {
  name: 'checkout',
  capacity: 12,
  refillPerMinute: 30,
}

const PAGE_POLICY: RateLimitPolicy = {
  name: 'page',
  capacity: 60,
  refillPerMinute: 180,
}

const API_POLICY: RateLimitPolicy = {
  name: 'api',
  capacity: 60,
  refillPerMinute: 180,
}

let checksSincePrune = 0

declare global {
  var __letsfgRateLimitStore: RateLimitStore | undefined
}

export function createRateLimitStore(): RateLimitStore {
  return new Map<string, RateLimitBucket>()
}

export function getGlobalRateLimitStore(): RateLimitStore {
  if (!globalThis.__letsfgRateLimitStore) {
    globalThis.__letsfgRateLimitStore = createRateLimitStore()
  }
  return globalThis.__letsfgRateLimitStore
}

function readPositiveInt(env: Record<string, string | undefined>, key: string): number | undefined {
  const value = env[key]
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function withEnvOverrides(
  policy: RateLimitPolicy,
  prefix: string,
  env: Record<string, string | undefined>,
): RateLimitPolicy {
  return {
    ...policy,
    capacity: readPositiveInt(env, `LETSFG_RATE_LIMIT_${prefix}_CAPACITY`) ?? policy.capacity,
    refillPerMinute:
      readPositiveInt(env, `LETSFG_RATE_LIMIT_${prefix}_REFILL_PER_MINUTE`) ?? policy.refillPerMinute,
  }
}

export function getRateLimitPolicy(
  pathname: string,
  env: Record<string, string | undefined> = process.env,
): RateLimitPolicy | null {
  if (pathname.startsWith('/api/checkout/webhook')) return null
  if (pathname === '/api/search') return withEnvOverrides(SEARCH_POLICY, 'SEARCH', env)
  if (pathname.startsWith('/api/results/')) return withEnvOverrides(RESULTS_POLICY, 'RESULTS', env)
  if (pathname.startsWith('/api/offer/')) return withEnvOverrides(OFFER_POLICY, 'OFFER', env)
  if (pathname.startsWith('/api/analytics/')) return withEnvOverrides(ANALYTICS_POLICY, 'ANALYTICS', env)
  if (pathname.startsWith('/api/checkout/')) return withEnvOverrides(CHECKOUT_POLICY, 'CHECKOUT', env)
  if (pathname.startsWith('/api/')) return withEnvOverrides(API_POLICY, 'API', env)
  if (pathname.startsWith('/results') || pathname.startsWith('/book') || pathname.startsWith('/probe')) {
    return withEnvOverrides(PAGE_POLICY, 'PAGE', env)
  }
  return null
}

export function buildRateLimitClientKey(headers: Headers, sessionUid?: string | null): string {
  const forwardedFor = headers.get('cf-connecting-ip')
    || headers.get('x-real-ip')
    || headers.get('x-client-ip')
    || headers.get('fly-client-ip')
    || headers.get('fastly-client-ip')
    || headers.get('x-forwarded-for')

  const clientIp = forwardedFor
    ?.split(',')
    .map((part) => part.trim())
    .find(Boolean)

  if (clientIp) return `ip:${clientIp.toLowerCase()}`
  if (sessionUid) return `sid:${sessionUid}`

  const userAgent = headers.get('user-agent')
    ?.replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)

  if (userAgent) return `ua:${userAgent.toLowerCase()}`

  return 'anonymous'
}

function pruneRateLimitStore(store: RateLimitStore, now: number) {
  for (const [key, bucket] of store.entries()) {
    if (now - bucket.lastSeenAt >= STALE_BUCKET_MS) {
      store.delete(key)
    }
  }

  if (store.size <= MAX_BUCKETS) return

  const bucketsByAge = Array.from(store.entries()).sort((a, b) => a[1].lastSeenAt - b[1].lastSeenAt)
  for (const [key] of bucketsByAge.slice(0, store.size - MAX_BUCKETS)) {
    store.delete(key)
  }
}

export function checkRateLimit(
  store: RateLimitStore,
  key: string,
  policy: RateLimitPolicy,
  now = Date.now(),
): RateLimitDecision {
  checksSincePrune += 1
  if (store.size > MAX_BUCKETS || checksSincePrune % PRUNE_INTERVAL === 0) {
    pruneRateLimitStore(store, now)
  }

  let bucket = store.get(key)
  if (!bucket) {
    bucket = {
      tokens: policy.capacity,
      lastRefillAt: now,
      lastSeenAt: now,
    }
    store.set(key, bucket)
  }

  const refillPerMs = policy.refillPerMinute / 60_000
  if (now > bucket.lastRefillAt && refillPerMs > 0) {
    bucket.tokens = Math.min(
      policy.capacity,
      bucket.tokens + (now - bucket.lastRefillAt) * refillPerMs,
    )
    bucket.lastRefillAt = now
  }
  bucket.lastSeenAt = now

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1
    const nextResetMs = refillPerMs > 0
      ? Math.ceil((policy.capacity - bucket.tokens) / refillPerMs)
      : 60_000
    return {
      allowed: true,
      limit: policy.capacity,
      remaining: Math.max(0, Math.floor(bucket.tokens)),
      retryAfterMs: 0,
      resetAfterMs: Math.max(0, nextResetMs),
    }
  }

  const retryAfterMs = refillPerMs > 0
    ? Math.max(1_000, Math.ceil((1 - bucket.tokens) / refillPerMs))
    : 60_000

  return {
    allowed: false,
    limit: policy.capacity,
    remaining: 0,
    retryAfterMs,
    resetAfterMs: retryAfterMs,
  }
}