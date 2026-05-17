import assert from 'node:assert/strict'
import test from 'node:test'

import { findBestLocationMatch, findBestMatch, searchAirports } from '../app/airports.ts'
import { parseNLQuery } from '../app/lib/searchParsing.ts'
import { resolveSearchLaunchRoute } from '../lib/search-launch-route.ts'

const RealDate = Date

function withFixedNow<T>(isoTimestamp: string, run: () => T): T {
  const fixedNow = new RealDate(isoTimestamp)

  class MockDate extends RealDate {
    constructor(...args: any[]) {
      super(...(args.length === 0 ? [fixedNow.getTime()] : args))
    }

    static now() {
      return fixedNow.getTime()
    }

    static parse(value: string) {
      return RealDate.parse(value)
    }

    static UTC(...args: Parameters<DateConstructor['UTC']>) {
      return RealDate.UTC(...args)
    }
  }

  globalThis.Date = MockDate as DateConstructor
  try {
    return run()
  } finally {
    globalThis.Date = RealDate
  }
}

test('parseNLQuery keeps the reported website examples working', () => {
  withFixedNow('2026-05-01T12:00:00Z', () => {
    const jfkToKarachi = parseNLQuery('New york jfk to karachi on 1st june 2026')
    assert.deepEqual(
      {
        origin: jfkToKarachi.origin,
        destination: jfkToKarachi.destination,
        date: jfkToKarachi.date,
      },
      {
        origin: 'JFK',
        destination: 'KHI',
        date: '2026-06-01',
      },
    )

    const londonToBarcelona = parseNLQuery('London to Barcelona next Friday')
    assert.deepEqual(
      {
        origin: londonToBarcelona.origin,
        destination: londonToBarcelona.destination,
        date: londonToBarcelona.date,
      },
      {
        origin: 'LON',
        destination: 'BCN',
        date: '2026-05-08',
      },
    )

    const nycToTokyo = parseNLQuery('NYC to Tokyo in June, business class')
    assert.deepEqual(
      {
        origin: nycToTokyo.origin,
        destination: nycToTokyo.destination,
        date: nycToTokyo.date,
        cabin: nycToTokyo.cabin,
      },
      {
        origin: 'NYC',
        destination: 'TYO',
        date: '2026-06-01',
        cabin: 'C',
      },
    )
  })
})

test('parseNLQuery keeps outbound and return time preferences for Friday evening / Monday morning weekend searches', () => {
  withFixedNow('2026-05-14T12:00:00Z', () => {
    const londonToParisWeekend = parseNLQuery('London to Paris this Friday evening, back Monday morning, 2 adults, direct, beach holiday')
    assert.deepEqual(
      {
        origin: londonToParisWeekend.origin,
        destination: londonToParisWeekend.destination,
        date: londonToParisWeekend.date,
        return_date: londonToParisWeekend.return_date,
        adults: londonToParisWeekend.adults,
        stops: londonToParisWeekend.stops,
        depart_time_pref: londonToParisWeekend.depart_time_pref,
        return_depart_time_pref: londonToParisWeekend.return_depart_time_pref,
        trip_purpose: londonToParisWeekend.trip_purpose,
      },
      {
        origin: 'LON',
        destination: 'PAR',
        date: '2026-05-15',
        return_date: '2026-05-18',
        adults: 2,
        stops: 0,
        depart_time_pref: 'evening',
        return_depart_time_pref: 'morning',
        trip_purpose: 'beach',
      },
    )
  })
})

test('parseNLQuery handles Japanese route phrasing without a destination particle before the date', () => {
  withFixedNow('2026-05-17T12:00:00Z', () => {
    const japaneseFamilyTrip = parseNLQuery('大阪から東京6月末、家族旅行、大人2名子供1名、2週間、窓側座席を並んで')

    assert.deepEqual(
      {
        origin: japaneseFamilyTrip.origin,
        destination: japaneseFamilyTrip.destination,
        date: japaneseFamilyTrip.date,
        adults: japaneseFamilyTrip.adults,
        children: japaneseFamilyTrip.children,
        passenger_context: japaneseFamilyTrip.passenger_context,
        require_adjacent_seats: japaneseFamilyTrip.require_adjacent_seats,
        seat_pref: japaneseFamilyTrip.seat_pref,
      },
      {
        origin: 'KIX',
        destination: 'TYO',
        date: '2026-06-26',
        adults: 2,
        children: 1,
        passenger_context: 'family',
        require_adjacent_seats: true,
        seat_pref: 'window',
      },
    )
  })
})

