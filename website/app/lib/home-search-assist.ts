import type { ParsedQuery } from './searchParsing'

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

const HOME_CONVO_ESSENTIAL_TOPICS: readonly HomeConvoFollowUpTopic[] = ['origin', 'destination', 'date']
const HOME_CONVO_PERSONALIZATION_TOPICS: readonly HomeConvoFollowUpTopic[] = ['party_size', 'trip_type', 'trip_purpose', 'priority']
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
): HomeConvoFollowUpTopic[] {
  const normalizedAiTopics = normalizeHomeConvoFollowUpTopics(aiTopics)
  const preferredPersonalizationTopics = normalizedAiTopics.filter((topic) => !HOME_CONVO_ESSENTIAL_TOPICS.includes(topic))

  return [
    ...HOME_CONVO_ESSENTIAL_TOPICS,
    ...preferredPersonalizationTopics,
    ...HOME_CONVO_PERSONALIZATION_TOPICS.filter((topic) => !preferredPersonalizationTopics.includes(topic)),
  ]
}

export function needsDateClarification(parsed: ParsedQuery | null | undefined): boolean {
  if (!parsed?.date || parsed.date_is_default === true) {
    return true
  }

  return !!(parsed.date_month_only && parsed.min_trip_days === undefined && !parsed.return_date)
}

export function shouldWaitForGeminiAssistOnHomeSubmit(
  query: string,
  parsed: ParsedQuery | null | undefined,
): boolean {
  const trimmed = query.trim()
  if (!trimmed || trimmed.length < 4) {
    return false
  }

  const hasExplicitFromKeyword = /\bfrom\b/i.test(trimmed)
  const missingOriginByRegex = !parsed?.origin && !parsed?.failed_origin_raw
  const missingDestinationByRegex = !parsed?.destination && !parsed?.failed_destination_raw && !parsed?.anywhere_destination
  const implicitSingleCityAsDestination = !!parsed?.origin && missingDestinationByRegex && !hasExplicitFromKeyword
  const missingOrigin = missingOriginByRegex || implicitSingleCityAsDestination
  const missingDestination = missingDestinationByRegex && hasExplicitFromKeyword && !missingOriginByRegex
  const needsOriginDisambig = !!(parsed?.failed_origin_raw && parsed?.origin_candidates?.length)
  const needsDestinationDisambig = !!(parsed?.failed_destination_raw && parsed?.destination_candidates?.length)

  const needsConvo =
    missingOrigin ||
    missingDestination ||
    needsOriginDisambig ||
    needsDestinationDisambig ||
    (!parsed?.trip_purpose && !parsed?.passenger_context)

  if (missingOriginByRegex || missingDestinationByRegex) {
    return true
  }

  return needsConvo || needsDateClarification(parsed)
}