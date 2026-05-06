/**
 * mixed_connector_session.ts — 90 offers across 3 connectors with clear price
 * differences, to validate connector_comparison logic.
 *
 * connector_cheap (easyjet_direct): 30 offers, prices 150–208, carrier U2
 *   → p50 ≈ 179 (step 2: 150, 152, ..., 208)
 *
 * connector_a (ryanair_direct): 30 offers, prices 200–258, carrier FR
 *   → p50 ≈ 229 (step 2: 200, 202, ..., 258)
 *
 * connector_b (wizzair_direct): 30 offers, prices 200–258, carrier W6
 *   → p50 ≈ 229 (same range as connector_a)
 *
 * avg_connector_p50 = (179 + 229 + 229) / 3 ≈ 212.3
 * delta_connector_cheap = (179 - 212.3) / 212.3 * 100 ≈ -15.7%
 * delta_connector_a/b   = (229 - 212.3) / 212.3 * 100 ≈ +7.9%
 *
 * The test should detect connector_cheap as cheapest with delta ≈ -15%.
 */

import type { AgentSearchSession, NormalizedOffer } from '../../../../lib/pfp/types/agent-session.types.ts'

// connector_cheap: 30 offers at prices [150, 152, ..., 208], carrier U2
const CHEAP_OFFERS: NormalizedOffer[] = Array.from({ length: 30 }, (_, i) => {
  const price = 150 + i * 2
  return {
    id: `mc-cheap-${i}`,
    price,
    currency: 'EUR',
    priceFormatted: `${price} EUR`,
    priceNormalized: price,
    outbound: {
      segments: [{
        airline: 'U2',
        airlineName: 'easyJet',
        flightNo: `U2${100 + i}`,
        origin: 'GDN',
        destination: 'BCN',
        originCity: 'Gdansk',
        destinationCity: 'Barcelona',
        departure: '2026-06-20T05:45:00',
        arrival: '2026-06-20T08:15:00',
        durationSeconds: 9000,
        cabinClass: 'economy',
        aircraft: '',
      }],
      totalDurationSeconds: 9000,
      stopovers: 0,
    },
    inbound: null,
    airlines: ['U2'],
    ownerAirline: 'U2',
    bagsPrice: {},
    availabilitySeats: null,
    conditions: {},
    source: 'easyjet_direct',
    sourceTier: 'free',
    isLocked: false,
    fetchedAt: '2026-05-05T10:00:00Z',
    bookingUrl: '',
  }
})

// connector_a (ryanair_direct): 30 offers at prices [200, 202, ..., 258], carrier FR
const A_OFFERS: NormalizedOffer[] = Array.from({ length: 30 }, (_, i) => {
  const price = 200 + i * 2
  return {
    id: `mc-a-${i}`,
    price,
    currency: 'EUR',
    priceFormatted: `${price} EUR`,
    priceNormalized: price,
    outbound: {
      segments: [{
        airline: 'FR',
        airlineName: 'Ryanair',
        flightNo: `FR${200 + i}`,
        origin: 'GDN',
        destination: 'BCN',
        originCity: 'Gdansk',
        destinationCity: 'Barcelona',
        departure: '2026-06-20T06:30:00',
        arrival: '2026-06-20T09:00:00',
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

// connector_b (wizzair_direct): 30 offers at prices [200, 202, ..., 258], carrier W6
const B_OFFERS: NormalizedOffer[] = Array.from({ length: 30 }, (_, i) => {
  const price = 200 + i * 2
  return {
    id: `mc-b-${i}`,
    price,
    currency: 'EUR',
    priceFormatted: `${price} EUR`,
    priceNormalized: price,
    outbound: {
      segments: [{
        airline: 'W6',
        airlineName: 'Wizz Air',
        flightNo: `W6${300 + i}`,
        origin: 'GDN',
        destination: 'BCN',
        originCity: 'Gdansk',
        destinationCity: 'Barcelona',
        departure: '2026-06-20T07:00:00',
        arrival: '2026-06-20T09:30:00',
        durationSeconds: 9000,
        cabinClass: 'economy',
        aircraft: '',
      }],
      totalDurationSeconds: 9000,
      stopovers: 0,
    },
    inbound: null,
    airlines: ['W6'],
    ownerAirline: 'W6',
    bagsPrice: {},
    availabilitySeats: null,
    conditions: {},
    source: 'wizzair_direct',
    sourceTier: 'protocol',
    isLocked: false,
    fetchedAt: '2026-05-05T10:00:00Z',
    bookingUrl: '',
  }
})

const offers: NormalizedOffer[] = [...CHEAP_OFFERS, ...A_OFFERS, ...B_OFFERS]

export const MIXED_CONNECTOR_SESSION: AgentSearchSession = {
  sessionId: 'mixed-connector-session-001',
  originIata: 'GDN',
  destIata: 'BCN',
  originCity: 'Gdansk',
  destCity: 'Barcelona',
  searchedAt: '2026-05-05T10:00:00Z',
  searchParams: {
    paxCount: 1,
    tripType: 'oneway',
    cabinPreference: null,
    advanceBookingDays: 45,
    maxStopovers: 0,
    currencyCode: 'EUR',
  },
  offers,
  stats: {
    offerCount: 90,
    carrierCount: 3,
    connectorCount: 3,
    priceMin: 150,
    priceMax: 258,
    priceP25: 184,
    priceP50: 209,
    priceP75: 234,
    priceP95: 254,
    hiddenFeesAvg: null,
    hiddenFeesPctAvg: null,
  },
  dataSources: ['easyjet_direct', 'ryanair_direct', 'wizzair_direct'],
  connectorResults: [
    { connector: 'easyjet_direct', ok: true, offers: 30, latencyMs: 900, errorType: null, errorMessage: null, errorCategory: null, httpStatus: null },
    { connector: 'ryanair_direct', ok: true, offers: 30, latencyMs: 800, errorType: null, errorMessage: null, errorCategory: null, httpStatus: null },
    { connector: 'wizzair_direct', ok: true, offers: 30, latencyMs: 850, errorType: null, errorMessage: null, errorCategory: null, httpStatus: null },
  ],
  targetCurrency: 'EUR',
}
