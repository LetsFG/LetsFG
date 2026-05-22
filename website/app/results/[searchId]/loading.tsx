'use client'

import { useEffect, useLayoutEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Image from 'next/image'
import SearchingTasks from './SearchingTasks'

// Shown while [searchId]/page.tsx runs its server-side data fetch.
// Intentionally avoids useSearchParams() — that hook requires an inner
// <Suspense> boundary, and a <Suspense fallback={null}> is the source
// of the black-screen flash when React falls back here mid-transition.
// useParams() is always synchronous in dynamic rendering; no Suspense needed.

interface Progress {
  checked: number
  total: number
  found: number
}

function LoadingInner() {
  const params = useParams()
  const searchId = (params?.searchId as string) || ''
  const [progress, setProgress] = useState<Progress | undefined>()
  const [searchedAt, setSearchedAt] = useState<string | undefined>()

  // Lock the body background white synchronously before the browser paints.
  // This bridges the one-frame gap between the pending page's .res-page
  // unmounting and this component's .res-page mounting — during which the
  // near-black default body (#090909) would otherwise flash through, since
  // body:has(.res-page) only applies once .res-page is in the DOM.
  useLayoutEffect(() => {
    const prev = document.body.style.background
    document.body.style.background = '#ffffff'
    return () => { document.body.style.background = prev }
  }, [])

  useEffect(() => {
    if (!searchId) return
    let cancelled = false

    async function poll() {
      try {
        const res = await fetch(`/api/results/${searchId}`, { cache: 'no-store' })
        if (!res.ok || cancelled) return
        const data = await res.json()
        if (cancelled) return
        if (data.progress) setProgress(data.progress)
        if (data.searched_at) setSearchedAt(data.searched_at)
      } catch (_) {
        // silently ignore — animation still runs via simulated counter
      }
    }

    poll()
    const id = setInterval(poll, 4_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [searchId])

  return (
    <main className="res-page res-page--searching">
      <section className="res-hero res-hero--searching">
        <div className="res-hero-backdrop" aria-hidden="true" />
        <div className="res-hero-inner">
          <div className="res-topbar res-topbar--searching">
            <a href="/" className="res-topbar-logo-link" aria-label="LetsFG home">
              <Image
                src="/lfg_ban.png"
                alt="LetsFG"
                width={4990}
                height={1560}
                className="res-topbar-logo"
                priority
              />
            </a>
          </div>
          <div className="res-search-shell" />
          <div className="res-searching-stage">
            <SearchingTasks
              searchId={searchId}
              progress={progress}
              searchedAt={searchedAt}
            />
          </div>
        </div>
      </section>
    </main>
  )
}

export default function Loading() {
  return <LoadingInner />
}
