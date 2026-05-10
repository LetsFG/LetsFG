// Server-only: parse NL flight queries via Vertex AI Gemini.
// Returns null on any failure — callers must fall back to the regex parser.

export interface VertexParseResult {
  // ── Locations ────────────────────────────────────────────────────────────────
  origin_city:        string | null   // English city name; include state/country if ambiguous
  destination_city:   string | null   // "ANYWHERE" for open-destination searches
  via_city:           string | null   // preferred stopover city (e.g. "Dubai")

  // ── Dates ────────────────────────────────────────────────────────────────────
  date:               string | null   // YYYY-MM-DD departure
  return_date:        string | null   // YYYY-MM-DD return (null = one-way)
  date_month_only:    boolean         // true when user said "in June" with no specific day
  find_best_window:   boolean         // "cheapest week in August", "best window in July"
  date_window_month:  number | null   // 1–12 month for best-window search
  date_window_year:   number | null   // year for best-window search
  min_trip_days:      number | null   // "for 2 weeks", "14–18 day trip" — min duration
  max_trip_days:      number | null   // upper bound of trip duration range

  // ── Passengers ───────────────────────────────────────────────────────────────
  adults:             number          // ≥16 — default 1
  children:           number          // age 2–15 — default 0
  infants:            number          // age <2, lap — default 0
  context:            'family' | 'business' | 'couple' | 'solo' | null

  // ── Flight preferences ───────────────────────────────────────────────────────
  cabin:              'economy' | 'business' | 'first' | 'premium_economy' | null
  direct_only:        boolean         // "nonstop", "no stops", "direct"
  max_stops:          number | null   // e.g. "max 1 stop" → 1; null = no constraint
  preferred_airline:  string | null   // "on Ryanair", "with BA" — lowercase airline name
  excluded_airline:   string | null   // "not EasyJet", "avoid Wizz"

  // ── Price ────────────────────────────────────────────────────────────────────
  max_price:          number | null   // "under €150", "max $300"

  // ── Time-of-day preferences ──────────────────────────────────────────────────
  depart_time_pref:        'early_morning' | 'morning' | 'afternoon' | 'evening' | 'red_eye' | null
  return_depart_time_pref: 'early_morning' | 'morning' | 'afternoon' | 'evening' | 'red_eye' | null

  // ── Ancillaries ──────────────────────────────────────────────────────────────
  require_checked_baggage: boolean    // "with bags", "hold luggage included"
  carry_on_only:           boolean    // "hand luggage only", "cabin bag only"
  require_meals:           boolean    // "with meals", "including food"
  require_cancellation:    boolean    // "refundable", "free cancellation"
  require_lounge:          boolean    // "with lounge access"

  // ── Seat ─────────────────────────────────────────────────────────────────────
  seat_pref:          'window' | 'aisle' | 'extra_legroom' | null

  // ── Trip purpose ─────────────────────────────────────────────────────────────
  trip_purpose:       'honeymoon' | 'business' | 'ski' | 'beach' | 'city_break' | 'family_holiday' | 'graduation' | 'concert_festival' | 'sports_event' | 'spring_break' | null

  // ── Urgency ──────────────────────────────────────────────────────────────────
  urgency:            'last_minute' | 'asap' | null

