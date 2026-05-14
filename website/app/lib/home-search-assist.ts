import type { ParsedQuery } from './searchParsing'

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

  return needsConvo && needsDateClarification(parsed)
}