test('parseNLQuery derives a return date from bare trip-duration phrasing', () => {
  withFixedNow('2026-05-14T12:00:00Z', () => {
    const businessTrip = parseNLQuery('London to New York next month, business trip, 4 nights, business class, needs to be refundable')
    assert.deepEqual(
      {
        origin: businessTrip.origin,
        destination: businessTrip.destination,
        date: businessTrip.date,
        return_date: businessTrip.return_date,
        min_trip_days: businessTrip.min_trip_days,
        max_trip_days: businessTrip.max_trip_days,
        cabin: businessTrip.cabin,
        passenger_context: businessTrip.passenger_context,
        trip_purpose: businessTrip.trip_purpose,
        require_cancellation: businessTrip.require_cancellation,
      },
      {
        origin: 'LON',
        destination: 'NYC',
        date: '2026-06-01',
        return_date: '2026-06-05',
        min_trip_days: 4,
        max_trip_days: 4,
        cabin: 'C',
        passenger_context: 'business_traveler',
        trip_purpose: 'business',
        require_cancellation: true,
      },
    )
  })
})

test('parseNLQuery falls back to generated global coverage for long-tail names', () => {
  withFixedNow('2026-05-01T12:00:00Z', () => {
    const southamptonToEdinburgh = parseNLQuery('Southampton to Edinburgh next Friday')
    assert.deepEqual(
      {
        origin: southamptonToEdinburgh.origin,
        destination: southamptonToEdinburgh.destination,
        date: southamptonToEdinburgh.date,
      },
      {
        origin: 'SOU',
        destination: 'EDI',
        date: '2026-05-08',
      },
    )

    const ashgabatToTirana = parseNLQuery('Aşgabat to Tiranë on 1st june 2026')
    assert.deepEqual(
      {
        origin: ashgabatToTirana.origin,
        destination: ashgabatToTirana.destination,
        date: ashgabatToTirana.date,
      },
      {
        origin: 'ASB',
        destination: 'TIA',
        date: '2026-06-01',
      },
    )

    const abidjanToAalborg = parseNLQuery('Abidjan to Aalborg on 1st june 2026')
    assert.deepEqual(
      {
        origin: abidjanToAalborg.origin,
        destination: abidjanToAalborg.destination,
        date: abidjanToAalborg.date,
      },
      {
        origin: 'ABJ',
        destination: 'AAL',
        date: '2026-06-01',
      },
    )
  })
})

test('parseNLQuery handles shorthand airports, holiday weeks, and metro aliases', () => {
  withFixedNow('2026-05-01T12:00:00Z', () => {
    const triesteToArlanda = parseNLQuery('Trs to arl 17 july')
    assert.deepEqual(
      {
        origin: triesteToArlanda.origin,
        destination: triesteToArlanda.destination,
        date: triesteToArlanda.date,
      },
      {
        origin: 'TRS',
        destination: 'ARN',
        date: '2026-07-17',
      },
    )

    const bdlThanksgiving = parseNLQuery('BDL to SAN the week of thanksgiving')
    assert.deepEqual(
      {
        origin: bdlThanksgiving.origin,
        destination: bdlThanksgiving.destination,
        date: bdlThanksgiving.date,
      },
      {
        origin: 'BDL',
        destination: 'SAN',
        date: '2026-11-23',
      },
    )

    const hartfordThanksgiving = parseNLQuery('Hartford to san diego the week of thanksgiving')
    assert.deepEqual(
      {
        origin: hartfordThanksgiving.origin,
        destination: hartfordThanksgiving.destination,
        date: hartfordThanksgiving.date,
      },
      {
        origin: 'BDL',
        destination: 'SAN',
        date: '2026-11-23',
      },
    )

    const helsinkiToRome = parseNLQuery('helsinki to rome')
    assert.deepEqual(
      {
        origin: helsinkiToRome.origin,
        destination: helsinkiToRome.destination,
      },
      {
        origin: 'HEL',
        destination: 'ROM',
      },
    )
  })
})

