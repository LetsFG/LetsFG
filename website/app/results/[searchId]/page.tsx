import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import SearchPageClient from './SearchPageClient'
import { getOfferDisplayTotalPrice } from '../../../lib/display-price'
import { getLiveFxRates } from '../../../lib/live-fx'
import { deduplicateOffers, getOfferInstanceKey } from '../../lib/rankOffers'
import { formatCurrencyAmount } from '../../../lib/user-currency'
import { getTrackingSearchId, isProbeModeValue } from '../../../lib/probe-mode'
import { buildFallbackSearchQuery, buildMissingSearchShareSummary, buildSearchShareSummary, type SearchResult } from './search-share-model'
import { RESULTS_SHARE_IMAGE_SIZE } from './search-share-image'
import { getInitialSearchResults, resolveRequestCurrency } from './search-share-server'

function parseOffersCountOverride(value?: string) {
  const parsed = Number.parseInt(value || '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function toIsoFromStartedParam(value?: string) {
  const parsed = Number.parseInt(value || '', 10)
  if (!Number.isFinite(parsed)) {
    return undefined
  }
  return new Date(parsed).toISOString()
}

function buildSearchingShell(searchId: string, started?: string, query = ''): SearchResult {
  return {
    search_id: searchId,
    status: 'searching',
    query,
    parsed: {},
    progress: { checked: 0, total: 180, found: 0 },
    offers: [],
    total_results: 0,
    searched_at: toIsoFromStartedParam(started),
  }
}

// Generate metadata for SEO and social sharing
export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ searchId: string }>
  searchParams: Promise<{ probe?: string; cur?: string; oc?: string }>
}): Promise<Metadata> {
  const { searchId } = await params
  const sp = await searchParams
  const isProbe = isProbeModeValue(sp?.probe)
  const displayCurrency = await resolveRequestCurrency(sp?.cur)
  const result = await getInitialSearchResults(searchId, isProbe)
  const fxRates = await getLiveFxRates()
  const offersCountOverride = parseOffersCountOverride(sp?.oc)

  const summary = result
    ? buildSearchShareSummary(result, displayCurrency, { offersAnalyzedOverride: offersCountOverride, fxRates })
    : buildMissingSearchShareSummary()
  const imageParams = new URLSearchParams()
  if (isProbe) imageParams.set('probe', '1')
  if (sp?.cur?.trim()) imageParams.set('cur', sp.cur.trim())
  if (offersCountOverride) imageParams.set('oc', String(offersCountOverride))
  const imageQuery = imageParams.toString()
  const imageUrl = `/api/og/results/${searchId}${imageQuery ? `?${imageQuery}` : ''}`

  return {
    title: summary.title,
    description: summary.description,
    openGraph: {
      title: summary.title,
      description: summary.description,
      url: `/results/${searchId}`,
      siteName: 'LetsFG',
      type: 'website',
      images: [
        {
          url: imageUrl,
          width: RESULTS_SHARE_IMAGE_SIZE.width,
          height: RESULTS_SHARE_IMAGE_SIZE.height,
          alt: `${summary.routeLabel} flight search summary`,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: summary.title,
      description: summary.description,
      images: [imageUrl],
    },
  }
}

export default async function ResultsPage({ params, searchParams }: { params: Promise<{ searchId: string }>; searchParams: Promise<{ sort?: string; filter?: string; started?: string; probe?: string; cur?: string; q?: string; _fss?: string }> }) {
  const { searchId } = await params
  if (!searchId.startsWith('ws_') && !searchId.startsWith('we_')) {
    notFound()
  }
  const sp = await searchParams
  const isProbe = isProbeModeValue(sp?.probe)
  const initialCurrency = await resolveRequestCurrency(sp?.cur)
  const trackingSearchId = getTrackingSearchId(searchId, isProbe)
  const fxRates = await getLiveFxRates()
  // Render immediately with the current snapshot and let SearchPageClient poll.
  // If the live snapshot fetch is slow, fall back to a searching shell so the
  // client can mount and start polling without sitting on loading.tsx.
  const result = await getInitialSearchResults(searchId, isProbe, sp?._fss)
    ?? buildSearchingShell(searchId, sp?.started, sp?.q?.trim() || '')

  const { status, query: resultQuery, parsed, progress, offers, searched_at, expires_at, gemini_justification } = result
  const query = sp?.q?.trim() || resultQuery?.trim() || buildFallbackSearchQuery(parsed)

  const isSearching = status === 'searching'
  const routeLabel = [parsed.origin_name || parsed.origin, parsed.destination_name || parsed.destination]
    .filter(Boolean)
    .join(' → ')

  const allOffers = Array.from(
    new Map((offers || []).map((offer) => [getOfferInstanceKey(offer), offer])).values()
  )

  // JSON-LD for SEO (server-rendered once; not updated client-side)
  const jsonLd = isSearching
    ? {
        '@context': 'https://schema.org',
        '@type': 'SearchResultsPage',
        name: `LetsFG — Searching flights ${routeLabel || query}`,
        description: `Searching 180+ airlines. ${progress?.checked || 0} of ${progress?.total || 180} checked. ${progress?.found || 0} results found so far.`,
        url: `https://letsfg.co/results/${searchId}`,
      }
    : status === 'completed' && offers
    ? {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        name: `Flights ${routeLabel}`,
        numberOfItems: offers.length,
        itemListElement: offers.slice(0, 10).map((offer, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          item: {
            '@type': 'Product',
            name: `${offer.airline} ${offer.origin}→${offer.destination}`,
            offers: {
              '@type': 'Offer',
              price: String(Math.round(getOfferDisplayTotalPrice(offer, initialCurrency, fxRates))),
              priceCurrency: initialCurrency,
              availability: 'https://schema.org/InStock',
            },
          },
        })),
      }
    : null

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}

      {/* SearchPageClient owns all dynamic rendering (searching ↔ results transition).
          It polls /api/results/{searchId} every 5 s on the client — no router.refresh()
          so SearchingTasks is never remounted and its animation state is always preserved. */}
      <SearchPageClient
        searchId={searchId}
        trackingSearchId={trackingSearchId}
        isTestSearch={isProbe}
        initialCurrency={initialCurrency}
        fxRates={fxRates}
        query={query}
        parsed={parsed}
        initialStatus={status}
        initialProgress={progress}
        initialOffers={allOffers}
        searchedAt={searched_at || sp?.started}
        expiresAt={expires_at}
        fswSession={sp?._fss}
        initialGemini={gemini_justification}
      />
    </>
  )
}
