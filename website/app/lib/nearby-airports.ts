/**
 * Curated map of well-known cities that have NO commercial international
 * airport (or only a tiny domestic strip) → the nearest practical airline hub.
 *
 * Used as a last-resort fallback in /api/search when both the regex parser
 * and the Gemini normalizer fail to map the user's input to a flyable IATA
 * code. Without this, exotic origins/destinations (Pretoria, Bath, Bonn,
 * Liechtenstein, Monaco, Vatican, etc.) would either 400 the search or run
 * a doomed search that returns 0 offers after a 5-minute wait.
 *
 * Pattern: { 'lowercase city alias' → { code, name, hub_name, reason } }
 *  - `code`     — IATA we actually search
 *  - `name`     — display string for that IATA
 *  - `hub_name` — short label for the hub airport (used in the Gemini note)
 *  - `reason`   — short human-readable justification for the swap; the
 *                 Gemini justification can paraphrase this for the user.
 *
 * Keep this list FOCUSED — major capitals + popular tourist cities only.
 * For everything else, the existing CITY_TO_IATA / vertex resolver is fine.
 */

export interface NearbyAirportFallback {
  code: string
  name: string
  hub_name: string
  reason: string
}

export const NEARBY_AIRPORTS: Record<string, NearbyAirportFallback> = {
  // ── Africa ────────────────────────────────────────────────────────────
  'pretoria': {
    code: 'JNB',
    name: 'Johannesburg (nearest to Pretoria)',
    hub_name: 'O. R. Tambo International (JNB)',
    reason: 'Pretoria has no commercial international airport — JNB is ~50 km away and is the de facto gateway',
  },
  'pry': {
    code: 'JNB',
    name: 'Johannesburg (nearest to Pretoria)',
    hub_name: 'O. R. Tambo International (JNB)',
    reason: 'Pretoria has no commercial international airport — JNB is ~50 km away',
  },

  // ── Europe ────────────────────────────────────────────────────────────
  'the hague': {
    code: 'AMS',
    name: 'Amsterdam (nearest to The Hague)',
    hub_name: 'Schiphol (AMS)',
    reason: 'The Hague has no commercial airport — Schiphol is ~50 km away and is the standard gateway',
  },
  'den haag': {
    code: 'AMS',
    name: 'Amsterdam (nearest to Den Haag)',
    hub_name: 'Schiphol (AMS)',
    reason: 'Den Haag has no commercial airport — Schiphol is ~50 km away',
  },
  'rotterdam': {
    code: 'AMS',
    name: 'Amsterdam (nearest to Rotterdam)',
    hub_name: 'Schiphol (AMS)',
    reason: 'Rotterdam-The Hague airport (RTM) has very limited service — Schiphol (AMS) is ~60 km away with full coverage',
  },
  'bonn': {
    code: 'CGN',
    name: 'Cologne/Bonn',
    hub_name: 'Cologne/Bonn (CGN)',
    reason: 'Bonn has no airport of its own — CGN is the shared regional hub ~25 km away',
  },
  'oxford': {
    code: 'LON',
    name: 'London (nearest to Oxford)',
    hub_name: 'Heathrow / Gatwick / Luton',
    reason: 'Oxford has no commercial airport — London airports (~90 km) are the realistic option',
  },
  'cambridge': {
    code: 'STN',
    name: 'London Stansted (nearest to Cambridge UK)',
    hub_name: 'Stansted (STN)',
    reason: 'Cambridge airport (CBG) is private/charter only — Stansted (~50 km) is the nearest commercial option',
  },
  'bath': {
    code: 'BRS',
    name: 'Bristol (nearest to Bath)',
    hub_name: 'Bristol (BRS)',
    reason: 'Bath has no airport — Bristol (BRS) is ~25 km away and is the standard gateway',
  },
  'monaco': {
    code: 'NCE',
    name: 'Nice (nearest to Monaco)',
    hub_name: 'Nice Côte d’Azur (NCE)',
    reason: 'Monaco has no commercial airport — NCE is ~30 km away with helicopter or coach transfer',
  },
  'monte carlo': {
    code: 'NCE',
    name: 'Nice (nearest to Monte Carlo)',
    hub_name: 'Nice Côte d’Azur (NCE)',
    reason: 'Monte Carlo has no airport — NCE is ~30 km away',
  },
  'vatican': {
    code: 'FCO',
    name: 'Rome (nearest to Vatican City)',
    hub_name: 'Fiumicino (FCO)',
    reason: 'Vatican City has no airport — Rome Fiumicino is the only realistic gateway',
  },
  'vatican city': {
    code: 'FCO',
    name: 'Rome (nearest to Vatican City)',
    hub_name: 'Fiumicino (FCO)',
    reason: 'Vatican City has no airport — Rome Fiumicino is the only realistic gateway',
  },
  'san marino': {
    code: 'BLQ',
    name: 'Bologna (nearest to San Marino)',
    hub_name: 'Bologna (BLQ)',
    reason: 'San Marino has no commercial airport — Bologna (~135 km) or Rimini (~25 km, very limited) are the options',
  },
  'liechtenstein': {
    code: 'ZRH',
    name: 'Zürich (nearest to Liechtenstein)',
    hub_name: 'Zürich (ZRH)',
    reason: 'Liechtenstein has no airport — Zürich is ~120 km away and is the standard gateway',
  },
  'vaduz': {
    code: 'ZRH',
    name: 'Zürich (nearest to Vaduz)',
    hub_name: 'Zürich (ZRH)',
    reason: 'Vaduz has no airport — Zürich (ZRH) is ~120 km away',
  },
  'andorra': {
    code: 'BCN',
    name: 'Barcelona (nearest to Andorra)',
    hub_name: 'Barcelona (BCN)',
    reason: 'Andorra has no commercial airport — Barcelona (~200 km) and Toulouse (~180 km) are the practical options',
  },
  'andorra la vella': {
    code: 'BCN',
    name: 'Barcelona (nearest to Andorra la Vella)',
    hub_name: 'Barcelona (BCN)',
    reason: 'Andorra has no commercial airport — Barcelona (~200 km) is the standard gateway',
  },
  'gibraltar': {
    code: 'GIB',
    name: 'Gibraltar',
    hub_name: 'Gibraltar (GIB)',
    reason: 'Limited carrier coverage — Málaga (AGP) ~130 km away may also work as alternative',
  },
  'san sebastian': {
    code: 'EAS',
    name: 'San Sebastián',
    hub_name: 'San Sebastián (EAS)',
    reason: 'EAS has very limited service — Bilbao (BIO) ~100 km or Biarritz (BIQ) ~50 km are common alternatives',
  },

  // ── Middle East / Asia ────────────────────────────────────────────────
  'mecca': {
    code: 'JED',
    name: 'Jeddah (nearest to Mecca)',
    hub_name: 'King Abdulaziz International (JED)',
    reason: 'Mecca has no airport — Jeddah is the standard pilgrimage gateway, ~80 km away',
  },
  'makkah': {
    code: 'JED',
    name: 'Jeddah (nearest to Makkah)',
    hub_name: 'King Abdulaziz International (JED)',
    reason: 'Makkah has no airport — Jeddah is the standard pilgrimage gateway, ~80 km away',
  },
  'petra': {
    code: 'AQJ',
    name: 'Aqaba (nearest to Petra)',
    hub_name: 'King Hussein International (AQJ)',
    reason: 'Petra has no airport — Aqaba is ~125 km away, Amman (AMM) is ~235 km',
  },
  'dead sea': {
    code: 'AMM',
    name: 'Amman (nearest to the Dead Sea)',
    hub_name: 'Queen Alia International (AMM)',
    reason: 'No airport at the Dead Sea — Amman is the standard gateway, ~55 km away',
  },
  'kandy': {
    code: 'CMB',
    name: 'Colombo (nearest to Kandy)',
    hub_name: 'Bandaranaike International (CMB)',
    reason: 'Kandy has no commercial airport — Colombo (CMB) is the only international option',
  },
  'agra': {
    code: 'DEL',
    name: 'Delhi (nearest to Agra)',
    hub_name: 'Indira Gandhi International (DEL)',
    reason: 'Agra airport (AGR) has minimal scheduled service — Delhi (~230 km) is the realistic gateway',
  },
  'taj mahal': {
    code: 'DEL',
    name: 'Delhi (nearest to Taj Mahal / Agra)',
    hub_name: 'Indira Gandhi International (DEL)',
    reason: 'No commercial gateway in Agra — Delhi (~230 km) is the standard option',
  },
  'nara': {
    code: 'KIX',
    name: 'Osaka Kansai (nearest to Nara)',
    hub_name: 'Kansai International (KIX)',
    reason: 'Nara has no airport — Osaka Kansai is ~80 km away and is the standard gateway',
  },
  'angkor': {
    code: 'REP',
    name: 'Siem Reap',
    hub_name: 'Siem Reap–Angkor International (REP)',
    reason: 'Siem Reap (REP) is the gateway for Angkor Wat',
  },
  'angkor wat': {
    code: 'REP',
    name: 'Siem Reap (nearest to Angkor Wat)',
    hub_name: 'Siem Reap–Angkor International (REP)',
    reason: 'Siem Reap is the standard Angkor gateway',
  },

  // ── Americas ──────────────────────────────────────────────────────────
  'machu picchu': {
    code: 'CUZ',
    name: 'Cusco (nearest to Machu Picchu)',
    hub_name: 'Cusco (CUZ)',
    reason: 'Machu Picchu has no airport — Cusco (CUZ) is the standard gateway',
  },
  'easter island': {
    code: 'IPC',
    name: 'Easter Island',
    hub_name: 'Mataveri International (IPC)',
    reason: 'IPC is the only airport — most flights connect via Santiago (SCL)',
  },
  'niagara falls': {
    code: 'BUF',
    name: 'Buffalo (nearest to Niagara Falls)',
    hub_name: 'Buffalo Niagara International (BUF)',
    reason: 'Niagara Falls has no major airport — Buffalo (BUF, ~30 km) or Toronto (YYZ, ~130 km) are the gateways',
  },
}

