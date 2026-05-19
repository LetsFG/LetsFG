import type { ParsedQuery } from './searchParsing'
import { normalizeTripPurposes } from './trip-purpose'

export const HOME_CONVO_FOLLOW_UP_TOPICS = [
  'origin',
  'destination',
  'date',
  'party_size',
  'trip_type',
  'trip_purpose',
  'priority',
] as const

export type HomeConvoFollowUpTopic = typeof HOME_CONVO_FOLLOW_UP_TOPICS[number]

export interface EssentialSearchClarificationState {
  missingOriginByRegex: boolean
  missingDestinationByRegex: boolean
  implicitSingleCityAsDestination: boolean
  missingOrigin: boolean
  missingDestination: boolean
  needsOriginDisambig: boolean
  needsDestinationDisambig: boolean
  sameRoute: boolean
}

export interface SearchClarificationState extends EssentialSearchClarificationState {
  missingPartySize: boolean
  missingTripPurpose: boolean
  missingPriority: boolean
  missingTripType: boolean
}

const HOME_CONVO_REQUIRED_TOPICS: readonly HomeConvoFollowUpTopic[] = ['origin', 'destination', 'date', 'party_size', 'trip_purpose', 'priority']
const HOME_CONVO_OPTIONAL_TOPICS: readonly HomeConvoFollowUpTopic[] = ['trip_type']
const HOME_CONVO_FOLLOW_UP_TOPIC_SET = new Set<HomeConvoFollowUpTopic>(HOME_CONVO_FOLLOW_UP_TOPICS)

export function normalizeHomeConvoFollowUpTopics(
  topics: readonly string[] | null | undefined,
): HomeConvoFollowUpTopic[] {
  if (!topics || topics.length === 0) return []

  const normalized: HomeConvoFollowUpTopic[] = []
  for (const topic of topics) {
    if (!HOME_CONVO_FOLLOW_UP_TOPIC_SET.has(topic as HomeConvoFollowUpTopic)) continue
    const typedTopic = topic as HomeConvoFollowUpTopic
    if (!normalized.includes(typedTopic)) normalized.push(typedTopic)
  }
  return normalized
}

export function buildHomeConvoTopicOrder(
  aiTopics: readonly string[] | null | undefined,
  requiredTopics: readonly HomeConvoFollowUpTopic[] = [],
): HomeConvoFollowUpTopic[] {
  const normalizedRequiredTopics = normalizeHomeConvoFollowUpTopics(requiredTopics)
  const normalizedAiTopics = normalizeHomeConvoFollowUpTopics(aiTopics)

  if (normalizedAiTopics.length > 0) {
    return [
      ...normalizedRequiredTopics,
      ...normalizedAiTopics.filter((topic) => !normalizedRequiredTopics.includes(topic)),
    ]
  }

  if (normalizedRequiredTopics.length > 0) {
    return [
      ...normalizedRequiredTopics,
      ...HOME_CONVO_OPTIONAL_TOPICS.filter((topic) => !normalizedRequiredTopics.includes(topic)),
    ]
  }

  return [
    ...HOME_CONVO_REQUIRED_TOPICS,
    ...HOME_CONVO_OPTIONAL_TOPICS,
  ]
}

export function hasPartySizeContext(parsed: ParsedQuery | null | undefined): boolean {
  return Boolean(
    (parsed?.adults !== undefined && parsed.adults > 1)
    || parsed?.children
    || parsed?.infants
    || parsed?.passenger_context
    || parsed?.group_size,
  )
}

export function hasTripPurposeContext(parsed: ParsedQuery | null | undefined): boolean {
  return normalizeTripPurposes({
    tripPurpose: parsed?.trip_purpose,
    tripPurposes: parsed?.trip_purposes,
  }).length > 0
}

export function hasPriorityContext(parsed: ParsedQuery | null | undefined): boolean {
  return Boolean(
    parsed?.stops === 0
    || parsed?.cabin
    || parsed?.preferred_sort
    || parsed?.prefer_direct
    || parsed?.prefer_quick_flight
    || parsed?.max_price !== undefined
    || parsed?.require_checked_baggage
    || parsed?.carry_on_only
    || parsed?.require_meals
    || parsed?.require_cancellation
    || parsed?.require_lounge
    || parsed?.preferred_airline
    || parsed?.excluded_airline
    || parsed?.seat_pref,
  )
}

export function hasTripTypeContext(parsed: ParsedQuery | null | undefined): boolean {
  return Boolean(
    parsed?.return_date
    || parsed?.min_trip_days !== undefined
    || parsed?.max_trip_days !== undefined
    || parsed?.return_depart_time_pref,
  )
}

export function getSearchClarificationState(
  query: string,
  parsed: ParsedQuery | null | undefined,
): SearchClarificationState {
  const essential = getEssentialSearchClarificationState(query, parsed)

  return {
    ...essential,
    missingPartySize: !hasPartySizeContext(parsed),
    missingTripPurpose: !hasTripPurposeContext(parsed),
    missingPriority: !hasPriorityContext(parsed),
    missingTripType: !hasTripTypeContext(parsed),
  }
}

