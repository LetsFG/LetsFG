// Server-only: resolve city/location names AND extract travel intent from NL flight queries via Vertex AI Gemini.
// Extracts cities + passengers, cabin class, direct_only, sort_by, time constraints, bags, trip purpose.
// Returns null on any failure.

import { TRIP_PURPOSES, type TripPurpose } from './trip-purpose'

export interface VertexCityResult {
  origin_city:      string | null  // English city name; include state/country if ambiguous
  destination_city: string | null  // "ANYWHERE" for open-destination searches; null if unclear
  via_city:         string | null  // preferred stopover city or null
  // Approximate centre lat/lon for the named city. Used as a deterministic
  // fallback by /api/search to find the nearest commercial airport (via the
  // bundled OurAirports DB + haversine) when origin_city / destination_city
  // doesn't map to any IATA code in our city alias table. Optional — leave
  // null when the model isn't confident or the query is ambiguous.
  origin_lat?:      number | null
  origin_lon?:      number | null
  destination_lat?: number | null
  destination_lon?: number | null

  // ── Intent fields (extracted alongside cities — same call, zero extra latency) ──
  /** Total traveller count (adults + children). null if not mentioned. */
  passengers?:      number | null
  /** Cabin class. null if not mentioned. */
  cabin_class?:     'economy' | 'premium_economy' | 'business' | 'first' | null
  /** true only if user explicitly wants no connections/layovers. null otherwise. */
  direct_only?:     boolean | null
  /** "price" = cheapest, "duration" = fastest, null = not stated. */
  sort_by?:         'price' | 'duration' | null
  /** Earliest acceptable departure time as "HH:MM" 24 h. null if not stated. */
  depart_after?:    string | null
  /** Latest acceptable departure time as "HH:MM" 24 h. null if not stated. */
  depart_before?:   string | null
  /** true if user wants checked bags included in the ticket price. null otherwise. */
  bags_included?:   boolean | null
  /** All applicable trip purposes, ordered strongest/most explicit first. */
  trip_purposes?:   TripPurpose[] | null
  /** Trip purpose inferred from context. null if unclear. */
  trip_purpose?:    TripPurpose | null
  /** Preferred departure time bucket for the outbound leg. null if not stated. */
  dep_time_pref?:   'early_morning' | 'morning' | 'afternoon' | 'evening' | 'red_eye' | null
  /** Preferred departure time bucket for the return leg. null if not a round-trip or not stated. */
  ret_time_pref?:   'early_morning' | 'morning' | 'afternoon' | 'evening' | 'red_eye' | null
  /** Passenger group context. null if unclear. */
  passenger_context?: 'solo' | 'couple' | 'family' | 'group' | 'business_traveler' | null
  /** true = round trip, false = one-way, null = unclear. */
  is_round_trip?: boolean | null
  /** Outbound flight date in YYYY-MM-DD. null if not determinable. */
  departure_date?: string | null
  /** Return flight date in YYYY-MM-DD. null for one-way or unclear. */
  return_date?: string | null
}

// Keep old name as alias so callers importing VertexParseResult still compile
export type VertexParseResult = VertexCityResult

// ── Vertex AI config ──────────────────────────────────────────────────────────

const VERTEX_PROJECT  = 'sms-caller'
const VERTEX_LOCATION = 'us-central1'
const VERTEX_MODEL    = 'gemini-2.5-flash-lite'
const VERTEX_URL      =
  `https://${VERTEX_LOCATION}-aiplatform.googleapis.com/v1` +
  `/projects/${VERTEX_PROJECT}/locations/${VERTEX_LOCATION}` +
  `/publishers/google/models/${VERTEX_MODEL}:generateContent`
