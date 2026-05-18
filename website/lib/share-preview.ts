export interface ShareLabels {
  fromLabel: string
  toLabel: string
}

const RESULTS_SHARE_IMAGE_PATH_RE = /^\/results\/[^/]+\/(?:opengraph-image|twitter-image)$/
const COMMON_THREE_LETTER_WORDS = new Set(['las', 'los', 'new', 'rio', 'san'])
const SHARE_SLUG_STOP_WORDS = new Set([
  'adult',
  'adults',
  'afternoon',
  'anytime',
  'bag',
  'bags',
  'business',
  'cabin',
  'cheap',
  'cheapest',
  'child',
  'children',
  'class',
  'couple',
  'date',
  'dates',
  'departing',
  'direct',
  'economy',
  'family',
  'fare',
  'fares',
  'first',
  'flexible',
  'flying',
  'for',
  'from',
  'group',
  'in',
  'leaving',
  'month',
  'morning',
  'next',
  'night',
  'nonstop',
  'on',
  'one',
  'passenger',
  'passengers',
  'people',
  'premium',
  'return',
  'round',
  'solo',
  'summer',
  'this',
  'three',
  'today',
  'tomorrow',
  'tonight',
  'traveler',
  'travelers',
  'travelling',
  'traveling',
  'trip',
  'two',
  'way',
  'week',
  'weekend',
  'winter',
  'with',
  'year',
])

function compactWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function titleCaseToken(token: string) {
  if (/^[a-z]{3}$/.test(token) && !COMMON_THREE_LETTER_WORDS.has(token)) {
    return token.toUpperCase()
  }

  return token.charAt(0).toUpperCase() + token.slice(1)
}

function humanizeSlugTokens(tokens: string[]) {
  return compactWhitespace(tokens.filter(Boolean).map(titleCaseToken).join(' '))
}

function looksLikeShareMetadataTail(tokens: string[], index: number) {
  const token = tokens[index]
  const nextToken = tokens[index + 1]

  if (!token) {
    return false
  }

  if (token === 'round' && nextToken === 'trip') {
    return true
  }

  if (token === 'one' && nextToken === 'way') {
    return true
  }

  return SHARE_SLUG_STOP_WORDS.has(token)
}

export function isPublicShareAssetPath(pathname: string) {
  return pathname.startsWith('/api/og/results/') || RESULTS_SHARE_IMAGE_PATH_RE.test(pathname)
}

export function normalizeShareLabelParam(value?: string | null) {
  if (typeof value !== 'string') {
    return null
  }

  const compact = compactWhitespace(value)
  return compact.length > 0 ? compact : null
}

export function extractShareLabelsFromResultsPathname(pathname?: string | null, searchId?: string): ShareLabels | null {
  if (!pathname || !searchId) {
    return null
  }

  const segments = pathname.split('/').filter(Boolean)
  if (segments[0] !== 'results' || segments[1] !== searchId) {
    return null
  }

  const slug = segments[2]
  if (!slug || slug === 'opengraph-image' || slug === 'twitter-image') {
    return null
  }

  const decodedSlug = decodeURIComponent(slug).toLowerCase()
  const tokens = decodedSlug.split('-').filter(Boolean)
  const toIndex = tokens.indexOf('to')
  if (toIndex <= 0 || toIndex === tokens.length - 1) {
    return null
  }

  const fromTokens = tokens.slice(0, toIndex)
  let destinationEnd = tokens.length

  for (let index = toIndex + 1; index < tokens.length; index += 1) {
    if (looksLikeShareMetadataTail(tokens, index)) {
      destinationEnd = index
      break
    }
  }

  const toTokens = tokens.slice(toIndex + 1, destinationEnd)
  if (fromTokens.length === 0 || toTokens.length === 0) {
    return null
  }

  const fromLabel = humanizeSlugTokens(fromTokens)
  const toLabel = humanizeSlugTokens(toTokens)
  if (!fromLabel || !toLabel) {
    return null
  }

  return { fromLabel, toLabel }
}