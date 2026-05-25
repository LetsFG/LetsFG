// User-Agent denylist for the proxy middleware. The actual values are sourced
// at runtime from the LETSFG_BLOCKED_USER_AGENTS env var (set in Cloud Run) so
// the list can be tuned without a redeploy and isn't visible in this public
// repo — naming an abuser here is a free hint to rename their UA.
//
// Format: comma-separated case-insensitive substrings.
//   LETSFG_BLOCKED_USER_AGENTS="needle1,needle two,needle/3"
//
// With no env var set, nothing is blocked here (rely on Cloudflare WAF + the
// existing token-bucket rate limit). Cloudflare is the primary defence; this
// module is belt-and-suspenders for traffic that reaches Cloud Run directly
// (bypassing CF via the raw run.app URL or AAAA-record gaps).

function readEnvBlocklist(env: Record<string, string | undefined>): string[] {
  const raw = env.LETSFG_BLOCKED_USER_AGENTS
  if (!raw) return []
  return raw
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
}

export function getBlockedUserAgentSubstrings(
  env: Record<string, string | undefined> = process.env,
): string[] {
  return readEnvBlocklist(env)
}

export function isBlockedUserAgent(
  userAgent: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!userAgent) return false
  const list = getBlockedUserAgentSubstrings(env)
  if (list.length === 0) return false
  const lower = userAgent.toLowerCase()
  return list.some((needle) => lower.includes(needle))
}
