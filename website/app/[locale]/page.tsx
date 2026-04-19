import Image from 'next/image'
import { getTranslations } from 'next-intl/server'
import HomeSearchForm from '../home-search-form'
import GlobeButton from '../globe-button'

const REPO_URL = 'https://github.com/LetsFG/LetsFG'

const LOCALE_BANNERS: Record<string, string> = {
  de: '/banners/de.png',
  es: '/banners/es.png',
  fr: '/banners/fr.png',
  it: '/banners/it.png',
  nl: '/banners/nl.png',
  pl: '/banners/pl.png',
  pt: '/banners/pt.png',
  sq: '/banners/sq.png',
  hr: '/banners/hr.png',
  sv: '/banners/sv.png',
}

const LOCALE_BANNER_SCALE: Record<string, number> = {
  de: 1.07,
  es: 1.07,
  fr: 1.15,
  it: 1.15,
  pt: 1.15,
  nl: 1.15,
  pl: 1.18,
  sv: 1.07,
  sq: 1.22,
  hr: 1.35,
}
const API_BASE = process.env.LETSFG_API_URL || 'https://api.letsfg.co'

async function getGitHubStars(): Promise<number | null> {
  try {
    const res = await fetch('https://api.github.com/repos/LetsFG/LetsFG', {
      headers: { Accept: 'application/vnd.github+json' },
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(2000),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { stargazers_count?: number }
    return typeof data.stargazers_count === 'number' ? data.stargazers_count : null
  } catch {
    return null
  }
}

interface PublicStats {
  totalSearches: number | null
  avgSavings: number | null
  airlinesCount: number | null
}

async function getPublicStats(): Promise<PublicStats> {
  const fallback: PublicStats = { totalSearches: null, avgSavings: null, airlinesCount: null }
  try {
    const res = await fetch(`${API_BASE}/api/v1/analytics/stats/public`, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(2000),
    })
    if (!res.ok) return fallback
    const data = (await res.json()) as {
      total_searches?: number
      avg_savings_usd?: number
      airlines_count?: number
    }
    return {
      totalSearches: data.total_searches ?? null,
      avgSavings: data.avg_savings_usd ?? null,
      airlinesCount: data.airlines_count ?? null,
    }
  } catch {
    return fallback
  }
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`
  return n.toLocaleString('en-US')
}

function formatStars(n: number | null): string {
  if (n === null) return 'GitHub'
  if (n >= 1000) return `${n >= 10000 ? Math.round(n / 1000) : Math.round(n / 100) / 10}k stars`
  return `${n} stars`
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" width="20" height="20">
      <path
        fill="currentColor"
        d="M12 1.5a10.5 10.5 0 0 0-3.32 20.47c.53.1.72-.23.72-.52v-1.82c-2.94.64-3.56-1.24-3.56-1.24-.48-1.22-1.18-1.54-1.18-1.54-.97-.66.07-.65.07-.65 1.07.08 1.64 1.1 1.64 1.1.95 1.63 2.5 1.16 3.11.89.1-.69.37-1.16.66-1.43-2.35-.27-4.83-1.18-4.83-5.24 0-1.16.42-2.1 1.1-2.84-.1-.27-.48-1.37.1-2.85 0 0 .9-.29 2.96 1.09a10.21 10.21 0 0 1 5.38 0c2.06-1.38 2.96-1.1 2.96-1.1.58 1.49.2 2.59.1 2.86.68.74 1.1 1.68 1.1 2.84 0 4.08-2.49 4.97-4.85 5.23.38.33.72.99.72 2v2.97c0 .29.19.63.73.52A10.5 10.5 0 0 0 12 1.5Z"
      />
    </svg>
  )
}

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const [stars, stats, t] = await Promise.all([
    getGitHubStars(),
    getPublicStats(),
    getTranslations({ locale, namespace: 'stats' }),
  ])
  const tn = await getTranslations({ locale, namespace: 'nav' })
  const tf = await getTranslations({ locale, namespace: 'footer' })
  const th = await getTranslations({ locale, namespace: 'hero' })
  const tfeat = await getTranslations({ locale, namespace: 'features' })
  const bannerSrc = LOCALE_BANNERS[locale] ?? '/banner.png'

  return (
    <main className="lp-root">
      <a
        href={REPO_URL}
        className="lp-badge lp-badge--left"
        target="_blank"
        rel="noreferrer"
        aria-label={tn('githubLabel')}
      >
        <GitHubIcon />
        <span>⭐ {formatStars(stars)}</span>
      </a>

      <GlobeButton />

      <section className="lp-hero">
        <video
          className="lp-hero-sky"
          src="/hero-bg.mp4"
          autoPlay
          muted
          loop
          playsInline
          aria-hidden="true"
        />
        <div className="lp-hero-fade" aria-hidden="true" />
        <Image
          src={bannerSrc}
          alt="LetsFG"
          width={2000}
          height={667}
          className="lp-hero-brand"
          priority
          unoptimized
          style={LOCALE_BANNER_SCALE[locale] ? { transform: `scale(${LOCALE_BANNER_SCALE[locale]})` } : undefined}
          aria-hidden="true"
        />
        <p className="lp-hero-sub">{th('tagline')}</p>
        <HomeSearchForm />
      </section>

      <section className="lp-stats" aria-label="Platform statistics">
        <div className="lp-stat">
          <span className="lp-stat-value">
            {stats.totalSearches !== null ? formatNumber(stats.totalSearches) : '—'}
          </span>
          <span className="lp-stat-label">{t('searches')}</span>
        </div>
        <div className="lp-stat-divider" aria-hidden="true" />
        <div className="lp-stat">
          <span className="lp-stat-value">
            {stats.avgSavings !== null ? `$${stats.avgSavings}` : '—'}
          </span>
          <span className="lp-stat-label">{t('savings')}</span>
        </div>
        <div className="lp-stat-divider" aria-hidden="true" />
        <div className="lp-stat">
          <span className="lp-stat-value">0%</span>
          <span className="lp-stat-label">{t('markup')}</span>
        </div>
      </section>

      <section className="lp-community" aria-label="About LetsFG">
        <p className="lp-community-intro">{tfeat('intro')}</p>
        <h2 className="lp-community-join">{tfeat('join')}</h2>
        <p>{tfeat('open_source')}</p>
        <p>
          {tfeat('contribute')}{' '}
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="lp-community-link">
            {tfeat('contribute_link')}
          </a>
        </p>
        <p>{tfeat('share')}</p>
        <p className="lp-community-star">
          {tfeat('star')}{' '}
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="lp-community-link">
            ⭐ Star on GitHub
          </a>
        </p>
        <p className="lp-community-signature">{tfeat('signature')}</p>
      </section>

      <footer className="lp-footer">
        <a href={REPO_URL} className="lp-footer-link" target="_blank" rel="noreferrer">{tf('github')}</a>
        <a href="/terms" className="lp-footer-link">{tf('terms')}</a>
        <a href="/privacy" className="lp-footer-link">{tf('privacy')}</a>
        <span className="lp-footer-sep" aria-hidden="true" />
        <a href="https://www.instagram.com/letsfg_" className="lp-footer-social" target="_blank" rel="noreferrer" aria-label="Instagram">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>
        </a>
        <a href="https://www.tiktok.com/@letsfg_" className="lp-footer-social" target="_blank" rel="noreferrer" aria-label="TikTok">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.18 8.18 0 0 0 4.78 1.52V6.74a4.85 4.85 0 0 1-1.01-.05z"/></svg>
        </a>
        <a href="https://x.com/LetsFG_" className="lp-footer-social" target="_blank" rel="noreferrer" aria-label="X">
          <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.737-8.835L1.254 2.25H8.08l4.264 5.633 5.9-5.633zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
        </a>
      </footer>
    </main>
  )
}
