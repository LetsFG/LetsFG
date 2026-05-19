import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildHomeConvoTopicOrder,
  getEssentialSearchClarificationState,
  getRequiredSearchClarificationTopics,
  getSearchClarificationState,
  hasPriorityContext,
  isSearchLaunchReady,
  needsDateClarification,
  normalizeHomeConvoFollowUpTopics,
  shouldWaitForGeminiAssistOnHomeSubmit,
} from '../app/lib/home-search-assist.ts'
import { parseNLQuery } from '../app/lib/searchParsing.ts'

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

test('home submit skips AI wait for complete route queries that go straight to results', () => {
  withFixedNow('2026-05-14T12:00:00Z', () => {
    const query = 'Tokyo to Miyako City Miyako Airport in the Summer, travelling solo, round trip for 7 days, beach holiday, city break, cheapest option, direct flights only, good departure times'
    const parsed = parseNLQuery(query)

    assert.equal(parsed.date, '2026-06-01')
    assert.equal(parsed.return_date, '2026-06-08')
    assert.equal(parsed.date_is_default, undefined)
    assert.equal(shouldWaitForGeminiAssistOnHomeSubmit(query, parsed), false)
  })
})

test('home submit still waits for AI when route slots are missing', () => {
  const query = 'Tokyo'
  const parsed = parseNLQuery(query)

  assert.equal(shouldWaitForGeminiAssistOnHomeSubmit(query, parsed), true)
})

test('home submit still waits for AI date help when the convo would otherwise ask for dates', () => {
  withFixedNow('2026-05-14T12:00:00Z', () => {
    const query = 'Tokyo to Miyako Airport in the Summer'
    const parsed = parseNLQuery(query)

    assert.equal(parsed.date, '2026-06-01')
    assert.equal(parsed.date_month_only, true)
    assert.equal(shouldWaitForGeminiAssistOnHomeSubmit(query, parsed), true)
  })
})

test('home submit keeps Japanese relative-month queries in date clarification mode', () => {
  withFixedNow('2026-05-14T12:00:00Z', () => {
    const thisMonthQuery = '東京からバルセロナ 今月'
    const thisMonthParsed = parseNLQuery(thisMonthQuery)

    assert.equal(thisMonthParsed.origin, 'TYO')
    assert.equal(thisMonthParsed.destination, 'BCN')
    assert.equal(thisMonthParsed.date, '2026-05-14')
    assert.equal(thisMonthParsed.date_month_only, true)
    assert.equal(thisMonthParsed.date_is_default, undefined)
    assert.equal(needsDateClarification(thisMonthParsed), true)
    assert.equal(shouldWaitForGeminiAssistOnHomeSubmit(thisMonthQuery, thisMonthParsed), true)

    const nextMonthParsed = parseNLQuery('東京からバルセロナ 来月')

    assert.equal(nextMonthParsed.date, '2026-06-01')
    assert.equal(nextMonthParsed.date_month_only, true)
    assert.equal(nextMonthParsed.date_is_default, undefined)
  })
})

test('home submit now waits for AI when the home convo needs personalization help', () => {
  withFixedNow('2026-05-14T12:00:00Z', () => {
    const query = 'London to Paris next Friday'
    const parsed = parseNLQuery(query)

    assert.equal(parsed.origin, 'LON')
    assert.equal(parsed.destination, 'PAR')
    assert.equal(parsed.date, '2026-05-15')
    assert.equal(isSearchLaunchReady(query, parsed), false)
    assert.equal(shouldWaitForGeminiAssistOnHomeSubmit(query, parsed), true)
  })
})

test('search readiness now requires party size, trip purpose, and ranking priority', () => {
  withFixedNow('2026-05-14T12:00:00Z', () => {
    const query = 'London to Paris next Friday as a couple'
    const parsed = parseNLQuery(query)
    const clarification = getSearchClarificationState(query, parsed)

    assert.equal(clarification.missingPartySize, false)
    assert.equal(clarification.missingTripPurpose, true)
    assert.equal(clarification.missingPriority, true)
    assert.deepEqual(getRequiredSearchClarificationTopics(query, parsed), ['trip_purpose', 'priority'])
    assert.equal(isSearchLaunchReady(query, parsed), false)
  })
})

