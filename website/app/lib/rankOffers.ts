/**
 * Personalized flight ranking engine.
 *
 * Scores each offer across 9 dimensions with personalization weights
 * that shift based on trip context and purpose. Pure TypeScript — no
 * external imports, safe to run in both Node and browser.
 *
 * Usage:
 *   import { rankOffers, type RankingContext } from '../../lib/rankOffers'
 *   const ranked = rankOffers(offers, { tripContext: 'family', requireBag: true, ... })
 *   // ranked[0].offer is the best pick, ranked[0].heroFacts explains why
 */

// ── Minimal offer shape (subset of FlightOffer in ResultsPanel) ───────────
export interface RankOffer {
  id: string
  price: number
  /** Display total in the user's chosen currency (ticket + fee + ancillaries).
   * When provided, this is used for all price scoring and penalty calculations
   * instead of `price`. Callers should populate this so the ranking reflects
   * exactly what the user will pay. */
  displayPrice?: number
  google_flights_price?: number
  currency: string
  airline: string
  origin?: string
  destination?: string
  departure_time: string
  arrival_time: string
  duration_minutes: number
  stops: number
  segments?: Array<{ layover_minutes?: number }>
  inbound?: { departure_time?: string }
  ancillaries?: {
    checked_bag?: { included?: boolean; price?: number; currency?: string }
    seat_selection?: { included?: boolean; price?: number; currency?: string }
  }
}

export interface RankingContext {
  tripContext?: 'solo' | 'couple' | 'family' | 'group' | 'business_traveler'
  tripPurpose?: 'honeymoon' | 'business' | 'ski' | 'beach' | 'city_break' | 'family_holiday' | 'graduation' | 'concert_festival' | 'sports_event' | 'spring_break'
  depTimePref?: 'early_morning' | 'morning' | 'afternoon' | 'evening' | 'red_eye'
  retTimePref?: 'early_morning' | 'morning' | 'afternoon' | 'evening' | 'red_eye'
  arrivalTimePref?: 'morning' | 'afternoon' | 'evening'
  requireBag?: boolean
  requireSeat?: boolean
  preferredAirline?: string
  preferQuickFlight?: boolean
  /** User said "direct" or "nonstop" — strongly boost stops weight but don't filter.
   *  If no directs exist, 1-stop will naturally float to the top over 3-stop. */
  preferDirect?: boolean
  /** User explicitly asked for cheapest / lowest price — price dominates all other factors. */
  preferCheapest?: boolean
}

export interface ScoreBreakdown {
  price: number
  stops: number
  duration: number
  depTime: number
  arrivalTime: number
  baggage: number
  savings: number
  comfortHours: number
  layover: number
}

export interface RankedOffer<T extends RankOffer = RankOffer> {
  offer: T
  score: number       // 0–100, higher = better
  rank: number        // 1-based rank in the result set
  breakdown: ScoreBreakdown
  heroFacts: string[] // key reasons why this offer was selected
  tradeoffs: string[] // what's not ideal (for runner-up explanations)
}

// ── Weight profiles ────────────────────────────────────────────────────────
// All rows must sum to 1.0.
// Columns: price, stops, duration, depTime, arrivalTime, baggage, savings, comfortHours, layover
interface Weights {
  price: number; stops: number; duration: number; depTime: number
  arrivalTime: number; baggage: number; savings: number; comfortHours: number; layover: number
}

