import { NextRequest, NextResponse } from 'next/server'
import { cacheOffers, getCachedOffer } from '../../../../lib/offer-cache'
import { normalizeTrustedOffer, toPublicOffer } from '../../../../lib/trusted-offer'
import { checkRateLimit, getRateLimitPolicy, getGlobalRateLimitStore, buildRateLimitClientKey } from '../../../../lib/rate-limit'
import { validateLocalOfferBookingUrl } from './validate'

const MAX_OFFERS_PER_REQUEST = 100

/**
 * POST /api/offer/register-local
 *
 * Accepts a batch of raw local-search offers from the open-source Python SDK.
 * Validates booking URLs, stores them under offer_cache, and returns encrypted
 * offer_ref snapshots that the SDK embeds in unlock URLs (?ref=…).
 *
 * This enables checkout to resolve locally-generated offer IDs without needing
 * the FSW (Flight Search Worker) backend, solving the Cloud Run multi-instance problem.
 */
export async function POST(req: NextRequest) {
  const policy = getRateLimitPolicy('/api/offer/register-local')
  if (policy) {
    const key = buildRateLimitClientKey(req.headers)
    const decision = checkRateLimit(getGlobalRateLimitStore(), key, policy)
    if (!decision.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil(decision.retryAfterMs / 1000)) },
      })
    }
  }

  let body: { search_id?: string; offers?: unknown[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const rawOffers = body?.offers
  if (!Array.isArray(rawOffers) || rawOffers.length === 0) {
    return NextResponse.json({ error: 'offers array required' }, { status: 400 })
  }

  const searchId = typeof body.search_id === 'string' ? body.search_id : undefined
  const toProcess = rawOffers.slice(0, MAX_OFFERS_PER_REQUEST)

  const registered: Array<{ offer_id: string; offer_ref: string }> = []

  for (const [idx, rawOffer] of toProcess.entries()) {
    if (typeof rawOffer !== 'object' || rawOffer === null) continue

    const raw = rawOffer as Record<string, unknown>

    if (!validateLocalOfferBookingUrl(raw.booking_url)) continue

    let trusted
    try {
      trusted = normalizeTrustedOffer(raw, idx)
    } catch {
      continue
    }

    // First-write-wins: don't overwrite an existing cached offer
    const existing = getCachedOffer(trusted.id, searchId)
    if (!existing) {
      cacheOffers([trusted], searchId)
    }

    const publicOffer = toPublicOffer(trusted)
    if (!publicOffer.offer_ref) continue

    registered.push({ offer_id: trusted.id, offer_ref: publicOffer.offer_ref })
  }

  return NextResponse.json({ registered })
}
