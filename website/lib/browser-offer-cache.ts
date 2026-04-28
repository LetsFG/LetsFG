const SESSION_PREFIX = 'lfg_result_'
const PERSIST_PREFIX = 'lfg_result_persist_'
const PERSIST_TTL_MS = 30 * 24 * 60 * 60 * 1000

export interface BrowserCachedResults<T> {
  status: 'completed'
  offers: T[]
  storedAt?: number
  expiresAt?: number
}

function canUseBrowserStorage(): boolean {
  return typeof window !== 'undefined'
}

function parseCachedResults<T>(raw: string | null): BrowserCachedResults<T> | null {
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as BrowserCachedResults<T>
    if (parsed?.status !== 'completed' || !Array.isArray(parsed.offers) || parsed.offers.length === 0) {
      return null
    }
    if (typeof parsed.expiresAt === 'number' && parsed.expiresAt <= Date.now()) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function getSessionResultCacheKey(searchId: string): string {
  return `${SESSION_PREFIX}${searchId}`
}

export function getPersistentResultCacheKey(searchId: string): string {
  return `${PERSIST_PREFIX}${searchId}`
}

export function readBrowserCachedResults<T>(searchId: string): BrowserCachedResults<T> | null {
  if (!canUseBrowserStorage()) return null

  const sessionCached = parseCachedResults<T>(window.sessionStorage.getItem(getSessionResultCacheKey(searchId)))
  if (sessionCached) {
    return sessionCached
  }

  const persistentKey = getPersistentResultCacheKey(searchId)
  const rawPersistent = window.localStorage.getItem(persistentKey)
  const persistentCached = parseCachedResults<T>(rawPersistent)
  if (persistentCached) {
    return persistentCached
  }

  if (rawPersistent) {
    window.localStorage.removeItem(persistentKey)
  }

  return null
}

export function writeBrowserCachedResults<T>(searchId: string, offers: T[]): void {
  if (!canUseBrowserStorage() || offers.length === 0) return

  try {
    window.sessionStorage.setItem(getSessionResultCacheKey(searchId), JSON.stringify({
      status: 'completed',
      offers,
    }))
  } catch {
    // Ignore sessionStorage failures.
  }

  try {
    const storedAt = Date.now()
    window.localStorage.setItem(getPersistentResultCacheKey(searchId), JSON.stringify({
      status: 'completed',
      offers,
      storedAt,
      expiresAt: storedAt + PERSIST_TTL_MS,
    }))
  } catch {
    // Ignore localStorage failures.
  }
}

export function findOfferInBrowserCache<T extends { id?: string }>(searchId: string, offerId: string): T | null {
  const cached = readBrowserCachedResults<T>(searchId)
  if (!cached) return null
  return cached.offers.find((offer) => offer?.id === offerId) || null
}