// IP-CIDR denylist for the proxy middleware. Used to drop traffic from known
// abuse source ranges before any expensive work runs.
//
// Source intentionally contains NO default CIDRs. The actual list is sourced
// at runtime from the LETSFG_BLOCKED_CIDRS env var (set on Cloud Run) so the
// list can be tuned without a redeploy and isn't visible in this public repo
// — listing a CIDR here is a free hint to a sophisticated attacker about
// what to rotate away from. Same pattern as ua-blocklist.ts.
//
// Format: comma-separated IPv4 CIDRs.
//   LETSFG_BLOCKED_CIDRS="1.2.3.0/24,4.5.0.0/16"
//
// With no env var set, no IP is blocked here (rely on UA blocklist +
// rate-limit + Cloudflare WAF when CF is in the data path).
//
// Scope: callers decide which paths to apply this on via
// pathIsAbuseProtected(). Some Google ranges overlap legitimate Googlebot
// crawlers, so blocking globally would damage SEO indexing of marketing &
// PFP pages — apply only to the expensive search endpoints.

interface ParsedCidr {
  base: number
  mask: number
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const octet = Number(part)
    if (octet < 0 || octet > 255) return null
    n = n * 256 + octet
  }
  return n
}

function parseCidr(cidr: string): ParsedCidr | null {
  const trimmed = cidr.trim()
  if (!trimmed) return null
  const [ipStr, prefixStr] = trimmed.split('/')
  const ip = ipv4ToInt(ipStr || '')
  const prefix = Number(prefixStr)
  if (ip === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  return { base: (ip & mask) >>> 0, mask }
}

function getCidrList(env: Record<string, string | undefined>): ReadonlyArray<ParsedCidr> {
  const raw = env.LETSFG_BLOCKED_CIDRS
  if (!raw) return []
  return raw
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)
    .map(parseCidr)
    .filter((c): c is ParsedCidr => c !== null)
}

export function ipMatchesBlockedCidr(
  ip: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const n = ipv4ToInt(ip)
  if (n === null) return false
  for (const { base, mask } of getCidrList(env)) {
    if (((n & mask) >>> 0) === base) return true
  }
  return false
}

export function extractClientIp(headers: Headers): string | null {
  // Leftmost X-Forwarded-For is the original client across all ingress paths:
  // CF → Firebase → Cloud Run, Firebase → Cloud Run, direct .run.app.
  const xff = headers.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first) return stripPortAndBrackets(first)
  }
  const fallback = headers.get('cf-connecting-ip') || headers.get('x-real-ip')
  return fallback ? stripPortAndBrackets(fallback) : null
}

function stripPortAndBrackets(raw: string): string {
  let value = raw.trim()
  if (value.startsWith('[')) {
    const end = value.indexOf(']')
    if (end > 0) return value.slice(1, end)
  }
  // IPv4 "1.2.3.4:5678" → strip port. IPv6 contains multiple colons; leave.
  const colonCount = (value.match(/:/g) || []).length
  if (colonCount === 1) value = value.split(':')[0]
  return value
}

const ABUSE_PROTECTED_PREFIXES: ReadonlyArray<string> = [
  '/results',
  '/api/results',
  '/api/search',
  '/api/offer',
  '/api/parse-query',
  '/api/date-grid',
  '/api/rank',
]

export function pathIsAbuseProtected(pathname: string): boolean {
  for (const prefix of ABUSE_PROTECTED_PREFIXES) {
    if (
      pathname === prefix ||
      pathname.startsWith(`${prefix}/`) ||
      pathname.startsWith(`${prefix}?`)
    ) {
      return true
    }
  }
  return false
}
