import assert from 'node:assert/strict'
import test from 'node:test'

import { shouldWaitForGeminiAssistOnHomeSubmit } from '../app/lib/home-search-assist.ts'
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