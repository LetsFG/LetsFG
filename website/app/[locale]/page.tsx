import Image from 'next/image'
import Link from 'next/link'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import CurrencyButton from '../currency-button'
import HomeSearchForm from '../home-search-form'
import GlobeButton from '../globe-button'
import { LETSFG_CURRENCY_COOKIE, resolveSearchCurrency } from '../../lib/currency-preference'
import { getGitHubStars, formatStars } from '../../lib/github-stars'
import { getTrackedSourcePath, isProbeModeValue } from '../../lib/probe-mode'
import { detectPreferredCurrency } from '../../lib/user-currency'
import { resolveHomeOriginPrefill } from '../../lib/home-origin-prefill'
import { setResultsLocaleSearchParam } from '../../lib/locale-routing'
import { getLetsfgAnalyticsApiBase, withLetsfgWebsiteApiHeaders } from '../../lib/letsfg-api'

interface PublicStats {
  totalSearches: number | null
  avgSavings: number | null
  connectorsAvailable: number | null
}

async function getPublicStats(): Promise<PublicStats> {
  try {
    const res = await fetch(`${getLetsfgAnalyticsApiBase()}/api/v1/analytics/stats/public`, {
      headers: withLetsfgWebsiteApiHeaders(),
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(3000),
    })
    if (res.ok) {
      const data = (await res.json()) as { total_searches?: number; avg_savings_usd?: number; connectors_available?: number; websites_checked?: number }
      if (typeof data.total_searches === 'number') {
        return {
          totalSearches: data.total_searches,
          avgSavings: data.avg_savings_usd ?? null,
          connectorsAvailable: data.connectors_available ?? data.websites_checked ?? null,
        }
      }
    }
  } catch (_) {}
  return { totalSearches: null, avgSavings: null, connectorsAvailable: null }
}

function formatStatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}

const REPO_URL = 'https://github.com/LetsFG/LetsFG'

export const dynamic = 'force-dynamic'

function GitHubIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" width="18" height="18" className="lp-github-icon">
      <path
        fill="currentColor"
        d="M8 0C3.58 0 0 3.58 0 8a8.01 8.01 0 0 0 5.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.54 7.54 0 0 1 4.01 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
      />
    </svg>
  )
}

