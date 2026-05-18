import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import GlobeButton from '../../globe-button'
import HomeMonitorNav from '../../home-monitor-nav'
import DevelopersPortal from './DevelopersPortal'
import { formatStars, getGitHubStars } from '../../../lib/github-stars'

const REPO_URL = 'https://github.com/LetsFG/LetsFG'
const API_BASE_URL = 'https://api.letsfg.co'
const SWAGGER_URL = `${API_BASE_URL}/docs`
const DOCS_URL = 'https://docs.letsfg.co'
const OPENAPI_URL = 'https://raw.githubusercontent.com/LetsFG/LetsFG/main/openapi.yaml'
const SUPPORT_MAILTO = 'mailto:contact@letsfg.co?subject=LetsFG%20partner%20API%20access'

const pricingCards = [
  {
    range: '1 to 10 searches',
    rate: '$0.50 / search',
  },
  {
    range: '11 to 100 searches',
    rate: '$0.20 / search',
  },
  {
    range: '101+ searches',
    rate: '$0.10 / search',
  },
]

export const metadata: Metadata = {
  title: 'LetsFG Developers',
  description:
    'Card-backed access to the LetsFG concierge backend: ranked travel options, reasoning, and booking-first API responses from the same system behind letsfg.co.',
}

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

export default async function DevelopersPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const githubStars = await getGitHubStars()

  return (
    <main className="lp-root dev-page">
      <section className="lp-hero dev-hero-shell">
        <div className="lp-hero-sky" aria-hidden="true">
          <Image
            src="/chatgpt-sky-bg.jpg"
            alt=""
            fill
            priority
            unoptimized
            sizes="(max-width: 767px) 1px, 1440px"
            className="lp-hero-sky-img"
            style={{ objectFit: 'cover', objectPosition: 'center 42%' }}
          />
        </div>
        <div className="lp-hero-fade" aria-hidden="true" />

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

          <HomeMonitorNav locale={locale} />

          <div className="lp-topbar-side">
            <GlobeButton inline />
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              className={githubStars !== null ? 'res-icon-btn res-icon-btn--gh' : 'res-icon-btn'}
              aria-label="GitHub"
              title="GitHub"
            >
              <GitHubIcon />
              {githubStars !== null && (
                <span className="res-gh-stars"><span className="res-gh-star" aria-hidden="true">⭐</span>{formatStars(githubStars)}</span>
              )}
            </a>
          </div>
        </div>

        <div className="lp-hero-content dev-hero-content">
          <span className="dev-kicker">Official Developers API</span>
          <h1 className="dev-title">Connect to the LetsFG booking concierge.</h1>
          <p className="dev-subtitle">
            This API talks to the same backend agent behind letsfg.co. One request in, ranked trip
            options out, with reasoning, booking paths, and a concierge-style answer instead of
            forty disconnected searches.
          </p>

          <div className="dev-pill-row" aria-label="Integration highlights">
            <span className="dev-pill">Same backend as letsfg.co</span>
            <span className="dev-pill">Ranked with reasoning</span>
            <span className="dev-pill">Booking-first responses</span>
            <span className="dev-pill">Card-backed access</span>
          </div>

          <div className="dev-cta-row">
            <a href="#portal" className="dev-button dev-button--primary">
              Get API access
            </a>
            <a href={SWAGGER_URL} target="_blank" rel="noreferrer" className="dev-button dev-button--ghost">
              Browse docs
            </a>
          </div>
        </div>
      </section>

      <section className="dev-section dev-section--compact">
        <div className="dev-shell">
          <div className="dev-rate-table dev-rate-table--centered" aria-label="Pricing tiers">
            <div className="dev-rate-table-head">
              <span className="dev-section-kicker">Pricing</span>
              <h2 className="dev-section-title">Usage-based search billing.</h2>
              <p>
                Minimum top-up is $5. Search pricing is calculated automatically from your total search volume.
              </p>
            </div>

            {pricingCards.map((card) => (
              <div key={card.range} className="dev-rate-row">
                <span className="dev-rate-range">{card.range}</span>
                <strong className="dev-rate-price">{card.rate}</strong>
              </div>
            ))}

            <p className="dev-rate-footnote">After 100 searches, the $0.10 rate stays the same.</p>
          </div>
        </div>
      </section>

      <div id="portal">
        <DevelopersPortal locale={locale} />
      </div>

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
        <a href={DOCS_URL} target="_blank" rel="noreferrer" className="lp-footer-link">
          Docs
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