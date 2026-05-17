import { DEFAULT_FX_VS_EUR, normalizeCurrencyCode, type FxRateTable } from './display-price'

const FX_CACHE_TTL_MS = 6 * 60 * 60 * 1000
const FX_FETCH_TIMEOUT_MS = 5_000
const FRANKFURTER_API_BASE = (process.env.LETSFG_FX_API_BASE || 'https://api.frankfurter.dev/v2').replace(/\/$/, '')
const SUPPORTED_QUOTES = Object.keys(DEFAULT_FX_VS_EUR)
  .filter((code) => code !== 'EUR')
  .sort()

type FrankfurterRateRow = {
  base?: unknown
  quote?: unknown
  rate?: unknown
}

let cachedRates: FxRateTable | null = null
let cacheExpiresAt = 0
let inFlightRates: Promise<FxRateTable> | null = null

function buildFrankfurterRatesUrl() {
  const url = new URL('/rates', `${FRANKFURTER_API_BASE}/`)
  url.searchParams.set('base', 'EUR')
  url.searchParams.set('quotes', SUPPORTED_QUOTES.join(','))
  return url.toString()
}

export function parseFrankfurterRatesPayload(payload: unknown): FxRateTable {
  const parsed: FxRateTable = {
    ...DEFAULT_FX_VS_EUR,
    EUR: 1,
  }

  if (!Array.isArray(payload)) {
    return parsed
  }

  for (const row of payload) {
    if (!row || typeof row !== 'object') {
      continue
    }

    const { base, quote, rate } = row as FrankfurterRateRow
    const normalizedBase = normalizeCurrencyCode(typeof base === 'string' ? base : undefined)
    const normalizedQuote = normalizeCurrencyCode(typeof quote === 'string' ? quote : undefined)
    const numericRate = typeof rate === 'number' ? rate : Number(rate)

    if (normalizedBase !== 'EUR' || normalizedQuote === 'EUR' || !Number.isFinite(numericRate) || numericRate <= 0) {
      continue
    }

    parsed[normalizedQuote] = numericRate
  }

  return parsed
}

export async function fetchLiveFxRates(fetchImpl: typeof fetch = fetch): Promise<FxRateTable> {
  const response = await fetchImpl(buildFrankfurterRatesUrl(), {
    cache: 'no-store',
    headers: {
      accept: 'application/json',
    },
    signal: AbortSignal.timeout(FX_FETCH_TIMEOUT_MS),
  })

  if (!response.ok) {
    throw new Error(`FX rate request failed with status ${response.status}`)
  }

  return parseFrankfurterRatesPayload(await response.json())
}

export async function getLiveFxRates(): Promise<FxRateTable> {
  const now = Date.now()
  if (cachedRates && cacheExpiresAt > now) {
    return cachedRates
  }

  if (inFlightRates) {
    return inFlightRates
  }

  inFlightRates = fetchLiveFxRates()
    .then((rates) => {
      cachedRates = rates
      cacheExpiresAt = Date.now() + FX_CACHE_TTL_MS
      return rates
    })
    .catch((error) => {
      console.error('Failed to refresh live FX rates:', error)
      if (cachedRates) {
        return cachedRates
      }
      return {
        ...DEFAULT_FX_VS_EUR,
      }
    })
    .finally(() => {
      inFlightRates = null
    })

  return inFlightRates
}