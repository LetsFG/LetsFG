// Drop-in for the letsfg.co website repo:
//   website/app/api/stars/social/route.ts
//
// Why this exists: the Omarchy plugin shows the homepage's social proof
// ("Already loved by 1.8k+ travelers and engineers"). Today the only public
// surface for that number is /api/stars/badge, which serves an SVG — so the
// plugin has to read the count out of the badge's aria-label. That works, but
// a picture is a poor API and the label is not a contract.
//
// This route publishes the same data as JSON, plus the stargazer avatars the
// homepage stacks. It reuses lib/github-stars.ts, so it inherits that module's
// caching, GITHUB_TOKEN handling and rate-limit floor rather than adding a
// second path to GitHub.
//
// Once deployed, the plugin prefers it automatically and stops parsing SVG —
// see fetchStars() in Panel.qml, which tries this first and falls back.
//
// It is deliberately public and unauthenticated: it exposes nothing that is
// not already on the homepage, and requiring a token for a star count would
// make the badge harder to use than the thing it replaces.

import { NextResponse } from 'next/server'
import { formatStars, getGitHubStars } from '../../../../lib/github-stars'

// Matches the badge route: fresh enough for social proof, cheap enough that
// GitHub's unauthenticated 60/hr limit is never the binding constraint.
export const revalidate = 900

const REPO = 'LetsFG/LetsFG'
const AVATAR_COUNT = 5

type Stargazer = { login?: string; avatar_url?: string }

async function recentAvatars(): Promise<Array<{ login: string; avatar: string }>> {
  try {
    const headers: Record<string, string> = { Accept: 'application/vnd.github.v3+json' }
    if (process.env.GITHUB_TOKEN) headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`

    // `per_page` + `page=last` would need a second call to discover the last
    // page, so take the first page of the most recent stargazers instead.
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/stargazers?per_page=${AVATAR_COUNT}`,
      { headers, next: { revalidate: 900 }, signal: AbortSignal.timeout(3000) },
    )
    if (!res.ok) return []
    const data = (await res.json()) as Stargazer[]
    if (!Array.isArray(data)) return []
    return data
      .filter(u => typeof u?.avatar_url === 'string' && typeof u?.login === 'string')
      .slice(0, AVATAR_COUNT)
      .map(u => ({ login: u.login as string, avatar: u.avatar_url as string }))
  } catch {
    // Avatars are decoration; the count is the point. Never fail the route.
    return []
  }
}

export async function GET() {
  const stars = await getGitHubStars()
  const avatars = await recentAvatars()

  return NextResponse.json(
    {
      repo: REPO,
      stars,
      formatted: formatStars(stars),
      avatars,
    },
    {
      headers: {
        // Public, cacheable, and safe for a desktop client to call directly.
        'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=3600',
        'Access-Control-Allow-Origin': '*',
      },
    },
  )
}
