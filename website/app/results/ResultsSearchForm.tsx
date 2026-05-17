'use client'

import { useEffect, useState } from 'react'
import HomeSearchForm from '../home-search-form'
import {
  CURRENCY_CHANGE_EVENT,
  readBrowserSearchCurrency,
  type CurrencyCode,
} from '../../lib/currency-preference'
import { trackSearchSessionEvent } from '../../lib/search-session-analytics'

interface ResultsSearchFormProps {
  initialQuery?: string
  initialCurrency?: CurrencyCode
  onSearchSubmit?: (query: string) => void
  trackingSearchId?: string
  trackingSourcePath?: string
  probeMode?: boolean
}

export default function ResultsSearchForm({
  initialQuery = '',
  initialCurrency = 'EUR',
  onSearchSubmit,
  trackingSearchId,
  trackingSourcePath,
  probeMode = false,
}: ResultsSearchFormProps) {
  const [prefCurrency, setPrefCurrency] = useState<CurrencyCode>(initialCurrency)

  useEffect(() => {
    setPrefCurrency(readBrowserSearchCurrency(initialCurrency))
    const sync = () => setPrefCurrency(readBrowserSearchCurrency(initialCurrency))
    window.addEventListener(CURRENCY_CHANGE_EVENT, sync)
    return () => window.removeEventListener(CURRENCY_CHANGE_EVENT, sync)
  }, [initialCurrency])

  const handleSearchStart = (nextQuery: string) => {
    trackSearchSessionEvent(trackingSearchId, 'new_search_started', {
      next_query: nextQuery,
    }, {
      source: 'website-results-form',
      source_path: trackingSourcePath || (trackingSearchId ? `/results/${trackingSearchId}` : '/results'),
    }, { keepalive: true })
    onSearchSubmit?.(nextQuery)
  }

  return <HomeSearchForm initialQuery={initialQuery} initialCurrency={prefCurrency} compact autoFocus={false} probeMode={probeMode} onSearchStart={handleSearchStart} />
}