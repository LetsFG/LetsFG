import fs from 'node:fs'
import path from 'node:path'

export interface PersistedSearchResult {
  search_id: string
  status: 'completed'
  query?: string
  parsed: Record<string, unknown>
  offers: unknown[]
  total_results: number
  cheapest_price?: number
  google_flights_price?: number
  value?: number
  savings_vs_google_flights?: number
  searched_at?: string
  expires_at?: string
  stored_at: number
}

const RESULTS_TTL_MS = 30 * 24 * 60 * 60 * 1000
const RESULTS_CACHE_FILE = path.join(process.cwd(), '.next', 'cache', 'letsfg-results.json')

let cacheLoaded = false
const resultsCache = new Map<string, PersistedSearchResult>()

type CacheSearchResultLike = Omit<PersistedSearchResult, 'stored_at'> | PersistedSearchResult

function roundMoney(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value * 100) / 100
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return Math.round(parsed * 100) / 100
    }
  }

  return undefined
}

function roundPositiveMoney(value: unknown): number | undefined {
  const rounded = roundMoney(value)
  return typeof rounded === 'number' && rounded > 0 ? rounded : undefined
}

function sanitizeOfferComparisonFields(offer: unknown): { offer: unknown; changed: boolean } {
  if (!offer || typeof offer !== 'object' || Array.isArray(offer)) {
    return { offer, changed: false }
  }

  const record = offer as Record<string, unknown>
  const nextGooglePrice = roundPositiveMoney(record.google_flights_price)
  const hadGooglePrice = Object.prototype.hasOwnProperty.call(record, 'google_flights_price')

  if (nextGooglePrice === record.google_flights_price || (!hadGooglePrice && nextGooglePrice === undefined)) {
    return { offer, changed: false }
  }

  const nextOffer = { ...record }
  if (typeof nextGooglePrice === 'number') {
    nextOffer.google_flights_price = nextGooglePrice
  } else {
    delete nextOffer.google_flights_price
  }

  return { offer: nextOffer, changed: true }
}

export function sanitizePersistedSearchResult<T extends CacheSearchResultLike>(result: T): T {
  let changed = false
  const sanitizedOffers = result.offers.map((offer) => {
    const sanitized = sanitizeOfferComparisonFields(offer)
    changed = changed || sanitized.changed
    return sanitized.offer
  })

  const derivedCheapestPrice = sanitizedOffers.reduce<number | undefined>((lowest, offer) => {
    if (!offer || typeof offer !== 'object' || Array.isArray(offer)) {
      return lowest
    }

    const price = roundMoney((offer as Record<string, unknown>).price)
    if (typeof price !== 'number' || price < 0) {
      return lowest
    }

    if (typeof lowest !== 'number' || price < lowest) {
      return price
    }

    return lowest
  }, undefined)

  const derivedGoogleFlightsPrice = sanitizedOffers.reduce<number | undefined>((lowest, offer) => {
    if (!offer || typeof offer !== 'object' || Array.isArray(offer)) {
      return lowest
    }

    const googlePrice = roundPositiveMoney((offer as Record<string, unknown>).google_flights_price)
    if (typeof googlePrice !== 'number') {
      return lowest
    }

    if (typeof lowest !== 'number' || googlePrice < lowest) {
      return googlePrice
    }

    return lowest
  }, roundPositiveMoney(result.google_flights_price))

  const cheapestPrice = roundMoney(result.cheapest_price) ?? derivedCheapestPrice
  const googleFlightsPrice = derivedGoogleFlightsPrice
  const computedValue = typeof cheapestPrice === 'number' && typeof googleFlightsPrice === 'number'
    ? Math.round(Math.max(0, googleFlightsPrice - cheapestPrice) * 100) / 100
    : undefined

  if (sanitizedOffers !== result.offers) {
    changed = changed || sanitizedOffers.some((offer, index) => offer !== result.offers[index])
  }
  changed = changed || result.cheapest_price !== cheapestPrice
  changed = changed || result.google_flights_price !== googleFlightsPrice
  changed = changed || result.value !== computedValue
  changed = changed || result.savings_vs_google_flights !== computedValue

  if (!changed) {
    return result
  }

  return {
    ...result,
    offers: sanitizedOffers,
    cheapest_price: cheapestPrice,
    google_flights_price: googleFlightsPrice,
    value: computedValue,
    savings_vs_google_flights: computedValue,
  } as T
}

function loadCache(): void {
  if (cacheLoaded) return
  cacheLoaded = true

  try {
    const raw = fs.readFileSync(RESULTS_CACHE_FILE, 'utf8')
    const parsed = JSON.parse(raw) as Record<string, PersistedSearchResult>
    const now = Date.now()
    for (const [searchId, result] of Object.entries(parsed || {})) {
      if (!result || typeof result !== 'object') continue
      if (typeof result.stored_at !== 'number' || now - result.stored_at > RESULTS_TTL_MS) continue
      if (result.status !== 'completed' || !Array.isArray(result.offers)) continue
      resultsCache.set(searchId, result)
    }
  } catch {
    // Ignore missing or malformed cache.
  }
}

function persistCache(): void {
  try {
    fs.mkdirSync(path.dirname(RESULTS_CACHE_FILE), { recursive: true })
    const serialized: Record<string, PersistedSearchResult> = {}
    for (const [searchId, result] of resultsCache) {
      serialized[searchId] = result
    }
    fs.writeFileSync(RESULTS_CACHE_FILE, JSON.stringify(serialized), 'utf8')
  } catch {
    // Ignore persistence failures; runtime cache still works.
  }
}

function pruneCache(now = Date.now()): void {
  let changed = false
  for (const [searchId, result] of resultsCache) {
    if (now - result.stored_at > RESULTS_TTL_MS) {
      resultsCache.delete(searchId)
      changed = true
    }
  }
  if (changed) {
    persistCache()
  }
}

export function cacheCompletedSearchResult(result: Omit<PersistedSearchResult, 'stored_at'>): void {
  loadCache()
  const sanitizedResult = sanitizePersistedSearchResult(result)
  resultsCache.set(sanitizedResult.search_id, {
    ...sanitizedResult,
    stored_at: Date.now(),
  })
  pruneCache()
  persistCache()
}

export function getCachedSearchResult(searchId: string): PersistedSearchResult | null {
  loadCache()
  pruneCache()
  const cachedResult = resultsCache.get(searchId)
  if (!cachedResult) {
    return null
  }

  const sanitizedResult = sanitizePersistedSearchResult(cachedResult)
  if (sanitizedResult !== cachedResult) {
    resultsCache.set(searchId, sanitizedResult)
    persistCache()
  }

  return sanitizedResult
}