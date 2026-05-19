'use client'

import { Suspense, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useLocale } from 'next-intl'
import Image from 'next/image'
import CurrencyButton from '../../currency-button'
import GlobeButton from '../../globe-button'
import ResultsSearchForm from '../ResultsSearchForm'
import SearchingTasks from '../[searchId]/SearchingTasks'
import { normalizeCurrencyCode } from '../../../lib/currency-preference'
import { buildLocaleHomePath, setResultsLocaleSearchParam } from '../../../lib/locale-routing'
import {
  clearClientSearchHandoff,
  createClientSearchHandoffToken,
  startClientSearchHandoff,
  waitForClientSearchHandoff,
} from '../../../lib/client-search-handoff'
import { parseNLQuery } from '../../lib/searchParsing'

const PREFIRE_ROUTE_WAIT_MS = 2500

function PendingResultsInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const locale = useLocale()
  const searchParamString = searchParams.toString()
  const query = searchParams.get('q')?.trim() || ''
  const probeMode = searchParams.get('probe') === '1'
  const initialCurrency = normalizeCurrencyCode(searchParams.get('cur')) || 'EUR'
  const launchToken = searchParams.get('launch')?.trim() || ''
  const homeHref = buildLocaleHomePath(locale, probeMode)
  const parsed = useMemo(() => {
    try {
      return parseNLQuery(query)
    } catch {
      return null
    }
  }, [query])

  useEffect(() => {
    router.prefetch(homeHref)
  }, [homeHref, router])

  useEffect(() => {
    if (!query) {
      router.replace(homeHref)
      return
    }

    let cancelled = false
    let activeToken = launchToken || createClientSearchHandoffToken()

    const nextParams = new URLSearchParams(searchParamString)
    nextParams.delete('launch')
    nextParams.set('q', query)
    nextParams.set('cur', initialCurrency)
    if (!nextParams.get('started')) {
      nextParams.set('started', String(Date.now()))
    }
    setResultsLocaleSearchParam(nextParams, locale)

    async function resolveSearch() {
      let result = await waitForClientSearchHandoff(activeToken, PREFIRE_ROUTE_WAIT_MS)
      if (!result?.searchId) {
        result = await startClientSearchHandoff(activeToken, {
          query,
          currency: initialCurrency,
          probeMode,
        })
      }

      if (cancelled) {
        return
      }

      if (result?.searchId) {
        if (result.fswSession) {
          nextParams.set('_fss', result.fswSession)
        }
        clearClientSearchHandoff(activeToken)
        router.replace(`/results/${result.searchId}?${nextParams.toString()}`)
        return
      }

      clearClientSearchHandoff(activeToken)
      router.replace(`/results?${nextParams.toString()}`)
    }

    void resolveSearch()

    return () => {
      cancelled = true
    }
  }, [homeHref, initialCurrency, launchToken, locale, probeMode, query, router, searchParamString])

  return (
    <main className="res-page res-page--searching">
      <section className="res-hero res-hero--searching">
        <div className="res-hero-backdrop" aria-hidden="true" />
        <div className="res-hero-inner">
          <div className="res-topbar res-topbar--searching">
            <Link href={homeHref} className="res-topbar-logo-link" aria-label="LetsFG home">
              <Image
                src="/lfg_ban.png"
                alt="LetsFG"
                width={4990}
                height={1560}
                className="res-topbar-logo"
                priority
              />
            </Link>
            <div className="res-topbar-actions">
              <GlobeButton inline />
              <CurrencyButton
                inline
                behavior={query ? 'rerun-search' : 'persist'}
                initialCurrency={initialCurrency}
                searchQuery={query}
                probeMode={probeMode}
              />
            </div>
          </div>
          <div className="res-search-shell">
            <ResultsSearchForm initialQuery={query} initialCurrency={initialCurrency} probeMode={probeMode} />
          </div>
          <div className="res-searching-stage">
            <SearchingTasks
              originLabel={parsed?.origin_name || parsed?.origin}
              originCode={parsed?.origin}
              destinationLabel={parsed?.destination_name || parsed?.destination}
              destinationCode={parsed?.destination}
            />
          </div>
        </div>
      </section>
    </main>
  )
}

export default function PendingResultsPage() {
  return (
    <Suspense>
      <PendingResultsInner />
    </Suspense>
  )
}
