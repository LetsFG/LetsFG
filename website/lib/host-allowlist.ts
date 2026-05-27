// Host-header allowlist for the proxy middleware. Public-facing traffic must
// arrive with a Host header that names one of our real domains — anything
// else (notably the raw .run.app URL used by the price-tracker bot to bypass
// Cloudflare) gets rejected before any other middleware runs.
//
// Domains here are public DNS records — listing them in source is fine.
// The escape hatch for testing tagged Cloud Run revisions on .run.app is the
// LETSFG_ALLOW_RUNAPP_DIRECT env var, which is unset in production.

const ALLOWED_DOMAIN_SUFFIXES: ReadonlyArray<string> = ['letsfg.co']

export function isAllowedHost(
  host: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!host) return false
  const normalised = host.toLowerCase().trim()
  if (!normalised) return false

  // Strip optional ":port" suffix.
  const bare = normalised.split(':')[0]
  if (!bare) return false

  // letsfg.co and any subdomain (www, docs, stats, api, …).
  for (const suffix of ALLOWED_DOMAIN_SUFFIXES) {
    if (bare === suffix || bare.endsWith(`.${suffix}`)) return true
  }

  // Local development — never enabled in production.
  if (env.NODE_ENV !== 'production') {
    if (bare === 'localhost' || bare === '127.0.0.1' || bare === '0.0.0.0') return true
  }

  // Escape hatch for testing tagged Cloud Run revisions on .run.app. Off by
  // default; switch on per-revision via env var when staging behavior needs
  // direct access without going through Cloudflare + Firebase Hosting.
  if (env.LETSFG_ALLOW_RUNAPP_DIRECT === '1' && bare.endsWith('.run.app')) return true

  return false
}