test('raw timing constraints do not satisfy the priority question by themselves', () => {
  const parsed = parseNLQuery('London to Paris next Friday, morning departure')

  assert.equal(hasPriorityContext(parsed), false)
})

test('ranking and product preferences still satisfy the priority question', () => {
  const parsed = parseNLQuery('London to Paris next Friday, cheapest option, direct flights only')

  assert.equal(hasPriorityContext(parsed), true)
})

test('same-airport routes stay in clarification mode and are not launch-ready', () => {
  const query = 'from Fort myers to RSW, September 30'
  const parsed = parseNLQuery(query)
  const clarification = getEssentialSearchClarificationState(query, parsed)

  assert.equal(parsed.origin, 'RSW')
  assert.equal(parsed.destination, undefined)
  assert.equal(parsed.failed_destination_raw, 'RSW')
  assert.equal(parsed.same_route, true)
  assert.equal(clarification.sameRoute, true)
  assert.equal(clarification.missingDestination, true)
  assert.equal(isSearchLaunchReady(query, parsed), false)
  assert.equal(shouldWaitForGeminiAssistOnHomeSubmit(query, parsed), true)
})

test('single-location queries with date context still stay out of launch-ready state', () => {
  const query = 'Oklahoma City Okc Will Rogers International Airport, next weekend, as a couple, special occasion'
  const parsed = parseNLQuery(query)

  assert.equal(parsed.origin, 'OKC')
  assert.equal(parsed.destination, undefined)
  assert.equal(isSearchLaunchReady(query, parsed), false)
  assert.equal(shouldWaitForGeminiAssistOnHomeSubmit(query, parsed), true)
})

test('special occasion counts as trip-purpose context for a fully specified query', () => {
  const query = 'BOD to DTM 2026-06-03 return 2026-06-11, as a couple, special occasion, cheapest option'
  const parsed = parseNLQuery(query)
  const clarification = getSearchClarificationState(query, parsed)

  assert.equal(parsed.origin, 'BOD')
  assert.equal(parsed.destination, 'DTM')
  assert.equal(parsed.trip_purpose, 'special_occasion')
  assert.equal(clarification.missingPartySize, false)
  assert.equal(clarification.missingTripPurpose, false)
  assert.equal(clarification.missingPriority, false)
  assert.equal(isSearchLaunchReady(query, parsed), true)
})

test('special occasion without explicit ranking priority stays in clarification mode', () => {
  const query = 'BOD to DTM 2026-06-03 return 2026-06-11, as a couple, special occasion'
  const parsed = parseNLQuery(query)
  const clarification = getSearchClarificationState(query, parsed)

  assert.equal(parsed.trip_purpose, 'special_occasion')
  assert.equal(parsed.cabin, undefined)
  assert.equal(hasPriorityContext(parsed), false)
  assert.equal(clarification.missingPriority, true)
  assert.equal(isSearchLaunchReady(query, parsed), false)
})

test('weekend timing constraints still leave priority missing for follow-up', () => {
  withFixedNow('2026-05-19T12:00:00Z', () => {
    const query = 'London to Barcelona this weekend, Friday evening out, Sunday night back'
    const parsed = parseNLQuery(query)
    const clarification = getSearchClarificationState(query, parsed)

    assert.equal(clarification.missingPartySize, true)
    assert.equal(clarification.missingTripPurpose, true)
    assert.equal(clarification.missingPriority, true)
    assert.deepEqual(getRequiredSearchClarificationTopics(query, parsed), ['party_size', 'trip_purpose', 'priority'])
    assert.equal(isSearchLaunchReady(query, parsed), false)
  })
})

test('home convo topic helpers preserve essential question order while honoring Gemini topic priorities', () => {
  assert.deepEqual(
    normalizeHomeConvoFollowUpTopics(['priority', 'priority', 'date', 'unknown', 'trip_purpose']),
    ['priority', 'date', 'trip_purpose'],
  )

  assert.deepEqual(
    buildHomeConvoTopicOrder(undefined),
    ['origin', 'destination', 'date', 'party_size', 'trip_purpose', 'priority', 'trip_type'],
  )

  assert.deepEqual(
    buildHomeConvoTopicOrder(['priority', 'trip_purpose'], ['date']),
    ['date', 'priority', 'trip_purpose'],
  )
})