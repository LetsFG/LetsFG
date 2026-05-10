// Server-only: resolve city/location names from NL flight queries via Vertex AI Gemini.
// Only handles location normalization — all other fields (dates, passengers, etc.)
// are handled by the regex parser in searchParsing.ts.
// Returns null on any failure.

export interface VertexCityResult {
  origin_city:      string | null  // English city name; include state/country if ambiguous
  destination_city: string | null  // "ANYWHERE" for open-destination searches; null if unclear
  via_city:         string | null  // preferred stopover city or null
}

// Keep old name as alias so callers importing VertexParseResult still compile
export type VertexParseResult = VertexCityResult

// ── Vertex AI config ──────────────────────────────────────────────────────────

const VERTEX_PROJECT = 'sms-caller'
const VERTEX_MODEL   = 'gemini-2.5-flash-lite'
const VERTEX_URL     =
  `https://aiplatform.googleapis.com/v1/projects/${VERTEX_PROJECT}/locations/global` +
  `/publishers/google/models/${VERTEX_MODEL}:generateContent`

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
- Translate non-English city names to English: "München"->"Munich", "Moskva"->"Moscow", "Tokyou"->"Tokyo".
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
Output: {"origin_city":"Barcelona","destination_city":"New York, New York","via_city":"London"}`

// ── Main export ───────────────────────────────────────────────────────────────

export async function vertexParse(
  query: string,
  _today: string,   // kept for API compatibility — not needed for city-only parsing
): Promise<VertexCityResult | null> {
  const token = await getAccessToken()
  if (!token) return null   // local dev or metadata server unreachable

  try {
    const res = await fetch(VERTEX_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: SYSTEM_PROMPT }],
        },
        contents: [{ role: 'user', parts: [{ text: query }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 100,
          responseMimeType: 'application/json',
        },
      }),
      signal: AbortSignal.timeout(5000),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      console.error(`[vertex-parse] HTTP ${res.status}:`, errText.slice(0, 200))
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
