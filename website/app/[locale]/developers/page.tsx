import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import GlobeButton from '../../globe-button'

const REPO_URL = 'https://github.com/LetsFG/LetsFG'
const API_BASE_URL = 'https://api.letsfg.co'
const SWAGGER_URL = `${API_BASE_URL}/docs`
const REDOC_URL = `${API_BASE_URL}/redoc`
const MCP_URL = `${API_BASE_URL}/mcp`
const OPENAPI_URL = 'https://raw.githubusercontent.com/LetsFG/LetsFG/main/openapi.yaml'
const SUPPORT_EMAIL = 'contact@letsfg.co'
const SUPPORT_MAILTO = 'mailto:contact@letsfg.co?subject=LetsFG%20partner%20API%20access'

const endpointCards = [
  {
    method: 'GET',
    path: '/api/v1/flights/resolve-location',
    summary: 'Resolve city or airport names to stable IATA codes before search.',
    status: 'Ready for search-only integrations',
  },
  {
    method: 'POST',
    path: '/api/v1/flights/search',
    summary: 'Production search endpoint for price, route, duration, stopovers, and conditions.',
    status: 'Ready for search-only integrations',
  },
  {
    method: 'POST',
    path: '/api/v1/bookings/unlock',
    summary: 'Confirms live airline price and reserves the offer for booking.',
    status: 'Documented now; enable later when commercial terms are aligned',
  },
  {
    method: 'POST',
    path: '/api/v1/bookings/book',
    summary: 'Creates the booking after unlock using real passenger details.',
    status: 'Documented now; keep disabled until privacy and support workflow are agreed',
  },
]

const rateLimits = [
  'Search API: 60 req/min per agent',
  'Resolve location: 120 req/min per agent',
  'Unlock: 20 req/min per agent',
  'Book: 10 req/min per agent',
]

const launchNotes = [
  'Partner key flow: self-serve registration exists today, and dedicated partner keys can be coordinated by email.',
  'Sandbox: no separate public sandbox is documented in the repo today. For immediate rollout, use production in search-only mode.',
  'Pricing: search is free. Unlock is free with GitHub star verification. Booking charges the ticket price plus Stripe processing.',
  'Search-only mode does not require passenger profiles, payment, or website scraping.',
  'Referral tracking, attribution, branding approval, GDPR/DPA terms, and live booking operations are handled directly at contact@letsfg.co.',
  'Support: contact@letsfg.co and GitHub Issues. The public docs note typical email response time is under 1 hour.',
]

export const metadata: Metadata = {
  title: 'LetsFG API for Partners',
  description:
    'Production API, OpenAPI spec, rate limits, and rollout notes for LetsFG partner integrations.',
}