  // ── Clarification ────────────────────────────────────────────────────────────
  follow_up_questions: string[]       // 0–2 short questions when answer improves matching
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

const SYSTEM_PROMPT = `You are a flight search query parser. Extract ALL flight details from natural language in ANY language.
Return ONLY valid JSON matching this schema exactly (no markdown, no explanation):
{
  "origin_city": "English city name; include state/country if ambiguous (e.g. 'Portland, Oregon') — null if unclear",
  "destination_city": "English city name — use ANYWHERE for open-destination queries — null if unclear",
  "via_city": "preferred stopover city or null",
  "date": "YYYY-MM-DD departure or null",
  "return_date": "YYYY-MM-DD return date or null (null = one-way)",
  "date_month_only": false,
  "find_best_window": false,
  "date_window_month": null,
  "date_window_year": null,
  "min_trip_days": null,
  "max_trip_days": null,
  "adults": 1,
  "children": 0,
  "infants": 0,
  "context": "family|business|couple|solo or null",
  "cabin": "economy|business|first|premium_economy or null",
  "direct_only": false,
  "max_stops": null,
  "preferred_airline": null,
  "excluded_airline": null,
  "max_price": null,
  "depart_time_pref": "early_morning|morning|afternoon|evening|red_eye or null",
  "return_depart_time_pref": "early_morning|morning|afternoon|evening|red_eye or null",
  "require_checked_baggage": false,
  "carry_on_only": false,
  "require_meals": false,
  "require_cancellation": false,
  "require_lounge": false,
  "seat_pref": "window|aisle|extra_legroom or null",
  "trip_purpose": "honeymoon|business|ski|beach|city_break|family_holiday|graduation|concert_festival|sports_event|spring_break or null",
  "urgency": "last_minute|asap or null",
  "follow_up_questions": []
}
Rules:
- Normalize informal city/region names to the nearest airport city: "Schiphol"→"Amsterdam", "the Big Apple"→"New York, New York", "Red Sea"→"Hurghada", "Scottish Highlands"→"Inverness", "French Riviera"→"Nice".
- Resolve relative dates from today's date: "next Friday", "this weekend", "in 3 weeks" → YYYY-MM-DD.
- "in June" (no day) → date_month_only:true, date:"2026-06-01" (first of that month).
- "cheapest week in August", "best time in July" → find_best_window:true, date_window_month:<month number>, date_window_year:<year>, date:null.
- Return trip: "return May 29", "back on the 29th", "May 25–29" → set return_date. "round trip for 4 days" or "for 4 nights, return" → BOTH set return_date = departure + 4 days AND min_trip_days = max_trip_days = 4. If only duration given with no round-trip signal → min_trip_days AND max_trip_days = 4, return_date = null.
- CRITICAL: Trip duration numbers (days/nights) NEVER set the passenger count. "4 days" means trip duration, NOT 4 passengers. Keep these completely separate.
- Passengers: "family of 4"→adults:2,children:2. "couple"→adults:2,context:couple. "solo/alone/just me"→adults:1,context:solo. "with a baby"→infants:1. "and my kid"→children:1. "trip with friends/mates/colleagues/buddies" without a number → adults:2. "me and 2 friends"→adults:3.
- direct_only: true for "nonstop", "direct", "no stops". max_stops: integer when "max 1 stop", "up to 2 connections".
- max_price: extract number in local currency as-is (e.g. "under €200" → 200, "less than $300" → 300).
- depart_time_pref: "early morning/red-eye"→early_morning, "morning"→morning, "afternoon"→afternoon, "evening/night"→evening.
- require_checked_baggage: true for "with bags", "hold luggage included", "checked bag".
- carry_on_only: true for "hand luggage only", "cabin bag only", "no hold baggage".
- preferred_airline: airline name lowercase (e.g. "ryanair", "british airways"). excluded_airline similarly.
- trip_purpose: infer from keywords — "honeymoon"→honeymoon, "ski trip"→ski, "beach holiday"→beach, "city break"→city_break, "graduation"→graduation, "festival/concert"→concert_festival.
- urgency: "ASAP", "urgent", "tomorrow" (with no specific date) → asap. "last minute" → last_minute.
- follow_up_questions: 0–2 short questions ONLY when critical info is missing and would materially change results.
Few-shot examples:
Input: "gdansk to riga august 17 for 4 days round trip direct only trip with friends"
Output: {"origin_city":"Gdansk","destination_city":"Riga","via_city":null,"date":"2026-08-17","return_date":"2026-08-21","date_month_only":false,"find_best_window":false,"date_window_month":null,"date_window_year":null,"min_trip_days":4,"max_trip_days":4,"adults":2,"children":0,"infants":0,"context":"solo","cabin":null,"direct_only":true,"max_stops":0,"preferred_airline":null,"excluded_airline":null,"max_price":null,"depart_time_pref":null,"return_depart_time_pref":null,"require_checked_baggage":false,"carry_on_only":false,"require_meals":false,"require_cancellation":false,"require_lounge":false,"seat_pref":null,"trip_purpose":"city_break","urgency":null,"follow_up_questions":[]}
Input: "jeddah to red sea may 25 return may 29 direct"
Output: {"origin_city":"Jeddah","destination_city":"Hurghada","via_city":null,"date":"2026-05-25","return_date":"2026-05-29","date_month_only":false,"find_best_window":false,"date_window_month":null,"date_window_year":null,"min_trip_days":null,"max_trip_days":null,"adults":1,"children":0,"infants":0,"context":null,"cabin":null,"direct_only":true,"max_stops":0,"preferred_airline":null,"excluded_airline":null,"max_price":null,"depart_time_pref":null,"return_depart_time_pref":null,"require_checked_baggage":false,"carry_on_only":false,"require_meals":false,"require_cancellation":false,"require_lounge":false,"seat_pref":null,"trip_purpose":"beach","urgency":null,"follow_up_questions":[]}
Input: "fort myers florida to crosse wisconsin june 12 family of 4"
Output: {"origin_city":"Fort Myers, Florida","destination_city":"La Crosse, Wisconsin","via_city":null,"date":"2026-06-12","return_date":null,"date_month_only":false,"find_best_window":false,"date_window_month":null,"date_window_year":null,"min_trip_days":null,"max_trip_days":null,"adults":2,"children":2,"infants":0,"context":"family","cabin":null,"direct_only":false,"max_stops":null,"preferred_airline":null,"excluded_airline":null,"max_price":null,"depart_time_pref":null,"return_depart_time_pref":null,"require_checked_baggage":false,"carry_on_only":false,"require_meals":false,"require_cancellation":false,"require_lounge":false,"seat_pref":null,"trip_purpose":"family_holiday","urgency":null,"follow_up_questions":[]}
Input: "london to anywhere cheapest week in august under 150 euros economy no bags"
Output: {"origin_city":"London","destination_city":"ANYWHERE","via_city":null,"date":null,"return_date":null,"date_month_only":false,"find_best_window":true,"date_window_month":8,"date_window_year":2026,"min_trip_days":null,"max_trip_days":null,"adults":1,"children":0,"infants":0,"context":null,"cabin":"economy","direct_only":false,"max_stops":null,"preferred_airline":null,"excluded_airline":null,"max_price":150,"depart_time_pref":null,"return_depart_time_pref":null,"require_checked_baggage":false,"carry_on_only":true,"require_meals":false,"require_cancellation":false,"require_lounge":false,"seat_pref":null,"trip_purpose":null,"urgency":null,"follow_up_questions":[]}
Input: "東京からロンドンへ来月ビジネスクラス"
Output: {"origin_city":"Tokyo","destination_city":"London","via_city":null,"date":"2026-06-01","return_date":null,"date_month_only":true,"find_best_window":false,"date_window_month":null,"date_window_year":null,"min_trip_days":null,"max_trip_days":null,"adults":1,"children":0,"infants":0,"context":"business","cabin":"business","direct_only":false,"max_stops":null,"preferred_airline":null,"excluded_airline":null,"max_price":null,"depart_time_pref":null,"return_depart_time_pref":null,"require_checked_baggage":false,"carry_on_only":false,"require_meals":false,"require_cancellation":false,"require_lounge":false,"seat_pref":null,"trip_purpose":"business","urgency":null,"follow_up_questions":[]}`

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
          maxOutputTokens: 700,
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
