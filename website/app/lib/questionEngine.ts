/**
 * questionEngine.ts
 *
 * Generates a personalised sequence of follow-up questions based on what we
 * already know from parsing the NL query. Answers are applied back onto the
 * search context to refine sorting, ancillary inclusion, and to produce a
 * "best for you" recommendation with human-readable reasoning.
 *
 * Pure logic — no React imports. Use from SearchDiscovery.tsx or server code.
 */

import type { ParsedQuery } from './searchParsing'
import { normalizeTripPurposes } from './trip-purpose'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface QuestionOption {
  value: string
  label: string
  emoji?: string
  subtext?: string
}

export interface FollowUpQuestion {
  id: string
  priority: number              // lower = shown earlier
  question: string
  subtext?: string              // shown in smaller text below the question
  insight?: string              // "Why we're asking" tooltip text
  type: 'single_choice' | 'confirm' | 'number'
  options?: QuestionOption[]
  min?: number                  // for number type
  max?: number
  /** Only show this question if the named question was answered with one of these values */
  dependsOn?: string
  dependsOnValues?: string[]
}

/** Key → chosen value (single_choice) or number */
export type DiscoveryAnswers = Record<string, string | number>

/** What discovery answers contribute back to the ParsedQuery */
export interface DiscoveryRefinement {
  require_seat_selection?: boolean
  require_checked_baggage?: boolean
  carry_on_only?: boolean
  require_cancellation?: boolean
  prefer_direct?: boolean
  depart_time_pref?: ParsedQuery['depart_time_pref']
  arrive_time_pref?: ParsedQuery['arrive_time_pref']
  cabin?: ParsedQuery['cabin']
  children?: number
  passenger_context?: ParsedQuery['passenger_context']
  /** IATA codes the user explicitly prefers for origin or destination */
  preferred_origin_airports?: string[]
  preferred_dest_airports?: string[]
}

// ── Multi-airport city data ───────────────────────────────────────────────────

interface AirportInfo {
  code: string
  name: string
  /** Short transport description to city centre */
  transport: string
  /** Typical transport cost to city centre in local currency (approx) */
  transportCost: number
  /** Catchment zone / area of the city this airport serves best */
  zone: string
}

interface MultiAirportCity {
  cityCode: string
  cityName: string
  currency: string
  airports: AirportInfo[]
}

