import { NextRequest, NextResponse } from 'next/server'
import type { RankedOffer, RankOffer, RankingContext } from '../../lib/rankOffers'
import { updateGeminiJustification } from '../../../lib/results-cache'

// ── Request / response types ──────────────────────────────────────────────
interface RankedOfferPayload {
  offer: RankOffer
  score: number
  breakdown: RankedOffer['breakdown']
  heroFacts: string[]
  tradeoffs: string[]
}

interface FallbackNotePayload {
  intended: string
  used_code: string
  used_name: string
  hub_name: string
  reason: string
}

interface RankRequestBody {
  topOffers: RankedOfferPayload[]
  rawQuery: string
  context: RankingContext
  searchId?: string
  /** 'early' = still searching (first gen), 'mid' = ~90% done, 'final' = search complete */
  phase?: 'early' | 'mid' | 'final'
  /** BCP-47 locale code (e.g. 'ja', 'de', 'en') — Gemini will respond in this language */
  locale?: string
  /** Set when /api/search had to swap a city without an airport for the
   * nearest hub (e.g. user typed Pretoria → we searched JNB). Gemini must
   * surface this honestly in its justification so the user understands. */
  fallbackNotes?: { origin?: FallbackNotePayload; destination?: FallbackNotePayload }
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

// In-memory token cache — avoids calling `gcloud auth print-access-token`
// on every request (3 rapid calls per search session would each shell out).
let _cachedToken: string | null = null
let _tokenExpiresAt = 0  // unix ms

/** Try to get a GCP access token from the Cloud Run metadata server. */
async function getGcpAccessToken(): Promise<string | null> {
  // Serve from cache if still valid (with 60s safety buffer)
  if (_cachedToken && Date.now() < _tokenExpiresAt - 60_000) return _cachedToken

  // 1. Cloud Run metadata server (production) — also returns expiry
  try {
    const r = await fetch(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
      {
        headers: { 'Metadata-Flavor': 'Google' },
        signal: AbortSignal.timeout(1_500),
      },
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

  // 2. Local dev: gcloud CLI application default credentials
  try {
    const token = execSync('gcloud auth print-access-token --quiet', {
      timeout: 5_000,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],  // suppress stderr cross-platform
    }).trim()
    if (token.startsWith('ya29.')) {
      _cachedToken = token
      // gcloud tokens are valid for ~1 hour; cache for 55 min
      _tokenExpiresAt = Date.now() + 55 * 60 * 1000
      return _cachedToken
    }
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
// Keep in sync with lib/pricing.ts MIN_FEE_FLOOR
const FEE_FLOOR: Record<string, number> = {
  EUR: 3, USD: 3, GBP: 2.55, PLN: 12.75, CZK: 75, HUF: 1200, RON: 15,
  SEK: 33, NOK: 36, DKK: 22.5, CHF: 2.85, TRY: 108, AED: 12, SAR: 12.3,
  INR: 276, THB: 117, MYR: 15, SGD: 4.5, AUD: 5.1, NZD: 5.55, CAD: 4.5,
  MXN: 66, BRL: 18, JPY: 486, KRW: 4500, HKD: 25.8, ZAR: 60, EGP: 165,
}
// Same FX table as display-price.ts — kept in sync manually
const FX_VS_EUR: Record<string, number> = {
  AED: 4.33, ARS: 1350.0, AUD: 1.64, BGN: 1.96, BRL: 5.87, CAD: 1.61, CHF: 0.92,
  CNY: 8.05, CZK: 24.3, DKK: 7.47, EGP: 60.0, EUR: 1.0, GBP: 0.87, HKD: 9.24,
  HUF: 363.0, IDR: 20270.0, INR: 109.5, JPY: 188.0, KES: 153.0, KRW: 1745.0,
  KWD: 0.36, MXN: 20.3, MYR: 4.66, NGN: 1920.0, NOK: 11.0, NZD: 2.0, PHP: 70.9,
  PLN: 4.23, RON: 5.1, SAR: 4.42, SEK: 10.8, SGD: 1.5, THB: 37.8, TRY: 53.0,
  USD: 1.18, VND: 30500.0, ZAR: 19.3,
}
function fxConvert(amount: number, from: string, to: string): number {
  const f = FX_VS_EUR[from.toUpperCase()], t = FX_VS_EUR[to.toUpperCase()]
  if (!f || !t || from.toUpperCase() === to.toUpperCase()) return Math.round(amount * 100) / 100
  return Math.round((amount / f) * t * 100) / 100
}

type FullAncillary = { included?: boolean; price?: number; currency?: string }
type FullAncillaries = {
  checked_bag?: FullAncillary
  seat_selection?: FullAncillary
}

/** Returns bag + seat cost in offerCurrency, with proper cross-currency conversion. */
function ancillaryCosts(anc: FullAncillaries | undefined, offerCurrency: string): { bag: number; seat: number } {
  if (!anc) return { bag: 0, seat: 0 }
  const resolve = (a?: FullAncillary) => {
    if (!a || a.included === true || typeof a.price !== 'number' || a.price <= 0) return 0
    return fxConvert(a.price, a.currency || offerCurrency, offerCurrency)
  }
  return { bag: resolve(anc.checked_bag), seat: resolve(anc.seat_selection) }
}

/** Returns the full price breakdown in offer currency: ticket, fee, bag, seat, total.
 * `requireBag` / `requireSeat` control whether the ancillary cost is added to the total
 * (only include when the user explicitly asked for that ancillary). */
function offerBreakdown(
  price: number, currency: string, source: string | undefined,
  anc: FullAncillaries | undefined,
  requireBag = false, requireSeat = false,
) {
  const { bag, seat } = ancillaryCosts(anc, currency)
  const floor = FEE_FLOOR[currency.toUpperCase()] ?? 3
  const fee = Math.round(Math.max(price * 0.01, floor) * 100) / 100
  const total = Math.round((price + fee + (requireBag ? bag : 0) + (requireSeat ? seat : 0)) * 100) / 100
  return { ticket: price, fee, bag, seat, total }
}

// ── Allowed origins ─────────────────────────────────────────────────────
const ALLOWED_ORIGIN_RE = /^https:\/\/(www\.)?letsfg\.co$|^https:\/\/(\w[\w-]*---)?letsfg-website[\w-]*(?:\.[\w-]+)*\.run\.app$|^http:\/\/localhost(:\d+)?$/

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
  const { searchId } = body
  const locale = body.locale ?? 'en'
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

  // Detect when user asked for direct flights but none are in the top results.
  // Only flag this on mid/final — during early phase search is still running so it's premature.
  const anyDirect = topOffers.some(o => o.offer.stops === 0)
  const noDirectsAvailable = context.preferDirect && !anyDirect && phase !== 'early'

  // Bag is required only when the user explicitly flagged it. We keep the
  // signal so the prompt can highlight bag pricing as a relevant cost, but we
  // do NOT add bag/seat ancillary costs into the TOTAL Gemini quotes. The
  // results card shows the total as ticket + fee (plus ancillaries marked
  // `included: true` in the fare); paid bag/seat are surfaced separately as
  // add-on lines. Quoting a different total than the card causes the user to
  // see "£373.06" in the copy but "£366.63" on the card. Always anchor to the
  // displayed figure.
  const requireBag = !!context.requireBag

  const hSource = (h as RankOffer & { source?: string }).source
  // Build TOTAL the SAME way the results card does: ticket + LetsFG fee, plus
  // only ancillaries marked included-in-fare. Paid bag / seat are surfaced as
  // add-on lines below but never folded into TOTAL — otherwise Gemini quotes a
  // different number than what the user sees on the card.
  const hBd = offerBreakdown(h.price, h.currency, hSource, h.ancillaries as FullAncillaries, false, false)
  const hTotal = hBd.total
  const savingsLine = h.google_flights_price && h.google_flights_price > hTotal + 8
    ? `\n- Saves ${Math.round(h.google_flights_price - hTotal)} ${h.currency} vs Google Flights (Google charges ~${Math.round(h.google_flights_price)} ${h.currency})`
    : ''
  // Price breakdown block for prompt (only show lines that are non-zero / relevant)
  const bdLines: string[] = [`  ✈ Ticket:      ${hBd.ticket} ${h.currency}`]
  bdLines.push(`  ⚙ LetsFG fee:  +${hBd.fee} ${h.currency}  ← small service charge, not a concern`)
  if (h.ancillaries?.checked_bag?.included === true) {
    bdLines.push(`  🧳 Bag:         included in fare`)
  } else if (requireBag && hBd.bag > 0) {
    bdLines.push(`  🧳 Bag:         +${hBd.bag} ${h.currency}  ← optional add-on if user checks a bag (NOT in TOTAL)`)
  }
  if (h.ancillaries?.seat_selection?.included === true) {
    bdLines.push(`  💺 Seat:        included in fare`)
  } else if (hBd.seat > 0) {
    bdLines.push(`  💺 Seat:        +${hBd.seat} ${h.currency}  ← optional add-on for seat selection (NOT in TOTAL)`)
  }
  bdLines.push(`  ─────────────────────────────`)
  bdLines.push(`  TOTAL:         ${hTotal} ${h.currency}  ← use this EXACT number in your copy (matches the card)`)
  const priceBreakdownBlock = bdLines.join('\n')
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
    context.preferDirect && !noDirectsAvailable ? 'asked for direct flights (none found yet — fewer stops is better)' : '',
    noDirectsAvailable ? 'asked for direct flights — none exist on this route' : '',
    context.depTimePref ? `prefers ${context.depTimePref.replace(/_/g, ' ')} departure` : '',
    context.retTimePref ? `prefers ${context.retTimePref.replace(/_/g, ' ')} return` : '',
    context.arrivalTimePref ? `prefers ${context.arrivalTimePref} arrival` : '',
  ].filter(Boolean).join(', ')

  const heroFactsText = hero.heroFacts.length > 0
    ? hero.heroFacts.map(f => `- ${f}`).join('\n')
    : '- No strong differentiating factors detected'

  const runnersText = runners.map((r, i) => {
    const ro = r.offer
    const roSource = (ro as RankOffer & { source?: string }).source
    // Match the displayed card total (ticket + fee + included ancillaries only).
    const roBd = offerBreakdown(ro.price, ro.currency, roSource, ro.ancillaries as FullAncillaries, false, false)
    const roBagNote = ro.ancillaries?.checked_bag?.included === true ? ' (bag incl)' : (requireBag && roBd.bag > 0) ? ` (+${roBd.bag} ${ro.currency} bag add-on)` : ''
    const roSeatNote = ro.ancillaries?.seat_selection?.included === true ? ' (seat incl)' : ''
    const roRetDep = (ro.inbound as { departure_time?: string } | undefined)?.departure_time
    const roRetNote = roRetDep ? ` | return departs ${fmtMins(roRetDep)}` : ''
    return (
      `${FLIGHT_LABELS[i + 1]}: ` +
      `${roBd.total} ${ro.currency}${roBagNote}${roSeatNote}, ` +
      `${ro.stops === 0 ? 'direct' : `${ro.stops} stop(s)`}, ` +
      `${fmtDur(ro.duration_minutes)}, ` +
      `departs ${fmtMins(ro.departure_time)} → arrives ${fmtMins(ro.arrival_time)}${roRetNote} ` +
      `| tradeoffs: ${r.tradeoffs.join('; ') || 'none'} ` +
      `| positives: ${r.heroFacts.slice(0, 2).join('; ') || 'similar value'}`
    )
  }).join('\n')

  const noDirectsBlock = noDirectsAvailable
    ? `
⚠️ CONTEXT — NO DIRECT FLIGHTS ON THIS ROUTE:
The user asked for direct flights. Search is complete and there are no direct flights available. The user does not know this yet — they need to hear it from you. Address this honestly in your justification: acknowledge the gap between what they asked for and what exists, and make the case for why this is the best option given that reality. Use your own words — don't be robotic about it.`
    : ''

  // ── Nearby-airport fallback context ────────────────────────────────────
  // When the user typed a city without a commercial airport (Pretoria, The
  // Hague, Bonn, Vatican, Mecca, etc.) /api/search swapped it for the
  // nearest practical hub. The user does not know this happened — Gemini
  // must say so up front so the user understands why their results show a
  // different city than they typed. The justification should be one short
  // sentence at the very start of the hero text.
  const fallbackOrigin = body.fallbackNotes?.origin
  const fallbackDestination = body.fallbackNotes?.destination
  const fallbackBlock = (fallbackOrigin || fallbackDestination)
    ? `
⚠️ CONTEXT — NEARBY-AIRPORT SUBSTITUTION:
${fallbackOrigin ? `- Origin: the user typed "${fallbackOrigin.intended}" but no airport serves it. We searched from ${fallbackOrigin.hub_name} (${fallbackOrigin.used_code}). Reason: ${fallbackOrigin.reason}.` : ''}${fallbackOrigin && fallbackDestination ? '\n' : ''}${fallbackDestination ? `- Destination: the user typed "${fallbackDestination.intended}" but no airport serves it. We searched to ${fallbackDestination.hub_name} (${fallbackDestination.used_code}). Reason: ${fallbackDestination.reason}.` : ''}

The user does NOT know this swap happened. You MUST open the hero justification with one short, plain-language sentence acknowledging it (e.g. "${fallbackOrigin?.intended ?? fallbackDestination?.intended} has no airport, so these are flights ${fallbackOrigin ? `from ${fallbackOrigin.hub_name}` : ''}${fallbackDestination ? `${fallbackOrigin ? ' to ' : 'to '}${fallbackDestination.hub_name}` : ''} — the standard gateway."). Keep it factual, brief, and friendly — don't apologise. Then continue with the normal price/timing/stops justification.`
    : ''

  const LOCALE_NAMES: Record<string, string> = {
    ja: 'Japanese', de: 'German', es: 'Spanish', fr: 'French', it: 'Italian',
    nl: 'Dutch', pl: 'Polish', pt: 'Portuguese', zh: 'Chinese', sv: 'Swedish',
    hr: 'Croatian', sq: 'Albanian',
  }
  const languageName = LOCALE_NAMES[locale.split('-')[0]] ?? null
  const languageInstruction = languageName
    ? `\nLANGUAGE: You MUST write your entire response in ${languageName}. Do not use English.`
    : ''

  const prompt = `You are a decisive travel advisor. You've already made the call — now justify it. Write like a sharp, honest friend who knows flights, not like a helpdesk bot. Be specific. Use actual numbers and times from the data.${languageInstruction}${fallbackBlock}${noDirectsBlock}

USER'S SEARCH: "${rawQuery}"
TRIP: ${tripDesc}${prefs ? ` | ${prefs}` : ''}

#1 RANKED FLIGHT (YOUR PICK):
- ${FLIGHT_LABELS[0]} | ${h.origin} → ${h.destination}
- Outbound: departs ${fmtMins(h.departure_time)}, arrives ${fmtMins(h.arrival_time)} | ${fmtDur(h.duration_minutes)} | ${stopsLabel}${h.inbound?.departure_time ? `\n- Return: departs ${fmtMins(h.inbound.departure_time)} from destination` : ''}
- PRICE BREAKDOWN:
${priceBreakdownBlock}${savingsLine}${aircraftLine}

NOTES ON THE BREAKDOWN:
- The LetsFG fee is a small platform service charge (like a booking fee). Do NOT dwell on it — it is normal and unremarkable.
- If a bag or seat cost is shown in the breakdown, it was factored in because it's a realistic expected cost for this trip (e.g. families need checked bags and to sit together). Justify it naturally — e.g. "bag included in the ${hTotal} ${h.currency}" — do not apologise for it.
- Ancillaries NOT shown in the breakdown are optional/not expected for this trip — do not add them to the price or imply the user must pay them.
- Always reference the TOTAL price (${hTotal} ${h.currency}) when talking about what the trip costs. Never quote just the ticket price.

REASONS IT RANKED FIRST (use these, don\'t invent others):
${heroFactsText}

CONTEXT: ${phase === 'early' ? 'Search is STILL RUNNING — more results are coming in. This is the best lead so far, not necessarily the final answer.' : phase === 'mid' ? 'Search is nearly done (~90% complete). This is very likely the final winner, but a few more results may still arrive.' : 'Search is COMPLETE. This is the definitive best flight. Be conclusive.'}

TASK 1 — Write a short TITLE (max 7 words) and a JUSTIFICATION (4-5 sentences).

Title rules:
- ${noDirectsAvailable ? 'The user asked for direct but none exist — the title should reflect the honest situation. Don\'t imply a direct was found.' : 'Capture the single strongest reason this flight wins for THIS trip'}
- ${phase === 'early' ? 'Since search is still running, the title MUST include an honest signal like "leading so far", "best so far", or "top pick so far" — make it feel live, not final' : noDirectsAvailable ? '' : 'Be definitive — do NOT add "so far" qualifiers. State it like it\'s settled.'}
- Do NOT start with "The" or "A"

Justification rules:
- Sentence 1: Lead with the price angle — is it the cheapest? Cheaper than Google? Best value given what you get? Reference the TOTAL (${hTotal} ${h.currency}).
- Sentence 2: Address the outbound departure time. Is ${fmtMins(h.departure_time)} a good or acceptable time for THIS trip (${tripDesc})? Why or why not?
- Sentence 3: ${noDirectsAvailable ? `The user wanted direct — cover what they're actually getting (${stopsLabel}, ${fmtDur(h.duration_minutes)}) and whether that's a reasonable trade for this route.` : `Stops and duration — ${stopsLabel}, ${fmtDur(h.duration_minutes)}. Is this good for the route? How does the journey feel?`}${context.retTimePref && h.inbound?.departure_time ? `\n- Sentence about return: The user asked for a ${context.retTimePref.replace(/_/g, ' ')} return. The return departs ${fmtMins(h.inbound.departure_time)}. Be HONEST about whether this matches — if it doesn't, say so plainly (e.g. "One caveat: the return is at ${fmtMins(h.inbound.departure_time)}, which isn't the evening flight back you asked for — no late returns are available on this route"). Do NOT skip this or pretend the return time is fine when it isn't.` : ''}
- Sentence 4: Any other notable positives (bag included, savings vs Google, good arrival time). If bag/seat costs are in the breakdown, weave them in as proof the total is still solid. Skip if nothing noteworthy.
- ${phase === 'early' ? 'Sentence 5 (REQUIRED for early phase): End with an honest caveat that search is still running and results may update — something like "Still scanning, so this could change — but it\'s looking strong." Keep it brief and natural.' : 'Sentence 5 (optional): One honest caveat — if the departure time is early/late, if there are cheaper options, say so briefly.'}
- Max 200 words total. Do NOT start any sentence with "This flight" or "We\'ve selected".

RUNNER-UP FLIGHTS:
${runnersText}

TASK 2 — For each runner-up, write exactly 2 sentences.
- Sentence 1: What genuinely makes this flight attractive (price, timing, fewer stops, better arrival)
- Sentence 2: The specific reason it lost to #1 for THIS trip (not generic — say what the actual tradeoff is)
- CRITICAL: If the runner-up costs LESS than #1, being cheaper is a POSITIVE (use it in sentence 1). It is NEVER the reason it lost — sentence 2 must give a non-price reason #1 won (e.g. fewer stops, better departure time, shorter duration, earlier arrival).
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

    const geminiBody = JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: 2000,
        temperature: 0.75,
      },
    })

    // Single retry on 429 (rate limit) or 5xx — with a 2s backoff
    let geminiResp = await fetch(url, {
      method: 'POST', headers, body: geminiBody,
      signal: AbortSignal.timeout(20_000),
    })
    if (!geminiResp.ok && (geminiResp.status === 429 || geminiResp.status >= 500)) {
      // On 429, invalidate cached token in case it's a quota-tied stale token
      if (geminiResp.status === 429) {
        _cachedToken = null
        _tokenExpiresAt = 0
      }
      await new Promise(r => setTimeout(r, 2000))
      // Refresh token for retry
      const retryToken = await getGcpAccessToken()
      const retryHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
      if (retryToken) retryHeaders['Authorization'] = `Bearer ${retryToken}`
      const retryUrl = retryToken
        ? 'https://aiplatform.googleapis.com/v1/projects/sms-caller/locations/global/publishers/google/models/gemini-2.5-flash-lite:generateContent'
        : `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${geminiApiKey}`
      geminiResp = await fetch(retryUrl, {
        method: 'POST', headers: retryHeaders, body: geminiBody,
        signal: AbortSignal.timeout(20_000),
      })
    }

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

    const result = {
      title: typeof parsed.title === 'string' && parsed.title.length > 3 ? parsed.title.trim() : undefined,
      hero: parsed.hero.trim(),
      runners: Array.isArray(parsed.runners)
        ? parsed.runners.filter((r): r is string => typeof r === 'string').map(r => r.trim())
        : [],
    }

    // Persist to server-side cache so any user with the shared link gets this text.
    // Only persist 'final' (or 'mid') — 'early' text explicitly says "still scanning".
    if (searchId && phase !== 'early') {
      updateGeminiJustification(searchId, result, locale)
    }

    return NextResponse.json(result)
  } catch (err) {
    console.error('[rank] fetch error:', err)
    return NextResponse.json({ error: 'fetch_error' }, { status: 502 })
  }
}
