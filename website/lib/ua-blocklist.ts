// Hard denylist of bot User-Agents that abuse public search. Each hit on
// /results?q=... triggers a Gemini parse + 180+ connector fan-out, so a single
// price-monitor bot can burn material compute in minutes.
//
// This is the in-app stopgap. The durable answer is the Cloudflare WAF rule
// on letsfg.co — turn this off once the CF proxy (orange cloud) is enabled
// and the equivalent UA rule is live there.
//
// Match is case-insensitive substring. Extend at runtime without a deploy via:
//   LETSFG_BLOCKED_USER_AGENTS="badbot,otherbot"

const DEFAULT_BLOCKED_USER_AGENT_SUBSTRINGS = [
  'passagens-monitor',
]

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
  return [...DEFAULT_BLOCKED_USER_AGENT_SUBSTRINGS, ...readEnvBlocklist(env)]
}

export function isBlockedUserAgent(
  userAgent: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!userAgent) return false
  const lower = userAgent.toLowerCase()
  return getBlockedUserAgentSubstrings(env).some((needle) => lower.includes(needle))
}