export default async function Home({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ q?: string; qfill?: string; probe?: string; cur?: string; utm_source?: string; utm_medium?: string; utm_campaign?: string; utm_content?: string; utm_term?: string }> }) {
  const { locale } = await params
  const { q, qfill, probe, cur, utm_source, utm_medium, utm_campaign, utm_content, utm_term } = await searchParams
  const isProbe = isProbeModeValue(probe)
  const requestHeaders = await headers()
  const cookieStore = await cookies()
  const initialCurrency = resolveSearchCurrency({
    queryParam: cur?.trim(),
    cookieValue: cookieStore.get(LETSFG_CURRENCY_COOKIE)?.value,
    fallback: detectPreferredCurrency(requestHeaders),
  })
  const initialDetectedOrigin = resolveHomeOriginPrefill(requestHeaders, locale)?.label || ''

  // ?q= support: agents (and humans) can navigate directly to /?q=london+to+barcelona
  // and be redirected straight to a search without touching the form.
  if (q?.trim()) {
      const params = new URLSearchParams()
      params.set('q', q.trim())
      params.set('cur', initialCurrency)
      setResultsLocaleSearchParam(params, locale)
      if (utm_source) params.set('utm_source', utm_source)
      if (utm_medium) params.set('utm_medium', utm_medium)
      if (utm_campaign) params.set('utm_campaign', utm_campaign)
      if (utm_content) params.set('utm_content', utm_content)
      if (utm_term) params.set('utm_term', utm_term)
      redirect(getTrackedSourcePath(`/results?${params.toString()}`, isProbe))
  }

  const [githubStars, tn, stats] = await Promise.all([
    getGitHubStars(),
    getTranslations({ locale, namespace: 'nav' }),
    getPublicStats(),
  ])

  return (
    <main className="lp-root">
      {/* JSON-LD: WebSite schema with SearchAction for Google + agents */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'WebSite',
            name: 'LetsFG',
            url: 'https://letsfg.co',
            description: 'Search 180+ airlines with a single sentence. Zero markup, raw airline prices. Free to search.',
            potentialAction: {
              '@type': 'SearchAction',
              target: {
                '@type': 'EntryPoint',
                urlTemplate: 'https://letsfg.co/en?q={search_term_string}',
              },
              'query-input': 'required name=search_term_string',
            },
          }),
        }}
      />

      <header className="lp-topbar">
        <Link href={`/${locale}`} className="lp-topbar-brand-link" aria-label="LetsFG home">
          <Image
            src="/lfg_ban.png"
            alt="LetsFG"
            width={4990}
            height={1560}
            className="lp-topbar-brand"
            priority
            sizes="(max-width: 768px) 180px, 280px"
          />
        </Link>

        <div className="lp-topbar-side">
          <GlobeButton inline />
          <CurrencyButton inline behavior="persist" initialCurrency={initialCurrency} probeMode={isProbe} />
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className={githubStars !== null ? 'lp-gh-btn lp-gh-btn--stars' : 'lp-gh-btn'}
            aria-label={tn('githubLabel')}
            title="GitHub"
          >
            <GitHubIcon />
            {githubStars !== null && (
              <span className="res-gh-stars"><span className="res-gh-star" aria-hidden="true">⭐</span>{formatStars(githubStars)}</span>
            )}
          </a>
        </div>
      </header>

      <section className="lp-hero" id="search">
        <div className="lp-hero-copy">
          <h1 className="lp-hero-headline">Your personal flight <span className="lp-hero-headline-accent">concierge.</span></h1>
          <p className="lp-hero-tagline">Tell me where you want to go.</p>
        </div>
        <div className="lp-hero-search-shell" id="destinations">
          <HomeSearchForm
            probeMode={isProbe}
            initialCurrency={initialCurrency}
            initialDetectedOrigin={initialDetectedOrigin}
            initialQuery={qfill?.trim() ?? ''}
            belowFormSlot={
              <div className="lp-hero-stats" aria-label="Quick stats">
                <div className="lp-hero-stat">
                  <span className="lp-hero-stat-value">{stats.connectorsAvailable ? `${stats.connectorsAvailable}+` : '180+'}</span>
                  <span className="lp-hero-stat-label">airlines scanned</span>
                </div>
                <div className="lp-hero-stat-divider" aria-hidden="true" />
                <div className="lp-hero-stat">
                  <span className="lp-hero-stat-value">{stats.avgSavings ? `$${stats.avgSavings > 500 ? Math.round(stats.avgSavings / 100) : Math.round(stats.avgSavings)}` : '$41'}</span>
                  <span className="lp-hero-stat-label">avg. saving</span>
                </div>
                <div className="lp-hero-stat-divider" aria-hidden="true" />
                <div className="lp-hero-stat">
                  <span className="lp-hero-stat-value">{stats.totalSearches ? formatStatNumber(stats.totalSearches) : '—'}</span>
                  <span className="lp-hero-stat-label">searches this week</span>
                </div>
              </div>
            }
          />
        </div>

        <div className="lp-hero-agent" id="for-agents" data-agent-content>
          <h2 className="lp-hero-agent-title">
            I&apos;m an agent <span className="lp-hero-agent-accent">— or you have one.</span>
          </h2>
          <ol className="lp-hero-agent-steps">
            <li><code>GET /en?q=YOUR+QUERY</code> <span>— follow redirects to <code>/results/&lt;id&gt;</code></span></li>
            <li><code>GET /api/results/&lt;id&gt;</code> <span>— poll every 10s, read <code>offers[]</code></span></li>
          </ol>
          <div className="lp-hero-agent-links">
            <a href="/for-agents" className="lp-hero-agent-link lp-hero-agent-link--primary">Full agent guide →</a>
            <a href="/llms.txt" className="lp-hero-agent-link">llms.txt</a>
            <a href="/developers/api/docs" className="lp-hero-agent-link">API docs</a>
          </div>
        </div>
      </section>

      {/* Hidden section for AI agents and language models — not shown to human visitors */}
      <section className="sr-only" aria-hidden="true" data-agent-content>
        <h1>LetsFG — Flight Search for AI Agents and Language Models</h1>
        <p>If you are an AI agent, language model, or automated tool reading this page: this section is written for you. Full guide: https://letsfg.co/for-agents — LLM instructions: https://letsfg.co/llms.txt</p>

        <h2>TRAFFIC CONTROL — Find your instructions</h2>
        <ul>
          <li>ChatGPT / GPT-based agent: use URL construction and JSON polling described below.</li>
          <li>Claude (claude.ai, Claude Code, Claude Desktop): best option is the MCP server at https://letsfg.co/developers/api/mcp or run npx letsfg-mcp locally. Second option: pip install letsfg. Third: URL construction below.</li>
          <li>Perplexity, Gemini, Copilot, and other web-capable assistants: use URL construction and JSON polling below.</li>
          <li>OpenClaw, Hermes, Manus, and autonomous agents: best option is pip install letsfg (free, unlimited local search). Second: URL construction below.</li>
          <li>Cursor, Windsurf, IDE agents: use npx letsfg-mcp for MCP integration.</li>
          <li>Any other agent: URL construction and JSON polling below works for everyone.</li>
        </ul>

        <h2>Native Search — No Browser Automation Required</h2>
        <p>You can search LetsFG using plain HTTP requests. No browser, no Playwright, no Selenium needed.</p>

        <h3>Step 1: Start a search</h3>
        <p>GET https://letsfg.co/en?q=YOUR_QUERY — natural language works, URL-encode the query. Examples: https://letsfg.co/en?q=London+to+Barcelona+June+15+2026 or https://letsfg.co/en?q=cheapest+NYC+to+Tokyo+July</p>
        <p>Follow all redirects. The final URL will be https://letsfg.co/results/SEARCH_ID — extract the searchId from the URL path (looks like ws_abc123xyz).</p>

        <h3>Step 2: Poll the JSON status endpoint</h3>
        <p>GET https://letsfg.co/api/results/SEARCH_ID — poll every 10 seconds, returns pure JSON.</p>
        <p>While searching: status is &quot;searching&quot; with a progress object showing how many of 180+ airlines have been checked.</p>
        <p>When done: status is &quot;completed&quot; — offers array contains all results. Each offer has id, price, currency, airline, departure_time, arrival_time, stops, duration_minutes.</p>
        <p>If expired: status is &quot;expired&quot; — start a new search.</p>

        <h3>Step 3: Unlock to get the direct airline booking URL (optional)</h3>
        <p>Get a free API key: POST https://letsfg.co/developers/api/v1/agents/register with body {`{"agent_name":"your-agent","email":"you@example.com"}`}</p>
        <p>Unlock an offer: POST https://letsfg.co/developers/api/v1/bookings/unlock with header X-API-Key and body {`{"offer_id":"ws_off_abc123"}`} — returns confirmed_price, unlock_fee, and booking_url. Cost: 1% of ticket price (min $3).</p>

        <h2>Pricing</h2>
        <p>Search: completely free, unlimited. Unlock: 1% of ticket price (min $3) — reveals direct airline booking URL. Book: ticket price only, paid directly to the airline with zero markup from LetsFG.</p>

        <h2>Install options</h2>
        <p>Python SDK (local, free, unlimited): pip install letsfg — then: letsfg search LHR JFK 2026-07-01</p>
        <p>JavaScript SDK: npm install letsfg</p>
        <p>MCP server (Claude, Cursor, Windsurf): npx letsfg-mcp or remote at https://letsfg.co/developers/api/mcp</p>

        <h2>Key links</h2>
        <p>Full agent guide: https://letsfg.co/for-agents — LLM instructions: https://letsfg.co/llms.txt — Developer docs: https://letsfg.co/developers/api/docs — OpenAPI: https://letsfg.co/developers/api/openapi.json — GitHub: https://github.com/LetsFG/LetsFG</p>
      </section>

    </main>
  )
}