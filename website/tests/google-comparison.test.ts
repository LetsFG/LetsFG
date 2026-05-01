import assert from 'node:assert/strict'
import test from 'node:test'

import { sanitizePersistedSearchResult } from '../lib/results-cache.ts'
import { applyGoogleFlightsBaseline, normalizeTrustedOffer } from '../lib/trusted-offer.ts'

function buildOffer(raw: Record<string, unknown>, idx: number) {
  return normalizeTrustedOffer({
    currency: 'EUR',
    ...raw,
  }, idx)
}

test('normalizeTrustedOffer drops non-positive Google comparison prices', () => {
  const offer = normalizeTrustedOffer({
    id: 'zero-google-price',
    price: 95,
    currency: 'EUR',
    airline: 'Example Air',
    google_flights_price: 0,
    outbound: {
      stopovers: 0,
      total_duration_seconds: 2 * 60 * 60,
      segments: [
        {
          origin: 'SOU',
          destination: 'EDI',
          departure: '2026-06-01T10:15:00Z',
          arrival: '2026-06-01T12:15:00Z',
        },
      ],
    },
  }, 0)

  assert.equal(offer.google_flights_price, undefined)
})

test('applyGoogleFlightsBaseline ignores zero fallback and matches only positive Google source prices', () => {
  const rawOffers = [
    {
      id: 'google-offer',
      source: 'google_flights',
      booking_url: 'https://www.google.com/travel/flights?curr=EUR',
      price: 140,
      currency: 'EUR',
      airline: 'Example Air',
      outbound: {
        stopovers: 0,
        total_duration_seconds: 2 * 60 * 60,
        segments: [
          {
            origin: 'SOU',
            destination: 'EDI',
            departure: '2026-06-01T10:15:00Z',
            arrival: '2026-06-01T12:15:00Z',
          },
        ],
      },
    },
    {
      id: 'letsfg-offer',
      price: 110,
      currency: 'EUR',
      airline: 'Example Air',
      google_flights_price: 0,
      outbound: {
        stopovers: 0,
        total_duration_seconds: 2 * 60 * 60,
        segments: [
          {
            origin: 'SOU',
            destination: 'EDI',
            departure: '2026-06-01T10:15:00Z',
            arrival: '2026-06-01T12:15:00Z',
          },
        ],
      },
    },
  ]

  const trustedOffers = rawOffers.map((rawOffer, index) => buildOffer(rawOffer, index))
  const patchedOffers = applyGoogleFlightsBaseline(rawOffers, trustedOffers, 0)

  assert.equal(patchedOffers[1]?.google_flights_price, 140)
})

test('sanitizePersistedSearchResult repairs stale cached zero baselines', () => {
  const sanitized = sanitizePersistedSearchResult({
    search_id: 'cached-zero-google-price',
    status: 'completed',
    parsed: {},
    offers: [
      { id: 'cached-a', price: 95, currency: 'EUR', google_flights_price: 0 },
      { id: 'cached-b', price: 120, currency: 'EUR', google_flights_price: 140 },
    ],
    total_results: 2,
    cheapest_price: 95,
    google_flights_price: 0,
    value: 0,
    savings_vs_google_flights: 0,
  })

  assert.equal((sanitized.offers[0] as { google_flights_price?: number }).google_flights_price, undefined)
  assert.equal((sanitized.offers[1] as { google_flights_price?: number }).google_flights_price, 140)
  assert.equal(sanitized.google_flights_price, 140)
  assert.equal(sanitized.value, 45)
  assert.equal(sanitized.savings_vs_google_flights, 45)
})