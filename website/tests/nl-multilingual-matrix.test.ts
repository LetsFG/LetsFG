// Multilingual NL parser coverage matrix.
//
// Asserts that representative queries across every supported locale
// (en, pl, de, es, fr, it, pt, nl, sq, hr, sv, ja, zh) parse into the
// expected origin / destination / date / return-date / passenger / stops
// signals. Every assertion is intentionally minimal — we don't pin every
// derived field, only the ones a real user expects to see honoured.
//
// Run: npx tsx --test tests/nl-multilingual-matrix.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseNLQuery } from '../app/lib/searchParsing.ts'

interface Expect {
  origin?: string
  originAny?: string[]          // accept any of these (city/airport ambiguity)
  destination?: string
  destinationAny?: string[]
  date?: string                 // 'YYYY-MM' prefix is enough — YYYY-MM-DD also OK
  hasReturnDate?: boolean
  adults?: number
  totalPax?: number             // adults+children = N (covers "family of 4" → 2+2)
  passenger_context?: string
  trip_purpose?: string
  stops?: number
  cabin?: string
  carry_on_only?: boolean
  preferred_sort?: string
}

interface Case {
  lang: string
  query: string
  expect: Expect
}

const CASES: Case[] = [
  // ── ENGLISH ────────────────────────────────────────────────────────────────
  { lang: 'en', query: 'London to Barcelona July 18 return July 22',
    expect: { origin: 'LON', destination: 'BCN', date: '2026-07-18', hasReturnDate: true } },
  { lang: 'en', query: 'from Guadalajara to Buenos Aires for a couple, July 18, Return 4 days, beach holiday, direct flights only',
    expect: { origin: 'GDL', destination: 'EZE', date: '2026-07-18', hasReturnDate: true, adults: 2, passenger_context: 'couple', stops: 0, trip_purpose: 'beach' } },
  { lang: 'en', query: 'NYC to Tokyo in June, business class',
    expect: { origin: 'NYC', destination: 'TYO', cabin: 'C' } },
  { lang: 'en', query: 'Cheap flights from Manchester to Dubai for a family of 4 in August',
    expect: { origin: 'MAN', destination: 'DXB', totalPax: 4, passenger_context: 'family', preferred_sort: 'price' } },
  { lang: 'en', query: 'Berlin to Bangkok next Monday, hand luggage only',
    expect: { origin: 'BER', destination: 'BKK', carry_on_only: true } },

  // ── POLISH ─────────────────────────────────────────────────────────────────
  { lang: 'pl', query: 'Warszawa do Barcelony 18 lipca powrót 22 lipca',
    expect: { origin: 'WAW', destination: 'BCN', date: '2026-07-18', hasReturnDate: true } },
  { lang: 'pl', query: 'Lot z Krakowa do Londynu w czerwcu, klasa biznes',
    expect: { origin: 'KRK', destination: 'LON', cabin: 'C' } },
  { lang: 'pl', query: 'Najtańsze bilety z Gdańska do Rzymu dla dwóch osób',
    expect: { origin: 'GDN', destinationAny: ['ROM', 'FCO', 'CIA'], adults: 2, preferred_sort: 'price' } },

  // ── GERMAN ─────────────────────────────────────────────────────────────────
  { lang: 'de', query: 'Berlin nach Barcelona am 18. Juli Rückflug am 22. Juli',
    expect: { origin: 'BER', destination: 'BCN', date: '2026-07-18', hasReturnDate: true } },
  { lang: 'de', query: 'Günstige Flüge von München nach New York für eine Familie',
    expect: { origin: 'MUC', destination: 'NYC', passenger_context: 'family', preferred_sort: 'price' } },
  { lang: 'de', query: 'Frankfurt nach Tokio im August, Business Class',
    expect: { origin: 'FRA', destination: 'TYO', cabin: 'C' } },

  // ── SPANISH ────────────────────────────────────────────────────────────────
  { lang: 'es', query: 'Madrid a Barcelona el 18 de julio regreso el 22 de julio',
    expect: { origin: 'MAD', destination: 'BCN', date: '2026-07-18', hasReturnDate: true } },
  { lang: 'es', query: 'Vuelos baratos desde Buenos Aires a Cancún en agosto para una pareja',
    expect: { origin: 'EZE', destination: 'CUN', adults: 2, passenger_context: 'couple', preferred_sort: 'price' } },
  { lang: 'es', query: 'Bogotá a Madrid en clase ejecutiva',
    expect: { origin: 'BOG', destination: 'MAD', cabin: 'C' } },

  // ── FRENCH ─────────────────────────────────────────────────────────────────
  { lang: 'fr', query: 'Paris à Barcelone le 18 juillet retour le 22 juillet',
    expect: { origin: 'PAR', destination: 'BCN', date: '2026-07-18', hasReturnDate: true } },
  { lang: 'fr', query: 'Vols pas chers de Lyon à Marrakech en août pour une famille',
    expect: { origin: 'LYS', destination: 'RAK', passenger_context: 'family', preferred_sort: 'price' } },
  { lang: 'fr', query: 'Nice à New York en classe affaires',
    expect: { origin: 'NCE', destination: 'NYC', cabin: 'C' } },

  // ── ITALIAN ────────────────────────────────────────────────────────────────
  { lang: 'it', query: 'Roma a Barcellona il 18 luglio ritorno il 22 luglio',
    expect: { origin: 'ROM', destination: 'BCN', date: '2026-07-18', hasReturnDate: true } },
  { lang: 'it', query: 'Voli economici da Milano a Tokyo per due persone',
    expect: { origin: 'MIL', destination: 'TYO', adults: 2, preferred_sort: 'price' } },

  // ── PORTUGUESE ─────────────────────────────────────────────────────────────
  { lang: 'pt', query: 'Lisboa a Barcelona em 18 de julho retorno em 22 de julho',
    expect: { origin: 'LIS', destination: 'BCN', date: '2026-07-18', hasReturnDate: true } },
  { lang: 'pt', query: 'Voos baratos de São Paulo para Buenos Aires em agosto para um casal',
    expect: { originAny: ['SAO', 'GRU', 'CGH', 'VCP'], destinationAny: ['EZE', 'BUE', 'AEP'], adults: 2, passenger_context: 'couple', preferred_sort: 'price' } },

  // ── DUTCH ──────────────────────────────────────────────────────────────────
  { lang: 'nl', query: 'Amsterdam naar Barcelona op 18 juli terug op 22 juli',
    expect: { origin: 'AMS', destination: 'BCN', date: '2026-07-18', hasReturnDate: true } },
  { lang: 'nl', query: 'Goedkope vluchten van Rotterdam naar New York voor een gezin',
    expect: { origin: 'RTM', destination: 'NYC', passenger_context: 'family', preferred_sort: 'price' } },

  // ── ALBANIAN ───────────────────────────────────────────────────────────────
  { lang: 'sq', query: 'Tiranë drejt Barcelonës më 18 korrik kthim më 22 korrik',
    expect: { origin: 'TIA', destination: 'BCN', date: '2026-07-18', hasReturnDate: true } },

  // ── CROATIAN ───────────────────────────────────────────────────────────────
  { lang: 'hr', query: 'Zagreb do Barcelone 18. srpnja povratak 22. srpnja',
    expect: { origin: 'ZAG', destination: 'BCN', date: '2026-07-18', hasReturnDate: true } },

  // ── SWEDISH ────────────────────────────────────────────────────────────────
  { lang: 'sv', query: 'Stockholm till Barcelona 18 juli tillbaka 22 juli',
    expect: { origin: 'STO', destination: 'BCN', date: '2026-07-18', hasReturnDate: true } },

  // ── JAPANESE ───────────────────────────────────────────────────────────────
  { lang: 'ja', query: '東京からバルセロナへ 7月18日',
    expect: { origin: 'TYO', destination: 'BCN' } },

  // ── CHINESE ────────────────────────────────────────────────────────────────
  { lang: 'zh', query: '北京到巴塞罗那 7月18日',
    expect: { originAny: ['BJS', 'PEK', 'PKX'], destination: 'BCN' } },
]