/** Cities where choosing the wrong airport can cost significantly more in transport */
export const MULTI_AIRPORT_CITIES: MultiAirportCity[] = [
  {
    cityCode: 'LON', cityName: 'London', currency: 'GBP',
    airports: [
      { code: 'LHR', name: 'Heathrow (LHR)', transport: 'Elizabeth line ~25 min, £15–£37', transportCost: 25, zone: 'West / Central London' },
      { code: 'LGW', name: 'Gatwick (LGW)', transport: 'Gatwick Express ~30 min, £18–£45', transportCost: 30, zone: 'South London / Surrey' },
      { code: 'STN', name: 'Stansted (STN)', transport: 'Stansted Express ~50 min, £20–£32', transportCost: 25, zone: 'North / East London (Cambridge area)' },
      { code: 'LTN', name: 'Luton (LTN)', transport: 'Shuttle bus + train ~60 min, £18–£50', transportCost: 35, zone: 'North London / Luton' },
      { code: 'LCY', name: 'City Airport (LCY)', transport: 'DLR ~25 min, £5', transportCost: 5, zone: 'East London / Canary Wharf / City' },
    ],
  },
  {
    cityCode: 'NYC', cityName: 'New York', currency: 'USD',
    airports: [
      { code: 'JFK', name: 'JFK International', transport: 'AirTrain + subway ~60 min, $9; taxi ~$70', transportCost: 60, zone: 'All boroughs (mainly Queens)' },
      { code: 'LGA', name: 'LaGuardia (LGA)', transport: 'Taxi ~$45, bus ~40 min', transportCost: 40, zone: 'Midtown / Upper Manhattan' },
      { code: 'EWR', name: 'Newark (EWR)', transport: 'NJ Transit ~30 min, $17; taxi ~$85', transportCost: 45, zone: 'New Jersey / Lower Manhattan' },
    ],
  },
  {
    cityCode: 'PAR', cityName: 'Paris', currency: 'EUR',
    airports: [
      { code: 'CDG', name: 'Charles de Gaulle (CDG)', transport: 'RER B ~45 min, €12', transportCost: 12, zone: 'North Paris' },
      { code: 'ORY', name: 'Orly (ORY)', transport: 'Orlyval + RER ~35 min, €14', transportCost: 14, zone: 'South Paris' },
      { code: 'BVA', name: 'Beauvais (BVA)', transport: 'Shuttle bus ~75 min, €16', transportCost: 16, zone: 'Far North Paris (Ryanair hub)' },
    ],
  },
  {
    cityCode: 'ROM', cityName: 'Rome', currency: 'EUR',
    airports: [
      { code: 'FCO', name: 'Fiumicino (FCO)', transport: 'Leonardo Express ~32 min, €14', transportCost: 14, zone: 'Central Rome' },
      { code: 'CIA', name: 'Ciampino (CIA)', transport: 'Bus + metro ~45 min, €5', transportCost: 8, zone: 'South Rome (budget airlines)' },
    ],
  },
  {
    cityCode: 'MIL', cityName: 'Milan', currency: 'EUR',
    airports: [
      { code: 'MXP', name: 'Malpensa (MXP)', transport: 'Malpensa Express ~45 min, €13', transportCost: 13, zone: 'West Milan / North' },
      { code: 'LIN', name: 'Linate (LIN)', transport: 'Metro M4 ~15 min, €5', transportCost: 5, zone: 'City centre / East Milan' },
      { code: 'BGY', name: 'Bergamo (BGY)', transport: 'Bus ~60 min, €10 (Ryanair hub)', transportCost: 10, zone: 'Bergamo area — far from city' },
    ],
  },
  {
    cityCode: 'BER', cityName: 'Berlin', currency: 'EUR',
    airports: [
      { code: 'BER', name: 'Berlin Brandenburg (BER)', transport: 'S-Bahn ~30 min, €3.80', transportCost: 4, zone: 'All of Berlin' },
    ],
  },
  {
    cityCode: 'AMS', cityName: 'Amsterdam', currency: 'EUR',
    airports: [
      { code: 'AMS', name: 'Schiphol (AMS)', transport: 'Train ~20 min, €6', transportCost: 6, zone: 'Amsterdam centre' },
      { code: 'EIN', name: 'Eindhoven (EIN)', transport: 'Bus + train ~90 min (budget hub)', transportCost: 15, zone: 'South Netherlands' },
    ],
  },
  {
    cityCode: 'MAD', cityName: 'Madrid', currency: 'EUR',
    airports: [
      { code: 'MAD', name: 'Barajas (MAD)', transport: 'Metro Line 8 ~35 min, €5', transportCost: 5, zone: 'All of Madrid' },
    ],
  },
  {
    cityCode: 'BCN', cityName: 'Barcelona', currency: 'EUR',
    airports: [
      { code: 'BCN', name: 'El Prat (BCN)', transport: 'Aerobus ~35 min, €6.75', transportCost: 7, zone: 'Barcelona city' },
      { code: 'GRO', name: 'Girona (GRO)', transport: 'Bus ~80 min, €16 (Ryanair hub)', transportCost: 16, zone: 'Far north — popular with Ryanair' },
      { code: 'REU', name: 'Reus (REU)', transport: 'Bus ~90 min, €14 (Ryanair)', transportCost: 14, zone: 'Far south — Tarragona area' },
    ],
  },
  {
    cityCode: 'STO', cityName: 'Stockholm', currency: 'SEK',
    airports: [
      { code: 'ARN', name: 'Arlanda (ARN)', transport: 'Arlanda Express ~20 min, SEK 170', transportCost: 170, zone: 'Central Stockholm' },
      { code: 'NYO', name: 'Skavsta (NYO)', transport: 'Bus ~80 min, SEK 199 (Ryanair)', transportCost: 199, zone: 'Far south — Nyköping area' },
      { code: 'VST', name: 'Västerås (VST)', transport: 'Bus ~100 min, SEK 249', transportCost: 249, zone: 'Far west' },
    ],
  },
]