const W: Record<string, Weights> = {
  // Generic solo / default — price-driven
  default: {
    price: 0.34, stops: 0.22, duration: 0.12, depTime: 0.08,
    arrivalTime: 0.04, baggage: 0.02, savings: 0.06, comfortHours: 0.04, layover: 0.08,
  },
  // Business — time and directness > price; long layovers are unacceptable
  business_traveler: {
    price: 0.10, stops: 0.26, duration: 0.20, depTime: 0.18,
    arrivalTime: 0.04, baggage: 0.06, savings: 0.00, comfortHours: 0.06, layover: 0.10,
  },
  // Family — directness + baggage practicality; kids + 8h layover = nightmare
  family: {
    price: 0.12, stops: 0.20, duration: 0.16, depTime: 0.08,
    arrivalTime: 0.04, baggage: 0.20, savings: 0.04, comfortHours: 0.08, layover: 0.08,
  },
  // Couple — balance of price, comfort, arrival time, savings
  couple: {
    price: 0.22, stops: 0.20, duration: 0.12, depTime: 0.10,
    arrivalTime: 0.14, baggage: 0.02, savings: 0.10, comfortHours: 0.04, layover: 0.06,
  },
  // Honeymoon — direct > everything; no one wants a 10h layover on their honeymoon
  honeymoon: {
    price: 0.08, stops: 0.28, duration: 0.10, depTime: 0.14,
    arrivalTime: 0.18, baggage: 0.02, savings: 0.02, comfortHours: 0.08, layover: 0.10,
  },
  // Ski — bag essential (equipment); early arrival to maximize slopes
  ski: {
    price: 0.12, stops: 0.16, duration: 0.10, depTime: 0.16,
    arrivalTime: 0.08, baggage: 0.24, savings: 0.04, comfortHours: 0.02, layover: 0.08,
  },
  // Beach — arrive early to enjoy the day; price matters
  beach: {
    price: 0.24, stops: 0.16, duration: 0.10, depTime: 0.10,
    arrivalTime: 0.14, baggage: 0.10, savings: 0.06, comfortHours: 0.04, layover: 0.06,
  },
  // City break — maximize time on the ground; 2-day trip loses half a day to a 6h layover
  city_break: {
    price: 0.26, stops: 0.20, duration: 0.08, depTime: 0.12,
    arrivalTime: 0.16, baggage: 0.02, savings: 0.04, comfortHours: 0.04, layover: 0.08,
  },
  // Quick flight — user explicitly wants shortest possible total duration
  quick_flight: {
    price: 0.14, stops: 0.20, duration: 0.40, depTime: 0.06,
    arrivalTime: 0.04, baggage: 0.02, savings: 0.04, comfortHours: 0.04, layover: 0.06,
  },
  // Cheapest — user explicitly asked for lowest price; price overwhelms all other factors
  cheapest: {
    price: 0.88, stops: 0.06, duration: 0.03, depTime: 0.01,
    arrivalTime: 0.01, baggage: 0.01, savings: 0.00, comfortHours: 0.00, layover: 0.00,
  },
}

function resolveWeights(ctx: RankingContext): Weights {
  // preferCheapest is the highest-priority override — user explicitly asked for lowest price
  if (ctx.preferCheapest) return { ...W.cheapest }

  // tripPurpose takes precedence for specific categories
  const w: Weights =
    ctx.preferQuickFlight             ? { ...W.quick_flight }
    : ctx.tripPurpose === 'honeymoon'     ? { ...W.honeymoon }
    : ctx.tripPurpose === 'ski'         ? { ...W.ski }
    : ctx.tripPurpose === 'beach'       ? { ...W.beach }
    : ctx.tripPurpose === 'city_break'  ? { ...W.city_break }
    : ctx.tripPurpose === 'family_holiday' ? { ...W.family }
    : ctx.tripPurpose === 'business'    ? { ...W.business_traveler }
    : ctx.tripContext === 'business_traveler' ? { ...W.business_traveler }
    : ctx.tripContext === 'family'      ? { ...W.family }
    : ctx.tripContext === 'couple'      ? { ...W.couple }
    : { ...W.default }

  // When user explicitly asked for direct/nonstop flights, heavily boost stops weight.
  // We don't filter — if no directs exist, 1-stop naturally beats 3-stop via this weight.
  if (ctx.preferDirect) {
    const boost = 0.20
    w.stops = Math.min(0.50, w.stops + boost)
    // Absorb from price first, then duration
    const fromPrice    = Math.min(boost * 0.60, Math.max(0.04, w.price)    - 0.04)
    const fromDuration = Math.min(boost - fromPrice, Math.max(0.02, w.duration) - 0.02)
    w.price    -= fromPrice
    w.duration -= fromDuration
  }

  // When the user explicitly stated a departure time preference ("evening", "morning",
  // etc.), honour it strongly — base profiles treat it as a soft preference but a
  // stated pref is a hard preference and must dominate arrivalTime.
  if (ctx.depTimePref) {
    const boost = 0.13
    w.depTime = Math.min(0.36, w.depTime + boost)
    // Absorb cost from arrivalTime first, then duration
    const fromArrival = Math.min(boost * 0.65, Math.max(0, w.arrivalTime - 0.03))
    const fromDuration = Math.min(boost - fromArrival, Math.max(0, w.duration - 0.03))
    w.arrivalTime -= fromArrival
    w.duration    -= fromDuration
  }

  // If user needs checked bag and the profile doesn't already weight it highly,
  // boost baggage importance at the cost of price and duration.
  if (ctx.requireBag && w.baggage < 0.15) {
    const boost = 0.12
    w.baggage += boost
    w.price    = Math.max(0.04, w.price    - boost * 0.60)
    w.duration = Math.max(0.02, w.duration - boost * 0.40)
  }

  return w
}

