/**
 * pfp-acquisition.ts — tracks users acquired through Programmatic Flight Pages.
 *
 * When a visitor lands on /[locale]/flights/[route]/ and clicks the search CTA,
 * we label that search with acquisition_source='pfp_organic' and acquisition_channel='pfp'.
 * This flows into the analytics pipeline, experiment engine, and growth model.
 *
 * How it works:
 *  1. The flight page sets a cookie (PFP_ACQUISITION_COOKIE) with the route slug.
 *  2. On search, the results API reads this cookie and attaches acquisition fields.
 *  3. Growth-ops picks up the pfp_organic_searches metric in its daily snapshot.
 *
 * The cookie is short-lived (30 min) — only attributes searches that happen
 * immediately after visiting the PFP page, avoiding false attribution.
 */

/** Cookie name that carries the PFP acquisition context. */
export const PFP_ACQUISITION_COOKIE = 'lfg_pfp_acq'

/** Max age in seconds for the acquisition cookie (30 minutes). */
export const PFP_ACQUISITION_COOKIE_MAX_AGE = 1800

/** Describes a PFP acquisition event for one search. */
export interface PfpAcquisitionContext {
  source: 'pfp_organic'
  route: string
}

/**
 * Parse the current page path to detect if the user is on a PFP page.
 * Accepts both full URLs and path strings.
 *
 * Returns null for non-PFP paths.
 */
export function parsePfpSourceFromReferrer(
  pathOrUrl: string,
): PfpAcquisitionContext | null {
  if (!pathOrUrl) return null

  let path: string
  try {
    // Attempt to parse as URL first
    const url = new URL(pathOrUrl, 'https://letsfg.co')
    path = url.pathname
  } catch {
    path = pathOrUrl
  }

  // Match /[locale]/flights/[origin-dest]/
  const match = path.match(/^\/[a-z]{2}\/flights\/([a-z]{2,4}-[a-z]{2,4})\/?$/)
  if (!match) return null

  return { source: 'pfp_organic', route: match[1] }
}

/** Extra fields appended to a search session payload when acquisition is known. */
export interface AcquisitionSearchFields {
  acquisition_source?: string
  acquisition_route?: string
  acquisition_channel?: string
}

/**
 * Build the extra fields to attach to a search session payload when the
 * visitor came from a PFP page. Returns an empty object when ctx is null.
 */
export function buildAcquisitionSearchPayload(
  ctx: PfpAcquisitionContext | null,
): AcquisitionSearchFields {
  if (!ctx) return {}
  return {
    acquisition_source: ctx.source,
    acquisition_route: ctx.route,
    acquisition_channel: 'pfp',
  }
}
