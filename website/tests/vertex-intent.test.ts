import assert from 'node:assert/strict'
import test from 'node:test'

import { parseNLQuery } from '../app/lib/searchParsing.ts'
import { applyVertexIntent } from '../app/lib/vertex-intent.ts'
import type { VertexCityResult } from '../app/lib/vertex-parse.ts'

test('applyVertexIntent keeps the resolved route but still merges AI ranking and filter intent', () => {
  const parsed = parseNLQuery('Tokyo to Berlin on May 24th, travelling solo, round trip for 7 days, beach holiday, city break, cheapest option, direct flights only')

  const ai: VertexCityResult = {
    origin_city: 'Tokyo',
    destination_city: 'Berlin',
    via_city: null,
    origin_lat: 35.6764,
    origin_lon: 139.65,
    destination_lat: 52.52,
    destination_lon: 13.405,
    passengers: 1,
    cabin_class: null,
    direct_only: true,
    sort_by: 'price',
    depart_after: null,
    depart_before: null,
    bags_included: null,
    trip_purposes: ['city_break', 'beach'],
    trip_purpose: 'city_break',
    dep_time_pref: null,
    ret_time_pref: null,
    passenger_context: 'solo',
    is_round_trip: true,
    departure_date: '2026-05-24',
    return_date: '2026-05-31',
  }

  const applied = applyVertexIntent(parsed, ai, parsed.adults || 1)

  assert.equal(applied.origin, 'TYO')
  assert.equal(applied.destination, 'BER')
  assert.equal(applied.dateFrom, '2026-05-24')
  assert.equal(applied.returnDate, '2026-05-31')
  assert.equal(applied.adults, 1)
  assert.equal(applied.aiIntent.ai_direct_only, true)
  assert.equal(applied.aiIntent.ai_sort_by, 'price')
  assert.deepEqual(applied.aiIntent.ai_trip_purposes, ['city_break', 'beach'])
  assert.equal(applied.aiIntent.ai_trip_purpose, 'city_break')
  assert.equal(applied.aiIntent.ai_passenger_context, 'solo')
})

test('applyVertexIntent maps AI cabin class into the backend cabin code when regex missed it', () => {
  const parsed = parseNLQuery('London to New York next Friday')

  const ai: VertexCityResult = {
    origin_city: 'London',
    destination_city: 'New York, New York',
    via_city: null,
    passengers: 1,
    cabin_class: 'business',
    direct_only: null,
    sort_by: null,
    depart_after: null,
    depart_before: null,
    bags_included: null,
    trip_purpose: null,
    dep_time_pref: null,
    ret_time_pref: null,
    passenger_context: null,
    is_round_trip: null,
    departure_date: '2026-05-22',
    return_date: null,
  }

  const applied = applyVertexIntent(parsed, ai, parsed.adults || 1)

  assert.equal(applied.cabin, 'C')
  assert.equal(applied.aiIntent.ai_cabin_class, 'business')
})