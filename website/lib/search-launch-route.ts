import { lookupNearbyAirport, resolveNearbyAirport, isUsableIata, type NearbyAirportFallback } from '../app/lib/nearby-airports'
import type { FallbackNote } from './results-cache'

export interface SearchLaunchRouteInput {
  origin?: string
  originName?: string
  failedOriginRaw?: string
  destination?: string
  destinationName?: string
  failedDestinationRaw?: string
  anywhereDestination?: boolean
  aiOriginCity?: string
  aiDestinationCity?: string
  aiOriginLat?: number
  aiOriginLon?: number
  aiDestinationLat?: number
  aiDestinationLon?: number
}

export interface SearchLaunchRouteResult {
  origin?: string
  originName?: string
  destination?: string
  destinationName?: string
  fallbackNotes: { origin?: FallbackNote; destination?: FallbackNote }
}

function uniqueNonEmpty(values: Array<string | undefined>): string[] {
  const seen = new Set<string>()
  const output: string[] = []
  for (const value of values) {
    const normalized = value?.trim()
    if (!normalized) continue
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    output.push(normalized)
  }
  return output
}

function resolveSlotFallback(
  candidates: string[],
  lat: number | undefined,
  lon: number | undefined,
  excludedCode: string | undefined,
): NearbyAirportFallback | null {
  const excluded = excludedCode?.toUpperCase()

  for (const candidate of candidates) {
    const hit = lookupNearbyAirport(candidate)
    if (hit && hit.code.toUpperCase() !== excluded) {
      return hit
    }
  }

  const cityLabel = candidates[0] || ''
  if (!cityLabel) return null

  const geoHit = resolveNearbyAirport(cityLabel, lat, lon)
  if (!geoHit) return null
  if (geoHit.code.toUpperCase() === excluded) return null
  return geoHit
}

export function resolveSearchLaunchRoute(input: SearchLaunchRouteInput): SearchLaunchRouteResult {
  let origin = input.origin
  let originName = input.originName
  let destination = input.destination
  let destinationName = input.destinationName

  const fallbackNotes: { origin?: FallbackNote; destination?: FallbackNote } = {}

  const ghostOriginCity = origin && !isUsableIata(origin)
    ? (input.aiOriginCity || input.failedOriginRaw || originName)
    : undefined
  const ghostDestinationCity = destination && !isUsableIata(destination)
    ? (input.aiDestinationCity || input.failedDestinationRaw || destinationName)
    : undefined

  if (ghostOriginCity) {
    origin = undefined
    originName = undefined
  }
  if (ghostDestinationCity) {
    destination = undefined
    destinationName = undefined
  }

  if (!origin) {
    const candidates = uniqueNonEmpty([
      ghostOriginCity,
      input.aiOriginCity,
      input.failedOriginRaw,
      input.originName,
    ])
    const hit = resolveSlotFallback(candidates, input.aiOriginLat, input.aiOriginLon, destination)
    if (hit) {
      origin = hit.code
      originName = hit.name
      fallbackNotes.origin = {
        intended: input.aiOriginCity || input.failedOriginRaw || ghostOriginCity || input.originName || hit.name,
        used_code: hit.code,
        used_name: hit.name,
        hub_name: hit.hub_name,
        reason: hit.reason,
      }
    }
  }

  if (!destination && !input.anywhereDestination) {
    const candidates = uniqueNonEmpty([
      ghostDestinationCity,
      input.aiDestinationCity,
      input.failedDestinationRaw,
      input.destinationName,
    ])
    const hit = resolveSlotFallback(candidates, input.aiDestinationLat, input.aiDestinationLon, origin)
    if (hit) {
      destination = hit.code
      destinationName = hit.name
      fallbackNotes.destination = {
        intended: input.aiDestinationCity || input.failedDestinationRaw || ghostDestinationCity || input.destinationName || hit.name,
        used_code: hit.code,
        used_name: hit.name,
        hub_name: hit.hub_name,
        reason: hit.reason,
      }
    }
  }

  return {
    origin,
    originName,
    destination,
    destinationName,
    fallbackNotes,
  }
}