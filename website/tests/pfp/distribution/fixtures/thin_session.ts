/**
 * thin_session.ts — 12 offers, 1 carrier, 1 connector.
 *
 * Used to test data_confidence: 'low' (< 40 offers).
 * Also exercises the single-carrier, single-connector path.
 *
 * Note: this session does NOT pass the ContentQualityGate (< 15 offers,
 * only 1 carrier, only 1 connector). However the DistributionService is a
 * lower-level transform — it processes whatever data it receives without
 * enforcing quality gate rules. data_confidence: 'low' communicates the
 * thinness to the page template.
 */

import type { AgentSearchSession, NormalizedOffer } from '../../../../lib/pfp/types/agent-session.types.ts'

// 12 offers, prices 89–199 (step 10)
const offers: NormalizedOffer[] = Array.from({ length: 12 }, (_, i) => {
  const price = 89 + i * 10
  return {
    id: `thin-offer-${i}`,
    price,
    currency: 'EUR',
    priceFormatted: `${price} EUR`,
    priceNormalized: price,
    outbound: {
      segments: [{
        airline: 'FR',
        airlineName: 'Ryanair',
        flightNo: `FR${500 + i}`,
        origin: 'GDN',
        destination: 'BCN',
        originCity: 'Gdansk',
        destinationCity: 'Barcelona',
        departure: '2026-07-01T07:00:00',
        arrival: '2026-07-01T09:30:00',
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

export const THIN_SESSION: AgentSearchSession = {
  sessionId: 'thin-session-001',
  originIata: 'GDN',
  destIata: 'BCN',
  originCity: 'Gdansk',
  destCity: 'Barcelona',
  searchedAt: '2026-05-05T10:00:00Z',
  searchParams: {
    paxCount: 1,
    tripType: 'oneway',
    cabinPreference: null,
    advanceBookingDays: 57,
    maxStopovers: 0,
    currencyCode: 'EUR',
  },
  offers,
  stats: {
    offerCount: 12,
    carrierCount: 1,
    connectorCount: 1,
    priceMin: 89,
    priceMax: 199,
    priceP25: 116,
    priceP50: 144,
    priceP75: 172,
    priceP95: 196,
    hiddenFeesAvg: null,
    hiddenFeesPctAvg: null,
  },
  dataSources: ['ryanair_direct'],
  connectorResults: [
    { connector: 'ryanair_direct', ok: true, offers: 12, latencyMs: 700, errorType: null, errorMessage: null, errorCategory: null, httpStatus: null },
  ],
  targetCurrency: 'EUR',
}