// ── Helpers ────────────────────────────────────────────────────────────────
function isoToMins(iso: string | undefined): number {
  if (!iso) return 0
  const d = new Date(iso)
  if (isNaN(d.getTime())) return 0
  return d.getHours() * 60 + d.getMinutes()
}

/** Number of calendar days between departure and arrival (UTC). 0 = same day, 1 = next day, etc. */
function daysBetween(depIso: string | undefined, arrIso: string | undefined): number {
  if (!depIso || !arrIso) return 0
  const dep = new Date(depIso)
  const arr = new Date(arrIso)
  if (isNaN(dep.getTime()) || isNaN(arr.getTime())) return 0
  const depDay = Math.floor(dep.getTime() / 86400000)
  const arrDay = Math.floor(arr.getTime() / 86400000)
  return Math.max(0, arrDay - depDay)
}

function formatMins(mins: number): string {
  const h = Math.floor(mins / 60) % 24
  const m = mins % 60
  const ampm = h >= 12 ? 'pm' : 'am'
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${h12}:${m.toString().padStart(2, '0')}${ampm}`
}

/** 5th and 95th percentile — clips outliers from distorting normalization */
function p5p95(arr: number[]): [number, number] {
  if (arr.length === 0) return [0, 0]
  const s = [...arr].sort((a, b) => a - b)
  const lo = s[Math.floor(s.length * 0.05)] ?? s[0]
  const hi = s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)]
  return [lo, hi]
}

// ── Dimension scorers (all return 0–1, higher = better) ───────────────────

function scorePrice(price: number, lo: number, hi: number): number {
  if (hi <= lo) return 1.0
  return 1.0 - Math.max(0, Math.min(1, (price - lo) / (hi - lo)))
}

function scoreDuration(mins: number, lo: number, hi: number): number {
  if (hi <= lo) return 0.8
  return 1.0 - Math.max(0, Math.min(1, (mins - lo) / (hi - lo)))
}

function scoreStops(stops: number): number {
  if (stops === 0) return 1.00
  if (stops === 1) return 0.40
  if (stops === 2) return 0.14
  return 0.04
}

const TIME_RANGES: Record<string, [number, number, number, number]> = {
  // [perfectLo, perfectHi, okLo, okHi] — all in minutes from midnight
  early_morning: [0, 330, 330, 420],
  morning:       [360, 660, 300, 750],
  afternoon:     [720, 1020, 660, 1140],
  evening:       [1080, 1320, 1020, 1380],
  red_eye:       [1320, 1439, 0, 420],
}

function scoreDepTime(depMins: number, pref: string | undefined): number {
  if (!pref) {
    // No preference: score by general reasonableness (avoid very early/late)
    if (depMins >= 360 && depMins <= 1260) return 0.80  // 6am–9pm: great
    if (depMins >= 270 && depMins <= 1380) return 0.50  // 4:30am–11pm: ok
    return 0.20                                           // middle of night
  }
  const r = TIME_RANGES[pref]
  if (!r) return 0.5
  const [pLo, pHi, oLo, oHi] = r
  if (depMins >= pLo && depMins <= pHi) return 1.00
  if (depMins >= oLo && depMins <= oHi) return 0.60
  return 0.20
}

function scoreArrivalTime(
  arrMins: number,
  pref: string | undefined,
  tripPurpose: string | undefined,
  dayOffset: number = 0,
): number {
  const isExploring = (
    tripPurpose === 'city_break' || tripPurpose === 'beach' ||
    tripPurpose === 'spring_break' || tripPurpose === 'concert_festival'
  )
  if (!pref && !isExploring) return 0.50  // neutral when no preference & not time-sensitive

  let base: number

  if (pref === 'morning') {
    if (arrMins < 720) base = 1.00
    else if (arrMins < 900) base = 0.65
    else base = 0.25
  } else if (pref === 'afternoon') {
    if (arrMins >= 720 && arrMins < 1020) base = 1.00
    else if (arrMins < 1140) base = 0.65
    else base = 0.25
  } else if (pref === 'evening') {
    if (arrMins >= 1020 && arrMins < 1320) base = 1.00
    else if (arrMins >= 900) base = 0.65
    else base = 0.25
  } else {
    // Exploring/tourism trips: earlier arrival = more day to enjoy.
    // IMPORTANT: arriving before 6am is a red-eye — you go to sleep and lose your first
    // morning. Don't score 02:40am as "amazing" just because it's before 10am. Reserve
    // the top score for genuine morning arrivals (6am+) when you can actually start the day.
    if (arrMins < 360) {
      // Red-eye / wee-hours arrival: you can't do anything until morning.
      // Next-day red-eye (e.g. 02:40+1) is especially bad — you've already lost
      // a full calendar day compared to a same-day afternoon arrival.
      base = dayOffset >= 1 ? 0.15 : 0.30
    } else if (arrMins < 600)  base = 1.00  // 6am–10am: genuinely great morning arrival
    else if (arrMins < 720)    base = 0.85  // 10am–noon
    else if (arrMins < 900)    base = 0.70  // noon–3pm
    else if (arrMins < 1080)   base = 0.55  // 3pm–6pm
    else if (arrMins < 1260)   base = 0.35  // 6pm–9pm
    else                       base = 0.15  // after 9pm: barely any evening left
  }

  // Penalise flights arriving a full day later than the earliest possible.
  // day+0 and day+1 are both treated as baseline (long-haul routinely arrives
  // the next day). day+2 means a full extra day of travel compared to the
  // fastest options, which matters a lot for city breaks and beach trips.
  if (dayOffset >= 2) {
    const extraDays = dayOffset - 1  // how many days beyond "next day"
    const penalty = isExploring
      ? Math.min(base, extraDays * 0.45)  // steeper for tourism trips
      : Math.min(base, extraDays * 0.25)
    base = Math.max(0, base - penalty)
  }

  return base
}

function scoreBaggage(offer: RankOffer, requireBag: boolean | undefined): number {
  const bag = offer.ancillaries?.checked_bag
  const isIncluded = bag?.included === true
  const fee = bag?.included === false ? (bag?.price ?? null) : null

  if (!requireBag) {
    // Slight preference for included bag even when not required
    return isIncluded ? 0.80 : 0.50
  }

  // User explicitly needs checked bag — reward it heavily
  if (isIncluded) return 1.0
  if (fee === null) return 0.30  // unknown fee is a risk

  // Score relative to ticket price — cheaper bag = better
  const ratio = fee / Math.max(offer.price, 1)
  if (ratio < 0.05) return 0.72
  if (ratio < 0.12) return 0.52
  if (ratio < 0.22) return 0.32
  return 0.12
}

function scoreSavings(offer: RankOffer): number {
  const gfp = offer.google_flights_price
  if (!gfp || gfp <= 0) return 0.50  // neutral — no comparison available

  const pct = (gfp - offer.price) / gfp
  if (pct >= 0.20) return 1.00  // 20%+ cheaper than GF: excellent
  if (pct >= 0.12) return 0.85
  if (pct >= 0.06) return 0.72
  if (pct >= 0.01) return 0.60  // slightly cheaper
  if (pct >= -0.05) return 0.48 // roughly same as GF
  return 0.22                    // more expensive than GF
}

function scoreComfortHours(depMins: number): number {
  if (depMins >= 360 && depMins <= 1320) return 1.00  // 6am–10pm: no alarm clock required
  if (depMins >= 270 && depMins <= 1380) return 0.60  // 4:30am or 11pm: early/late
  if (depMins >= 180) return 0.30                      // 3am ish: very early
  return 0.10                                           // dead of night
}

function scoreLayover(offer: RankOffer): number {
  if (offer.stops === 0) return 1.0
  const segs = offer.segments ?? []
  const layoverMins = segs
    .filter(s => (s.layover_minutes ?? 0) > 0)
    .map(s => s.layover_minutes!)
  if (layoverMins.length === 0) return 0.50  // stop present but no segment detail: neutral

  const worst = Math.max(...layoverMins)
  if (worst < 40)  return 0.10  // dangerously tight connection
  if (worst < 60)  return 0.35  // risky
  if (worst <= 180) return 1.00  // ideal 1–3h: sweet spot
  if (worst <= 240) return 0.82  // 3–4h: fine
  if (worst <= 360) return 0.55  // 4–6h: starts to drag
  if (worst <= 480) return 0.28  // 6–8h: genuinely bad
  if (worst <= 660) return 0.12  // 8–11h: awful
  return 0.04                     // 11h+ layover: borderline unusable
}

// ── Fact generation ────────────────────────────────────────────────────────
function generateFacts(
  offer: RankOffer,
  bd: ScoreBreakdown,
  refPrice: number,
  fastestMins: number,
  ctx: RankingContext,
  isHero: boolean,
): { heroFacts: string[]; tradeoffs: string[] } {
  const heroFacts: string[] = []
  const tradeoffs: string[] = []
  const cur = offer.currency

  // ── Price ─────────────────────────────────────────────────────────────────
  const priceDiff = Math.round(offer.price - refPrice)
  if (isHero) {
    // Hero: compare vs cheapest in the full set
    if (priceDiff <= 5) {
      heroFacts.push(`cheapest available (${Math.round(offer.price)} ${cur})`)
    } else {
      // Hero won despite not being cheapest — note the small premium is worth it
      tradeoffs.push(`${priceDiff} ${cur} above the cheapest option`)
    }
  } else {
    // Runner: compare vs the hero
    if (priceDiff < -5) {
      heroFacts.push(`${Math.abs(priceDiff)} ${cur} cheaper than the top pick`)
    } else if (priceDiff > 5) {
      tradeoffs.push(`${priceDiff} ${cur} more expensive than the top pick`)
    }
    // within ±5: skip the price note (essentially the same price)
  }

  // ── Stops ────────────────────────────────────────────────────────────────
  if (offer.stops === 0) {
    heroFacts.push('direct flight — no layovers or connections')
  } else if (offer.stops === 1) {
    tradeoffs.push('1 stop')
  } else {
    tradeoffs.push(`${offer.stops} stops`)
  }

  // ── Google Flights savings ───────────────────────────────────────────────
  if (offer.google_flights_price && offer.google_flights_price > offer.price + 8) {
    const saving = Math.round(offer.google_flights_price - offer.price)
    heroFacts.push(
      `${saving} ${cur} cheaper than Google Flights (Google shows ${Math.round(offer.google_flights_price)} ${cur})`
    )
  } else if (offer.google_flights_price && offer.price > offer.google_flights_price + 8) {
    const extra = Math.round(offer.price - offer.google_flights_price)
    tradeoffs.push(`${extra} ${cur} more expensive than Google Flights shows`)
  }

  // ── Duration vs fastest ──────────────────────────────────────────────────
  const durDiff = offer.duration_minutes - fastestMins
  if (durDiff === 0) {
    heroFacts.push(
      `fastest flight on this route (${Math.floor(offer.duration_minutes / 60)}h ${offer.duration_minutes % 60}m)`
    )
  } else if (durDiff > 90) {
    tradeoffs.push(
      `${Math.floor(durDiff / 60)}h ${durDiff % 60}m longer than the fastest option`
    )
  }

  // ── Departure time ───────────────────────────────────────────────────────
  const depMins = isoToMins(offer.departure_time)
  if (bd.depTime >= 0.88 && ctx.depTimePref) {
    heroFacts.push(
      `departs ${formatMins(depMins)} — matches your ${ctx.depTimePref.replace('_', ' ')} preference`
    )
  } else if (bd.depTime <= 0.25 && ctx.depTimePref) {
    tradeoffs.push(
      `departure at ${formatMins(depMins)} doesn't match your ${ctx.depTimePref.replace('_', ' ')} preference`
    )
  }

  // ── Arrival time ─────────────────────────────────────────────────────────
  const arrMins = isoToMins(offer.arrival_time)
  const isExploring = ctx.tripPurpose === 'city_break' || ctx.tripPurpose === 'beach'
  if (bd.arrivalTime >= 0.88) {
    heroFacts.push(
      `arrives ${formatMins(arrMins)}${isExploring ? ' — full day to explore' : ''}`
    )
  } else if (bd.arrivalTime <= 0.25) {
    tradeoffs.push(`late arrival (${formatMins(arrMins)})`)
  }

  // ── Baggage ──────────────────────────────────────────────────────────────
  const bagIncluded = offer.ancillaries?.checked_bag?.included === true
  const bagFee = offer.ancillaries?.checked_bag?.included === false
    ? offer.ancillaries.checked_bag.price
    : null
  if (ctx.requireBag && bagIncluded) {
    heroFacts.push('checked bag already included in the ticket price')
  } else if (ctx.requireBag && bagFee != null) {
    tradeoffs.push(
      `bag costs extra (${Math.round(bagFee)} ${offer.ancillaries?.checked_bag?.currency ?? cur})`
    )
  } else if (ctx.requireBag && bagFee === null && !bagIncluded) {
    tradeoffs.push('bag fee unknown — check at booking')
  }

  // ── Preferred airline ────────────────────────────────────────────────────
  if (ctx.preferredAirline) {
    const airLower = offer.airline.toLowerCase()
    const prefLower = ctx.preferredAirline.toLowerCase()
    if (airLower.includes(prefLower) || prefLower.includes(airLower.split(' ')[0])) {
      heroFacts.push(`with ${offer.airline} as you mentioned`)
    } else {
      tradeoffs.push(`not ${ctx.preferredAirline} (which you mentioned)`)
    }
  }

  return { heroFacts, tradeoffs }
}

