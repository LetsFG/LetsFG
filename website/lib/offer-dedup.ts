/**
 * Dedup offers by literal `id`, keeping the cheapest copy on collision.
 *
 * FSW occasionally returns the same `wo_xxx` id 2–3 times in a single
 * response. The normalize → validate → order pipeline in
 * /api/results/[searchId]/route.ts had no dedup step, so users saw the same
 * card multiple times. This is a separate concern from physical-flight dedup
 * in app/lib/rankOffers.ts — that one matches by route + time across IDs.
 */

export function dedupOffersById<T extends { id?: unknown; price?: unknown }>(offers: T[]): T[] {
  const seen = new Map<string, number>()  // id → index in result
  const result: T[] = []

  for (const offer of offers) {
    const id = typeof offer?.id === 'string' ? offer.id : ''
    if (!id) {
      result.push(offer)
      continue
    }

    const existingIdx = seen.get(id)
    if (existingIdx === undefined) {
      seen.set(id, result.length)
      result.push(offer)
      continue
    }

    const existing = result[existingIdx]
    const existingPrice = typeof existing?.price === 'number' ? existing.price : Number.POSITIVE_INFINITY
    const candidatePrice = typeof offer?.price === 'number' ? offer.price : Number.POSITIVE_INFINITY
    if (candidatePrice < existingPrice) {
      result[existingIdx] = offer
    }
  }

  return result
}
