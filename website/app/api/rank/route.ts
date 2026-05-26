import { NextRequest, NextResponse } from 'next/server'
import type { RankedOffer, RankOffer, RankingContext } from '../../lib/rankOffers'
import { normalizeGoogleFlightsComparisonPrice } from '../../../lib/google-flights-savings'
import { getOfferDetailPromptNotes } from '../../../lib/offer-details'
import { getLetsfgApiBase, withLetsfgWebsiteApiHeaders } from '../../../lib/letsfg-api'
import { updateGeminiJustification } from '../../../lib/results-cache'
import { normalizeTripPurposes } from '../../lib/trip-purpose'

// ── Request / response types ──────────────────────────────────────────────
interface RankedOfferPayload {
  offer: RankOffer
  score: number
  breakdown: RankedOffer['breakdown']
  heroFacts: string[]
  tradeoffs: string[]
  /** Hero only: user-stated criteria that had to be relaxed to find the hero
   *  (no offer satisfied them all). Names: 'refund' | 'bag' | 'time' | 'direct'.
   *  Used to make the LLM copy lead with the relaxation note instead of
   *  silently claiming a match. */
  relaxedGates?: string[]
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
  scannedDealsCount?: number
  /** 'early' = still searching (first gen), 'mid' = ~90% done, 'final' = search complete */
  phase?: 'early' | 'mid' | 'final'
  /** BCP-47 locale code (e.g. 'ja', 'de', 'en') — Gemini will respond in this language */
  locale?: string
  /** Currency the user is viewing prices in. All prompt prices are converted to this so
   * Gemini's copy matches the card. Falls back to each offer's native currency. */
  displayCurrency?: string
  /** Set when /api/search had to swap a city without an airport for the
   * nearest hub (e.g. user typed Pretoria → we searched JNB). Gemini must
   * surface this honestly in its justification so the user understands. */
  fallbackNotes?: { origin?: FallbackNotePayload; destination?: FallbackNotePayload }
}

interface RankResponseBody {
  title?: string
  /** One-line page subtitle under "Your 3 best flights". Gemini-written so it
   *  weaves search breadth + the value prop (all-fees-included) in the user's
   *  language. Optional — clients fall back to a deterministic string. */
  subtitle?: string
  /** Existing single-string hero justification (kept for back-compat / SEO). */
  hero: string
  /** Three short bullets shown on the hero card. Each 5–11 words, single
   *  specific fact. Replaces the long `hero` paragraph in the new layout. */
  hero_bullets?: string[]
  runners: string[]
  offer_ids: string[]
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
  const displayCurrency = (body.displayCurrency ?? '').toUpperCase()
  // Enforce max 3 offers server-side regardless of what the client sends
  const topOffers = (body.topOffers ?? []).slice(0, 3)
  if (!topOffers.length) {
    return NextResponse.json({ error: 'no_offers' }, { status: 400 })
  }
  const scannedDealsCount = typeof body.scannedDealsCount === 'number' && Number.isFinite(body.scannedDealsCount)
    ? Math.max(Math.floor(body.scannedDealsCount), topOffers.length)
    : topOffers.length
  const formattedScannedDealsCount = scannedDealsCount.toLocaleString('en-US')

  const hero = topOffers[0]
  const runners = topOffers.slice(1, 3)   // top 3 total → 2 runner-ups
  const h = hero.offer
  const heroIsDirect = h.stops === 0

  // Mask airline names — Gemini must not reference specific carriers in its output
  const FLIGHT_LABELS = ['Flight 1', 'Flight 2', 'Flight 3']
  const tripPurposes = normalizeTripPurposes({
    tripPurpose: context.tripPurpose,
    tripPurposes: context.tripPurposes,
  })

  // Build a human-readable trip description from context signals
  const tripParts = Array.from(new Set([
    context.tripContext && context.tripContext !== 'solo' && context.tripContext !== 'group'
      ? context.tripContext.replace(/_/g, ' ')
      : '',
    ...tripPurposes.map((purpose) => purpose.replace(/_/g, ' ')),
  ].filter(Boolean)))
  const tripDesc = tripParts.length > 0 ? tripParts.join(' / ') : 'solo trip'

  const stopsLabel = h.stops === 0 ? 'direct' : h.stops === 1 ? '1 stop' : `${h.stops} stops`

