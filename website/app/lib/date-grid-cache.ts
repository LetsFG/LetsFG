/**
 * In-memory promise cache for Google Flights date-grid scrapes.
 *
 * Used to deduplicate / pre-warm scrapes across the parse-query and
 * date-grid endpoints. When parse-query fires-and-forgets a warmup scrape,
 * the resulting Promise is stashed here keyed by (origin, dest, dep, ret).
 * When the client later calls /api/date-grid, the route checks this cache
 * first and returns the in-flight (or completed) Promise instead of
 * starting a fresh scrape.
 *
 * Lifetime: entries are evicted 5 minutes after they resolve. Cache lives
 * in the Node process memory — fine for the dev server and single-instance
 * Cloud Run, but ephemeral across cold starts. For multi-instance prod
 * scale this would want a Redis/Firestore backing.
 *
 * Per project guidance ("do not cache aggressively"), the TTL is short and
 * intentionally not meant to be a price cache — it's a request-coalescing
 * cache that smooths over the gap between the user submitting and the
 * refine page mounting.
 */

const EVICT_MS = 5 * 60 * 1000  // 5 minutes after resolution

export interface DateGridGridCell {
  outbound: string
  return: string
  price: number
  currency: string
  is_cheaper: boolean
}

export interface DateGridPayload {
  origin: string
  destination: string
  currency: string | null
  selected_outbound: string
  selected_return: string | null
  scraped_at: string
  grid: DateGridGridCell[]
  source: 'backend' | 'subprocess'
}

export type DateGridMode = 'grid' | 'month'

export interface DateGridKey {
  origin: string
  destination: string
  dep: string
  ret: string | null
  mode?: DateGridMode  // defaults to 'grid' when omitted
}

function k(key: DateGridKey): string {
  return `${key.origin}|${key.destination}|${key.dep}|${key.ret ?? ''}|${key.mode ?? 'grid'}`
}

// Stored separately so we can introspect for logging without unwrapping.
interface Entry {
  promise: Promise<DateGridPayload | null>
  startedAt: number
}

// `globalThis` survives hot reloads in `next dev`, the regular module-scope
// would reset every recompile and we'd lose the pre-warmed scrape.
type CacheGlobal = typeof globalThis & { __lfgDateGridCache?: Map<string, Entry> }
const g = globalThis as CacheGlobal
if (!g.__lfgDateGridCache) g.__lfgDateGridCache = new Map<string, Entry>()
const cache: Map<string, Entry> = g.__lfgDateGridCache

export function getInflight(key: DateGridKey): Promise<DateGridPayload | null> | null {
  const entry = cache.get(k(key))
  return entry?.promise ?? null
}

/**
 * Register an in-flight scrape Promise under this key. If another caller
 * later asks for the same key, they get the SAME Promise back — one scrape,
 * multiple consumers. The entry is evicted 5 minutes after the Promise
 * resolves.
 */
export function setInflight(
  key: DateGridKey,
  promise: Promise<DateGridPayload | null>,
): Promise<DateGridPayload | null> {
  const keyStr = k(key)
  const entry: Entry = { promise, startedAt: Date.now() }
  cache.set(keyStr, entry)
  void promise.finally(() => {
    setTimeout(() => {
      const current = cache.get(keyStr)
      if (current === entry) cache.delete(keyStr)
    }, EVICT_MS)
  })
  return promise
}
