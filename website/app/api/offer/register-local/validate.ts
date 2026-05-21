const PRIVATE_IP_RE = /^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|127\.|0\.0\.0\.0$)/
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0'])
const BLOCKED_HOSTNAMES_RE = /letsfg\.co$/i

export function validateLocalOfferBookingUrl(url: unknown): boolean {
  if (typeof url !== 'string' || !url) return false

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  if (parsed.protocol !== 'https:') return false

  const host = parsed.hostname.toLowerCase()

  if (LOOPBACK_HOSTS.has(host)) return false
  if (PRIVATE_IP_RE.test(host)) return false
  if (BLOCKED_HOSTNAMES_RE.test(host)) return false

  // Reject bare hostnames with no dot (e.g. "internalhost")
  if (!host.includes('.')) return false

  return true
}
