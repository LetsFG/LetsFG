/**
 * bimodal_session.ts — clear bimodal distribution with LCC and FSC clusters.
 *
 * LCC cluster (30 offers): prices 750–950, carrier FR, ryanair_direct
 * FSC cluster (30 offers): prices 2800–3000, carrier LH + BA, lufthansa_direct
 *
 * The gap between 950 and 2800 (1850 EUR) creates a clear valley in the
 * histogram, making bimodal detection trivial for the two-peaks algorithm.
 *
 * With min=750, max=3000, numBuckets=10, width=225:
 *   Bucket 0 [750, 975): all 30 LCC offers → count=30 (PEAK)
 *   Buckets 1–7 [975, 2775): 0 offers (VALLEY)
 *   Bucket 8 [2775, 3000): 29 FSC offers (PEAK)
 *   Bucket 9 [3000, 3000+]: 1 FSC offer (clamped to last bucket)
 */

import type { AgentSearchSession, NormalizedOffer } from '../../../../lib/pfp/types/agent-session.types.ts'

// LCC: 30 prices from 750 to 950 (step 200/29 ≈ 6.90)
const LCC_OFFERS: NormalizedOffer[] = Array.from({ length: 30 }, (_, i) => {
  const price = Math.round((750 + i * (200 / 29)) * 100) / 100
  return {
    id: `bimodal-lcc-${i}`,
    price,
    currency: 'EUR',
    priceFormatted: `${price} EUR`,
    priceNormalized: price,
    outbound: {
      segments: [{
        airline: 'FR',
        airlineName: 'Ryanair',
        flightNo: `FR${1000 + i}`,
        origin: 'GDN',
        destination: 'BCN',
        originCity: 'Gdansk',
        destinationCity: 'Barcelona',
        departure: '2026-06-15T06:30:00',
        arrival: '2026-06-15T09:00:00',
        durationSeconds: 9000,
        cabinClass: 'economy',
        aircraft: '',
      }],
      totalDurationSeconds: 9000,
      stopovers: 0,
    },
    inbound: null,
    airlines: ['FR'],
    ownerAirline: 'FR',
    bagsPrice: {},
    availabilitySeats: null,
    conditions: {},
    source: 'ryanair_direct',
    sourceTier: 'protocol',
    isLocked: false,
    fetchedAt: '2026-05-05T10:00:00Z',
    bookingUrl: '',
  }
})

// FSC: 30 prices from 2800 to 3000 (step 200/29 ≈ 6.90)
const FSC_OFFERS: NormalizedOffer[] = Array.from({ length: 30 }, (_, i) => {
  const price = Math.round((2800 + i * (200 / 29)) * 100) / 100
  const carrier = i % 2 === 0 ? 'LH' : 'BA'
  return {
    id: `bimodal-fsc-${i}`,
    price,
    currency: 'EUR',
    priceFormatted: `${price} EUR`,
    priceNormalized: price,
    outbound: {
      segments: [{
        airline: carrier,
        airlineName: carrier === 'LH' ? 'Lufthansa' : 'British Airways',
        flightNo: `${carrier}${2000 + i}`,
        origin: 'GDN',
        destination: 'BCN',
        originCity: 'Gdansk',
        destinationCity: 'Barcelona',
        departure: '2026-06-15T08:00:00',
        arrival: '2026-06-15T12:00:00',
        durationSeconds: 14400,
        cabinClass: 'business',
        aircraft: '',
      }],
      totalDurationSeconds: 14400,
      stopovers: 1,
    },
    inbound: null,
    airlines: [carrier],
    ownerAirline: carrier,
    bagsPrice: {},
    availabilitySeats: null,
    conditions: {},
    source: 'lufthansa_direct',
    sourceTier: 'free',
    isLocked: false,
    fetchedAt: '2026-05-05T10:00:00Z',
    bookingUrl: '',
  }
})

const offers: NormalizedOffer[] = [...LCC_OFFERS, ...FSC_OFFERS]

export const BIMODAL_SESSION: AgentSearchSession = {
  sessionId: 'bimodal-session-001',
  originIata: 'GDN',
  destIata: 'BCN',
  originCity: 'Gdansk',
  destCity: 'Barcelona',
  searchedAt: '2026-05-05T10:00:00Z',
  searchParams: {
    paxCount: 1,
    tripType: 'oneway',
    cabinPreference: null,
    advanceBookingDays: 40,
    maxStopovers: 2,
    currencyCode: 'EUR',
  },
  offers,
  stats: {
    offerCount: 60,
    carrierCount: 3,
    connectorCount: 2,
    priceMin: 750,
    priceMax: 3000,
    priceP25: 820,
    priceP50: 1875,
    priceP75: 2870,
    priceP95: 2966,
    hiddenFeesAvg: null,
    hiddenFeesPctAvg: null,
  },
  dataSources: ['ryanair_direct', 'lufthansa_direct'],
  connectorResults: [
    { connector: 'ryanair_direct', ok: true, offers: 30, latencyMs: 800, errorType: null, errorMessage: null, errorCategory: null, httpStatus: null },
    { connector: 'lufthansa_direct', ok: true, offers: 30, latencyMs: 1200, errorType: null, errorMessage: null, errorCategory: null, httpStatus: null },
  ],
  targetCurrency: 'EUR',
}
