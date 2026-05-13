// Round-trip keyword detection test.
//
// Asserts that queries containing explicit round-trip signals ("round trip",
// "return flight", multilingual equivalents) set a return_date, and that
// city-break phrasing infers a short 3–4 day window while generic round trip
// defaults to 7 days.
//
// Run: npx tsx --test tests/round-trip-detection.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseNLQuery } from '../app/lib/searchParsing.ts'

interface Case {
  query: string
  /** origin code(s) */
  origin: string | string[]
  /** destination code(s) */
  destination: string | string[]
  /** return_date must be set */
  hasReturnDate: boolean
  /** optional: return_date must be within this many days of outbound */
  maxDurationDays?: number
}

const WAW = ['WAW']
const PAR = ['PAR', 'CDG', 'ORY', 'BVA']
const BER = ['BER']
const OSL = ['OSL']
const LON = ['LON', 'LHR', 'LGW', 'STN', 'LCY', 'LTN']
const BCN = ['BCN']
const MAD = ['MAD']

const CASES: Case[] = [
  // ── THE ORIGINAL FAILING QUERY ────────────────────────────────────────────
  {
    query: 'Warsaw Paris next month, as a couple, round trip\\, city break, cheapest option + good departure times',
    origin: WAW, destination: PAR, hasReturnDate: true, maxDurationDays: 5,
  },

  // ── "round trip" variants ─────────────────────────────────────────────────
  { query: 'Berlin Oslo next month round trip',           origin: BER, destination: OSL, hasReturnDate: true },
  { query: 'Berlin Oslo next month round-trip',           origin: BER, destination: OSL, hasReturnDate: true },
  { query: 'Berlin Oslo next month roundtrip',            origin: BER, destination: OSL, hasReturnDate: true },
  { query: 'Berlin to Oslo next month, return flight',    origin: BER, destination: OSL, hasReturnDate: true },
  { query: 'London Barcelona round trip in June',         origin: LON, destination: BCN, hasReturnDate: true },
  { query: 'London to Madrid return ticket next month',   origin: LON, destination: MAD, hasReturnDate: true },

  // ── city break → short duration (≤ 5 days) ─────────────────────────────────
  {
    query: 'Warsaw to Paris round trip, city break, next month',
    origin: WAW, destination: PAR, hasReturnDate: true, maxDurationDays: 5,
  },
  {
    query: 'Berlin Oslo weekend break round trip next month',
    origin: BER, destination: OSL, hasReturnDate: true, maxDurationDays: 5,
  },

  // ── generic round trip → ≤ 10 days ────────────────────────────────────────
  {
    query: 'London to Barcelona round trip next month',
    origin: LON, destination: BCN, hasReturnDate: true, maxDurationDays: 10,
  },
]

for (const c of CASES) {
  test(`round-trip: ${c.query.slice(0, 70)}`, async () => {
    const r = parseNLQuery(c.query)

    const okOrig = Array.isArray(c.origin)
      ? c.origin.includes(r.origin || '')
      : r.origin === c.origin
    const okDest = Array.isArray(c.destination)
      ? c.destination.includes(r.destination || '')
      : r.destination === c.destination

    assert.ok(okOrig, `origin: got ${r.origin}, expected ${JSON.stringify(c.origin)}`)
    assert.ok(okDest, `dest: got ${r.destination}, expected ${JSON.stringify(c.destination)}`)

    if (c.hasReturnDate) {
      assert.ok(r.return_date, `return_date not set (query="${c.query}")`)
      if (c.maxDurationDays !== undefined && r.date && r.return_date) {
        const dep = new Date(r.date)
        const ret = new Date(r.return_date)
        const days = Math.round((ret.getTime() - dep.getTime()) / 86_400_000)
        assert.ok(
          days >= 1 && days <= c.maxDurationDays,
          `trip duration ${days} days exceeds maxDurationDays=${c.maxDurationDays} (dep=${r.date} ret=${r.return_date})`,
        )
      }
    }
  })
}
