import { NextRequest, NextResponse } from 'next/server'
import { execSync } from 'child_process'

// ── Auth (same pattern as rank/route.ts) ─────────────────────────────────
let _cachedToken: string | null = null
let _tokenExpiresAt = 0

async function getGcpAccessToken(): Promise<string | null> {
  if (_cachedToken && Date.now() < _tokenExpiresAt - 60_000) return _cachedToken
  try {
    const r = await fetch(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
      { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(1_500) },
    )
    if (r.ok) {
      const j = await r.json() as { access_token?: string; expires_in?: number }
      if (j.access_token) {
        _cachedToken = j.access_token
        _tokenExpiresAt = Date.now() + (j.expires_in ?? 3600) * 1000
        return _cachedToken
      }
    }
  } catch { /* not on GCP */ }
  try {
    const token = execSync('gcloud auth print-access-token --quiet', {
      timeout: 5_000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (token.startsWith('ya29.')) {
      _cachedToken = token
      _tokenExpiresAt = Date.now() + 55 * 60 * 1000
      return _cachedToken
    }
  } catch { /* not available */ }
  return null
}

// ── Types ─────────────────────────────────────────────────────────────────
type TimePref = 'early_morning' | 'morning' | 'afternoon' | 'evening' | 'red_eye'
type TripPurpose = 'honeymoon' | 'business' | 'ski' | 'beach' | 'city_break' | 'family_holiday'
type PassengerContext = 'solo' | 'couple' | 'family' | 'group' | 'business_traveler'

export interface RankPrefs {
  depTimePref?: TimePref
  retTimePref?: TimePref
  tripPurpose?: TripPurpose
  passengerContext?: PassengerContext
  preferDirect?: boolean
  preferCheapest?: boolean
  preferQuickFlight?: boolean
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
}

// ── Route handler ─────────────────────────────────────────────────────────
// POST /api/rank-prefs
// Body: { query: string }
// Returns: RankPrefs — a small JSON of ranking preferences extracted from the NL query.
// Gemini handles colloquial phrases like "Friday evening out" / "Sunday night back"
// that the regex parser in searchParsing.ts cannot reliably match.
export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { query?: string }
  try {
    body = await req.json() as { query?: string }
  } catch {
    return NextResponse.json({})
  }

  const query = (body.query ?? '').trim()
  if (!query) return NextResponse.json({})

  const gcpToken = await getGcpAccessToken()
  const geminiApiKey = process.env.GEMINI_API_KEY

  // If no auth available, return empty — the regex parser will be the fallback
  if (!gcpToken && !geminiApiKey) {
    return NextResponse.json({})
  }

  const prompt = `Extract flight ranking preferences from this travel search query. Return ONLY a JSON object with these optional fields (include only those you are confident about):

- "depTimePref": outbound departure time — one of: "early_morning" (before 6am or "first flight"), "morning" (6am–noon), "afternoon" (noon–6pm), "evening" (6pm–10pm), "red_eye" (after 10pm / overnight)
- "retTimePref": return/inbound departure time — same options as depTimePref
- "tripPurpose": one of: "city_break", "beach", "ski", "business", "honeymoon", "family_holiday"
- "passengerContext": one of: "solo", "couple", "family", "group", "business_traveler"
- "preferDirect": true if user explicitly wants non-stop/direct flights only
- "preferCheapest": true if user explicitly prioritises cheapest price above all
- "preferQuickFlight": true if user explicitly prioritises shortest journey time

Examples of how to interpret colloquial phrases:
- "Friday evening out" → depTimePref: "evening"
- "Sunday night back" → retTimePref: "evening"
- "fly back Sunday evening" → retTimePref: "evening"
- "night flight back" / "late flight home" → retTimePref: "red_eye"
- "early morning flight out" / "first flight Friday" → depTimePref: "early_morning"
- "afternoon departure" → depTimePref: "afternoon"
- "trip for two" / "romantic getaway" / "couple" → passengerContext: "couple"
- "honeymoon" → tripPurpose: "honeymoon", passengerContext: "couple"
- "family holiday" / "kids" → tripPurpose: "family_holiday", passengerContext: "family"
- "direct" / "non-stop" / "no layovers" → preferDirect: true
- "cheapest" / "budget" / "lowest price" → preferCheapest: true
- "quickest" / "fastest" / "shortest" → preferQuickFlight: true
- "ski trip" / "skiing" → tripPurpose: "ski"
- "beach" / "sun holiday" → tripPurpose: "beach"
- "business trip" / "work travel" → tripPurpose: "business", passengerContext: "business_traveler"

Return only a JSON object. No markdown, no explanation.

Query: "${query.replace(/"/g, '\\"')}"`

  const url = gcpToken
    ? 'https://aiplatform.googleapis.com/v1/projects/sms-caller/locations/global/publishers/google/models/gemini-2.5-flash-lite:generateContent'
    : `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${geminiApiKey}`

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (gcpToken) headers['Authorization'] = `Bearer ${gcpToken}`

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 300, temperature: 0 },
      }),
      signal: AbortSignal.timeout(8_000),
    })

    if (!resp.ok) return NextResponse.json({})

    const data = await resp.json() as GeminiResponse
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''

    const jsonMatch = rawText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return NextResponse.json({})

    const result = JSON.parse(jsonMatch[0]) as RankPrefs

    // Sanitise: only return known valid enum values
    const validTimePref = new Set<string>(['early_morning', 'morning', 'afternoon', 'evening', 'red_eye'])
    const validPurpose = new Set<string>(['honeymoon', 'business', 'ski', 'beach', 'city_break', 'family_holiday'])
    const validPax = new Set<string>(['solo', 'couple', 'family', 'group', 'business_traveler'])

    const safe: RankPrefs = {}
    if (result.depTimePref && validTimePref.has(result.depTimePref)) safe.depTimePref = result.depTimePref
    if (result.retTimePref && validTimePref.has(result.retTimePref)) safe.retTimePref = result.retTimePref
    if (result.tripPurpose && validPurpose.has(result.tripPurpose)) safe.tripPurpose = result.tripPurpose
    if (result.passengerContext && validPax.has(result.passengerContext)) safe.passengerContext = result.passengerContext
    if (result.preferDirect === true) safe.preferDirect = true
    if (result.preferCheapest === true) safe.preferCheapest = true
    if (result.preferQuickFlight === true) safe.preferQuickFlight = true

    return NextResponse.json(safe)
  } catch {
    return NextResponse.json({})
  }
}
