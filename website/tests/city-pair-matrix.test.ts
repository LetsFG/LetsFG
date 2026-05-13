// Bare city-pair stress matrix.
//
// Asserts that ALL the ways a user might type a two-city query parse into the
// expected origin → destination IATAs. Covers:
//   • bare pairs ("Berlin Oslo")
//   • case variations ("BERLIN OSLO", "berlin oslo")
//   • separator variations (space / comma / dash / slash / arrow / "to" / "→")
//   • "from X to Y" / "from X Y" / "X-Y" / "X/Y" / "X > Y"
//   • trailing noise ("Berlin Oslo next month", "Berlin Oslo couple", "Berlin Oslo round trip")
//   • leading conversational noise ("flights Berlin Oslo", "fly Berlin to Oslo")
//   • multi-word cities ("New York Tokyo", "Buenos Aires Madrid")
//   • multilingual separators (es "a", de "nach", fr "à", pl "do", it "a")
//
// Run: npx tsx --test tests/city-pair-matrix.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseNLQuery } from '../app/lib/searchParsing.ts'

interface Case {
  query: string
  origin: string | string[]      // accept any of these
  destination: string | string[]
}

// Acceptable code sets — many cities resolve to either city metacode or main airport.
const BER = ['BER']
const OSL = ['OSL']
const LON = ['LON', 'LHR', 'LGW', 'STN', 'LCY', 'LTN']
const PAR = ['PAR', 'CDG', 'ORY', 'BVA']
const NYC = ['NYC', 'JFK', 'LGA', 'EWR']
const TYO = ['TYO', 'HND', 'NRT']
const MAD = ['MAD']
const BCN = ['BCN']
const ROM = ['ROM', 'FCO', 'CIA']
const MIL = ['MIL', 'MXP', 'LIN', 'BGY']
const WAW = ['WAW']
const KRK = ['KRK']
const GDN = ['GDN']
const MUC = ['MUC']
const FRA = ['FRA']
const VIE = ['VIE']
const ZRH = ['ZRH']
const AMS = ['AMS']
const BRU = ['BRU']
const CPH = ['CPH']
const ARN = ['ARN', 'STO']
const HEL = ['HEL']
const DUB = ['DUB']
const LIS = ['LIS']
const ATH = ['ATH']
const IST = ['IST', 'SAW']
const DXB = ['DXB']
const SIN = ['SIN']
const HKG = ['HKG']
const BKK = ['BKK']
const SYD = ['SYD']
const LAX = ['LAX']
const SFO = ['SFO']
const MIA = ['MIA']
const YYZ = ['YYZ']
const MEX = ['MEX']
const GRU = ['GRU', 'SAO']
const EZE = ['EZE', 'BUE']
const BOG = ['BOG']
const JNB = ['JNB']
const CAI = ['CAI']