  // Detect when user asked for direct flights but none are in the top results.
  // Only flag this on mid/final — during early phase search is still running so it's premature.
  const anyDirect = topOffers.some(o => o.offer.stops === 0)
  const noDirectsAvailable = context.preferDirect && !anyDirect && phase !== 'early'
  // Even if another option in top-3 is direct, the hero itself might still not be.
  // In that case Gemini must not describe the chosen hero as direct/non-stop.
  const heroContradictsDirectRequest = context.preferDirect && !heroIsDirect

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
  // Display currency: prefer the client-computed display_price/display_currency (exact match
  // to what the card shows). Fall back to backend fxConvert only when not provided.
  const hOfferExt = h as RankOffer & { display_price?: number; display_currency?: string; display_price_formatted?: string }
  const hDispCur = hOfferExt.display_currency || displayCurrency || h.currency
  const dispFee = fxConvert(hBd.fee, h.currency, hDispCur)
  const dispBag = fxConvert(hBd.bag, h.currency, hDispCur)
  const dispSeat = fxConvert(hBd.seat, h.currency, hDispCur)
  const hTotal = hOfferExt.display_price ?? fxConvert(hBd.total, h.currency, hDispCur)
  const dispTicket = Math.round((hTotal - dispFee) * 100) / 100
  // Pre-formatted price string the user actually sees on the card (e.g. "$183.31").
  // Gemini must use this string VERBATIM in its copy — never reformat or convert.
  const heroPriceStr = hOfferExt.display_price_formatted || `${hTotal} ${hDispCur}`
  const normalizedGoogle = normalizeGoogleFlightsComparisonPrice(h.google_flights_price, context.travelerCount)
  const dispGoogle = normalizedGoogle ? fxConvert(normalizedGoogle, h.currency, hDispCur) : 0
  const fmtCurrency = (amount: number) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency: hDispCur, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)
  const savingsLine = dispGoogle && dispGoogle > hTotal + 8
    ? `\n- Saves ${fmtCurrency(Math.round((dispGoogle - hTotal) * 100) / 100)} vs Google Flights (Google charges ~${fmtCurrency(Math.round(dispGoogle * 100) / 100)})`
    : ''
  // Price breakdown block for prompt (only show lines that are non-zero / relevant)
  const bdLines: string[] = [`  ✈ Ticket:      ${dispTicket} ${hDispCur}`]
  bdLines.push(`  ⚙ LetsFG fee:  +${dispFee} ${hDispCur}  ← small service charge, not a concern`)
  if (h.ancillaries?.checked_bag?.included === true) {
    bdLines.push(`  🧳 Bag:         included in fare`)
  } else if (requireBag && dispBag > 0) {
    bdLines.push(`  🧳 Bag:         +${dispBag} ${hDispCur}  ← optional add-on if user checks a bag (NOT in TOTAL)`)
  }
  if (h.ancillaries?.seat_selection?.included === true) {
    bdLines.push(`  💺 Seat:        included in fare`)
  } else if (dispSeat > 0) {
    bdLines.push(`  💺 Seat:        +${dispSeat} ${hDispCur}  ← optional add-on for seat selection (NOT in TOTAL)`)
  }
  bdLines.push(`  ─────────────────────────────`)
  bdLines.push(`  TOTAL:         ${heroPriceStr}  ← use this EXACT string in your copy (matches the card)`)
  const priceBreakdownBlock = bdLines.join('\n')
  // Collect unique aircraft types from outbound segments (runtime data includes aircraft even if type doesn't)
  const heroAircraft = (h.segments as Array<{ aircraft?: string }> | undefined)
    ?.map(s => s.aircraft?.replace(/\s*\([^)]*\)/, '').trim())
    .filter((v): v is string => !!v)
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(' / ')
  const aircraftLine = heroAircraft ? `\n- Aircraft: ${heroAircraft}` : ''
  const heroDetailNotes = getOfferDetailPromptNotes(h)
  const heroDetailBlock = heroDetailNotes.length > 0
    ? `\n- FARE DETAILS FROM SEARCH DATA:\n${heroDetailNotes.map((note) => `  • ${note}`).join('\n')}`
    : ''
  const prefs = [
    context.requireBag ? 'needs checked bag' : '',
    context.requireMeals ? 'cares about meal / food availability' : '',
    context.requireCancellation ? 'cares about refund or change flexibility' : '',
    context.preferQuickFlight ? 'wants shortest possible flight time' : '',
    context.preferDirect && !noDirectsAvailable ? 'asked for direct flights (none found yet — fewer stops is better)' : '',
    noDirectsAvailable ? 'asked for direct flights — none exist on this route' : '',
    context.depTimePref ? `prefers ${context.depTimePref.replace(/_/g, ' ')} departure` : '',
    context.retTimePref ? `prefers ${context.retTimePref.replace(/_/g, ' ')} return` : '',
    context.arrivalTimePref ? `prefers ${context.arrivalTimePref} arrival` : '',
  ].filter(Boolean).join(', ')

  // Hero criteria relaxation: when the ranker had to relax stated criteria to
  // find a hero (no offer satisfied them all), we MUST tell Gemini so the copy
  // leads with the caveat instead of silently claiming a match. Without this
  // the user reads "direct flight — matches your search!" on a 1-stop hero.
  const relaxedGates = hero.relaxedGates ?? []
  const relaxedHumanNames: Record<string, string> = {
    direct: 'direct/non-stop (no direct flights exist on this route)',
    time: 'preferred time of day (no offer matches the requested time window)',
    bag: 'checked bag included in fare (no offer includes a bag — bag is an add-on cost)',
    refund: 'refundable/flexible fare (no refundable offer found at this price tier)',
  }
  const relaxedBlock = relaxedGates.length > 0
    ? '\nIMPORTANT — HERO DOES NOT FULLY MATCH USER CRITERIA:\n' +
      relaxedGates.map(g => `  - ${relaxedHumanNames[g] ?? g}`).join('\n') +
      '\nLead Sentence 1 or 2 with this caveat in plain language (e.g. "no direct flights on this route — this is the closest match"). Do NOT describe the hero as matching a criterion it does not actually satisfy.'
    : ''

  const heroFactsText = hero.heroFacts.length > 0
    ? hero.heroFacts.map(f => `- ${f}`).join('\n')
    : '- No strong differentiating factors detected'

  const runnersText = runners.map((r, i) => {
    const ro = r.offer
    const roSource = (ro as RankOffer & { source?: string }).source
    // Match the displayed card total (ticket + fee + included ancillaries only).
    const roBd = offerBreakdown(ro.price, ro.currency, roSource, ro.ancillaries as FullAncillaries, false, false)
    const roOfferExt = ro as RankOffer & { display_price?: number; display_currency?: string; display_price_formatted?: string }
    const roDispCur = roOfferExt.display_currency || displayCurrency || ro.currency
    const roDispTotal = roOfferExt.display_price ?? fxConvert(roBd.total, ro.currency, roDispCur)
    const roPriceStr = roOfferExt.display_price_formatted || `${roDispTotal} ${roDispCur}`
    const roDispBag = fxConvert(roBd.bag, ro.currency, roDispCur)
    const roBagNote = ro.ancillaries?.checked_bag?.included === true ? ' (bag incl)' : (requireBag && roDispBag > 0) ? ` (+${roDispBag} ${roDispCur} bag add-on)` : ''
    const roSeatNote = ro.ancillaries?.seat_selection?.included === true ? ' (seat incl)' : ''
    const roDetailNotes = getOfferDetailPromptNotes(ro).join('; ') || 'none shown'
    const roRetDep = (ro.inbound as { departure_time?: string } | undefined)?.departure_time
    const roRetNote = roRetDep ? ` | return departs ${fmtMins(roRetDep)}` : ''
    return (
      `${FLIGHT_LABELS[i + 1]}: ` +
      `${roPriceStr}${roBagNote}${roSeatNote}, ` +
      `${ro.stops === 0 ? 'direct' : `${ro.stops} stop(s)`}, ` +
      `${fmtDur(ro.duration_minutes)}, ` +
      `departs ${fmtMins(ro.departure_time)} → arrives ${fmtMins(ro.arrival_time)}${roRetNote} ` +
      `| fare details: ${roDetailNotes} ` +
      `| tradeoffs: ${r.tradeoffs.join('; ') || 'none'} ` +
      `| positives: ${r.heroFacts.slice(0, 2).join('; ') || 'similar value'}`
    )
  }).join('\n')

  const noDirectsBlock = noDirectsAvailable
    ? `
⚠️ CONTEXT — NO DIRECT FLIGHTS ON THIS ROUTE:
The user asked for direct flights. Search is complete and there are no direct flights available. The user does not know this yet — they need to hear it from you. Address this honestly in your justification: acknowledge the gap between what they asked for and what exists, and make the case for why this is the best option given that reality. Use your own words — don't be robotic about it.`
    : ''

  const heroDirectGuardBlock = heroContradictsDirectRequest
    ? `
⚠️ CRITICAL FACT CHECK:
- The selected #1 flight is NOT direct. It has ${h.stops} stop(s).
- You MUST NOT call this pick "direct", "non-stop", or "nonstop" anywhere.
- If the user asked for direct flights, acknowledge that this winner is a compromise and explain why it still ranks best.`
    : ''

  const fareClaimGuardBlock = `
⚠️ CRITICAL FARE FACT CHECK:
- Cabin class is NOT provided in this prompt data.
- You MUST NOT mention economy, premium economy, business class, first class, coach, or any cabin label anywhere.
- Refundability/flexibility is ONLY known when it is explicitly stated in the provided reasons, tradeoffs, or fare details block.
- Meals/food are ONLY known when they are explicitly stated in the reasons, tradeoffs, or fare details block.
- Wi-Fi, power/USB, refreshments, or in-flight entertainment are ONLY known when they are explicitly stated in the reasons, tradeoffs, or fare details block.
- Insurance or lounge access are ONLY known when they are explicitly stated in the reasons, tradeoffs, or fare details block.
- If a detail is not explicitly stated there, do NOT call the fare refundable, flexible, cancellable, changeable, meal-included, refreshment-included, Wi-Fi-enabled, power-equipped, entertainment-equipped, insured, or lounge-included.`

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

  const searchBreadthBlock = `
SEARCH BREADTH:
- ${phase === 'final' ? `We scanned ${formattedScannedDealsCount} matching deals for this search.` : `We have scanned ${formattedScannedDealsCount} matching deals so far, and more may still arrive.`}
- You MAY mention this once if it makes the recommendation feel more earned.
- ${phase === 'final' ? 'On final copy, prefer weaving in one short breadth signal when the field was meaningfully large; it helps the recommendation feel curated rather than generic.' : 'On early or mid copy, keep breadth mentions lighter and more provisional.'}
- If you mention it, vary the wording naturally. Do NOT sound like you're repeating a canned line.
- In early or mid phases, frame the count as "so far" or "already checked," never as a final total.
- You can use the breadth to signal that these picks are the shortlist worth focusing on, but do NOT rely on one stock tagline such as "worth your time".`

  const prompt = `You are a decisive travel advisor. You've already made the call — now justify it. Write like a sharp, honest friend who knows flights, not like a helpdesk bot. Be specific. Use actual numbers and times from the data.${languageInstruction}${fallbackBlock}${relaxedBlock}${noDirectsBlock}${heroDirectGuardBlock}${fareClaimGuardBlock}

USER'S SEARCH: "${rawQuery}"
TRIP: ${tripDesc}${prefs ? ` | ${prefs}` : ''}
${searchBreadthBlock}

#1 RANKED FLIGHT (YOUR PICK):
- ${FLIGHT_LABELS[0]} | ${h.origin} → ${h.destination}
- Outbound: departs ${fmtMins(h.departure_time)}, arrives ${fmtMins(h.arrival_time)} | ${fmtDur(h.duration_minutes)} | ${stopsLabel}${h.inbound?.departure_time ? `\n- Return: departs ${fmtMins(h.inbound.departure_time)} from destination` : ''}
- PRICE BREAKDOWN:
${priceBreakdownBlock}${savingsLine}${aircraftLine}${heroDetailBlock}

NOTES ON THE BREAKDOWN:
- The LetsFG fee is a small platform service charge (like a booking fee). Do NOT dwell on it — it is normal and unremarkable.
- If a bag or seat cost is shown in the breakdown, it was factored in because it's a realistic expected cost for this trip (e.g. families need checked bags and to sit together). Justify it naturally — e.g. "bag included in the ${heroPriceStr}" — do not apologise for it.
- Ancillaries NOT shown in the breakdown are optional/not expected for this trip — do not add them to the price or imply the user must pay them.
- Always reference the TOTAL price (${heroPriceStr}) when talking about what the trip costs. Never quote just the ticket price.
- CRITICAL: When you write the price, copy the string "${heroPriceStr}" EXACTLY as given — same digits, same currency symbol, same formatting. Do NOT convert it to another currency. Do NOT change the symbol. Do NOT round or recalculate. This string is what the user sees on the card; any deviation will look like a bug.

REASONS IT RANKED FIRST (use these, don\'t invent others):
${heroFactsText}

CONTEXT: ${phase === 'early' ? 'Search is STILL RUNNING — more results are coming in. This is the best lead so far, not necessarily the final answer.' : phase === 'mid' ? 'Search is nearly done (~90% complete). This is very likely the final winner, but a few more results may still arrive.' : 'Search is COMPLETE. This is the definitive best flight. Be conclusive.'}

TASK 1 — Write a short TITLE (max 7 words) and a JUSTIFICATION (4-5 sentences).

Title rules:
- ${noDirectsAvailable ? 'The user asked for direct but none exist — the title should reflect the honest situation. Don\'t imply a direct was found.' : 'Capture the single strongest reason this flight wins for THIS trip'}
- ${phase === 'early' ? 'Since search is still running, the title MUST include an honest signal like "leading so far", "best so far", or "top pick so far" — make it feel live, not final' : noDirectsAvailable ? '' : 'Be definitive — do NOT add "so far" qualifiers. State it like it\'s settled.'}
- Do NOT start with "The" or "A"

Justification rules:
- Sentence 1: Lead with the price angle — is it the cheapest? Cheaper than Google? Best value given what you get? Reference the TOTAL (${heroPriceStr}) — copy this string exactly.
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

TASK 3 — Page subtitle (one short line, MAX 12 WORDS, ~75 characters).
- MUST start with the breadth signal using EXACTLY this phrasing: "From ${formattedScannedDealsCount} deals checked"
- Then ONE short clause about the top pick (e.g. "this direct flight offers the best schedule and value", "this red-eye is the cheapest with reasonable timing", "this carrier has the best on-time record at this price")
- DO NOT add any trailing context — no destination name, no trip type, no traveller info, no date phrase. End on the value clause.
- Plain prose, no markdown, no emoji, no leading punctuation, no trailing period optional.
- Match the user's language (same locale rules as the hero)
- Example shape (target length): "From 388 deals checked this direct flight offers the best schedule and value"

TASK 4 — Hero card bullets (exactly 3, each 5–11 words).
- Each bullet is a single specific reason this flight wins for THIS trip
- DO NOT repeat info that's already visible elsewhere on the card (departure/arrival times, the airline name, the price, the stop pill, the duration pill)
- Prefer concrete data the user can't see at a glance: ancillary inclusions, airport-of-choice tradeoffs, schedule fit relative to the destination's typical activities, savings vs alternatives, arrival-time advantages, etc.
- Bullet 1: stops/timing/schedule fit angle
- Bullet 2: total-price / ancillaries / fee-inclusion angle
- Bullet 3: location, airline, or practical-insight angle (airport choice, baggage policy, layover quality, etc.)
- Do NOT start any bullet with a checkmark, dash, bullet, or symbol — those are rendered separately
- Do NOT start with "This flight" or "We've selected"

Return ONLY valid JSON, no markdown, no code blocks:
{"title": "...", "subtitle": "...", "hero": "...", "hero_bullets": ["...", "...", "..."], "runners": ["...", "..."]}`

  try {
    const rankResp = await fetch(`${getLetsfgApiBase()}/api/v1/flights/rank-copy`, {
      method: 'POST',
      headers: withLetsfgWebsiteApiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        prompt,
        offer_ids: topOffers.map((entry) => entry.offer.id),
        hero_stops: h.stops,
      }),
      signal: AbortSignal.timeout(25_000),
    })

    if (!rankResp.ok) {
      const errText = await rankResp.text().catch(() => '')
      console.error(`[rank] backend rank error ${rankResp.status}:`, errText.slice(0, 300))
      return NextResponse.json({ error: 'gemini_error' }, { status: 502 })
    }

    const parsed = await rankResp.json() as Partial<RankResponseBody>
    if (typeof parsed.hero !== 'string' || parsed.hero.length < 10) {
      return NextResponse.json({ error: 'invalid_response' }, { status: 502 })
    }

    const result: RankResponseBody = {
      title: typeof parsed.title === 'string' && parsed.title.length > 3 ? parsed.title.trim() : undefined,
      subtitle: typeof parsed.subtitle === 'string' && parsed.subtitle.trim().length > 3
        ? parsed.subtitle.trim()
        : undefined,
      hero: parsed.hero.trim(),
      hero_bullets: Array.isArray(parsed.hero_bullets)
        ? parsed.hero_bullets
            .filter((b): b is string => typeof b === 'string')
            .map((b) => b.trim().replace(/^[•\-•✓✓✦]+\s*/, ''))
            .filter((b) => b.length > 0)
            .slice(0, 3)
        : undefined,
      runners: Array.isArray(parsed.runners)
        ? parsed.runners.filter((r): r is string => typeof r === 'string').map(r => r.trim())
        : [],
      offer_ids: Array.isArray(parsed.offer_ids)
        ? parsed.offer_ids.filter((offerId): offerId is string => typeof offerId === 'string')
        : topOffers.map((entry) => entry.offer.id),
    }

    // Persist to server-side cache so any user with the shared link gets this text.
    // Only persist 'final' (or 'mid') — 'early' text explicitly says "still scanning".
    if (searchId && phase !== 'early') {
      updateGeminiJustification(searchId, result, locale, displayCurrency)
    }

    return NextResponse.json(result)
  } catch (err) {
    console.error('[rank] fetch error:', err)
    return NextResponse.json({ error: 'fetch_error' }, { status: 502 })
  }
}