function check(c: Case): string | null {
  const r = parseNLQuery(c.query) as Record<string, unknown>
  const failures: string[] = []
  const e = c.expect

  if (e.origin && r.origin !== e.origin) failures.push(`origin: got ${r.origin ?? '∅'}, want ${e.origin}`)
  if (e.originAny && !e.originAny.includes(String(r.origin))) failures.push(`origin: got ${r.origin ?? '∅'}, want one of ${e.originAny.join('/')}`)
  if (e.destination && r.destination !== e.destination) failures.push(`destination: got ${r.destination ?? '∅'}, want ${e.destination}`)
  if (e.destinationAny && !e.destinationAny.includes(String(r.destination))) failures.push(`destination: got ${r.destination ?? '∅'}, want one of ${e.destinationAny.join('/')}`)
  if (e.date) {
    const d = String(r.date ?? '')
    if (!d.startsWith(e.date)) failures.push(`date: got ${d || '∅'}, want prefix ${e.date}`)
  }
  if (e.hasReturnDate && !r.return_date) failures.push(`return_date: missing`)
  if (e.adults !== undefined && r.adults !== e.adults) failures.push(`adults: got ${r.adults ?? '∅'}, want ${e.adults}`)
  if (e.totalPax !== undefined) {
    const total = (Number(r.adults) || 0) + (Number(r.children) || 0) + (Number(r.infants) || 0)
    if (total !== e.totalPax) failures.push(`totalPax: got ${total}, want ${e.totalPax}`)
  }
  if (e.passenger_context && r.passenger_context !== e.passenger_context) failures.push(`passenger_context: got ${r.passenger_context ?? '∅'}, want ${e.passenger_context}`)
  if (e.trip_purpose && r.trip_purpose !== e.trip_purpose) failures.push(`trip_purpose: got ${r.trip_purpose ?? '∅'}, want ${e.trip_purpose}`)
  if (e.stops !== undefined && r.stops !== e.stops) failures.push(`stops: got ${r.stops ?? '∅'}, want ${e.stops}`)
  if (e.cabin && r.cabin !== e.cabin) failures.push(`cabin: got ${r.cabin ?? '∅'}, want ${e.cabin}`)
  if (e.carry_on_only && !r.carry_on_only) failures.push(`carry_on_only: missing`)
  if (e.preferred_sort && r.preferred_sort !== e.preferred_sort) failures.push(`preferred_sort: got ${r.preferred_sort ?? '∅'}, want ${e.preferred_sort}`)

  return failures.length ? failures.join('; ') : null
}

test('parseNLQuery handles representative queries across all 13 supported locales', () => {
  const results = CASES.map(c => ({ c, err: check(c) }))
  const failed = results.filter(r => r.err)
  if (failed.length) {
    const detail = failed.map(({ c, err }) => `  [${c.lang}] "${c.query}"\n    → ${err}`).join('\n')
    assert.fail(`${failed.length}/${CASES.length} cases failed:\n${detail}`)
  }
})
