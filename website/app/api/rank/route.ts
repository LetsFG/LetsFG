import { NextRequest, NextResponse } from 'next/server'
import type { RankedOffer, RankOffer, RankingContext } from '../../lib/rankOffers'

// ── Request / response types ──────────────────────────────────────────────
interface RankedOfferPayload {
  offer: RankOffer
  score: number
  breakdown: RankedOffer['breakdown']
  heroFacts: string[]
  tradeoffs: string[]
}

interface RankRequestBody {
  topOffers: RankedOfferPayload[]
  rawQuery: string
  context: RankingContext
  /** 'early' = still searching (first gen), 'mid' = ~90% done, 'final' = search complete */
  phase?: 'early' | 'mid' | 'final'
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>
    }
  }>
}

import { execSync } from 'child_process'

// ── Auth helpers ──────────────────────────────────────────────────────────

/** Try to get a GCP access token from the Cloud Run metadata server. */
async function getGcpAccessToken(): Promise<string | null> {
  // 1. Cloud Run metadata server (production)
  try {
    const r = await fetch(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
      {
        headers: { 'Metadata-Flavor': 'Google' },
        signal: AbortSignal.timeout(1_500),
      },
    )
    if (r.ok) {
      const j = await r.json() as { access_token?: string }
      return j.access_token ?? null
    }
  } catch { /* not on GCP */ }

  // 2. Local dev: gcloud CLI application default credentials
  try {
    const token = execSync('gcloud auth print-access-token --quiet', {
      timeout: 5_000,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],  // suppress stderr cross-platform
    }).trim()
    if (token.startsWith('ya29.')) return token
  } catch { /* gcloud not available or not authed */ }

  return null
}

