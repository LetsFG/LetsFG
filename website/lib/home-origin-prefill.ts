import { createRequire } from 'node:module'

import { findBestMatch, getAirportName } from '../app/airports'
import { findNearestAirport } from '../app/lib/nearby-airports'

const require = createRequire(import.meta.url)

type GeoIpLookup = {
  ll?: readonly [number, number] | readonly number[]
  country?: string
} | null

let geoIpLookup: ((clientIp: string) => GeoIpLookup) | null | undefined

export interface HomeOriginPrefill {
  code: string
  label: string
  city: string
  country: string | null
  latitude: number
  longitude: number
  source: 'headers' | 'geoip'
}

type HeaderLike = Pick<Headers, 'get'> | null | undefined

const CLIENT_IP_HEADERS = [
  'cf-connecting-ip',
  'x-real-ip',
  'x-client-ip',
  'fly-client-ip',
  'fastly-client-ip',
  'x-forwarded-for',
] as const

const GEO_COUNTRY_HEADERS = [
  'cf-ipcountry',
  'x-vercel-ip-country',
  'x-appengine-country',
  'cloudfront-viewer-country',
  'x-country-code',
  'x-country',
  'x-geo-country',
  'fastly-geoip-countrycode',
] as const

const GEO_LATITUDE_HEADERS = [
  'x-vercel-ip-latitude',
  'x-appengine-citylatlong',
  'x-geo-latitude',
  'x-client-latitude',
  'fastly-geoip-latitude',
] as const

const GEO_LONGITUDE_HEADERS = [
  'x-vercel-ip-longitude',
  'x-geo-longitude',
  'x-client-longitude',
  'fastly-geoip-longitude',
] as const

function firstHeader(headers: HeaderLike, names: readonly string[]): string | null {
  if (!headers) return null

  for (const name of names) {
    const value = headers.get(name)?.trim()
    if (value) return value
  }

  return null
}

function readNumberHeader(headers: HeaderLike, names: readonly string[]): number | null {
  const raw = firstHeader(headers, names)
  if (!raw) return null

  // App Engine can send a combined "lat,long" value rather than discrete headers.
  if (raw.includes(',')) {
    const first = raw.split(',')[0]?.trim()
    const parsed = Number.parseFloat(first || '')
    return Number.isFinite(parsed) ? parsed : null
  }

  const parsed = Number.parseFloat(raw)
  return Number.isFinite(parsed) ? parsed : null
}

function readClientIp(headers: HeaderLike): string | null {
  const forwardedFor = firstHeader(headers, CLIENT_IP_HEADERS)
  if (!forwardedFor) return null

  return forwardedFor
    .split(',')
    .map((part) => part.trim())
    .find(Boolean) || null
}

function readClientIpCandidates(headers: HeaderLike): string[] {
  const forwardedFor = firstHeader(headers, CLIENT_IP_HEADERS)
  if (!forwardedFor) return []

  return forwardedFor
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
}

const HOME_ORIGIN_TO_WORDS: Record<string, string> = {
  en: 'to', pl: 'do', de: 'nach', es: 'a', fr: 'vers', it: 'a', pt: 'para',
  nl: 'naar', sv: 'till', hr: 'u', sq: 'në', zh: 'to', ja: 'to',
}

function toHomeOriginLabel(code: string, locale: string, name: string | undefined, city: string | undefined): string {
  const toWord = HOME_ORIGIN_TO_WORDS[locale] ?? HOME_ORIGIN_TO_WORDS.en

  // Curated locale-aware name takes priority (en:'Gdansk', de:'Danzig', pl:'Gdańsk')
  const airportMatch = findBestMatch(code, locale)
  if (airportMatch) {
    return `${getAirportName(airportMatch, locale)} ${toWord}`
  }

  // Fall back to raw OurAirports city name, then stripped airport name
  const cityName = city?.trim() || name
    ?.replace(/\bInternational\b/gi, '')
    ?.replace(/\bAirport\b/gi, '')
    ?.replace(/\s{2,}/g, ' ')
    ?.trim() || code

  return `${cityName} ${toWord}`
}

function lookupGeoIp(clientIp: string): GeoIpLookup {
  if (geoIpLookup === undefined) {
    try {
      const geoip = require('geoip-lite') as { lookup?: (ip: string) => GeoIpLookup }
      geoIpLookup = typeof geoip.lookup === 'function' ? geoip.lookup.bind(geoip) : null
    } catch {
      geoIpLookup = null
    }
  }

  if (!geoIpLookup) {
    return null
  }

  try {
    return geoIpLookup(clientIp)
  } catch {
    return null
  }
}

export function resolveHomeOriginFromCoordinates(lat: number, lon: number, locale = 'en'): HomeOriginPrefill | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null

  const nearest = findNearestAirport(lat, lon)
  if (!nearest) return null

  const label = toHomeOriginLabel(nearest.c, locale, nearest.n, nearest.ci)
  return {
    code: nearest.c,
    label,
    city: nearest.ci?.trim() || label,
    country: nearest.co || null,
    latitude: lat,
    longitude: lon,
    source: 'geoip',
  }
}

export function resolveHomeOriginPrefill(headers: HeaderLike, locale = 'en'): HomeOriginPrefill | null {
  const hintedLat = readNumberHeader(headers, GEO_LATITUDE_HEADERS)
  const hintedLon = readNumberHeader(headers, GEO_LONGITUDE_HEADERS)

  if (hintedLat !== null && hintedLon !== null) {
    const hinted = resolveHomeOriginFromCoordinates(hintedLat, hintedLon, locale)
    if (hinted) {
      return {
        ...hinted,
        country: firstHeader(headers, GEO_COUNTRY_HEADERS)?.toUpperCase() || hinted.country,
        source: 'headers',
      }
    }
  }

  const clientIps = readClientIpCandidates(headers)
  if (clientIps.length === 0) return null

  for (const clientIp of clientIps) {
    const lookup = lookupGeoIp(clientIp)
    const lat = lookup?.ll?.[0]
    const lon = lookup?.ll?.[1]
    if (typeof lat !== 'number' || !Number.isFinite(lat)) continue
    if (typeof lon !== 'number' || !Number.isFinite(lon)) continue

    const resolved = resolveHomeOriginFromCoordinates(lat, lon, locale)
    if (!resolved) continue

    return {
      ...resolved,
      country: lookup?.country || resolved.country,
      source: 'geoip',
    }
  }

  return null
}