const CASES: Case[] = [
  // ── BARE PAIRS — single space separator ─────────────────────────────────────
  { query: 'Berlin Oslo', origin: BER, destination: OSL },
  { query: 'berlin oslo', origin: BER, destination: OSL },
  { query: 'BERLIN OSLO', origin: BER, destination: OSL },
  { query: 'Madrid Barcelona', origin: MAD, destination: BCN },
  { query: 'Paris Rome', origin: PAR, destination: ROM },
  { query: 'London Tokyo', origin: LON, destination: TYO },
  { query: 'Warsaw Krakow', origin: WAW, destination: KRK },
  { query: 'Munich Vienna', origin: MUC, destination: VIE },
  { query: 'Amsterdam Brussels', origin: AMS, destination: BRU },
  { query: 'Copenhagen Stockholm', origin: CPH, destination: ARN },
  { query: 'Dublin Lisbon', origin: DUB, destination: LIS },
  { query: 'Athens Istanbul', origin: ATH, destination: IST },
  { query: 'Dubai Singapore', origin: DXB, destination: SIN },
  { query: 'Bangkok Sydney', origin: BKK, destination: SYD },
  { query: 'Los Angeles Miami', origin: LAX, destination: MIA },
  { query: 'Toronto Mexico City', origin: YYZ, destination: MEX },
  { query: 'Sao Paulo Buenos Aires', origin: GRU, destination: EZE },
  { query: 'Bogota Johannesburg', origin: BOG, destination: JNB },
  { query: 'Cairo Helsinki', origin: CAI, destination: HEL },

  // ── MULTI-WORD CITIES (ambiguity test) ─────────────────────────────────────
  { query: 'New York Tokyo', origin: NYC, destination: TYO },
  { query: 'New York to Tokyo', origin: NYC, destination: TYO },
  { query: 'Buenos Aires Madrid', origin: EZE, destination: MAD },
  { query: 'Hong Kong Singapore', origin: HKG, destination: SIN },
  { query: 'San Francisco New York', origin: SFO, destination: NYC },
  { query: 'Mexico City Toronto', origin: MEX, destination: YYZ },
  { query: 'Sao Paulo to New York', origin: GRU, destination: NYC },

  // ── PUNCTUATION SEPARATORS ─────────────────────────────────────────────────
  { query: 'Berlin, Oslo', origin: BER, destination: OSL },
  { query: 'Berlin-Oslo', origin: BER, destination: OSL },
  { query: 'Berlin - Oslo', origin: BER, destination: OSL },
  { query: 'Berlin – Oslo', origin: BER, destination: OSL },     // en-dash
  { query: 'Berlin — Oslo', origin: BER, destination: OSL },     // em-dash
  { query: 'Berlin/Oslo', origin: BER, destination: OSL },
  { query: 'Berlin → Oslo', origin: BER, destination: OSL },
  { query: 'Berlin -> Oslo', origin: BER, destination: OSL },
  { query: 'Berlin > Oslo', origin: BER, destination: OSL },

  // ── ENGLISH "to" / "from … to" ─────────────────────────────────────────────
  { query: 'Berlin to Oslo', origin: BER, destination: OSL },
  { query: 'from Berlin to Oslo', origin: BER, destination: OSL },
  { query: 'From Berlin To Oslo', origin: BER, destination: OSL },
  { query: 'fly Berlin to Oslo', origin: BER, destination: OSL },
  { query: 'flying Berlin to Oslo', origin: BER, destination: OSL },
  { query: 'flights Berlin Oslo', origin: BER, destination: OSL },
  { query: 'flight Berlin to Oslo', origin: BER, destination: OSL },
  { query: 'cheap flights Berlin Oslo', origin: BER, destination: OSL },
  { query: 'cheapest flight from Berlin to Oslo', origin: BER, destination: OSL },

  // ── TRAILING NOISE (date / passenger / trip-type words) ────────────────────
  { query: 'Berlin Oslo next month', origin: BER, destination: OSL },
  { query: 'Berlin Oslo tomorrow', origin: BER, destination: OSL },
  { query: 'Berlin Oslo this weekend', origin: BER, destination: OSL },
  { query: 'Berlin Oslo June', origin: BER, destination: OSL },
  { query: 'Berlin Oslo June 15', origin: BER, destination: OSL },
  { query: 'Berlin Oslo couple', origin: BER, destination: OSL },
  { query: 'Berlin Oslo for a couple', origin: BER, destination: OSL },
  { query: 'Berlin Oslo round trip', origin: BER, destination: OSL },
  { query: 'Berlin Oslo one way', origin: BER, destination: OSL },
  { query: 'Berlin Oslo direct', origin: BER, destination: OSL },
  { query: 'Berlin Oslo business class', origin: BER, destination: OSL },
  { query: 'Berlin Oslo for 2 people', origin: BER, destination: OSL },
  { query: 'Berlin Oslo cheapest', origin: BER, destination: OSL },

  // ── MULTILINGUAL SEPARATORS ────────────────────────────────────────────────
  { query: 'Madrid a Barcelona', origin: MAD, destination: BCN },          // es
  { query: 'Berlin nach Oslo', origin: BER, destination: OSL },             // de
  { query: 'Paris à Rome', origin: PAR, destination: ROM },                  // fr
  { query: 'Roma a Milano', origin: ROM, destination: MIL },                 // it
  { query: 'Warszawa do Krakowa', origin: WAW, destination: KRK },           // pl
  { query: 'Lisboa para Madrid', origin: LIS, destination: MAD },            // pt
  { query: 'Amsterdam naar Brussel', origin: AMS, destination: BRU },        // nl
]

for (const c of CASES) {
  test(`city-pair: ${c.query}`, async () => {
    const r = await parseNLQuery(c.query, 'en')
    const okOrig = Array.isArray(c.origin) ? c.origin.includes(r.origin || '') : r.origin === c.origin
    const okDest = Array.isArray(c.destination) ? c.destination.includes(r.destination || '') : r.destination === c.destination
    assert.ok(
      okOrig && okDest,
      `query="${c.query}" → origin=${r.origin} dest=${r.destination} ` +
      `(expected ${JSON.stringify(c.origin)} → ${JSON.stringify(c.destination)})`,
    )
  })
}
