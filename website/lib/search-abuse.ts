// Progressive search-abuse block: clients that initiate more than THRESHOLD
// searches within a rolling WINDOW_MS are temporarily blocked, with the
// block duration escalating on each repeat offense.
//
// Distinct from the per-path rate limiter (burst seconds) — this catches
// sustained low-and-slow abuse that stays under the burst threshold.
//
// Per-instance in-memory store. Fragments across Cloud Run scale-out the same
// way the rate-limit store does — acceptable since CIDR + UA blocks cover the
// rotating-IP case; this layer targets stable-IP clients (OpenClaw, ChatGPT, etc.)

export interface SearchAbuseEntry {
  searches: number[]   // epoch-ms timestamps in the current rolling window
  strikes: number      // cumulative offenses
  blockedUntil: number // epoch ms; 0 = not blocked
  lastSeenAt: number   // for store pruning
}

export type SearchAbuseStore = Map<string, SearchAbuseEntry>

export interface SearchAbuseDecision {
  blocked: boolean
  retryAfterMs?: number
  strikes?: number
}

// Block durations indexed by strike (0-based). Last entry applies to all higher strikes.
const BLOCK_DURATIONS_MS: ReadonlyArray<number> = [
  30 * 60 * 1000,         // 1st offense: 30 minutes
  6 * 60 * 60 * 1000,     // 2nd offense: 6 hours
  24 * 60 * 60 * 1000,    // 3rd+ offense: 24 hours
]

const DEFAULT_THRESHOLD = 5
const DEFAULT_WINDOW_MS = 10 * 60 * 1000  // 10 minutes
const STALE_ENTRY_MS = 48 * 60 * 60 * 1000
const PRUNE_INTERVAL = 64

let _checksSincePrune = 0

declare global {
  var __letsfgSearchAbuseStore: SearchAbuseStore | undefined
}

export function getGlobalSearchAbuseStore(): SearchAbuseStore {
  if (!globalThis.__letsfgSearchAbuseStore) {
    globalThis.__letsfgSearchAbuseStore = new Map()
  }
  return globalThis.__letsfgSearchAbuseStore
}

function pruneStore(store: SearchAbuseStore, now: number): void {
  for (const [key, entry] of store) {
    if (now - entry.lastSeenAt > STALE_ENTRY_MS) store.delete(key)
  }
}

function resolveConfig(env: Record<string, string | undefined>): { threshold: number; windowMs: number } {
  const t = Number(env.LETSFG_SEARCH_ABUSE_THRESHOLD)
  const w = Number(env.LETSFG_SEARCH_ABUSE_WINDOW_MS)
  return {
    threshold: Number.isFinite(t) && t > 0 ? t : DEFAULT_THRESHOLD,
    windowMs: Number.isFinite(w) && w > 0 ? w : DEFAULT_WINDOW_MS,
  }
}

export function checkSearchAbuse(
  store: SearchAbuseStore,
  clientKey: string,
  env: Record<string, string | undefined> = process.env,
  now: number = Date.now(),
): SearchAbuseDecision {
  _checksSincePrune++
  if (_checksSincePrune >= PRUNE_INTERVAL) {
    _checksSincePrune = 0
    pruneStore(store, now)
  }

  const { threshold, windowMs } = resolveConfig(env)
  const entry = store.get(clientKey) ?? { searches: [], strikes: 0, blockedUntil: 0, lastSeenAt: now }

  // Already blocked — don't count this attempt toward the next window
  if (entry.blockedUntil > now) {
    store.set(clientKey, { ...entry, lastSeenAt: now })
    return { blocked: true, retryAfterMs: entry.blockedUntil - now, strikes: entry.strikes }
  }

  // Sliding window: drop timestamps outside the window, then record this search
  const cutoff = now - windowMs
  const recent = entry.searches.filter(t => t > cutoff)
  recent.push(now)

  if (recent.length > threshold) {
    const strikeIndex = Math.min(entry.strikes, BLOCK_DURATIONS_MS.length - 1)
    const durationMs = BLOCK_DURATIONS_MS[strikeIndex]!
    store.set(clientKey, {
      searches: [],                     // clean slate after block expires
      strikes: entry.strikes + 1,
      blockedUntil: now + durationMs,
      lastSeenAt: now,
    })
    return { blocked: true, retryAfterMs: durationMs, strikes: entry.strikes + 1 }
  }

  // Under threshold — record and allow
  const maxStored = threshold + 5
  store.set(clientKey, { ...entry, searches: recent.slice(-maxStored), lastSeenAt: now })
  return { blocked: false }
}

// Returns true for paths that initiate a new real search (Gemini + FSW fan-out)
// or that are standalone Vertex AI cost vectors.
// /api/results/* and /results/ws_... are polling paths — excluded.
export function isSearchAbuseTarget(pathname: string, searchParams: URLSearchParams): boolean {
  if (pathname === '/api/search') return true
  if (pathname === '/api/parse-query') return true
  if (pathname === '/results' && searchParams.has('q')) return true
  return false
}
