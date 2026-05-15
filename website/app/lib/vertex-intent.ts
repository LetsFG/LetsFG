import { isUsableIata } from './nearby-airports'
import { resolveCity, type ParsedQuery } from './searchParsing'
import { getPrimaryTripPurpose, normalizeTripPurposes } from './trip-purpose'
import type { VertexCityResult } from './vertex-parse'

export interface AppliedVertexIntent {
  origin?: string
  originName?: string
  destination?: string
  destinationName?: string
  viaIata?: string
  dateFrom?: string
  returnDate?: string
  adults: number
  cabin?: ParsedQuery['cabin']
  aiOriginCity?: string
  aiDestinationCity?: string
  aiOriginLat?: number
  aiOriginLon?: number
  aiDestinationLat?: number
  aiDestinationLon?: number
  aiIntent: Record<string, unknown>
}

function mapAiCabinClass(cabinClass: VertexCityResult['cabin_class']): ParsedQuery['cabin'] {
  switch (cabinClass) {
    case 'economy':
      return 'M'
    case 'premium_economy':
      return 'W'
    case 'business':
      return 'C'
    case 'first':
      return 'F'
    default:
      return undefined
  }
}

export function applyVertexIntent(
  parsed: ParsedQuery,
  ai: VertexCityResult | null,
  adults: number,
): AppliedVertexIntent {
  let origin = parsed.origin
  let originName = parsed.origin_name
  let destination = parsed.destination
  let destinationName = parsed.destination_name
  let viaIata = parsed.via_iata
  let nextAdults = adults
  let dateFrom = parsed.date
  let returnDate = parsed.return_date || undefined
  let cabin = parsed.cabin

  const aiIntent: Record<string, unknown> = {}

  if (!ai) {
    return {
      origin,
      originName,
      destination,
      destinationName,
      viaIata,
      dateFrom,
      returnDate,
      adults: nextAdults,
      cabin,
      aiIntent,
    }
  }

  const aiOriginCity = ai.origin_city ?? undefined
  const aiDestinationCity = ai.destination_city && ai.destination_city !== 'ANYWHERE'
    ? ai.destination_city
    : undefined
  const aiOriginLat = typeof ai.origin_lat === 'number' ? ai.origin_lat : undefined
  const aiOriginLon = typeof ai.origin_lon === 'number' ? ai.origin_lon : undefined
  const aiDestinationLat = typeof ai.destination_lat === 'number' ? ai.destination_lat : undefined
  const aiDestinationLon = typeof ai.destination_lon === 'number' ? ai.destination_lon : undefined

  const originIsGhost = origin !== undefined && !isUsableIata(origin)
  const destinationIsGhost = destination !== undefined && !isUsableIata(destination)

  if ((!origin || originIsGhost) && ai.origin_city) {
    const aiOrigin = resolveCity(ai.origin_city)
    if (aiOrigin) {
      origin = aiOrigin.code
      originName = aiOrigin.name
    }
  }

  if ((!destination || destinationIsGhost) && ai.destination_city && ai.destination_city !== 'ANYWHERE') {
    const aiDestination = resolveCity(ai.destination_city)
    if (aiDestination) {
      destination = aiDestination.code
      destinationName = aiDestination.name
    }
  }

  if (!viaIata && ai.via_city) {
    const aiVia = resolveCity(ai.via_city)
    if (aiVia) viaIata = aiVia.code
  }

  if (!cabin && ai.cabin_class) {
    cabin = mapAiCabinClass(ai.cabin_class)
  }

  if (ai.passengers && ai.passengers > 0) {
    nextAdults = ai.passengers
  }

  const aiTripPurposes = normalizeTripPurposes({
    tripPurpose: ai.trip_purpose,
    tripPurposes: ai.trip_purposes,
  })
  const primaryAiTripPurpose = getPrimaryTripPurpose({
    tripPurpose: ai.trip_purpose,
    tripPurposes: ai.trip_purposes,
  })

  if (ai.passengers) aiIntent.ai_passengers = ai.passengers
  if (ai.depart_after) aiIntent.ai_depart_after = ai.depart_after
  if (ai.depart_before) aiIntent.ai_depart_before = ai.depart_before
  if (ai.direct_only != null) aiIntent.ai_direct_only = ai.direct_only
  if (ai.bags_included != null) aiIntent.ai_bags_included = ai.bags_included
  if (ai.cabin_class) aiIntent.ai_cabin_class = ai.cabin_class
  if (ai.sort_by) aiIntent.ai_sort_by = ai.sort_by
  if (aiTripPurposes.length > 0) aiIntent.ai_trip_purposes = aiTripPurposes
  if (primaryAiTripPurpose) aiIntent.ai_trip_purpose = primaryAiTripPurpose
  if (ai.dep_time_pref) aiIntent.ai_dep_time_pref = ai.dep_time_pref
  if (ai.ret_time_pref) aiIntent.ai_ret_time_pref = ai.ret_time_pref
  if (ai.passenger_context) aiIntent.ai_passenger_context = ai.passenger_context

  if ((!dateFrom || parsed.date_is_default) && ai.departure_date) {
    dateFrom = ai.departure_date
  }
  if (!returnDate && ai.return_date) {
    returnDate = ai.return_date
  }
  if (returnDate && dateFrom && returnDate <= dateFrom) {
    returnDate = undefined
  }

  return {
    origin,
    originName,
    destination,
    destinationName,
    viaIata,
    dateFrom,
    returnDate,
    adults: nextAdults,
    cabin,
    aiOriginCity,
    aiDestinationCity,
    aiOriginLat,
    aiOriginLon,
    aiDestinationLat,
    aiDestinationLon,
    aiIntent,
  }
}