// ── Main export ────────────────────────────────────────────────────────────
/**
 * Rank an array of flight offers by personalized score.
 * Returns a new array sorted best-first. The original array is not mutated.
 *
 * @param offers  Array of flight offers (any type extending RankOffer)
 * @param ctx     User intent context from the NL query parser
 */
/**
 * Price-premium penalty: clamps a score down when an offer costs
 * significantly more than the cheapest option.
 *
 * Uses RELATIVE % so it works correctly in any currency (JPY, EUR, USD, etc.).
 * A 50% premium hurts the same whether the flight is ¥40k or €300.
 */
function premiumPenalty(offerPrice: number, cheapestPrice: number): number {
  if (cheapestPrice <= 0) return 1
  const ratio = (offerPrice - cheapestPrice) / cheapestPrice  // 0 = cheapest, 0.5 = 50% more
  if (ratio <= 0) return 1.00      // cheapest (or tied)
  if (ratio <= 0.08) return 1.00   // within 8% — noise, no penalty
  if (ratio <= 0.18) return 0.96   // 8–18% more — tiny nudge
  if (ratio <= 0.30) return 0.88   // 18–30% more — modest
  if (ratio <= 0.50) return 0.76   // 30–50% more — noticeable
  if (ratio <= 0.80) return 0.58   // 50–80% more — strong
  if (ratio <= 1.20) return 0.40   // 80–120% more (2× price)
  if (ratio <= 2.00) return 0.26   // 2–3× cheapest
  return 0.14                       // 3×+ : essentially out of contention
}

