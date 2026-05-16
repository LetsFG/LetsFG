import { NextRequest } from 'next/server'
import { buildMissingSearchShareSummary, buildSearchShareSummary } from '../../../../results/[searchId]/search-share-model'
import { renderSearchShareImage } from '../../../../results/[searchId]/search-share-image'
import { getSearchResults, resolveRequestCurrency } from '../../../../results/[searchId]/search-share-server'
import { isProbeModeValue } from '../../../../../lib/probe-mode'

function parseOffersCountOverride(value?: string | null) {
  const parsed = Number.parseInt(value || '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ searchId: string }> },
) {
  const { searchId } = await params
  const isProbe = isProbeModeValue(request.nextUrl.searchParams.get('probe'))
  const displayCurrency = await resolveRequestCurrency(request.nextUrl.searchParams.get('cur') || undefined)
  const offersCountOverride = parseOffersCountOverride(request.nextUrl.searchParams.get('oc'))
  const result = await getSearchResults(searchId, isProbe)

  const summary = result
    ? buildSearchShareSummary(result, displayCurrency, { offersAnalyzedOverride: offersCountOverride })
    : buildMissingSearchShareSummary()

  return renderSearchShareImage(summary)
}