export function getMultiAirportCity(iataOrCityCode: string): MultiAirportCity | null {
  if (!iataOrCityCode) return null
  const code = iataOrCityCode.toUpperCase()
  // Direct city code match
  const byCity = MULTI_AIRPORT_CITIES.find(c => c.cityCode === code)
  if (byCity) return byCity
  // Airport code match — find the city that contains it
  const byAirport = MULTI_AIRPORT_CITIES.find(c => c.airports.some(a => a.code === code) && c.airports.length > 1)
  return byAirport ?? null
}

// ── Question generation ────────────────────────────────────────────────────────

/**
 * Generate the list of relevant follow-up questions given what we already know
 * from the NL parse. Questions are prioritised and only generated when the
 * information is genuinely missing or ambiguous.
 */
export function generateFollowUpQuestions(
  nlParsed: ParsedQuery | null,
  originCode?: string,
  destCode?: string,
): FollowUpQuestion[] {
  const questions: FollowUpQuestion[] = []
  const p = nlParsed ?? {}
  const tripPurposes = normalizeTripPurposes({
    tripPurpose: p.trip_purpose,
    tripPurposes: p.trip_purposes,
  })

  const totalPax = (p.adults ?? 1) + (p.children ?? 0) + (p.infants ?? 0)
  const hasKidSignal = (p.children ?? 0) > 0 || p.require_bassinet || p.require_adjacent_seats
  const purposeKnown = tripPurposes.length > 0 || !!p.passenger_context

  // ── Q1: Trip purpose — highest impact question ──────────────────────────────
  if (!purposeKnown) {
    const destName = p.destination_name ?? destCode ?? 'there'
    questions.push({
      id: 'purpose',
      priority: 10,
      question: `What's the trip to ${destName}?`,
      subtext: 'This helps us personalise the best offer for you.',
      type: 'single_choice',
      options: [
        { value: 'leisure',       label: 'Holiday / leisure',  emoji: '🌴' },
        { value: 'city_break',    label: 'Weekend break',       emoji: '🏙️' },
        { value: 'business',      label: 'Business trip',       emoji: '💼' },
        { value: 'family',        label: 'Family trip',         emoji: '👨‍👩‍👧' },
        { value: 'occasion',      label: 'Special occasion',    emoji: '🎉' },
      ],
    })
  }

  // ── Q2: Children on board? (if family or high pax count and no explicit children set) ──
  if ((p.passenger_context === 'family' || (totalPax >= 2 && !purposeKnown)) && (p.children ?? 0) === 0 && !p.infants) {
    questions.push({
      id: 'has_children',
      priority: 15,
      question: 'Are you travelling with children?',
      subtext: 'We\'ll make sure there are seats together and factor in the seat selection cost.',
      type: 'single_choice',
      dependsOn: 'purpose',
      dependsOnValues: ['family', 'leisure', 'city_break', 'occasion'],
      options: [
        { value: 'yes', label: 'Yes', emoji: '👶' },
        { value: 'no',  label: 'No',  emoji: '🙅' },
      ],
    })
  }

  // ── Q3: How many children / ages? ──────────────────────────────────────────
  if (!hasKidSignal) {
    questions.push({
      id: 'child_count',
      priority: 20,
      question: 'How many children are you travelling with?',
      subtext: 'Children under 2 travel on a lap (free) — we\'ll factor bassinet availability.',
      type: 'number',
      min: 1,
      max: 8,
      dependsOn: 'has_children',
      dependsOnValues: ['yes'],
    })
  }

  // ── Q4: Sit together? (2+ adults, no children context) ─────────────────────
  if (totalPax >= 2 && !hasKidSignal && !p.require_adjacent_seats && !p.require_seat_selection) {
    questions.push({
      id: 'sit_together',
      priority: 25,
      question: `Do you need to sit together?`,
      subtext: `Seat selection costs ~€5–€20 per seat per person. We'll include this in the total price.`,
      insight: 'Some airlines don\'t guarantee adjacent seats without paid selection.',
      type: 'single_choice',
      dependsOn: 'has_children',
      dependsOnValues: ['no', undefined as unknown as string],
      options: [
        { value: 'yes',   label: 'Yes, must sit together',    emoji: '🤝', subtext: 'Include seat selection in price' },
        { value: 'nice',  label: 'Nice to have',               emoji: '😊' },
        { value: 'no',    label: 'Not necessary',              emoji: '✌️' },
      ],
    })
  }

  // ── Q5: Checked baggage ─────────────────────────────────────────────────────
  if (!p.require_checked_baggage && !p.carry_on_only) {
    questions.push({
      id: 'baggage',
      priority: 30,
      question: 'Will you need checked luggage?',
      subtext: 'Budget airlines charge €15–€80 per bag. We\'ll factor it into every price.',
      type: 'single_choice',
      options: [
        { value: 'no',       label: 'Hand luggage only',     emoji: '🎒', subtext: 'Cheapest option' },
        { value: 'one',      label: 'One checked bag',       emoji: '🧳', subtext: 'Per person' },
        { value: 'multiple', label: 'Multiple bags',         emoji: '🗃️' },
      ],
    })
  }

  // ── Q6: Multi-airport DESTINATION ──────────────────────────────────────────
  const destCity = getMultiAirportCity(destCode ?? '')
  if (destCity && destCity.airports.length > 1) {
    questions.push({
      id: 'dest_area',
      priority: 35,
      question: `Where in ${destCity.cityName} do you need to get to?`,
      subtext: `Different airports can cost ${destCity.currency === 'GBP' ? '£' : destCity.currency === 'USD' ? '$' : '€'}20–50 more in transport. We'll factor this in.`,
      insight: `${destCity.cityName} has ${destCity.airports.length} airports with very different transport costs.`,
      type: 'single_choice',
      options: [
        ...destCity.airports.map(a => ({
          value: a.code,
          label: a.name,
          subtext: a.transport,
          emoji: '✈️',
        })),
        { value: 'flexible', label: 'Anywhere — I\'ll check transport myself', emoji: '🗺️' },
      ],
    })
  }

  // ── Q7: Multi-airport ORIGIN ────────────────────────────────────────────────
  const originCity = getMultiAirportCity(originCode ?? '')
  if (originCity && originCity.airports.length > 1) {
    questions.push({
      id: 'origin_area',
      priority: 38,
      question: `Which part of ${originCity.cityName} are you departing from?`,
      subtext: `We'll show airports that are actually convenient for you.`,
      type: 'single_choice',
      options: [
        ...originCity.airports.map(a => ({
          value: a.code,
          label: a.name,
          subtext: `${a.zone} — ${a.transport}`,
          emoji: '📍',
        })),
        { value: 'flexible', label: 'Happy with any airport', emoji: '🗺️' },
      ],
    })
  }

  // ── Q8: Date flexibility ────────────────────────────────────────────────────
  if (p.date && !p.find_best_window && !p.date_month_only) {
    questions.push({
      id: 'flexibility',
      priority: 50,
      question: 'How fixed are your dates?',
      subtext: 'Shifting by even one day can save €50–€200 on popular routes.',
      type: 'single_choice',
      options: [
        { value: 'fixed',    label: 'These exact dates',        emoji: '📅' },
        { value: 'pm2',      label: '± 2 days',                emoji: '↔️', subtext: 'Small shift' },
        { value: 'pm7',      label: '± 1 week',                emoji: '📆', subtext: 'Most savings' },
        { value: 'month',    label: 'Any day that month',       emoji: '🗓️', subtext: 'Find cheapest window' },
      ],
    })
  }

  // ── Q9: Arrival time (business trips) ──────────────────────────────────────
  if (tripPurposes.includes('business') || p.passenger_context === 'business_traveler') {
    if (!p.arrive_time_pref) {
      questions.push({
        id: 'arrival_time',
        priority: 42,
        question: 'When do you need to arrive?',
        subtext: 'We\'ll only show flights that get you there in time.',
        type: 'single_choice',
        dependsOn: 'purpose',
        dependsOnValues: ['business'],
        options: [
          { value: 'morning',   label: 'Morning (before noon)',   emoji: '🌅' },
          { value: 'afternoon', label: 'Afternoon (noon–6 pm)',   emoji: '☀️' },
          { value: 'evening',   label: 'Evening (after 6 pm)',    emoji: '🌆' },
          { value: 'any',       label: 'No preference',           emoji: '⏰' },
        ],
      })
    }
  }

  // ── Q10: Cabin preference — only if not ultra-budget (no max_price < €100) ──
  if (!p.cabin && !(p.max_price && p.max_price < 100)) {
    questions.push({
      id: 'cabin',
      priority: 55,
      question: 'How do you want to travel?',
      type: 'single_choice',
      options: [
        { value: 'M', label: 'Economy',         emoji: '💺', subtext: 'Cheapest' },
        { value: 'W', label: 'Premium economy', emoji: '🛋️', subtext: 'Extra legroom' },
        { value: 'C', label: 'Business class',  emoji: '🥂' },
        { value: 'F', label: 'First class',     emoji: '👑' },
      ],
    })
  }

  // ── Q11: Refundability ──────────────────────────────────────────────────────
  if (!p.require_cancellation) {
    questions.push({
      id: 'refundable',
      priority: 60,
      question: 'Do you need a flexible ticket?',
      subtext: 'Refundable fares typically cost 20–40% more.',
      type: 'single_choice',
      options: [
        { value: 'no',        label: 'No, cheapest is fine',  emoji: '💸' },
        { value: 'preferred', label: 'Preferred if not much more', emoji: '🤔' },
        { value: 'required',  label: 'Must be refundable',    emoji: '🔄' },
      ],
    })
  }

  return questions.sort((a, b) => a.priority - b.priority)
}