export default async function DevelopersPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params

  return (
    <main className="lp-root dev-page">
      <div className="dev-hero-shell">
        <div className="lp-topbar">
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

          <div aria-hidden="true" />

          <div className="lp-topbar-side">
            <GlobeButton inline />
            <a href={REPO_URL} target="_blank" rel="noreferrer" className="dev-top-link">
              GitHub
            </a>
          </div>
        </div>

        <section className="dev-hero">
          <div className="dev-shell dev-hero-grid">
            <div className="dev-copy">
              <span className="dev-kicker">Partner API</span>
              <h1 className="dev-title">Integrate LetsFG in an agent today.</h1>
              <p className="dev-subtitle">
                Production REST API first. SDK and MCP as fallback. Search-only can ship now,
                and unlock or booking can stay off until commercial, privacy, and support flows
                are agreed.
              </p>

              <div className="dev-pill-row" aria-label="Integration highlights">
                <span className="dev-pill">Search-first rollout</span>
                <span className="dev-pill">OpenAPI 3.1</span>
                <span className="dev-pill">Location lookup + flight search</span>
                <span className="dev-pill">No scraping required</span>
              </div>

              <div className="dev-cta-row">
                <a href={SWAGGER_URL} target="_blank" rel="noreferrer" className="dev-button dev-button--primary">
                  Open Swagger
                </a>
                <a href={OPENAPI_URL} target="_blank" rel="noreferrer" className="dev-button dev-button--ghost">
                  Open OpenAPI YAML
                </a>
                <a href={SUPPORT_MAILTO} className="dev-button dev-button--ghost">
                  Request partner access
                </a>
              </div>
            </div>

            <aside className="dev-spotlight">
              <span className="dev-card-kicker">What is live now</span>
              <h2 className="dev-spotlight-title">Search-only integration</h2>
              <ul className="dev-list">
                <li>Location lookup and flight search on the production API.</li>
                <li>Runtime envs already match common agent setups: LETSFG_API_KEY and LETSFG_BASE_URL.</li>
                <li>Stable contract published via Swagger, ReDoc, and the OpenAPI spec.</li>
                <li>Unlock and booking endpoints are documented for later enablement.</li>
              </ul>
            </aside>
          </div>
        </section>
      </div>

      <section className="dev-section">
        <div className="dev-shell">
          <div className="dev-section-head">
            <span className="dev-section-kicker">Use the right surface</span>
            <h2 className="dev-section-title">Production API first. Local tools as fallback.</h2>
          </div>

          <div className="dev-card-grid">
            <article className="dev-card">
              <span className="dev-card-kicker">Production API</span>
              <h3>Use the REST API for live partner integrations.</h3>
              <p>
                Base URL: <code>{API_BASE_URL}</code>
              </p>
              <p>
                Auth: send your key in the <code>X-API-Key</code> header.
              </p>
              <p>
                If you need a dedicated partner key or custom limits, email{' '}
                <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a>.
              </p>
            </article>

            <article className="dev-card">
              <span className="dev-card-kicker">OpenAPI + docs</span>
              <h3>Everything public is already documented.</h3>
              <p>
                Interactive docs: <a href={SWAGGER_URL} target="_blank" rel="noreferrer">Swagger</a> and{' '}
                <a href={REDOC_URL} target="_blank" rel="noreferrer">ReDoc</a>.
              </p>
              <p>
                Importable spec: <a href={OPENAPI_URL} target="_blank" rel="noreferrer">openapi.yaml</a>.
              </p>
            </article>

            <article className="dev-card">
              <span className="dev-card-kicker">Fallbacks</span>
              <h3>SDK and MCP stay available as backup paths.</h3>
              <p>
                JS and Python SDKs live in the public repo, and remote MCP is available at{' '}
                <a href={MCP_URL} target="_blank" rel="noreferrer">{MCP_URL}</a>.
              </p>
              <p>
                That makes the hybrid rollout straightforward: production API for live traffic,
                SDK or MCP for local fallback and prototyping.
              </p>
            </article>
          </div>
        </div>
      </section>

      <section className="dev-section dev-section--compact">
        <div className="dev-shell">
          <div className="dev-section-head">
            <span className="dev-section-kicker">Stable contract</span>
            <h2 className="dev-section-title">Endpoints you can wire against now.</h2>
          </div>

          <div className="dev-endpoint-grid">
            {endpointCards.map((endpoint) => (
              <article key={endpoint.path} className="dev-endpoint-card">
                <div className="dev-endpoint-head">
                  <span className="dev-method">{endpoint.method}</span>
                  <code className="dev-path">{endpoint.path}</code>
                </div>
                <p className="dev-endpoint-summary">{endpoint.summary}</p>
                <p className="dev-endpoint-status">{endpoint.status}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="dev-section dev-section--compact">
        <div className="dev-shell dev-detail-grid">
          <article className="dev-card dev-card--code">
            <span className="dev-card-kicker">Search-only example</span>
            <h3>Drop this into a provider adapter.</h3>
            <pre className="dev-code"><code>{`const baseUrl = process.env.LETSFG_BASE_URL ?? 'https://api.letsfg.co';
const apiKey = process.env.LETSFG_API_KEY!;

const headers = {
  'Content-Type': 'application/json',
  'X-API-Key': apiKey,
};

const locations = await fetch(
  \`${'${baseUrl}'}/api/v1/flights/resolve-location?query=London\`,
  { headers }
).then((response) => response.json());

const results = await fetch(\`${'${baseUrl}'}/api/v1/flights/search\`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    origin: 'LON',
    destination: 'BCN',
    date_from: '2026-06-15',
    adults: 1,
    currency: 'EUR',
  }),
}).then((response) => response.json());`}</code></pre>
          </article>

          <article className="dev-card">
            <span className="dev-card-kicker">API key flow</span>
            <h3>Start immediately with self-serve registration.</h3>
            <pre className="dev-code dev-code--small"><code>{`curl -X POST https://api.letsfg.co/api/v1/agents/register \\
  -H "Content-Type: application/json" \\
  -d '{"agent_name":"your-agent","email":"team@example.com"}'`}</code></pre>
            <p>
              That returns an API key for production calls today. If you want a dedicated partner key,
              contact <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a>.
            </p>
          </article>
        </div>
      </section>

      <section className="dev-section dev-section--compact">
        <div className="dev-shell dev-detail-grid">
          <article className="dev-card">
            <span className="dev-card-kicker">Rate limits</span>
            <h3>Standard production limits.</h3>
            <ul className="dev-list">
              {rateLimits.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>

          <article className="dev-card">
            <span className="dev-card-kicker">Partner rollout notes</span>
            <h3>What is manual today.</h3>
            <ul className="dev-list">
              {launchNotes.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
        </div>
      </section>

      <section className="dev-section dev-section--last">
        <div className="dev-shell">
          <div className="dev-contact-card">
            <span className="dev-card-kicker">Need a fast rollout?</span>
            <h2 className="dev-contact-title">Send the partner team your runtime shape and we can wire the rest around it.</h2>
            <p className="dev-contact-copy">
              If you are already building around <code>LETSFG_API_KEY</code> and{' '}
              <code>LETSFG_BASE_URL</code>, you can ship location lookup plus search immediately and keep
              unlock or booking for phase two.
            </p>
            <div className="dev-cta-row">
              <a href={SUPPORT_MAILTO} className="dev-button dev-button--primary">
                Email partner team
              </a>
              <a href={SWAGGER_URL} target="_blank" rel="noreferrer" className="dev-button dev-button--ghost">
                Browse docs
              </a>
            </div>
          </div>
        </div>
      </section>

      <footer className="lp-footer">
        <Link href={`/${locale}`} className="lp-footer-link">
          Home
        </Link>
        <a href={SWAGGER_URL} target="_blank" rel="noreferrer" className="lp-footer-link">
          Swagger
        </a>
        <a href={OPENAPI_URL} target="_blank" rel="noreferrer" className="lp-footer-link">
          OpenAPI
        </a>
        <a href={REPO_URL} target="_blank" rel="noreferrer" className="lp-footer-link">
          GitHub
        </a>
        <a href={SUPPORT_MAILTO} className="lp-footer-link">
          Support
        </a>
      </footer>
    </main>
  )
}