const HOST_LABELS: Array<[RegExp, string]> = [
  [/skyscanner\./, 'Skyscanner'],
  [/kiwi\.com$/, 'Kiwi.com'],
  [/trip\.com$/, 'Trip.com'],
  [/edreams\./, 'eDreams'],
  [/opodo\./, 'Opodo'],
  [/momondo\./, 'Momondo'],
  [/kayak\./, 'Kayak'],
  [/cheapflights\./, 'Cheapflights'],
  [/expedia\./, 'Expedia'],
  [/booking\.com$/, 'Booking.com'],
  [/ryanair\./, 'Ryanair'],
  [/wizzair\./, 'Wizz Air'],
  [/easyjet\./, 'easyJet'],
  [/vueling\./, 'Vueling'],
  [/britishairways\./, 'British Airways'],
  [/iberia\./, 'Iberia'],
  [/norwegian\./, 'Norwegian'],
  [/lufthansa\./, 'Lufthansa'],
  [/airfrance\./, 'Air France'],
  [/klm\./, 'KLM'],
  [/qatarairways\./, 'Qatar Airways'],
  [/emirates\./, 'Emirates'],
  [/turkishairlines\./, 'Turkish Airlines'],
]

function normalizeHostname(hostname: string): string {
  return hostname
    .trim()
    .toLowerCase()
    .replace(/^www\d*\./, '')
    .replace(/^m\./, '')
    .replace(/^app\./, '')
}

function titleCaseWord(word: string): string {
  if (!word) return word
  return word[0].toUpperCase() + word.slice(1)
}

function labelFromHostname(hostname: string): string | undefined {
  const normalized = normalizeHostname(hostname)
  if (!normalized) return undefined

  for (const [pattern, label] of HOST_LABELS) {
    if (pattern.test(normalized)) {
      return label
    }
  }

  const parts = normalized.split('.').filter(Boolean)
  const stem = parts.length >= 2 ? parts[parts.length - 2] : normalized
  const words = stem
    .split(/[-_]+/)
    .filter(Boolean)
    .map(titleCaseWord)

  return words.length > 0 ? words.join(' ') : undefined
}

export function getBookingSiteLabel(url: string | null | undefined, fallbackLabel?: string): string | undefined {
  if (typeof url === 'string' && url.trim().length > 0) {
    try {
      const derived = labelFromHostname(new URL(url).hostname)
      if (derived) {
        return derived
      }
    } catch {
      // Fall through to the provided fallback label.
    }
  }

  if (typeof fallbackLabel === 'string' && fallbackLabel.trim().length > 0) {
    return fallbackLabel.trim()
  }

  return undefined
}

export function summarizeBookingSites(labels: Array<string | undefined>): string | undefined {
  const unique = Array.from(new Set(labels.filter((label): label is string => (
    typeof label === 'string' && label.trim().length > 0
  ))))

  if (unique.length === 0) {
    return undefined
  }

  return unique.join(' + ')
}