const GEMINI_DIRECT_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${VERTEX_MODEL}:generateContent`

const TRIP_PURPOSE_JSON_ENUM = TRIP_PURPOSES.map((purpose) => `"${purpose}"`).join('|')

// ── Access-token cache (tokens are valid ~1 h on Cloud Run) ──────────────────

let _token: string | null = null
let _tokenExpiry = 0

async function getAccessToken(): Promise<string | null> {
  const now = Date.now()
  if (_token && now < _tokenExpiry) return _token
  try {
    const res = await fetch(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
      { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(2000) },
    )
    if (!res.ok) return null
    const data = await res.json() as { access_token: string; expires_in: number }
    _token = data.access_token
    _tokenExpiry = now + (data.expires_in - 60) * 1000   // expire 60 s early
    return _token
  } catch {
    return null   // local dev — no metadata server
  }
}

// ── Prompt ───────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a flight search intent extractor. Extract cities AND travel intent from a flight search query in any language.
Return ONLY valid JSON (no markdown, no explanation) with exactly these fields:
{
  "origin_city": string|null,
  "destination_city": string|null,
  "via_city": string|null,
  "origin_lat": number|null,
  "origin_lon": number|null,
  "destination_lat": number|null,
  "destination_lon": number|null,
  "passengers": number|null,
  "cabin_class": "economy"|"premium_economy"|"business"|"first"|null,
  "direct_only": boolean|null,
  "sort_by": "price"|"duration"|null,
  "depart_after": string|null,
  "depart_before": string|null,
  "bags_included": boolean|null,
  "trip_purposes": (${TRIP_PURPOSE_JSON_ENUM})[]|null,
  "trip_purpose": ${TRIP_PURPOSE_JSON_ENUM}|null,
  "dep_time_pref": "early_morning"|"morning"|"afternoon"|"evening"|"red_eye"|null,
  "ret_time_pref": "early_morning"|"morning"|"afternoon"|"evening"|"red_eye"|null,
  "passenger_context": "solo"|"couple"|"family"|"group"|"business_traveler"|null,
  "is_round_trip": boolean|null,
  "departure_date": "YYYY-MM-DD"|null,
  "return_date": "YYYY-MM-DD"|null
}

CITY RULES:
- origin_city / destination_city: English city name. Include state/country if ambiguous (e.g. "Portland, Oregon"). null if not found.
- destination_city: "ANYWHERE" for open-destination queries ("to anywhere", "wherever is cheapest").
- via_city: preferred stopover city if explicitly mentioned ("via Dubai", "through Hong Kong"). null otherwise.
- origin_lat/lon, destination_lat/lon: approximate centre coordinates for the named city. null if unsure.
- Normalize informal names: "Schiphol"->"Amsterdam", "Big Apple"->"New York, New York", "Red Sea"->"Hurghada", "Scottish Highlands"->"Inverness", "French Riviera"->"Nice", "Riviera Maya"->"Cancun", "the Alps"->"Geneva", "Maldives"->"Male", "Canaries"->"Las Palmas de Gran Canaria".
- Translate non-English city names to English AND undo grammatical case/declension: "München"->"Munich", "Moskva"->"Moscow", "Tokjo"->"Tokyo", "Soulu"/"Seul"->"Seoul", "Warszawy"/"Warszawie"->"Warsaw", "Barcelony"->"Barcelona", "Guatemali"->"Guatemala City", "Lizbony"->"Lisbon", "Paryża"/"Paryżu"->"Paris", "Londynu"->"London", "Madrytu"->"Madrid", "Nowego Jorku"->"New York". Apply un-declension to any Slavic/Romance/Greek/Arabic genitive or locative form.

PASSENGER RULES — count ALL travellers mentioned, including the speaker:
- "me and my girlfriend/boyfriend/partner/wife/husband" = 2
- "me and my friend/buddy/mate" = 2
- "as a couple" / "just the two of us" / "we two" = 2
- "me and 2 friends" / "3 of us" = 3
- "family of 4" / "4 people" / "4 adults" = 4
- "solo" / "just me" / "alone" = 1
- Number words: "two"->"2", "three"->"3", "four"->"4", "five"->"5"
- null if no mention of travellers

INTENT RULES:
- cabin_class: "economy" for economy/coach, "premium_economy" for premium economy, "business" for business/business class, "first" for first class. null if not mentioned.
- direct_only: true only if user says "direct", "non-stop", "no stops", "no layovers". null otherwise.
- sort_by: "price" if user wants cheapest/lowest price/budget; "duration" if user wants fastest/shortest flight. null if not clear.
- depart_after: earliest acceptable departure as "HH:MM" 24 h. "morning" -> "06:00", "afternoon" -> "12:00", "evening" -> "18:00". null if not stated.
- depart_before: latest acceptable departure as "HH:MM" 24 h. "before noon" -> "12:00", "morning flight" -> "10:00". null if not stated.
- bags_included: true if user mentions "with bags/luggage/baggage included". null otherwise.
- trip_purposes: include ALL applicable purposes, ordered strongest/most explicit first, then by mention order. "beach holiday/beach break/sun holiday/coast" -> "beach"; "city break/city trip/sightseeing" -> "city_break"; "ski/snowboard" -> "ski"; "business/conference/meeting" -> "business"; "honeymoon/anniversary" -> "honeymoon"; "family holiday/kids" -> "family_holiday"; "graduation/commencement/graduation trip" -> "graduation"; "concert/festival/event" -> "concert_festival"; "match/game/race/tournament" -> "sports_event"; "spring break/students' trip" -> "spring_break". null if unclear.
- trip_purpose: the single primary purpose. Must equal the first element of trip_purposes, or null if trip_purposes is null/empty.
- dep_time_pref: outbound departure time preference. "early morning/dawn/first flight/6am" -> "early_morning"; "morning flight/morning out" -> "morning"; "afternoon/midday" -> "afternoon"; "evening/evening out/evening flight/night out" -> "evening"; "red eye/overnight" -> "red_eye". null if not stated. NOTE: "Friday evening out" means outbound (dep_time_pref="evening"), "Sunday night back" means return (ret_time_pref="evening").
- ret_time_pref: return departure time preference. Same buckets as dep_time_pref. Phrases like "Sunday night back", "evening return", "fly back in the morning" set this. null if not stated or not a round-trip.
- passenger_context: "solo" if travelling alone; "couple" if two romantic partners (girlfriend/boyfriend/wife/husband/partner); "family" if travelling with children/kids; "group" if travelling with friends/colleagues/team (3+); "business_traveler" if explicit business trip context. null if unclear.

DATE RULES (today's date is given at the start of the user message):
- departure_date: outbound date, YYYY-MM-DD. Resolve relative expressions using today: "next month" → first day of next month; "next friday" → nearest future Friday; "in 2 weeks" → today + 14 days; "May 20th" / "the 20th" → nearest future occurrence. null if no date is mentioned at all.
- return_date: return date, YYYY-MM-DD. Set when: an explicit return date is given; OR "round trip for N days/nights" → departure_date + N days; OR "for N days" in a round-trip context → departure_date + N days. null for clear one-way queries or when undeterminable.
- is_round_trip: true when user says "round trip", "return flight", "return on [date]", "coming back", "there and back", or gives both outbound and return dates. false for "one way" / "one-way". null if not stated.

Few-shot examples:
Input: "London to Guatemala next week, 20th May, me and my girlfriend, round trip for 5 days, beach holiday, short flight and cheapest price"
Output: {"origin_city":"London","destination_city":"Guatemala City","via_city":null,"origin_lat":51.5,"origin_lon":-0.1,"destination_lat":14.6,"destination_lon":-90.5,"passengers":2,"cabin_class":null,"direct_only":null,"sort_by":"price","depart_after":null,"depart_before":null,"bags_included":null,"trip_purposes":["beach"],"trip_purpose":"beach"}

Input: "Warsaw to Barcelona, just the two of us, honeymoon, departure before 10am"
Output: {"origin_city":"Warsaw","destination_city":"Barcelona","via_city":null,"origin_lat":52.2,"origin_lon":21.0,"destination_lat":41.4,"destination_lon":2.2,"passengers":2,"cabin_class":null,"direct_only":null,"sort_by":null,"depart_after":null,"depart_before":"10:00","bags_included":null,"trip_purposes":["honeymoon"],"trip_purpose":"honeymoon"}

Input: "London Copenhagen, 3 friends, departure after 10 am"
Output: {"origin_city":"London","destination_city":"Copenhagen","via_city":null,"origin_lat":51.5,"origin_lon":-0.1,"destination_lat":55.7,"destination_lon":12.6,"passengers":3,"cabin_class":null,"direct_only":null,"sort_by":null,"depart_after":"10:00","depart_before":null,"bags_included":null,"trip_purpose":null}

Input: "BCN to NYC via LHR next friday business class"
Output: {"origin_city":"Barcelona","destination_city":"New York, New York","via_city":"London","origin_lat":41.4,"origin_lon":2.2,"destination_lat":40.7,"destination_lon":-74.0,"passengers":null,"cabin_class":"business","direct_only":null,"sort_by":null,"depart_after":null,"depart_before":null,"bags_included":null,"trip_purpose":null}

Input: "Brasilia to Pretoria as a couple, beach holiday, direct flights only"
Output: {"origin_city":"Brasilia","destination_city":"Pretoria","via_city":null,"origin_lat":-15.8,"origin_lon":-47.9,"destination_lat":-25.7,"destination_lon":28.2,"passengers":2,"cabin_class":null,"direct_only":true,"sort_by":null,"depart_after":null,"depart_before":null,"bags_included":null,"trip_purpose":"beach"}

Input: "gdansk to riga august 17 for 4 days round trip direct only trip with friends"
Output: {"origin_city":"Gdansk","destination_city":"Riga","via_city":null,"origin_lat":54.4,"origin_lon":18.6,"destination_lat":56.9,"destination_lon":24.1,"passengers":null,"cabin_class":null,"direct_only":true,"sort_by":null,"depart_after":null,"depart_before":null,"bags_included":null,"trip_purpose":null}

Input: "fort myers florida to crosse wisconsin june 12 family of 4"
Output: {"origin_city":"Fort Myers, Florida","destination_city":"La Crosse, Wisconsin","via_city":null,"origin_lat":26.6,"origin_lon":-81.9,"destination_lat":43.8,"destination_lon":-91.2,"passengers":4,"cabin_class":null,"direct_only":null,"sort_by":null,"depart_after":null,"depart_before":null,"bags_included":null,"trip_purpose":"family_holiday"}

Input: "z Krakowa do Guatemali w czerwcu"
Output: {"origin_city":"Krakow","destination_city":"Guatemala City","via_city":null,"origin_lat":50.1,"origin_lon":19.9,"destination_lat":14.6,"destination_lon":-90.5,"passengers":null,"cabin_class":null,"direct_only":null,"sort_by":null,"depart_after":null,"depart_before":null,"bags_included":null,"trip_purpose":null}

Input: "Warsaw Paris next month, as a couple, round trip, city break, cheapest option, good departure times"
Output: {"origin_city":"Warsaw","destination_city":"Paris","via_city":null,"origin_lat":52.2,"origin_lon":21.0,"destination_lat":48.9,"destination_lon":2.3,"passengers":2,"cabin_class":null,"direct_only":null,"sort_by":"price","depart_after":"08:00","depart_before":"20:00","bags_included":null,"trip_purposes":["city_break"],"trip_purpose":"city_break","dep_time_pref":"morning","ret_time_pref":null,"passenger_context":"couple"}

Input: "London to Barcelona this weekend, Friday evening out, Sunday night back, 2 adults, direct, trip for two"
Output: {"origin_city":"London","destination_city":"Barcelona","via_city":null,"origin_lat":51.5,"origin_lon":-0.1,"destination_lat":41.4,"destination_lon":2.2,"passengers":2,"cabin_class":null,"direct_only":true,"sort_by":null,"depart_after":null,"depart_before":null,"bags_included":null,"trip_purposes":["city_break"],"trip_purpose":"city_break","dep_time_pref":"evening","ret_time_pref":"evening","passenger_context":"couple"}

Input: "Tokyo to Berlin on May 24th, travelling solo, round trip for 7 days, beach holiday, city break, cheapest option, direct flights only"
Output: {"origin_city":"Tokyo","destination_city":"Berlin","via_city":null,"origin_lat":35.7,"origin_lon":139.7,"destination_lat":52.5,"destination_lon":13.4,"passengers":1,"cabin_class":null,"direct_only":true,"sort_by":"price","depart_after":null,"depart_before":null,"bags_included":null,"trip_purposes":["city_break","beach"],"trip_purpose":"city_break","dep_time_pref":null,"ret_time_pref":null,"passenger_context":"solo","is_round_trip":true,"departure_date":"2026-05-24","return_date":"2026-05-31"}`

// ── Main export ───────────────────────────────────────────────────────────────

export async function vertexParse(
  query: string,
  today: string,
): Promise<VertexCityResult | null> {
  const token = await getAccessToken()
  const geminiApiKey = process.env.GEMINI_API_KEY

  // Need at least one auth method
  if (!token && !geminiApiKey) return null

  // Prefer Vertex AI (Cloud Run), fall back to direct Gemini API key
  const url = token
    ? VERTEX_URL
    : `${GEMINI_DIRECT_URL}?key=${geminiApiKey}`
  const fetchHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) fetchHeaders['Authorization'] = `Bearer ${token}`

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: fetchHeaders,
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: SYSTEM_PROMPT }],
        },
        contents: [{ role: 'user', parts: [{ text: `Today is ${today}. Day of week: ${new Date(today + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })}.\n\n${query}` }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 700,
          responseMimeType: 'application/json',
        },
      }),
      signal: AbortSignal.timeout(5000),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      console.error(`[vertex-parse] HTTP ${res.status} url=${url} body=${errText.slice(0, 400)}`)
      return null
    }

    const data = await res.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    if (!text) return null

    return JSON.parse(text) as VertexCityResult
  } catch (e) {
    console.error('[vertex-parse] error:', e)
    return null
  }
}
