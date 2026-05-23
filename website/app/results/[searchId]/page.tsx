import { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { getLocale } from 'next-intl/server'
import SearchPageClient from './SearchPageClient'
import { getOfferDisplayTotalPrice } from '../../../lib/display-price'
import { getLiveFxRates } from '../../../lib/live-fx'
import { extractShareLabelsFromResultsPathname } from '../../../lib/share-preview'
import { deduplicateOffers, getOfferInstanceKey } from '../../lib/rankOffers'
import { formatCurrencyAmount } from '../../../lib/user-currency'
import { getTrackingSearchId, isProbeModeValue } from '../../../lib/probe-mode'
import {
  buildFallbackSearchQuery,
  buildFallbackSearchShareSummaryFromLabels,
  extractShareLabelsFromQuery,
  buildSearchShareSummary,
  type SearchResult,
} from './search-share-model'
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
  searchParams: Promise<{ probe?: string; cur?: string; oc?: string; q?: string; started?: string }>
}): Promise<Metadata> {
  const { searchId } = await params
  const locale = await getLocale()
  const sp = await searchParams
  const isProbe = isProbeModeValue(sp?.probe)
  const displayCurrency = await resolveRequestCurrency(sp?.cur)
  const offersCountOverride = parseOffersCountOverride(sp?.oc)
  const requestHeaders = await headers()
  const fallbackLabels = extractShareLabelsFromResultsPathname(requestHeaders.get('x-letsfg-pathname'), searchId)
    || extractShareLabelsFromQuery(sp?.q)
  const fallbackSummary = fallbackLabels
    ? buildFallbackSearchShareSummaryFromLabels(
        fallbackLabels.fromLabel,
        fallbackLabels.toLabel,
        offersCountOverride,
      )
    : null
  const result = fallbackSummary ? null : await getInitialSearchResults(searchId, isProbe)
  const fxRates = await getLiveFxRates()

  const summary = result
    ? buildSearchShareSummary(result, displayCurrency, { offersAnalyzedOverride: offersCountOverride, fxRates })
    : fallbackSummary

  const fallbackQuery = sp?.q?.trim() || ''
  const fallbackTitle = locale === 'ja'
    ? fallbackQuery ? `${fallbackQuery} のフライト検索結果 — LetsFG` : 'フライト検索結果 — LetsFG'
    : fallbackQuery ? `Flight search results for ${fallbackQuery} — LetsFG` : 'Flight search results — LetsFG'
  const fallbackDescription = locale === 'ja'
    ? 'LetsFG のライブフライト検索結果です。経路情報と最新料金を読み込んでいます。'
    : 'Live LetsFG flight search results. Route details and current fares will load shortly.'

  const metadataTitle = summary
    ? locale === 'ja'
      ? summary.status === 'searching'
        ? `${summary.routeLabel} のフライトを検索中 — LetsFG`
        : summary.status === 'expired'
          ? '検索有効期限切れ — LetsFG'
          : `${summary.routeLabel} のフライト結果 — LetsFG`
      : summary.title
    : fallbackTitle
  const metadataDescription = summary
    ? locale === 'ja'
      ? summary.status === 'searching'
        ? `${summary.routeLabel} のライブ検索を継続中です。しばらくすると結果が表示されます。`
        : summary.status === 'expired'
          ? `${summary.routeLabel} の共有結果は有効期限切れです。最新料金を見るには再検索してください。`
          : `${summary.routeLabel} のライブ検索結果です。手数料なし、航空会社の生運賃。`
      : summary.description
    : fallbackDescription
  const imageParams = new URLSearchParams()
  if (isProbe) imageParams.set('probe', '1')
  if (sp?.cur?.trim()) imageParams.set('cur', sp.cur.trim())
  if (offersCountOverride) imageParams.set('oc', String(offersCountOverride))
  if (fallbackLabels) {
    imageParams.set('from', fallbackLabels.fromLabel)
    imageParams.set('to', fallbackLabels.toLabel)
  }
  const imageQuery = imageParams.toString()
  const imageUrl = `/api/og/results/${searchId}${imageQuery ? `?${imageQuery}` : ''}`

  return {
    title: metadataTitle,
    description: metadataDescription,
    openGraph: {
      title: metadataTitle,
      description: metadataDescription,
      url: `/results/${searchId}`,
      siteName: 'LetsFG',
      type: 'website',
      images: [
        {
          url: imageUrl,
          width: RESULTS_SHARE_IMAGE_SIZE.width,
          height: RESULTS_SHARE_IMAGE_SIZE.height,
          alt: summary
            ? locale === 'ja' ? `${summary.routeLabel} のフライト検索サマリー` : `${summary.routeLabel} flight search summary`
            : locale === 'ja' ? 'LetsFG フライト検索サマリー' : 'LetsFG flight search summary',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: metadataTitle,
      description: metadataDescription,
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
  const result = await getInitialSearchResults(searchId, isProbe, sp?._fss, initialCurrency)
    ?? buildSearchingShell(searchId, sp?.started, sp?.q?.trim() || '')

  const { status, query: resultQuery, parsed, progress, offers, searched_at, expires_at, gemini_justification } = result
  const analyticsQuery = sp?.q?.trim() || resultQuery?.trim() || ''
  const query = analyticsQuery || buildFallbackSearchQuery(parsed)

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
        analyticsQuery={analyticsQuery}
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
