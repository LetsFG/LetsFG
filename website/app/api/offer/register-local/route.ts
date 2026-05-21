import { NextRequest, NextResponse } from 'next/server'
import { cacheOffers } from '../../../../lib/offer-cache'
import { normalizeTrustedOffer, toPublicOffer } from '../../../../lib/trusted-offer'
import { validateLocalOfferBookingUrl } from './validate'

/**
 * POST /api/offer/register-local
 *
 * Called by the Python SDK after a local search completes. The SDK submits the
 * raw offers (including booking_url) so the website can:
 *   1. Validate and normalise each offer.
 *   2. Store it in the process-local offer cache so any Cloud Run instance can
 *      serve it via GET /api/offer/[offerId] without a full re-search.
 *   3. Return an AES-256-GCM encrypted `offer_ref` snapshot so the offer can be
 *      reconstructed on a different Cloud Run instance that has no cache entry.
 *   4. Return a `payment_token` UUID per offer that the SDK can use to poll for
 *      the booking URL after the user pays via the hosted Stripe checkout.
 *
 * Authentication: none required — offers are validated structurally and their
 * booking_url is checked to prevent SSRF / open-redirect abuse.
 * The returned `offer_ref` is AES-256-GCM encrypted server-side, so clients
 * cannot forge offer data.
 */
export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body || typeof body !== 'object' || !Array.isArray((body as any).offers)) {
    return NextResponse.json(
      { error: 'Request body must be { offers: [...] }' },
      { status: 400 },
    )
  }

  const rawOffers: unknown[] = (body as any).offers
  const searchId: string | undefined =
    typeof (body as any).search_id === 'string' ? (body as any).search_id : undefined

  if (rawOffers.length === 0) {
    return NextResponse.json({ registered: [] })
  }

  // Hard cap to avoid memory abuse.
  const MAX_OFFERS = 200
  if (rawOffers.length > MAX_OFFERS) {
    return NextResponse.json(
      { error: `Too many offers: max ${MAX_OFFERS} per request` },
      { status: 400 },
    )
  }

  const registered: Array<{
    offer_id: string
    offer_ref: string | undefined
    payment_token: string
  }> = []
  const validOffers: ReturnType<typeof normalizeTrustedOffer>[] = []

  for (let i = 0; i < rawOffers.length; i++) {
    const raw = rawOffers[i]
    if (!raw || typeof raw !== 'object') continue

    // Validate the booking URL before accepting the offer.
    const urlResult = validateLocalOfferBookingUrl((raw as any).booking_url)
    if (!urlResult.ok) {
      // Skip invalid offers rather than rejecting the entire batch.
      continue
    }

    let normalized: ReturnType<typeof normalizeTrustedOffer>
    try {
      normalized = normalizeTrustedOffer(raw, i)
    } catch {
      continue
    }

    if (!normalized.id) continue

    validOffers.push(normalized)

    const publicOffer = toPublicOffer(normalized)
    const paymentToken = crypto.randomUUID()

    registered.push({
      offer_id: normalized.id,
      offer_ref: publicOffer.offer_ref,
      payment_token: paymentToken,
    })
  }

  if (validOffers.length > 0) {
    cacheOffers(validOffers, searchId)
  }

  return NextResponse.json({ registered })
}
