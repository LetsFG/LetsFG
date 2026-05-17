import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeTrustedOffer } from '../lib/trusted-offer.ts'

function buildOneWayOffer(bookingUrl: string) {
  return normalizeTrustedOffer({
    id: 'repair-target',
    price: 35034.16,
    currency: 'INR',
    airline: 'IndiGo',
    airline_code: '6E',
    booking_url: bookingUrl,
    outbound: {
      stopovers: 0,
      total_duration_seconds: 11 * 60 * 60 + 25 * 60,
      segments: [
        {
          airline: '6E',
          airline_name: 'IndiGo',
          flight_no: '6E11',
          origin: 'DEL',
          destination: 'LHR',
          departure: '2026-05-30T10:50:00+05:30',
          arrival: '2026-05-30T17:45:00+01:00',
        },
      ],
    },
  }, 0)
}

test('normalizeTrustedOffer repairs generic Trip.com route URLs to a dated search', () => {
  const offer = buildOneWayOffer('https://www.trip.com/flights/del-to-lon/tickets-del-lon')
  const parsed = new URL(offer.booking_url || '')

  assert.equal(parsed.hostname, 'www.trip.com')
  assert.equal(parsed.pathname, '/flights/showfarefirst')
  assert.equal(parsed.searchParams.get('dcity'), 'del')
  assert.equal(parsed.searchParams.get('acity'), 'lhr')
  assert.equal(parsed.searchParams.get('ddate'), '2026-05-30')
  assert.equal(parsed.searchParams.get('dairport'), 'del')
  assert.equal(parsed.searchParams.get('triptype'), 'ow')
})

test('normalizeTrustedOffer repairs generic Skyscanner URLs to a dated search', () => {
  const offer = buildOneWayOffer('https://www.skyscanner.net/transport/flights/del/lon/')
  const parsed = new URL(offer.booking_url || '')

  assert.equal(parsed.hostname, 'www.skyscanner.net')
  assert.equal(parsed.pathname, '/transport/flights/del/lhr/260530/')
  assert.equal(parsed.searchParams.get('rtn'), '0')
})

test('normalizeTrustedOffer repairs one-way Kayak URLs to include the departure date', () => {
  const offer = buildOneWayOffer('https://www.kayak.com/flights/DEL-LON')
  const parsed = new URL(offer.booking_url || '')

  assert.equal(parsed.hostname, 'www.kayak.com')
  assert.equal(parsed.pathname, '/flights/DEL-LHR/2026-05-30')
})

test('normalizeTrustedOffer repairs one-way Momondo and Cheapflights URLs to include the departure date', () => {
  const momondoOffer = buildOneWayOffer('https://www.momondo.com/flight-search/DEL-LON/1adult')
  const momondoParsed = new URL(momondoOffer.booking_url || '')
  assert.equal(momondoParsed.pathname, '/flight-search/DEL-LHR/2026-05-30/1adult')

  const cheapflightsOffer = buildOneWayOffer('https://www.cheapflights.com/flight-search/DEL-LON/1adult')
  const cheapflightsParsed = new URL(cheapflightsOffer.booking_url || '')
  assert.equal(cheapflightsParsed.pathname, '/flight-search/DEL-LHR/2026-05-30/1adult')
})