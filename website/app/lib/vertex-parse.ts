// Server-only: parse NL flight queries via Vertex AI Gemini.
// Returns null on any failure — callers must fall back to the regex parser.

export interface VertexParseResult {
  origin_city:       string | null   // English city name, state/country included if needed
  destination_city:  string | null   // "ANYWHERE" for open-destination searches
  date:              string | null   // YYYY-MM-DD
  ambiguous_date: {
    a_date:  string   // YYYY-MM-DD
    b_date:  string   // YYYY-MM-DD
    a_label: string   // "October 12"
    b_label: string   // "12 October"
  } | null
  return_date:       string | null   // YYYY-MM-DD
  adults:            number
  children:          number
  cabin:             'economy' | 'business' | 'first' | 'premium_economy' | null
  direct_only:       boolean
  context:           'family' | 'business' | 'couple' | 'solo' | null
  follow_up_questions: string[]
}

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

const SYSTEM_PROMPT = `You are a flight search query parser. Extract flight details from natural language in ANY language.
Return ONLY valid JSON (no markdown, no explanation):
{
  "origin_city": "English city name; include state/country if ambiguous (e.g. 'Portland, Oregon')",
  "destination_city": "English city name; use ANYWHERE for open-destination",
  "date": "YYYY-MM-DD or null",
  "ambiguous_date": {"a_date":"YYYY-MM-DD","b_date":"YYYY-MM-DD","a_label":"Month D","b_label":"D Month"} or null,
  "return_date": "YYYY-MM-DD or null",
  "adults": 1,
  "children": 0,
  "cabin": "economy|business|first|premium_economy or null",
  "direct_only": false,
  "context": "family|business|couple|solo or null",
  "follow_up_questions": []
}
Rules:
- Normalize partial/informal city names: "Crosse, Wisconsin"→"La Crosse, Wisconsin"; "Schiphol"→"Amsterdam"; "the Big Apple"→"New York, New York".
- ambiguous_date: only when BOTH parts ≤ 12, e.g. "10/12" — set both interpretations. Otherwise pick the only valid parse.
- Dates without year: resolve to next occurrence from today.
- Relative dates (next Friday, in June, next weekend): resolve to YYYY-MM-DD.
- follow_up_questions: 0–2 short questions when the answer would improve matching. E.g. "Business or leisure?".
- "family of 4"→adults:2,children:2. "couple"→adults:2. "solo"/"alone"/"just me"→adults:1,context:solo.
- If origin/destination is clear from context but casually phrased ("flies from the city"=context-dependent), return null for that field rather than guessing.
Few-shot examples:
Input: "fort myers florida to crosse wisconsin june 12 family of 4"
Output: {"origin_city":"Fort Myers, Florida","destination_city":"La Crosse, Wisconsin","date":"2026-06-12","ambiguous_date":null,"return_date":null,"adults":2,"children":2,"cabin":null,"direct_only":false,"context":"family","follow_up_questions":[]}
Input: "london to barcelona 10/12"
Output: {"origin_city":"London","destination_city":"Barcelona","date":null,"ambiguous_date":{"a_date":"2026-10-12","b_date":"2026-12-10","a_label":"October 12","b_label":"10 December"},"return_date":null,"adults":1,"children":0,"cabin":null,"direct_only":false,"context":null,"follow_up_questions":["Business or leisure?"]}
Input: "東京からロンドンへ来月ビジネスクラス"
Output: {"origin_city":"Tokyo","destination_city":"London","date":"2026-06-01","ambiguous_date":null,"return_date":null,"adults":1,"children":0,"cabin":"business","direct_only":false,"context":"business","follow_up_questions":[]}`

// ── Main export ───────────────────────────────────────────────────────────────

export async function vertexParse(
  query: string,
  today: string,    // YYYY-MM-DD
): Promise<VertexParseResult | null> {
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
          parts: [{ text: `${SYSTEM_PROMPT}\nToday: ${today}` }],
        },
        contents: [{ role: 'user', parts: [{ text: query }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 300,
          responseMimeType: 'application/json',
        },
      }),
      signal: AbortSignal.timeout(7000),
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

    return JSON.parse(text) as VertexParseResult
  } catch (e) {
    console.error('[vertex-parse] error:', e)
    return null
  }
}