export function rankOffers<T extends RankOffer>(
  offers: T[],
  ctx: RankingContext,
): RankedOffer<T>[] {
  if (offers.length === 0) return []

  const weights = resolveWeights(ctx)
  // Use displayPrice when available — it reflects what the user actually pays
  // (ticket + LetsFG fee + ancillaries, in their display currency).
  const effectivePrice = (o: RankOffer) => o.displayPrice ?? o.price
  const prices = offers.map(effectivePrice)
  const durations = offers.map(o => o.duration_minutes)
  const [pLo, pHi] = p5p95(prices)
  const [dLo, dHi] = p5p95(durations)
  const cheapestPrice = Math.min(...prices)
  const fastestMins = Math.min(...durations)

  // Score every offer
  const scored: RankedOffer<T>[] = offers.map(offer => {
    const depMins = isoToMins(offer.departure_time)
    const arrMins = isoToMins(offer.arrival_time)
    const dayOffset = daysBetween(offer.departure_time, offer.arrival_time)
    const ep = effectivePrice(offer)

    const bd: ScoreBreakdown = {
      price:        scorePrice(ep, pLo, pHi),
      stops:        scoreStops(offer.stops),
      duration:     scoreDuration(offer.duration_minutes, dLo, dHi),
      depTime:      scoreDepTime(depMins, ctx.depTimePref),
      arrivalTime:  scoreArrivalTime(arrMins, ctx.arrivalTimePref, ctx.tripPurpose, dayOffset),
      baggage:      scoreBaggage(offer, ctx.requireBag),
      savings:      scoreSavings(offer),
      comfortHours: scoreComfortHours(depMins),
      layover:      scoreLayover(offer),
    }

    const rawScore = (
      bd.price        * weights.price +
      bd.stops        * weights.stops +
      bd.duration     * weights.duration +
      bd.depTime      * weights.depTime +
      bd.arrivalTime  * weights.arrivalTime +
      bd.baggage      * weights.baggage +
      bd.savings      * weights.savings +
      bd.comfortHours * weights.comfortHours +
      bd.layover      * weights.layover
    ) * 100

    // Apply price-premium penalty so no flight can leapfrog a much cheaper one
    // purely on arrival time / stops when the price gap is unreasonable.
    const score = rawScore * premiumPenalty(ep, cheapestPrice)

    return { offer, score, rank: 0, breakdown: bd, heroFacts: [], tradeoffs: [] }
  })

  // Sort best-first
  scored.sort((a, b) => b.score - a.score)

  // Assign 1-based ranks and generate human-readable facts
  // Hero compares vs cheapest in set; runners compare vs the hero price
  const heroPrice = scored[0]?.offer.price ?? cheapestPrice
  for (let i = 0; i < scored.length; i++) {
    scored[i].rank = i + 1
    const isHero = i === 0
    const refPrice = isHero ? cheapestPrice : heroPrice
    const { heroFacts, tradeoffs } = generateFacts(
      scored[i].offer, scored[i].breakdown, refPrice, fastestMins, ctx, isHero,
    )
    scored[i].heroFacts = heroFacts
    scored[i].tradeoffs = tradeoffs
  }

  return scored
}

