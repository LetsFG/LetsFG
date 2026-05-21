/**
 * Share-link utilities — pure functions for shareable URL generation and
 * visit attribution.
 *
 * These functions are intentionally free of I/O so they can be unit-tested
 * offline and used from any context (server components, edge, client, tests).
 */

const DEFAULT_SITE_URL = 'https://letsfg.co'

// ── buildShareSlug ────────────────────────────────────────────────────────────

/**
 * Converts two place labels into a URL-safe kebab-case slug separated by "-to-".
 * Example: ("London Heathrow", "Tokyo Narita") → "london-heathrow-to-tokyo-narita"
 */
export function buildShareSlug(fromLabel: string, toLabel: string): string {
  return `${slugify(fromLabel)}-to-${slugify(toLabel)}`
}

function slugify(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .replace(/[^a-z0-9\s-]/g, '')   // remove non-alphanumeric
    .trim()
    .replace(/\s+/g, '-')           // spaces → hyphens
    .replace(/-{2,}/g, '-')         // collapse consecutive hyphens
}

// ── generateShareUrl ──────────────────────────────────────────────────────────

export interface GenerateShareUrlOptions {
  fromLabel?: string
  toLabel?: string
  siteUrl?: string
}

/**
 * Builds the canonical shareable URL for a search session.
 * The URL resolves to the existing /results/[searchId] page so no new
 * page routes are required.
 *
 * With labels: https://letsfg.co/results/ws_abc123/london-to-tokyo
 * Without:     https://letsfg.co/results/ws_abc123
 */
export function generateShareUrl(searchId: string, options?: GenerateShareUrlOptions): string {
  const base = (options?.siteUrl ?? DEFAULT_SITE_URL).replace(/\/$/, '')
  const slug =
    options?.fromLabel && options?.toLabel
      ? `/${buildShareSlug(options.fromLabel, options.toLabel)}`
      : ''
  return `${base}/results/${searchId}${slug}`
}

// ── isValidShareId ────────────────────────────────────────────────────────────

/**
 * Returns true if value is a non-empty string with no whitespace,
 * suitable for use as a search session share ID.
 */
export function isValidShareId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !/\s/.test(value)
}

// ── extractShareSource ────────────────────────────────────────────────────────

/**
 * Extracts the source search ID from URL search params.
 *
 * Checks (in priority order):
 *   1. ?ref=<id>                — short form used in share links
 *   2. ?source_search_id=<id>   — explicit analytics field name
 *
 * Returns null if no valid share source is found.
 */
export function extractShareSource(
  params: URLSearchParams | Record<string, string | undefined>,
): string | null {
  const get = (key: string): string | null | undefined =>
    params instanceof URLSearchParams ? params.get(key) : params[key]

  const ref = get('ref')
  if (ref && ref.length > 0) return ref

  const sid = get('source_search_id')
  if (sid && sid.length > 0) return sid

  return null
}

// ── buildShareVisitAttribution ────────────────────────────────────────────────

export interface ShareVisitAttribution {
  source_search_id: string
  source: string
}

/**
 * Builds the analytics attribution fields for a session that arrived via a
 * shared link. The returned object is merged into the SearchSessionPayload.
 */
export function buildShareVisitAttribution(sourceSearchId: string): ShareVisitAttribution {
  return {
    source_search_id: sourceSearchId,
    source: 'share',
  }
}
