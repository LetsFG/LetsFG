import Link from 'next/link'
import Image from 'next/image'

// Server-rendered fallback while [searchId]/page.tsx runs its initial data
// fetch on hard refresh. Deliberately minimal — the actual loading visual
// lives on /results/pending; once ResultsClient mounts, it owns all polling
// + UI. We only render the header + a slim bar here so the page doesn't
// flash blank during SSR. No legacy SearchingTasks import.
export default function ResultsLoading() {
  return (
    <main className="res2-page">
      <header className="lp-topbar">
        <Link href="/" className="lp-topbar-brand-link" aria-label="LetsFG home">
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
      </header>
      <section className="res2-body">
        <div className="res2-skeleton-bar" aria-label="Loading results" role="progressbar">
          <div className="res2-skeleton-bar-fill" />
        </div>
      </section>
    </main>
  )
}
