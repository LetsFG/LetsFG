// Server-only: resolve city/location names from NL flight queries via Vertex AI Gemini.
// Only handles location normalization — all other fields (dates, passengers, etc.)
// are handled by the regex parser in searchParsing.ts.
// Returns null on any failure.

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
  /** Trip purpose inferred from context. null if unclear. */
  trip_purpose?:    'city_break' | 'beach' | 'ski' | 'business' | 'honeymoon' | 'family_holiday' | 'concert_festival' | 'sports_event' | null
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

const SYSTEM_PROMPT = `You are a flight location resolver. Your ONLY job is to identify the origin city, destination city, and optional stopover city from a flight search query — in any language.
Return ONLY valid JSON with exactly these three fields (no markdown, no explanation):
{"origin_city": "...", "destination_city": "...", "via_city": ...}

Rules:
- origin_city: English city name. Include state/country if ambiguous (e.g. "Portland, Oregon"). null if not found.
- destination_city: English city name. "ANYWHERE" for open-destination queries ("to anywhere", "wherever is cheapest"). null if not found.
- via_city: preferred stopover city if explicitly mentioned ("via Dubai", "through Hong Kong"). null otherwise.
- Normalize informal names to the nearest airport city: "Schiphol"->"Amsterdam", "Big Apple"->"New York, New York", "Red Sea"->"Hurghada", "Scottish Highlands"->"Inverness", "French Riviera"->"Nice", "Riviera Maya"->"Cancun", "the Alps"->"Geneva", "Maldives"->"Male".
- Translate non-English city names to English AND undo any grammatical case/declension before translating: "München"->"Munich", "Moskva"->"Moscow", "Tokjo"/"Tokio"->"Tokyo", "Soulu"/"Seulu"/"Seul"->"Seoul", "Warszawy"/"Warszawie"->"Warsaw", "Barcelony"/"Barcelonie"->"Barcelona", "Guatemali"->"Guatemala City", "Guadalahary"/"Gwadalahary"->"Guadalajara", "Lizbony"->"Lisbon", "Paryża"/"Paryżu"->"Paris", "Londynu"/"Londynie"->"London", "Madrytu"/"Madrycie"->"Madrid", "Rzymu"/"Rzymie"->"Rome", "Berlina"/"Berlinie"->"Berlin", "Stambułu"/"Stambule"->"Istanbul", "Kairu"/"Kairze"->"Cairo", "Pekinu"/"Pekinie"->"Beijing", "Szanghaju"->"Shanghai", "Bangkoku"->"Bangkok", "Nowego Jorku"/"Nowym Jorku"->"New York". Apply the same un-declension to ANY Slavic, Romance, Greek or Arabic genitive/locative form: strip the case ending and translate the bare name.
- IGNORE everything else: dates, passengers, cabin class, stops, price. Only extract cities.
Few-shot examples:
Input: "gdansk to riga august 17 for 4 days round trip direct only trip with friends"
Output: {"origin_city":"Gdansk","destination_city":"Riga","via_city":null}
Input: "jeddah to red sea may 25 return may 29 direct"
Output: {"origin_city":"Jeddah","destination_city":"Hurghada","via_city":null}
Input: "fort myers florida to crosse wisconsin june 12 family of 4"
Output: {"origin_city":"Fort Myers, Florida","destination_city":"La Crosse, Wisconsin","via_city":null}
Input: "london to anywhere cheapest week in august under 150 euros"
Output: {"origin_city":"London","destination_city":"ANYWHERE","via_city":null}
Input: "Tokyo to London next month business class"
Output: {"origin_city":"Tokyo","destination_city":"London","via_city":null}
Input: "BCN to NYC via LHR next friday business class"
Output: {"origin_city":"Barcelona","destination_city":"New York, New York","via_city":"London"}
Input: "Warszawa do Soulu 13 czerwca solo one way"
Output: {"origin_city":"Warsaw","destination_city":"Seoul","via_city":null}
Input: "z Krakowa do Guatemali w czerwcu"
Output: {"origin_city":"Krakow","destination_city":"Guatemala City","via_city":null}
Input: "do Barcelony z Warszawy 18 lipca"
Output: {"origin_city":"Warsaw","destination_city":"Barcelona","via_city":null}`

// ── Main export ───────────────────────────────────────────────────────────────

export async function vertexParse(
  query: string,
  _today: string,   // kept for API compatibility — not needed for city-only parsing
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
        contents: [{ role: 'user', parts: [{ text: query }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 450,
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