test('findBestLocationMatch prefers explicit airports and city codes correctly', () => {
  assert.deepEqual(findBestLocationMatch('Aşgabat'), {
    code: 'ASB',
    name: 'Ashgabat Airport',
    type: 'airport',
    country: 'TM',
  })

  assert.deepEqual(findBestLocationMatch('New York JFK'), {
    code: 'JFK',
    name: 'John F Kennedy International Airport',
    type: 'airport',
    country: 'US',
  })

  assert.deepEqual(findBestLocationMatch('Tokyo'), {
    code: 'TYO',
    name: 'Tokyo',
    type: 'city',
    country: 'JP',
  })
})

test('homepage airport matching uses generated aliases and expanded airport coverage', () => {
  assert.equal(findBestMatch('Aşgabat', 'en')?.code, 'ASB')
  assert.equal(findBestMatch('Tiranë', 'en')?.code, 'TIA')
  assert.equal(findBestMatch('Aalborg', 'en')?.code, 'AAL')
  assert.equal(findBestMatch('Hartford', 'en')?.code, 'BDL')

  const airportResults = searchAirports('ashgabat', 'en', 5)
  assert.ok(airportResults.some((airport) => airport.code === 'ASB'))

  const hartfordResults = searchAirports('Hartford', 'en', 5)
  assert.ok(hartfordResults.some((airport) => airport.code === 'BDL'))
})

test('Hawaii airports resolve correctly and do not produce false positives via substring', () => {
  withFixedNow('2026-05-01T12:00:00Z', () => {
    // "hawaii" in a query should not match AII (Ali-Sabieh) via substring "aii" inside "hawaii"
    const detroitToHawaii = parseNLQuery('Detroit to Hawaii KOA June 15')
    assert.equal(detroitToHawaii.origin, 'DTW')
    assert.equal(detroitToHawaii.destination, 'KOA')

    const detroitToHonolulu = parseNLQuery('Detroit to Honolulu June 15')
    assert.equal(detroitToHonolulu.origin, 'DTW')
    assert.equal(detroitToHonolulu.destination, 'HNL')

    const detroitToMaui = parseNLQuery('Detroit to Maui June 15')
    assert.equal(detroitToMaui.origin, 'DTW')
    assert.equal(detroitToMaui.destination, 'OGG')

    const detroitToKona = parseNLQuery('Detroit to Kona June 15')
    assert.equal(detroitToKona.origin, 'DTW')
    assert.equal(detroitToKona.destination, 'KOA')

    // Direct findBestLocationMatch checks
    assert.equal(findBestLocationMatch('hawaii koa')?.code, 'KOA')
    assert.equal(findBestLocationMatch('honolulu')?.code, 'HNL')
    assert.equal(findBestLocationMatch('kona')?.code, 'KOA')
    assert.equal(findBestLocationMatch('maui')?.code, 'OGG')
  })
})

test('launch route fallback does not invent a self-route for a missing side', () => {
  const resolved = resolveSearchLaunchRoute({
    origin: 'PMI',
    originName: 'Palma de Mallorca',
    failedDestinationRaw: 'Mallorca',
  })

  assert.equal(resolved.origin, 'PMI')
  assert.equal(resolved.destination, undefined)
  assert.deepEqual(resolved.fallbackNotes, {})
})

test('launch route fallback still swaps ghost IATAs to a nearby commercial hub', () => {
  const resolved = resolveSearchLaunchRoute({
    origin: 'PRY',
    originName: 'Pretoria',
    destination: 'FCO',
    destinationName: 'Rome',
  })

  assert.equal(resolved.origin, 'JNB')
  assert.equal(resolved.originName, 'Johannesburg (nearest to Pretoria)')
  assert.equal(resolved.destination, 'FCO')
  assert.equal(resolved.fallbackNotes.origin?.used_code, 'JNB')
})