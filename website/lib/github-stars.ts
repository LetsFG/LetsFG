const GITHUB_API_URL = 'https://api.github.com/repos/LetsFG/LetsFG'

export async function getGitHubStars(): Promise<number | null> {
  try {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
    }
    if (process.env.GITHUB_TOKEN) {
      headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`
    }
    const res = await fetch(GITHUB_API_URL, {
      next: { revalidate: 900 }, // revalidate every 15 minutes
      headers,
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { stargazers_count?: number }
    return typeof data.stargazers_count === 'number' ? data.stargazers_count : null
  } catch {
    return null
  }
}

export function formatStars(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return n.toLocaleString('en-US')
}