/**
 * Given the set of all questions and current answers, return the next question
 * that should be shown. Returns null when all applicable questions are done.
 */
export function getActiveQuestion(
  questions: FollowUpQuestion[],
  answers: DiscoveryAnswers,
): FollowUpQuestion | null {
  for (const q of questions) {
    // Skip if already answered
    if (answers[q.id] !== undefined) continue

    // Check dependency: if this question depends on a prior question's answer
    if (q.dependsOn) {
      const parentAnswer = answers[q.dependsOn]
      if (parentAnswer === undefined) continue          // parent not answered yet — skip for now
      if (q.dependsOnValues && !q.dependsOnValues.includes(String(parentAnswer))) continue
    }

    return q
  }
  return null
}

/**
 * Count how many questions are applicable given the current answers.
 * Used for the progress indicator (question 2 of 4).
 */
export function countApplicableQuestions(
  questions: FollowUpQuestion[],
  answers: DiscoveryAnswers,
): { answered: number; total: number } {
  let answered = 0
  let total = 0
  for (const q of questions) {
    if (q.dependsOn) {
      const parentAnswer = answers[q.dependsOn]
      if (parentAnswer === undefined) continue
      if (q.dependsOnValues && !q.dependsOnValues.includes(String(parentAnswer))) continue
    }
    total++
    if (answers[q.id] !== undefined) answered++
  }
  return { answered, total }
}

