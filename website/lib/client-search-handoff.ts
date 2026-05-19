export interface ClientSearchHandoffOptions {
  query: string
  currency?: string
  probeMode?: boolean
  // Pre-resolved structured params — when present, /api/search uses the fast
  // path (no Gemini re-parse), cutting the loading-page wait from ~5s to ~1s.
  origin?: string
  destination?: string
  date_from?: string
  return_date?: string
  adults?: number
  origin_name?: string
  destination_name?: string
  // Convo-wizard context forwarded to satisfy isSearchLaunchReady in the fast path.
  cabin?: string
  trip_purpose?: string
  sort_by?: string
  passenger_context?: string
  max_stops?: number
}

export interface ClientSearchHandoffResult {
  searchId?: string
  fswSession?: string
}

interface ClientSearchHandoffRecord {
  token: string
  startedAt: number
  abortController: AbortController
  promise: Promise<ClientSearchHandoffResult | null>
  result: ClientSearchHandoffResult | null | undefined
}

const CLIENT_SEARCH_HANDOFF_TTL_MS = 3 * 60 * 1000
const pendingSearchHandoffs = new Map<string, ClientSearchHandoffRecord>()

function scheduleCleanup(token: string, startedAt: number) {
  window.setTimeout(() => {
    const current = pendingSearchHandoffs.get(token)
    if (!current || current.startedAt !== startedAt) {
      return
    }
    if (Date.now() - current.startedAt >= CLIENT_SEARCH_HANDOFF_TTL_MS) {
      pendingSearchHandoffs.delete(token)
    }
  }, CLIENT_SEARCH_HANDOFF_TTL_MS)
}

async function requestSearch(options: ClientSearchHandoffOptions, signal: AbortSignal): Promise<ClientSearchHandoffResult | null> {
  const response = await fetch('/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: options.query,
      ...(options.currency ? { currency: options.currency } : {}),
      ...(options.probeMode ? { probe: '1' } : {}),
      ...(options.origin ? { origin: options.origin } : {}),
      ...(options.destination ? { destination: options.destination } : {}),
      ...(options.date_from ? { date_from: options.date_from } : {}),
      ...(options.return_date ? { return_date: options.return_date } : {}),
      ...(options.adults ? { adults: String(options.adults) } : {}),
      ...(options.origin_name ? { origin_name: options.origin_name } : {}),
      ...(options.destination_name ? { destination_name: options.destination_name } : {}),
      ...(options.cabin ? { cabin: options.cabin } : {}),
      ...(options.trip_purpose ? { trip_purpose: options.trip_purpose } : {}),
      ...(options.sort_by ? { sort_by: options.sort_by } : {}),
      ...(options.passenger_context ? { passenger_context: options.passenger_context } : {}),
      ...(options.max_stops !== undefined ? { max_stops: String(options.max_stops) } : {}),
    }),
    signal,
  }).catch(() => null)

  if (!response?.ok) {
    return null
  }

  const payload = await response.json().catch(() => null) as { search_id?: string; fsw_session?: string } | null
  if (!payload?.search_id) {
    return null
  }

  return {
    searchId: payload.search_id,
    fswSession: payload.fsw_session,
  }
}

export function createClientSearchHandoffToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '')
  }

  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

export function startClientSearchHandoff(
  token: string,
  options: ClientSearchHandoffOptions,
): Promise<ClientSearchHandoffResult | null> {
  const existing = pendingSearchHandoffs.get(token)
  if (existing) {
    if (existing.result !== null) {
      return existing.result !== undefined ? Promise.resolve(existing.result) : existing.promise
    }

    pendingSearchHandoffs.delete(token)
  }

  const abortController = new AbortController()
  const startedAt = Date.now()
  const record: ClientSearchHandoffRecord = {
    token,
    startedAt,
    abortController,
    result: undefined,
    promise: Promise.resolve(null),
  }

  record.promise = requestSearch(options, abortController.signal)
    .then((result) => {
      record.result = result
      return result
    })
    .catch(() => {
      record.result = null
      return null
    })

  pendingSearchHandoffs.set(token, record)
  scheduleCleanup(token, startedAt)
  return record.promise
}

export function clearClientSearchHandoff(token: string | null | undefined) {
  if (!token) {
    return
  }

  const existing = pendingSearchHandoffs.get(token)
  existing?.abortController.abort()
  pendingSearchHandoffs.delete(token)
}

export async function waitForClientSearchHandoff(
  token: string | null | undefined,
  timeoutMs = 0,
): Promise<ClientSearchHandoffResult | null> {
  if (!token) {
    return null
  }

  const existing = pendingSearchHandoffs.get(token)
  if (!existing) {
    return null
  }

  if (existing.result !== undefined) {
    return existing.result
  }

  if (timeoutMs <= 0) {
    return existing.promise
  }

  return Promise.race([
    existing.promise,
    new Promise<null>((resolve) => window.setTimeout(() => resolve(null), timeoutMs)),
  ])
}