/**
 * Look up a city in the nearby-airport fallback map.
 * Input is normalized (lowercased, accents stripped) for matching.
 */
export function lookupNearbyAirport(rawCity: string): NearbyAirportFallback | null {
  if (!rawCity) return null
  const key = rawCity
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’`]/g, '')
    .trim()
  if (!key) return null
  return NEARBY_AIRPORTS[key] ?? null
}

// ── Global geo-based fallback ─────────────────────────────────────────
// When the curated map above doesn't know the city but Gemini gave us
// approximate WGS84 lat/lon for it, find the nearest large or medium
// commercial airport from the bundled OurAirports DB (~3,300 airports
// with IATA + scheduled service, public-domain dataset). This makes the
// fallback comprehensive — it works for ANY city Gemini can place on a
// map, which is essentially every named place on Earth.

import { AIRPORTS_DB, type AirportRow } from './airports-db.generated'

// Set of IATA codes that have actual scheduled commercial service (large or
// medium airports in OurAirports). Used by /api/search to detect "ghost" IATAs
// like PRY (Pretoria — no commercial service) so we can override them with the
// nearest real hub instead of starting a doomed search.
const USABLE_IATAS: ReadonlySet<string> = new Set(AIRPORTS_DB.map(a => a.c))
export function isUsableIata(code: string | undefined | null): boolean {
  if (!code) return false
  // Multi-airport "city" codes like LON, NYC, PAR aren't in OurAirports'
  // airport list but ARE flyable on every supplier — whitelist them.
  const upper = code.toUpperCase()
  if (CITY_METACODES.has(upper)) return true
  return USABLE_IATAS.has(upper)
}
const CITY_METACODES: ReadonlySet<string> = new Set([
  'LON', 'NYC', 'PAR', 'TYO', 'CHI', 'WAS', 'MIL', 'MOW', 'STO', 'BUE',
  'RIO', 'SAO', 'BJS', 'SEL', 'OSA', 'ROM', 'BCN', 'BER',
])

const EARTH_RADIUS_KM = 6371
const toRad = (deg: number) => (deg * Math.PI) / 180

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = toRad(bLat - aLat)
  const dLon = toRad(bLon - aLon)
  const lat1 = toRad(aLat)
  const lat2 = toRad(bLat)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a))
}

/**
 * Find the closest commercial airport (large or medium, with IATA + scheduled
 * service) to the given lat/lon. Prefers a large airport if there's one within
 * `preferLargeWithinKm` of the geometrically closest hit (so e.g. a small
 * regional that happens to be 5 km closer than a major hub doesn't win).
 */
export function findNearestAirport(
  lat: number,
  lon: number,
  opts: { maxKm?: number; preferLargeWithinKm?: number } = {},
): AirportRow | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  const maxKm = opts.maxKm ?? 600
  const preferLargeWithinKm = opts.preferLargeWithinKm ?? 150

  // Bounding-box pre-filter (1° lat ≈ 111 km).
  const latDeltaDeg = (maxKm / 111) + 0.5
  const cosLat = Math.cos(toRad(lat))
  const lonDeltaDeg = cosLat > 0.05 ? (maxKm / (111 * cosLat)) + 0.5 : 360
  const minLat = lat - latDeltaDeg
  const maxLat = lat + latDeltaDeg
  const minLon = lon - lonDeltaDeg
  const maxLon = lon + lonDeltaDeg
  const lonWraps = minLon < -180 || maxLon > 180

  type Hit = { row: AirportRow; km: number }
  let candidates: Hit[] = []
  for (const a of AIRPORTS_DB) {
    if (a.lat < minLat || a.lat > maxLat) continue
    if (!lonWraps && (a.lon < minLon || a.lon > maxLon)) continue
    const km = haversineKm(lat, lon, a.lat, a.lon)
    if (km <= maxKm) candidates.push({ row: a, km })
  }
  if (candidates.length === 0) {
    // Bounding box came up empty — full scan as a safety net (the array is
    // only ~3,300 entries so this is still sub-millisecond).
    candidates = []
    for (const a of AIRPORTS_DB) {
      const km = haversineKm(lat, lon, a.lat, a.lon)
      if (km <= maxKm) candidates.push({ row: a, km })
    }
    if (candidates.length === 0) return null
  }
  candidates.sort((x, y) => x.km - y.km)

  const closest = candidates[0]
  if (closest.row.t === 0) return closest.row // closest is already large
  for (const c of candidates) {
    if (c.km - closest.km > preferLargeWithinKm) break
    if (c.row.t === 0) return c.row
  }
  return closest.row
}

/**
 * High-level resolver used by /api/search.
 *
 * Priority:
 *   1. Curated `NEARBY_AIRPORTS` overrides (famous edge cases — Pretoria→JNB,
 *      Vatican→FCO, Niagara Falls→BUF, etc.). These win because they encode
 *      "human practical answer", not just geometry.
 *   2. Geo-lookup against the bundled OurAirports DB using Gemini-supplied
 *      lat/lon. Comprehensive for ANY named city worldwide.
 *
 * Returns null only when neither path can resolve the city.
 */
export function resolveNearbyAirport(
  city: string,
  lat: number | null | undefined,
  lon: number | null | undefined,
): NearbyAirportFallback | null {
  const curated = lookupNearbyAirport(city)
  if (curated) return curated

  if (typeof lat !== 'number' || typeof lon !== 'number') return null
  const nearest = findNearestAirport(lat, lon)
  if (!nearest) return null

  const hub = nearest.n
    ? `${nearest.n} (${nearest.c})`
    : `${nearest.ci || nearest.c} (${nearest.c})`
  const km = Math.round(haversineKm(lat, lon, nearest.lat, nearest.lon))
  const cityLabel = city.trim() || nearest.ci || nearest.c
  return {
    code: nearest.c,
    name: nearest.ci
      ? `${nearest.ci} (nearest commercial airport to ${cityLabel})`
      : `${nearest.c} (nearest commercial airport to ${cityLabel})`,
    hub_name: hub,
    reason: `${cityLabel} doesn't map to any IATA in our coverage — ${hub} is ~${km} km away and is the nearest large/medium airport with scheduled commercial service`,
  }
}
