import { buildMissingSearchShareSummary, buildSearchShareSummary } from './search-share-model'
import { getSearchResults } from './search-share-server'
import { renderSearchShareImage, RESULTS_SHARE_IMAGE_SIZE } from './search-share-image'

export const alt = 'LetsFG flight search share card'
export const size = RESULTS_SHARE_IMAGE_SIZE
export const contentType = 'image/png'
export const dynamic = 'force-dynamic'

export default async function Image({
  params,
}: {
  params: Promise<{ searchId: string }>
}) {
  const { searchId } = await params
  const result = await getSearchResults(searchId, false)
  const summary = result
    ? buildSearchShareSummary(result, result.offers?.[0]?.currency)
    : buildMissingSearchShareSummary()

  return renderSearchShareImage(summary)
}