/**
 * Returns a short human-readable label describing the ranking profile
 * that was applied (e.g. "City break", "Family holiday"). Returns null
 * if the default generic profile is used.
 */
export function getProfileLabel(ctx: RankingContext): string | null {
  if (ctx.tripPurpose === 'honeymoon')         return 'profileHoneymoon'
  if (ctx.tripPurpose === 'business')          return 'profileBusiness'
  if (ctx.tripPurpose === 'ski')               return 'profileSki'
  if (ctx.tripPurpose === 'beach')             return 'profileBeach'
  if (ctx.tripPurpose === 'city_break')        return 'profileCityBreak'
  if (ctx.tripPurpose === 'family_holiday')    return 'profileFamilyHoliday'
  if (ctx.tripPurpose === 'graduation')        return 'profileGraduation'
  if (ctx.tripPurpose === 'concert_festival')  return 'profileFestival'
  if (ctx.tripPurpose === 'sports_event')      return 'profileSports'
  if (ctx.tripPurpose === 'spring_break')      return 'profileSpringBreak'
  if (ctx.tripContext === 'family')            return 'profileFamily'
  if (ctx.tripContext === 'couple')            return 'profileCouple'
  if (ctx.tripContext === 'business_traveler') return 'profileBusinessLabel'
  if (ctx.requireBag)                         return 'profileBag'
  return null
}