// ── Applying answers back to ParsedQuery refinements ─────────────────────────

/**
 * Translate discovery answers into concrete ParsedQuery refinements.
 * Merged on top of the NL-parsed result to inform sorting, filtering,
 * and the "best for you" recommendation.
 */
export function applyDiscoveryAnswers(answers: DiscoveryAnswers): DiscoveryRefinement {
  const r: DiscoveryRefinement = {}

  // Purpose
  const purpose = answers['purpose'] as string
  if (purpose === 'business') {
    r.passenger_context = 'business_traveler'
    r.prefer_direct = true
  } else if (purpose === 'family') {
    r.passenger_context = 'family'
  }

  // Children
  if (answers['has_children'] === 'yes' || (answers['child_count'] && Number(answers['child_count']) > 0)) {
    r.require_seat_selection = true
    r.children = answers['child_count'] ? Number(answers['child_count']) : 1
  }

  // Sit together
  if (answers['sit_together'] === 'yes') {
    r.require_seat_selection = true
  }

  // Baggage
  if (answers['baggage'] === 'no') {
    r.carry_on_only = true
  } else if (answers['baggage'] === 'one' || answers['baggage'] === 'multiple') {
    r.require_checked_baggage = true
  }

  // Preferred destination airport
  const destArea = answers['dest_area'] as string
  if (destArea && destArea !== 'flexible') {
    r.preferred_dest_airports = [destArea]
  }

  // Preferred origin airport
  const originArea = answers['origin_area'] as string
  if (originArea && originArea !== 'flexible') {
    r.preferred_origin_airports = [originArea]
  }

  // Refundable
  if (answers['refundable'] === 'required') {
    r.require_cancellation = true
  }

  // Cabin
  const cabin = answers['cabin'] as string
  if (cabin && ['M', 'W', 'C', 'F'].includes(cabin)) {
    r.cabin = cabin as ParsedQuery['cabin']
  }

  // Arrival time
  const arrTime = answers['arrival_time'] as string
  if (arrTime && arrTime !== 'any') {
    r.arrive_time_pref = arrTime as ParsedQuery['arrive_time_pref']
  }

  return r
}