// ── Helpers ───────────────────────────────────────────────────────────────
function fmtMins(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  const h = d.getHours(), m = d.getMinutes()
  const ampm = h >= 12 ? 'pm' : 'am'
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${h12}:${m.toString().padStart(2, '0')}${ampm}`
}

function fmtDur(mins: number): string {
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

// Compute the total price Gemini should reference (matches what the card displays)
const GOOGLE_SOURCES = new Set(['serpapi_google', 'google_flights'])
const FEE_FLOOR: Record<string, number> = {
  USD: 3, EUR: 3, GBP: 2.55, AUD: 4.5, CAD: 4, CHF: 3,
  SEK: 30, NOK: 30, DKK: 20, PLN: 12, CZK: 70,
}
function offerTotal(price: number, currency: string, source?: string): number {
  if (source && GOOGLE_SOURCES.has(source)) return Math.round(price * 100) / 100
  const floor = FEE_FLOOR[currency.toUpperCase()] ?? 3
  return Math.round((price + Math.max(price * 0.01, floor)) * 100) / 100
}

// ── Allowed origins ─────────────────────────────────────────────────────
const ALLOWED_ORIGIN_RE = /^https:\/\/(www\.)?letsfg\.co$|^https:\/\/letsfg-website[\w-]*\.run\.app$|^http:\/\/localhost(:\d+)?$/

// ── Route handler ─────────────────────────────────────────────────────────
export async function POST(req: NextRequest): Promise<NextResponse> {
  // Block requests that don't originate from our own domains
  const origin = req.headers.get('origin') ?? ''
  if (!ALLOWED_ORIGIN_RE.test(origin)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // Resolve auth: Vertex AI (Cloud Run metadata) → GEMINI_API_KEY (local dev)
  const gcpToken = await getGcpAccessToken()
  const geminiApiKey = process.env.GEMINI_API_KEY

  if (!gcpToken && !geminiApiKey) {
    return NextResponse.json({ error: 'no_auth' }, { status: 503 })
  }

  let body: RankRequestBody
  try {
    body = await req.json() as RankRequestBody
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }

  const { rawQuery, context } = body
  const phase = body.phase ?? 'final'
  // Enforce max 3 offers server-side regardless of what the client sends
  const topOffers = (body.topOffers ?? []).slice(0, 3)
  if (!topOffers.length) {
    return NextResponse.json({ error: 'no_offers' }, { status: 400 })
  }

  const hero = topOffers[0]
  const runners = topOffers.slice(1, 3)   // top 3 total → 2 runner-ups
  const h = hero.offer

  // Mask airline names — Gemini must not reference specific carriers in its output
  const FLIGHT_LABELS = ['Flight 1', 'Flight 2', 'Flight 3']

  // Build a human-readable trip description from context signals
  const tripParts = [
    context.tripContext && context.tripContext !== 'solo' && context.tripContext !== 'group'
      ? context.tripContext.replace(/_/g, ' ')
      : '',
    context.tripPurpose ? context.tripPurpose.replace(/_/g, ' ') : '',
  ].filter(Boolean)
  const tripDesc = tripParts.length > 0 ? tripParts.join(' / ') : 'solo trip'

  const stopsLabel = h.stops === 0 ? 'direct' : h.stops === 1 ? '1 stop' : `${h.stops} stops`
  const hSource = (h as RankOffer & { source?: string }).source
  const hTotal = offerTotal(h.price, h.currency, hSource)
  const savingsLine = h.google_flights_price && h.google_flights_price > h.price + 8
    ? `\n- ${Math.round(h.google_flights_price - hTotal)} ${h.currency} cheaper than Google Flights`
    : ''
  const bagLine = h.ancillaries?.checked_bag?.included === true ? '\n- Checked bag included' : ''
  // Collect unique aircraft types from outbound segments (runtime data includes aircraft even if type doesn't)
  const heroAircraft = (h.segments as Array<{ aircraft?: string }> | undefined)
    ?.map(s => s.aircraft?.replace(/\s*\([^)]*\)/, '').trim())
    .filter((v): v is string => !!v)
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(' / ')
  const aircraftLine = heroAircraft ? `\n- Aircraft: ${heroAircraft}` : ''
  const prefs = [
    context.requireBag ? 'needs checked bag' : '',
    context.preferQuickFlight ? 'wants shortest possible flight time' : '',
    context.depTimePref ? `prefers ${context.depTimePref.replace(/_/g, ' ')} departure` : '',
    context.arrivalTimePref ? `prefers ${context.arrivalTimePref} arrival` : '',
  ].filter(Boolean).join(', ')

  const heroFactsText = hero.heroFacts.length > 0
    ? hero.heroFacts.map(f => `- ${f}`).join('\n')
    : '- No strong differentiating factors detected'

  const runnersText = runners.map((r, i) => {
    const ro = r.offer
    const roSource = (ro as RankOffer & { source?: string }).source
    const roTotal = offerTotal(ro.price, ro.currency, roSource)
    return (
      `${FLIGHT_LABELS[i + 1]}: ` +
      `${roTotal} ${ro.currency}, ` +
      `${ro.stops === 0 ? 'direct' : `${ro.stops} stop(s)`}, ` +
      `${fmtDur(ro.duration_minutes)}, ` +
      `departs ${fmtMins(ro.departure_time)} → arrives ${fmtMins(ro.arrival_time)} ` +
      `| tradeoffs: ${r.tradeoffs.join('; ') || 'none'} ` +
      `| positives: ${r.heroFacts.slice(0, 2).join('; ') || 'similar value'}`
    )
  }).join('\n')

  const prompt = `You are a decisive travel advisor. You've already made the call — now justify it. Write like a sharp, honest friend who knows flights, not like a helpdesk bot. Be specific. Use actual numbers and times from the data.

USER'S SEARCH: "${rawQuery}"
TRIP: ${tripDesc}${prefs ? ` | ${prefs}` : ''}

#1 RANKED FLIGHT (YOUR PICK):
- ${FLIGHT_LABELS[0]} | ${h.origin} → ${h.destination}
- Departs ${fmtMins(h.departure_time)}, arrives ${fmtMins(h.arrival_time)} | ${fmtDur(h.duration_minutes)} | ${stopsLabel}
- Price: ${hTotal} ${h.currency}${savingsLine}${bagLine}${aircraftLine}

REASONS IT RANKED FIRST (use these, don\'t invent others):
${heroFactsText}

CONTEXT: ${phase === 'early' ? 'Search is STILL RUNNING — more results are coming in. This is the best lead so far, not necessarily the final answer.' : phase === 'mid' ? 'Search is nearly done (~90% complete). This is very likely the final winner, but a few more results may still arrive.' : 'Search is COMPLETE. This is the definitive best flight. Be conclusive.'}

TASK 1 — Write a short TITLE (max 7 words) and a JUSTIFICATION (4-5 sentences).

Title rules:
- Capture the single strongest reason this flight wins for THIS trip
- ${phase === 'early' ? 'Since search is still running, the title MUST include an honest signal like "leading so far", "best so far", or "top pick so far" — make it feel live, not final' : 'Be definitive — do NOT add "so far" qualifiers. State it like it\'s settled.'}
- Do NOT start with "The" or "A"

Justification rules:
- Sentence 1: Lead with the price angle — is it the cheapest? Cheaper than Google? Best value given what you get?
- Sentence 2: Address the departure time directly. Is ${fmtMins(h.departure_time)} a good or acceptable time for THIS trip (${tripDesc})? Why or why not?
- Sentence 3: Stops and duration — ${stopsLabel}, ${fmtDur(h.duration_minutes)}. Is this good for the route? How does the journey feel?
- Sentence 4: Any other notable positives (bag included, savings, good arrival time). Skip if nothing noteworthy.
- ${phase === 'early' ? 'Sentence 5 (REQUIRED for early phase): End with an honest caveat that search is still running and results may update — something like "Still scanning, so this could change — but it\'s looking strong." Keep it brief and natural.' : 'Sentence 5 (optional): One honest caveat — if the departure time is early/late, if there are cheaper options, say so briefly.'}
- Max 200 words total. Do NOT start any sentence with "This flight" or "We\'ve selected".

RUNNER-UP FLIGHTS:
${runnersText}

TASK 2 — For each runner-up, write exactly 2 sentences.
- Sentence 1: What genuinely makes this flight attractive (price, timing, fewer stops, better arrival)
- Sentence 2: The specific reason it lost to #1 for THIS trip (not generic — say what the actual tradeoff is)
- If a runner is listed with "tradeoffs: none" or similar, still find something that makes #1 better
- Max 70 words total per runner

Return ONLY valid JSON, no markdown, no code blocks:
{"title": "...", "hero": "...", "runners": ["...", "..."]}`

  try {
    // Vertex AI (Cloud Run): project sms-caller, location global, gemini-2.5-flash-lite
    const url = gcpToken
      ? 'https://aiplatform.googleapis.com/v1/projects/sms-caller/locations/global/publishers/google/models/gemini-2.5-flash-lite:generateContent'
      : `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${geminiApiKey}`

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (gcpToken) headers['Authorization'] = `Bearer ${gcpToken}`

    const geminiResp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 2000,
          temperature: 0.75,
        },
      }),
      signal: AbortSignal.timeout(20_000),
    })

    if (!geminiResp.ok) {
      const errText = await geminiResp.text().catch(() => '')
      console.error(`[rank] Gemini error ${geminiResp.status}:`, errText.slice(0, 300))
      return NextResponse.json({ error: 'gemini_error' }, { status: 502 })
    }

    const data = await geminiResp.json() as GeminiResponse
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''

    // Extract JSON — handle any wrapping Gemini might add
    const jsonMatch = rawText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.error('[rank] No JSON in Gemini response:', rawText.slice(0, 200))
      return NextResponse.json({ error: 'parse_error' }, { status: 502 })
    }

    const parsed = JSON.parse(jsonMatch[0]) as { title?: string; hero?: string; runners?: unknown[] }
    if (typeof parsed.hero !== 'string' || parsed.hero.length < 10) {
      return NextResponse.json({ error: 'invalid_response' }, { status: 502 })
    }

    return NextResponse.json({
      title: typeof parsed.title === 'string' && parsed.title.length > 3 ? parsed.title.trim() : undefined,
      hero: parsed.hero.trim(),
      runners: Array.isArray(parsed.runners)
        ? parsed.runners.filter((r): r is string => typeof r === 'string').map(r => r.trim())
        : [],
    })
  } catch (err) {
    console.error('[rank] fetch error:', err)
    return NextResponse.json({ error: 'fetch_error' }, { status: 502 })
  }
}
