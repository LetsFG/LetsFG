#!/usr/bin/env node
/**
 * Build a compact airports lookup table for the website.
 *
 * Source: OurAirports (public domain) — https://ourairports.com/data/
 * Run:    node scripts/build-airports-db.mjs <input.csv> <output.ts>
 *
 * Filters to airports with:
 *   - non-empty IATA code (3 uppercase letters)
 *   - type ∈ {large_airport, medium_airport}
 *   - scheduled_service = yes
 *
 * Output: app/lib/airports-db.generated.ts with a flat array of
 *         { c: iata, n: name, ci: city, co: country, t: 0|1, lat, lon }.
 *         t: 0 = large, 1 = medium (large is preferred when distances tie).
 */
import fs from 'node:fs'
import path from 'node:path'

const [, , inPath, outPath] = process.argv
if (!inPath || !outPath) {
  console.error('usage: build-airports-db.mjs <airports.csv> <out.ts>')
  process.exit(1)
}

// Minimal CSV parser that handles quoted fields with embedded commas/quotes.
function parseCsv(text) {
  const rows = []
  let row = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++ } else { inQuotes = false }
      } else {
        cur += ch
      }
    } else {
      if (ch === '"') inQuotes = true
      else if (ch === ',') { row.push(cur); cur = '' }
      else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = '' }
      else if (ch === '\r') { /* skip */ }
      else cur += ch
    }
  }
  if (cur.length > 0 || row.length > 0) { row.push(cur); rows.push(row) }
  return rows
}

const text = fs.readFileSync(inPath, 'utf8')
const rows = parseCsv(text)
const header = rows[0]
const idx = (name) => {
  const i = header.indexOf(name)
  if (i < 0) throw new Error(`column not found: ${name}`)
  return i
}
const I_TYPE = idx('type')
const I_NAME = idx('name')
const I_LAT = idx('latitude_deg')
const I_LON = idx('longitude_deg')
const I_COUNTRY = idx('iso_country')
const I_MUNI = idx('municipality')
const I_SCHED = idx('scheduled_service')
const I_IATA = idx('iata_code')

const out = []
const seenIata = new Set()
for (let r = 1; r < rows.length; r++) {
  const row = rows[r]
  if (!row || row.length < header.length) continue
  const type = row[I_TYPE]
  if (type !== 'large_airport' && type !== 'medium_airport') continue
  if (row[I_SCHED] !== 'yes') continue
  const iata = (row[I_IATA] || '').trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(iata)) continue
  if (seenIata.has(iata)) continue
  const lat = parseFloat(row[I_LAT])
  const lon = parseFloat(row[I_LON])
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
  seenIata.add(iata)
  out.push({
    c: iata,
    n: (row[I_NAME] || '').trim(),
    ci: (row[I_MUNI] || '').trim(),
    co: (row[I_COUNTRY] || '').trim().toUpperCase(),
    t: type === 'large_airport' ? 0 : 1,
    lat: Math.round(lat * 10000) / 10000,
    lon: Math.round(lon * 10000) / 10000,
  })
}
out.sort((a, b) => a.c.localeCompare(b.c))

const banner = `// AUTO-GENERATED from OurAirports (public domain).
// Source: https://ourairports.com/data/
// Run \`node scripts/build-airports-db.mjs _ourairports.csv app/lib/airports-db.generated.ts\`
// to refresh. ${out.length} airports (large + medium with IATA + scheduled service).
//
// Compact field names to keep the bundle small:
//   c=IATA, n=name, ci=city, co=ISO country, t=0(large)|1(medium), lat, lon
`

const body = `export interface AirportRow { c: string; n: string; ci: string; co: string; t: 0 | 1; lat: number; lon: number }\n` +
  `export const AIRPORTS_DB: ReadonlyArray<AirportRow> = ${JSON.stringify(out)}\n`

fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, banner + body, 'utf8')
console.error(`wrote ${out.length} airports to ${outPath}`)
