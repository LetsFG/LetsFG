import fs from 'node:fs'
import path from 'node:path'

/**
 * Module-level offer cache for the Next.js server process.
 *
 * When /api/results/[searchId] fetches completed offers from FSW, it stores
 * them here. When /api/offer/[offerId] needs an offer it checks here first,
 * avoiding a second FSW round-trip that could land on a different Cloud Run
 * instance (which would have no in-memory search state).
 *
 * This cache is intentionally process-local and website-only. Search reuse is
 * owned by flight-search-worker, not by the website.
 */

type OfferCacheEntry = { offer: Record<string, unknown>; expiresAt: number; searchId?: string }

const _cache = new Map<string, OfferCacheEntry>()
const OFFER_TTL_MS = 30 * 24 * 60 * 60 * 1000
const TTL_MS = OFFER_TTL_MS // alias kept for any existing call-sites
const PERSISTED_CACHE_FILE = path.join(process.cwd(), '.next', 'cache', 'letsfg-offers.json')

let persistedLoaded = false

function loadPersistedCache(): void {
  if (persistedLoaded) return
  persistedLoaded = true

  try {
    const raw = fs.readFileSync(PERSISTED_CACHE_FILE, 'utf8')
    const parsed = JSON.parse(raw) as Record<string, OfferCacheEntry>
    const now = Date.now()
    for (const [offerId, entry] of Object.entries(parsed || {})) {
      if (!entry || typeof entry !== 'object') continue
      if (typeof entry.expiresAt !== 'number' || entry.expiresAt <= now) continue
      if (!entry.offer || typeof entry.offer !== 'object') continue
      _cache.set(offerId, entry)
    }
  } catch {
    // Ignore missing or malformed persisted cache.
  }
}

function persistCache(): void {
  try {
    fs.mkdirSync(path.dirname(PERSISTED_CACHE_FILE), { recursive: true })
    const now = Date.now()
    const serialized: Record<string, OfferCacheEntry> = {}
    for (const [offerId, entry] of _cache) {
      if (entry.expiresAt > now) {
        serialized[offerId] = entry
      }
    }
    fs.writeFileSync(PERSISTED_CACHE_FILE, JSON.stringify(serialized), 'utf8')
  } catch {
    // Ignore persistence failures and continue with in-memory cache.
  }
}

function pruneExpiredEntries(now = Date.now()): void {
  let changed = false
  for (const [key, entry] of _cache) {
    if (now > entry.expiresAt) {
      _cache.delete(key)
      changed = true
    }
  }
  if (changed) {
    persistCache()
  }
}

export function cacheOffers<T extends { id?: string }>(offers: T[], searchId?: string): void {
  loadPersistedCache()
  const expiresAt = Date.now() + OFFER_TTL_MS
  for (const offer of offers) {
    const id = offer.id
    if (id) _cache.set(id, { offer: offer as Record<string, unknown>, expiresAt, searchId })
  }
  pruneExpiredEntries()
  persistCache()
}

export function getCachedOffer<T = Record<string, unknown>>(offerId: string, searchId?: string): T | null {
  loadPersistedCache()
  const entry = _cache.get(offerId)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    _cache.delete(offerId)
    persistCache()
    return null
  }
  if (searchId && entry.searchId && entry.searchId !== searchId) {
    return null
  }
  return entry.offer as T
}