// ── Recommendation scoring ────────────────────────────────────────────────────

/**
 * Minimal offer shape needed by the scorer — matches the FlightOffer types in
 * both SearchPageClient and ResultsPanel without importing from either.
 */
export interface ScoredOffer {
  id: string
  price: number
  currency: string
  stops: number
  duration_minutes: number
  origin: string
  destination: string
  airline: string
  departure_time?: string
  arrival_time?: string
  ancillaries?: {
    cabin_bag?:    { included?: boolean; price?: number }
    checked_bag?:  { included?: boolean; price?: number }
    seat_selection?:{ included?: boolean; price?: number }
  }
}

/**
 * Score an offer against the user's discovery answers.
 * Returns a score (lower is better) and human-readable reasons for the
 * "Best for you because…" card.
 *
 * Score is intentionally not complex: the goal is to surface ONE obvious winner
 * quickly, not to build a perfect ranking model.
 */
export function scoreOfferForUser(
  offer: ScoredOffer,
  nlParsed: ParsedQuery | null,
  answers: DiscoveryAnswers,
  refinement: DiscoveryRefinement,
): { score: number; reasons: string[] } {
  let score = 0
  const reasons: string[] = []

  const passCount = (nlParsed?.adults ?? 1) + (refinement.children ?? nlParsed?.children ?? 0)

  // ── Direct flight preference ────────────────────────────────────────────────
  if (offer.stops === 0) {
    score -= 30
    const ctx = refinement.passenger_context ?? nlParsed?.passenger_context
    if (ctx === 'business_traveler') reasons.push('Direct flight — no wasted time')
    else if ((nlParsed?.children ?? 0) > 0 || answers['has_children'] === 'yes') reasons.push('Direct flight — easier with kids')
    else reasons.push('Direct flight')
  } else {
    score += offer.stops * 15
  }

  // ── Baggage included ────────────────────────────────────────────────────────
  const needsBag = refinement.require_checked_baggage || nlParsed?.require_checked_baggage
  if (needsBag && offer.ancillaries?.checked_bag?.included) {
    score -= 20
    reasons.push('Checked bag included')
  }
  if (refinement.carry_on_only && !offer.ancillaries?.checked_bag?.included) {
    // Carry-on only: penalise offers that charge for bags heavily (irrelevant)
  }

  // ── Seat selection included (when children / sit-together) ─────────────────
  const needsSeats = refinement.require_seat_selection || nlParsed?.require_seat_selection
  if (needsSeats && offer.ancillaries?.seat_selection?.included) {
    score -= 15 * passCount
    reasons.push(`Seat selection included for ${passCount} — sit together guaranteed`)
  }

  // ── Airport preference match ────────────────────────────────────────────────
  if (refinement.preferred_dest_airports?.includes(offer.destination)) {
    score -= 25
    // Find the transport info for this airport
    const city = MULTI_AIRPORT_CITIES.find(c => c.airports.some(a => a.code === offer.destination))
    const airport = city?.airports.find(a => a.code === offer.destination)
    if (airport) reasons.push(`Arrives at ${airport.name} — ${airport.transport}`)
  }
  if (refinement.preferred_origin_airports?.includes(offer.origin)) {
    score -= 25
    const city = MULTI_AIRPORT_CITIES.find(c => c.airports.some(a => a.code === offer.origin))
    const airport = city?.airports.find(a => a.code === offer.origin)
    if (airport) reasons.push(`Departs from ${airport.name} — closest to you`)
  }

  // ── Arrival time match (business) ──────────────────────────────────────────
  if (refinement.arrive_time_pref && offer.arrival_time) {
    const h = parseInt(offer.arrival_time.split('T')[1]?.split(':')[0] ?? '12', 10)
    const timePref = refinement.arrive_time_pref
    const matches =
      (timePref === 'morning'   && h < 12) ||
      (timePref === 'afternoon' && h >= 12 && h < 18) ||
      (timePref === 'evening'   && h >= 18)
    if (matches) {
      score -= 20
      const label = timePref === 'morning' ? 'morning' : timePref === 'afternoon' ? 'afternoon' : 'evening'
      reasons.push(`Arrives in the ${label} as needed`)
    }
  }

  // ── Duration bonus ──────────────────────────────────────────────────────────
  const durationH = offer.duration_minutes / 60
  if (durationH < 3) score -= 5
  else if (durationH > 8) score += 10

  // ── Price is base component ─────────────────────────────────────────────────
  score += offer.price * 0.01  // normalise so €100 = +1 point

  return { score, reasons }
}

/**
 * Given scored offers, return the single best offer ID with its reasons.
 * Returns null if no offers or none with compelling reasons.
 */
export function getBestOfferForUser(
  offers: ScoredOffer[],
  nlParsed: ParsedQuery | null,
  answers: DiscoveryAnswers,
  refinement: DiscoveryRefinement,
): { offerId: string; reasons: string[] } | null {
  if (!offers.length) return null

  // Only recommend if user has answered at least one question
  if (Object.keys(answers).length === 0) return null

  const scored = offers
    .map(o => ({ ...scoreOfferForUser(o, nlParsed, answers, refinement), offerId: o.id }))
    .sort((a, b) => a.score - b.score)

  const best = scored[0]
  if (!best.reasons.length) return null  // no personalization criteria matched

  return { offerId: best.offerId, reasons: best.reasons }
}
