/**
 * high_confidence_session.ts — 180 offers, 6 carriers, 5 connectors.
 *
 * Prices: arithmetic sequence [100, 103, 106, ..., 637] (step 3, 180 values).
 * This gives a perfectly uniform distribution with exactly 18 offers per
 * histogram bucket, making statistical assertions deterministic.
 *
 * Carriers (30 offers each): FR, W6, U2, LO, LH, BA
 * Connectors (36 offers each): ryanair_direct, wizzair_direct, easyjet_direct,
 *                               skyscanner_meta, kiwi_connector
 * Currency: EUR (priceNormalized == price, all in EUR)
 * No bag fees — fee_breakdown_available will be false.
 */

import type { AgentSearchSession, NormalizedOffer } from '../../../../lib/pfp/types/agent-session.types.ts'

const CARRIERS = ['FR', 'W6', 'U2', 'LO', 'LH', 'BA'] as const
const CONNECTORS = ['ryanair_direct', 'wizzair_direct', 'easyjet_direct', 'skyscanner_meta', 'kiwi_connector'] as const

function makeOffer(i: number): NormalizedOffer {
  const price = 100 + i * 3
  const carrier = CARRIERS[i % 6]
  const connector = CONNECTORS[i % 5]
  return {
    id: `hc-offer-${i}`,
    price,
    currency: 'EUR',
    priceFormatted: `${price} EUR`,
    priceNormalized: price,
    outbound: {
      segments: [{
        airline: carrier,
        airlineName: carrier,
        flightNo: '',
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
    airlines: [carrier],
    ownerAirline: carrier,
    bagsPrice: {},
    availabilitySeats: null,
    conditions: {},
    source: connector,
    sourceTier: 'free',
    isLocked: false,
    fetchedAt: '2026-05-05T10:00:00Z',
    bookingUrl: '',
  }
}

const offers: NormalizedOffer[] = Array.from({ length: 180 }, (_, i) => makeOffer(i))

export const HIGH_CONFIDENCE_SESSION: AgentSearchSession = {
  sessionId: 'hc-session-001',
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
    offerCount: 180,
    carrierCount: 6,
    connectorCount: 5,
    priceMin: 100,
    priceMax: 637,
    priceP25: 234,
    priceP50: 368,
    priceP75: 503,
    priceP95: 610,
    hiddenFeesAvg: null,
    hiddenFeesPctAvg: null,
  },
  dataSources: [...CONNECTORS],
  connectorResults: CONNECTORS.map(c => ({
    connector: c,
    ok: true,
    offers: 36,
    latencyMs: 1500,
    errorType: null,
    errorMessage: null,
    errorCategory: null,
    httpStatus: null,
  })),
  targetCurrency: 'EUR',
}