export function getRequiredSearchClarificationTopics(
  query: string,
  parsed: ParsedQuery | null | undefined,
): HomeConvoFollowUpTopic[] {
  const clarification = getSearchClarificationState(query, parsed)
  const requiredTopics: HomeConvoFollowUpTopic[] = []

  if (clarification.missingOrigin) requiredTopics.push('origin')
  if (clarification.missingDestination) requiredTopics.push('destination')
  if (needsDateClarification(parsed)) requiredTopics.push('date')
  if (clarification.missingPartySize) requiredTopics.push('party_size')
  if (clarification.missingTripPurpose) requiredTopics.push('trip_purpose')
  if (clarification.missingPriority) requiredTopics.push('priority')

  return requiredTopics
}

export function needsDateClarification(parsed: ParsedQuery | null | undefined): boolean {
  if (!parsed?.date || parsed.date_is_default === true) {
    return true
  }

  return !!(parsed.date_month_only && parsed.min_trip_days === undefined && !parsed.return_date)
}

// Maps multi-airport city codes and same-metro airport pairs.
// Key = city code → Set of airport codes that are within that metro area.
// The first loop in isSameMetroArea also catches two individual airports in the
// same metro (e.g. LHR ↔ LGW, or HND ↔ NRT) without needing a city code.
const METRO_AREA_AIRPORTS: Readonly<Record<string, ReadonlySet<string>>> = {
  TYO: new Set(['HND', 'NRT']),
  LON: new Set(['LHR', 'LGW', 'STN', 'LCY', 'LTN', 'SEN']),
  NYC: new Set(['JFK', 'LGA', 'EWR']),
  PAR: new Set(['CDG', 'ORY', 'BVA']),
  WAS: new Set(['DCA', 'IAD', 'BWI']),
  CHI: new Set(['ORD', 'MDW']),
  OSA: new Set(['KIX', 'ITM', 'UKB']),
  BUE: new Set(['EZE', 'AEP']),
  GRU: new Set(['GRU', 'CGH', 'VCP']),
  ICN: new Set(['ICN', 'GMP']),
  MIL: new Set(['MXP', 'LIN', 'BGY']),
  SEL: new Set(['ICN', 'GMP']),
}

function isSameMetroArea(a: string, b: string): boolean {
  if (a === b) return true
  // Both airports in the same metro (e.g. LHR ↔ LGW)
  for (const airports of Object.values(METRO_AREA_AIRPORTS)) {
    if (airports.has(a) && airports.has(b)) return true
  }
  // City code ↔ member airport (e.g. TYO ↔ HND, LON ↔ LHR)
  const aSet = METRO_AREA_AIRPORTS[a]
  if (aSet?.has(b)) return true
  const bSet = METRO_AREA_AIRPORTS[b]
  if (bSet?.has(a)) return true
  return false
}

export function isSameAirportRoute(parsed: ParsedQuery | null | undefined): boolean {
  return !!(
    !parsed?.anywhere_destination && (
      parsed?.same_route === true ||
      (parsed?.origin && parsed?.destination && isSameMetroArea(parsed.origin, parsed.destination))
    )
  )
}

export function getEssentialSearchClarificationState(
  query: string,
  parsed: ParsedQuery | null | undefined,
): EssentialSearchClarificationState {
  const trimmed = query.trim()
  const hasExplicitFromKeyword = /\bfrom\b/i.test(trimmed)
  const missingOriginByRegex = !parsed?.origin && !parsed?.failed_origin_raw
  const missingDestinationByRegex = !parsed?.destination && !parsed?.failed_destination_raw && !parsed?.anywhere_destination
  const implicitSingleCityAsDestination = !!parsed?.origin && missingDestinationByRegex && !hasExplicitFromKeyword
  const sameRoute = isSameAirportRoute(parsed)
  const missingOrigin = missingOriginByRegex || implicitSingleCityAsDestination
  const missingDestination = sameRoute || (missingDestinationByRegex && hasExplicitFromKeyword && !missingOriginByRegex)
  const needsOriginDisambig = !!(parsed?.failed_origin_raw && parsed?.origin_candidates?.length)
  const needsDestinationDisambig = !!(!sameRoute && parsed?.failed_destination_raw && parsed?.destination_candidates?.length)

  return {
    missingOriginByRegex,
    missingDestinationByRegex,
    implicitSingleCityAsDestination,
    missingOrigin,
    missingDestination,
    needsOriginDisambig,
    needsDestinationDisambig,
    sameRoute,
  }
}

export function isSearchLaunchReady(
  query: string,
  parsed: ParsedQuery | null | undefined,
): boolean {
  const clarification = getSearchClarificationState(query, parsed)
  return !(
    clarification.missingOrigin ||
    clarification.missingDestination ||
    clarification.needsOriginDisambig ||
    clarification.needsDestinationDisambig ||
    needsDateClarification(parsed) ||
    clarification.missingPartySize ||
    clarification.missingTripPurpose ||
    clarification.missingPriority
  )
}

export function shouldWaitForGeminiAssistOnHomeSubmit(
  query: string,
  parsed: ParsedQuery | null | undefined,
): boolean {
  if (!query.trim() || query.trim().length < 4) {
    return false
  }

  const clarification = getSearchClarificationState(query, parsed)

  const needsConvo =
    clarification.missingOrigin ||
    clarification.missingDestination ||
    clarification.needsOriginDisambig ||
    clarification.needsDestinationDisambig ||
    clarification.missingPartySize ||
    clarification.missingTripPurpose ||
    clarification.missingPriority ||
    clarification.missingTripType

  if (clarification.missingOriginByRegex || clarification.missingDestinationByRegex || clarification.sameRoute) {
    return true
  }

  return needsConvo || needsDateClarification(parsed)
}