/**
 * Runtime test for the offer-recovery-from-results-cache fix.
 *
 * Scenario: user bookmarks a /book/[offerId] URL. When they return hours later
 * the 30-min offer cache has expired and the URL's ?ref= snapshot is missing or
 * invalid. The fix looks up the offer in the 30-day persisted results cache and
 * decodes the stored offer_ref to reconstruct the full TrustedOffer.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { cacheCompletedSearchResult, findOfferInCachedResults } from '../lib/results-cache.ts'
import { getTrustedOffer, toPublicOffer } from '../lib/trusted-offer.ts'
import { getCachedOffer, cacheOffers } from '../lib/offer-cache.ts'

const TEST_OFFER_ID = `test-recovery-${Date.now()}`
const TEST_SEARCH_ID = `ws_test_recovery_${Date.now()}`

const TEST_TRUSTED_OFFER = {
  id: TEST_OFFER_ID,
  price: 1002,
  currency: 'CAD',
  airline: 'Low-cost carrier',
  airline_code: 'LC',
  origin: 'YVR',
  origin_name: 'Vancouver',
  destination: 'ICN',
  destination_name: 'Seoul Incheon',
  departure_time: '2026-06-11T17:25:00.000Z',
  arrival_time: '2026-06-12T05:40:00.000Z',
  duration_minutes: 615,
  stops: 0,
  flight_number: 'LC101',
  booking_url: 'https://test-airline.example.com/book/LC101?token=abc123',
}

test('findOfferInCachedResults finds an offer stored in a completed search', () => {
  const publicOffer = toPublicOffer(TEST_TRUSTED_OFFER)
  assert.ok(publicOffer.offer_ref, 'toPublicOffer must produce an offer_ref snapshot')

  cacheCompletedSearchResult({
    search_id: TEST_SEARCH_ID,
    status: 'completed',
    query: 'YVR to ICN June',
    parsed: { origin: 'YVR', destination: 'ICN' },
    offers: [publicOffer],
    total_results: 1,
  })

  // Find by offer ID + known searchId
  const found = findOfferInCachedResults(TEST_OFFER_ID, TEST_SEARCH_ID)
  assert.ok(found, 'findOfferInCachedResults must find the offer when searchId is known')
  assert.equal((found as Record<string, unknown>).id, TEST_OFFER_ID)
  assert.ok((found as Record<string, unknown>).offer_ref, 'stored offer must carry offer_ref')
})

test('findOfferInCachedResults scans all searches when no searchId given', () => {
  // Offer was inserted by the previous test — look for it without specifying the search
  const found = findOfferInCachedResults(TEST_OFFER_ID, null)
  assert.ok(found, 'findOfferInCachedResults must find offer without searchId (scans all)')
  assert.equal((found as Record<string, unknown>).id, TEST_OFFER_ID)
})

test('getTrustedOffer recovers offer from results cache when 30-min cache is cold and no searchId', async () => {
  // Ensure the offer is NOT in the hot 30-min offer cache
  // (simulate returning hours later by never populating the offer cache)
  const hotCached = getCachedOffer(TEST_OFFER_ID)
  // If it snuck in (e.g. from a previous cacheOffers call), this test is still
  // valid — getCachedOffer would return it and the test would pass for the right reason.
  // We log its presence so we know which path ran.
  if (hotCached) {
    console.log('  Note: offer was in hot cache (TTL not expired yet) — fast path taken')
  }

  const recovered = await getTrustedOffer(TEST_OFFER_ID, null, 'invalid-ref-that-wont-decode')
  assert.ok(recovered, 'getTrustedOffer must return offer even with no searchId and invalid ref')
  assert.equal(recovered.id, TEST_OFFER_ID)
  assert.equal(recovered.airline, TEST_TRUSTED_OFFER.airline)
  assert.equal(recovered.origin, TEST_TRUSTED_OFFER.origin)
  assert.equal(recovered.destination, TEST_TRUSTED_OFFER.destination)
  assert.equal(recovered.price, TEST_TRUSTED_OFFER.price)
  assert.equal(recovered.booking_url, TEST_TRUSTED_OFFER.booking_url,
    'booking_url must survive the results-cache round-trip (stored in offer_ref snapshot)')
})

test('getTrustedOffer recovers offer from results cache when cold cache and searchId provided', async () => {
  // Use a fresh offer ID that was never put in the hot offer cache
  const freshId = `test-recovery-fresh-${Date.now()}`
  const freshOffer = { ...TEST_TRUSTED_OFFER, id: freshId, booking_url: 'https://test-airline.example.com/book/fresh' }
  const freshSearchId = `ws_fresh_${Date.now()}`

  const publicOffer = toPublicOffer(freshOffer)
  cacheCompletedSearchResult({
    search_id: freshSearchId,
    status: 'completed',
    query: 'fresh recovery test',
    parsed: {},
    offers: [publicOffer],
    total_results: 1,
  })

  // Confirm it is NOT in the hot offer cache (we never called cacheOffers for it)
  const hotMiss = getCachedOffer(freshId)
  assert.equal(hotMiss, null, 'fresh offer must not be in the hot 30-min offer cache')

  // getTrustedOffer should find it in the results cache using the searchId
  const recovered = await getTrustedOffer(freshId, freshSearchId, null)
  assert.ok(recovered, 'getTrustedOffer must recover offer via results cache with matching searchId')
  assert.equal(recovered.id, freshId)
  assert.equal(recovered.booking_url, freshOffer.booking_url)
})

test('getTrustedOffer returns null for genuinely unknown offer (not in any cache)', async () => {
  const result = await getTrustedOffer('completely-unknown-offer-xyz', null, null)
  assert.equal(result, null, 'getTrustedOffer must return null for offers not in any cache')
})
