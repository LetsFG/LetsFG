'use client'

import { FormEvent, ReactNode, useState, useRef, useEffect, useLayoutEffect, KeyboardEvent, startTransition } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { findBestMatch, getAirportName, Airport, searchAirports } from './airports'
import { findNearestAirport } from './lib/nearby-airports'
import {
  CURRENCY_CHANGE_EVENT,
  readBrowserSearchCurrency,
  type CurrencyCode,
} from '../lib/currency-preference'

const DESTINATION_KEYS = [
  { key: 'barcelona', code: 'BCN', img: '/destinations/barcelona.jpg' },
  { key: 'tokyo',     code: 'NRT', img: '/destinations/tokyo.jpg' },
  { key: 'newYork',   code: 'JFK', img: '/destinations/newyork.jpg' },
  { key: 'paris',     code: 'CDG', img: '/destinations/paris.jpg' },
  { key: 'bali',      code: 'DPS', img: '/destinations/bali.jpg' },
  { key: 'dubai',     code: 'DXB', img: '/destinations/dubai.jpg' },
] as const

// "to" keyword in various languages
const TO_KEYWORDS: Record<string, string[]> = {
  en: ['to'],
  pl: ['do'],
  de: ['nach'],
  es: ['a', 'hacia'],
  fr: ['vers', 'à'],
  it: ['a', 'verso'],
  pt: ['para', 'a'],
  nl: ['naar'],
  sv: ['till'],
  hr: ['u', 'za'],
  sq: ['në', 'drejt'],
  zh: ['至', '到'],
  ja: ['へ', 'ゆき'],
}

// Return keywords
const RETURN_KEYWORDS: Record<string, string[]> = {
  en: ['returning', 'return', 'back'],
  pl: ['powrót', 'wracając'],
  de: ['zurück', 'rückkehr'],
  es: ['regreso', 'volviendo'],
  fr: ['retour'],
  it: ['ritorno'],
  pt: ['volta', 'retorno'],
  nl: ['terug', 'retour'],
  sv: ['tillbaka', 'retur'],
  hr: ['povratak'],
  sq: ['kthim'],
}

// Direct flight keywords
const DIRECT_KEYWORDS: Record<string, string[]> = {
  en: ['direct', 'nonstop', 'non-stop'],
  pl: ['bezpośredni', 'bezpośrednio'],
  de: ['direkt', 'nonstop'],
  es: ['directo', 'sin escalas'],
  fr: ['direct', 'sans escale'],
  it: ['diretto', 'senza scali'],
  pt: ['direto', 'sem escalas'],
  nl: ['direct', 'rechtstreeks'],
  sv: ['direkt'],
  hr: ['direktno', 'izravno'],
  sq: ['direkt'],
}

// Class keywords
const CLASS_KEYWORDS: Record<string, string[]> = {
  en: ['business', 'economy', 'first class', 'premium'],
  pl: ['biznes', 'ekonomiczna', 'pierwsza klasa'],
  de: ['business', 'economy', 'erste klasse'],
  es: ['business', 'económica', 'primera clase'],
  fr: ['affaires', 'économique', 'première classe'],
  it: ['business', 'economica', 'prima classe'],
  pt: ['executiva', 'econômica', 'primeira classe'],
  nl: ['business', 'economy', 'eerste klas'],
  sv: ['business', 'ekonomi', 'första klass'],
  hr: ['poslovna', 'ekonomska', 'prva klasa'],
  sq: ['biznes', 'ekonomike', 'klasa e parë'],
}

// Time filter keywords
const TIME_KEYWORDS: Record<string, string[]> = {
  en: ['morning', 'afternoon', 'evening', 'departing', 'leaving'],
  pl: ['rano', 'popołudniu', 'wieczorem', 'wylot'],
  de: ['morgens', 'nachmittags', 'abends', 'abflug'],
  es: ['mañana', 'tarde', 'noche', 'salida'],
  fr: ['matin', 'après-midi', 'soir', 'départ'],
  it: ['mattina', 'pomeriggio', 'sera', 'partenza'],
  pt: ['manhã', 'tarde', 'noite', 'partida'],
  nl: ['ochtend', 'middag', 'avond', 'vertrek'],
  sv: ['morgon', 'eftermiddag', 'kväll', 'avgång'],
  hr: ['ujutro', 'popodne', 'navečer', 'polazak'],
  sq: ['mëngjes', 'pasdite', 'mbrëmje', 'nisje'],
}

// Passenger / group context keywords (used for ghost-text suggestion detection)
const PASSENGER_KEYWORDS: Record<string, string[]> = {
  en: ['with kids', 'with children', 'with family', 'as a couple', 'solo', '2 adults', 'family of'],
  pl: ['z dziećmi', 'z rodziną', 'jako para', 'sam', '2 dorosłych'],
  de: ['mit kindern', 'mit der familie', 'als paar', 'alleine', '2 erwachsene'],
  es: ['con niños', 'con familia', 'en pareja', 'solo', '2 adultos'],
  fr: ['avec enfants', 'en famille', 'en couple', 'seul', '2 adultes'],
  it: ['con bambini', 'in famiglia', 'in coppia', 'da solo', '2 adulti'],
  pt: ['com crianças', 'em família', 'a dois', 'sozinho', '2 adultos'],
  nl: ['met kinderen', 'met gezin', 'als koppel', 'alleen', '2 volwassenen'],
  sv: ['med barn', 'med familj', 'som par', 'ensam', '2 vuxna'],
  hr: ['s djecom', 's obitelji', 'kao par', 'sam', '2 odrasla'],
  sq: ['me fëmijë', 'me familje', 'si çift', 'vetëm', '2 të rritur'],
}

// Ancillary / inclusion keywords (used for ghost-text suggestion detection)
const ANCILLARY_KEYWORDS: Record<string, string[]> = {
  en: ['with bags', 'with checked baggage', 'carry-on only', 'with seat selection', 'refundable', 'with meals'],
  pl: ['z bagażem', 'z wyborem miejsca', 'tylko bagaż podręczny', 'z posiłkiem'],
  de: ['mit gepäck', 'mit sitzplatzwahl', 'nur handgepäck', 'mit mahlzeit'],
  es: ['con equipaje', 'con selección de asiento', 'solo equipaje de mano', 'reembolsable'],
  fr: ['avec bagages', 'avec choix de siège', 'bagage cabine uniquement', 'remboursable'],
  it: ['con bagagli', 'con scelta del posto', 'solo bagaglio a mano', 'rimborsabile'],
  pt: ['com bagagem', 'com seleção de assento', 'só bagagem de mão', 'reembolsável'],
  nl: ['met bagage', 'met stoekkeuze', 'alleen handbagage', 'restitueerbaar'],
  sv: ['med bagage', 'med platsval', 'bara handbagage', 'återbetalningsbar'],
  hr: ['s prtljagom', 's odabirom sjedišta', 'samo ručna prtljaga'],
  sq: ['me bagazh', 'me zgjedhje vendi', 'vetëm bagazh dore'],
}


function PlaneIcon() {
  // Font Awesome 6 Free Solid — fa-plane-departure (CC BY 4.0)
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512" aria-hidden="true" className="lp-sf-icon" fill="currentColor">
      <path d="M372 143.9L172.7 40.2c-8-4.1-17.3-4.8-25.7-1.7l-41.1 15c-10.3 3.7-13.8 16.4-7.1 25L200.3 206.4 100.1 242.8 40 206.2c-6.2-3.8-13.8-4.5-20.7-2.1L3 210.1c-9.4 3.4-13.4 14.5-8.3 23.1l53.6 91.8c15.6 26.7 48.1 38.4 77.1 27.8l12.9-4.7 0 0 398.4-145c29.1-10.6 44-42.7 33.5-71.8s-42.7-44-71.8-33.5L372 143.9zM32.2 448c-17.7 0-32 14.3-32 32s14.3 32 32 32l512 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-512 0z"/>
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" className="lp-sf-icon" fill="none">
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="2.2" />
      <path d="M16 16l4 4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  )
}

function countryFlag(countryCode: string): string {
  const code = countryCode.toUpperCase()
  if (code.length !== 2) return '\u{1F30D}'
  return String.fromCodePoint(
    0x1F1E6 + code.charCodeAt(0) - 65,
    0x1F1E6 + code.charCodeAt(1) - 65,
  )
}

interface ParsedQuery {
  origin: string | null
  toKeyword: string | null
  destination: string | null
  hasOutboundDate: boolean
  hasReturnKeyword: boolean
  hasReturnDate: boolean
  hasDirectKeyword: boolean
  hasClassKeyword: boolean
  hasTimeKeyword: boolean
  hasPassengerKeyword: boolean   // "with kids", "2 adults", "as a couple", "solo", etc.
  hasAncillaryKeyword: boolean   // "with bags", "with seat selection", "refundable", etc.
  hasPurposeKeyword: boolean     // "honeymoon", "business trip", "ski trip", "beach holiday"
  hasTripDuration: boolean       // "for 2 weeks", "for 10 days", "14-day trip"
  remainder: string
}

function parseQuery(query: string, locale: string): ParsedQuery {
  const toWords = TO_KEYWORDS[locale] || TO_KEYWORDS.en
  const returnWords = RETURN_KEYWORDS[locale] || RETURN_KEYWORDS.en
  const directWords = DIRECT_KEYWORDS[locale] || DIRECT_KEYWORDS.en
  const classWords = CLASS_KEYWORDS[locale] || CLASS_KEYWORDS.en
  const timeWords = TIME_KEYWORDS[locale] || TIME_KEYWORDS.en
  
  const lowerQuery = query.toLowerCase()
  const words = query.split(/\s+/)
  
  let origin: string | null = null
  let toKeyword: string | null = null
  let destination: string | null = null
  let toIndex = -1
  
  // Find the "to" keyword
  for (let i = 0; i < words.length; i++) {
    const word = words[i].toLowerCase()
    if (toWords.includes(word)) {
      toKeyword = words[i]
      toIndex = i
      break
    }
  }
  
  if (toIndex > 0) {
    origin = words.slice(0, toIndex).join(' ')
    if (toIndex < words.length - 1) {
      destination = words.slice(toIndex + 1).join(' ')
    }
  } else if (toIndex === -1 && words.length > 0) {
    origin = words.join(' ')
  }
  
  // Check for date-like patterns (multiple dates possible)
  const dateMatches = query.match(/\d{1,2}[\s./\-]|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|sty|lut|kwi|maj|cze|lip|sie|wrz|paz|lis|gru|janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre|januar|februar|märz|april|juni|juli|august|september|oktober|november|dezember|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre|januari|februari|maart|mei|augustus|januari|februari|mars|maj|juni|juli|augusti|oktober|studenoga|prosinca|siječnja|veljače|ožujka|travnja|svibnja|lipnja|srpnja|kolovoza|rujna|listopada)/gi)
  const dateCount = dateMatches ? dateMatches.length : 0
  
  // Check for return keyword
  const hasReturnKeyword = returnWords.some(w => lowerQuery.includes(w.toLowerCase()))
  
  // Check for direct keyword
  const hasDirectKeyword = directWords.some(w => lowerQuery.includes(w.toLowerCase()))
  
  // Check for class keyword
  const hasClassKeyword = classWords.some(w => lowerQuery.includes(w.toLowerCase()))
  
  // Check for time keyword
  const hasTimeKeyword = timeWords.some(w => lowerQuery.includes(w.toLowerCase())) || 
                         /\b\d{1,2}(:|h)\d{0,2}\s*(am|pm)?\b/i.test(query) ||
                         /\b(after|before|between)\s+\d/i.test(query)

  // Check for passenger / group context keywords
  const passengerWords = PASSENGER_KEYWORDS[locale] || PASSENGER_KEYWORDS.en
  const hasPassengerKeyword = passengerWords.some(w => lowerQuery.includes(w.toLowerCase())) ||
    /\b(?:solo|alone|just\s+me|as\s+a\s+couple|with\s+(?:kids?|children|family|my\s+partner|my\s+wife|my\s+husband)|family\s+(?:trip|of)|group\s+of|\d+\s+(?:adults?|kids?|children|passengers?|people)|with\s+a\s+baby|honeymoon)\b/i.test(query)

  // Check for ancillary keywords
  const ancillaryWords = ANCILLARY_KEYWORDS[locale] || ANCILLARY_KEYWORDS.en
  const hasAncillaryKeyword = ancillaryWords.some(w => lowerQuery.includes(w.toLowerCase())) ||
    /\b(?:with\s+(?:bags?|checked?\s+bag|seat\s+selection|meals?|lounge)|carry[- ]?on\s+only|hand\s+luggage\s+only|refundable|free\s+cancellation|fully\s+flexible|window\s+seat|aisle\s+seat|extra\s+legroom)\b/i.test(query)

  // Check for trip purpose keywords
  const hasPurposeKeyword =
    /\b(?:honeymoon|romantic|anniversary|special\s+occasion|birthday\s+(?:trip|holiday|getaway)|celebration\s+(?:trip|holiday|getaway)|business\s+trip|for\s+work|ski(?:ing)?\s+(?:trip|holiday)|beach\s+(?:trip|holiday|vacation)|city\s+break|weekend\s+(?:trip|break|getaway)|long\s+weekend)\b/i.test(query)

  // Check for trip duration keywords
  const hasTripDuration =
    /\bfor\s+\d+\s+(?:days?|nights?|weeks?)\b|\b\d+[- ]\d+\s+(?:days?|nights?)\b|\bfor\s+a\s+(?:week|fortnight|two\s+weeks)\b/i.test(query)
  
  return {
    origin,
    toKeyword,
    destination,
    hasOutboundDate: dateCount >= 1,
    hasReturnKeyword,
    hasReturnDate: dateCount >= 2 || (hasReturnKeyword && dateCount >= 1),
    hasDirectKeyword,
    hasClassKeyword,
    hasTimeKeyword,
    hasPassengerKeyword,
    hasAncillaryKeyword,
    hasPurposeKeyword,
    hasTripDuration,
    remainder: query,
  }
}

// Determine which slot the user is currently filling and return top airport suggestions
function computeDropdown(query: string, locale: string): { airports: Airport[]; slot: 'origin' | 'destination' } {
  if (!query || query.length < 2) return { airports: [], slot: 'origin' }
  const parsed = parseQuery(query, locale)
  // Don't show while typing dates/return/etc.
  if (parsed.hasOutboundDate) return { airports: [], slot: 'origin' }
  // Destination slot — suppress if user is typing an "anywhere" keyword
  const anywhereRe = /^(?:anywhere|wherever|any\s+(?:destination|place|airport|country)|surprise\s+me)/i
  if (parsed.toKeyword && parsed.destination && parsed.destination.trim().length >= 2) {
    if (anywhereRe.test(parsed.destination.trim())) return { airports: [], slot: 'destination' }
    return { airports: searchAirports(parsed.destination.trim(), locale, 6), slot: 'destination' }
  }
  // Origin slot (no "to" yet)
  if (!parsed.toKeyword && parsed.origin && parsed.origin.trim().length >= 2) {
    return { airports: searchAirports(parsed.origin.trim(), locale, 6), slot: 'origin' }
  }
  return { airports: [], slot: 'origin' }
}

// Build the new query string after selecting an airport from the dropdown
function insertAirport(
  parsed: ParsedQuery,
  airport: Airport,
  slot: 'origin' | 'destination',
  locale: string,
): string {
  const name = getAirportName(airport, locale)
  if (slot === 'origin') {
    if (parsed.toKeyword) {
      return `${name} ${parsed.toKeyword}${parsed.destination ? ' ' + parsed.destination : ' '}`
    }
    return name + ' '
  }
  // destination: keep origin + toKeyword, replace destination text
  const originPart = parsed.origin || ''
  const toWord = parsed.toKeyword || (TO_KEYWORDS[locale] || TO_KEYWORDS.en)[0]
  return `${originPart} ${toWord} ${name}`
}

// Set to true to skip the API call and go straight to the loading UI demo
const DEMO_LOADING = false
const PREFIRED_SEARCH_TTL_MS = 3 * 60 * 1000

interface HomeSearchFormProps {
  initialQuery?: string
  initialDetectedOrigin?: string
  initialCurrency?: CurrencyCode
  compact?: boolean
  autoFocus?: boolean
  probeMode?: boolean
  onSearchStart?: (query: string) => void
  belowFormSlot?: ReactNode
}

const AUTO_PREFILL_FALLBACK_SUFFIXES: Record<string, string> = {
  en: ' to Tokyo next month, cheapest option, direct flights only, business trip, need to land by 3pm…',
  pl: ' do Tokio w przyszłym miesiącu, najtańsza opcja, tylko bezpośrednie, wyjazd służbowy, muszę dolecieć do 15:00…',
}

const lsKeyHomeOriginPrefill = (locale: string) => `lfg_home_origin_prefill_v4_${locale}`
const ssKeyHomeOriginIpLookupAttempted = (locale: string) => `lfg_home_origin_ip_lookup_attempted_v4_${locale}`

function buildAutoPrefillGhostSuffix(locale: string, placeholder: string, prefill?: string): string {
  const cleaned = placeholder.replace(/^try:\s*/i, '').trim()
  const toWords = TO_KEYWORDS[locale] || TO_KEYWORDS.en
  const lower = cleaned.toLowerCase()
  const prefillLower = (prefill || '').trim().toLowerCase()

  for (const toWord of toWords) {
    const toWordLower = toWord.toLowerCase()
    const idx = lower.indexOf(` ${toWordLower} `)
    if (idx >= 0) {
      // If the prefill already ends with the "to" keyword, skip it in the ghost suffix
      // so we don't display "Gdansk to to Tokyo..." — just "Gdansk to Tokyo..."
      if (prefillLower.endsWith(` ${toWordLower}`) || prefillLower === toWordLower) {
        return cleaned.slice(idx + 1 + toWordLower.length)
      }
      return cleaned.slice(idx)
    }
  }

  return AUTO_PREFILL_FALLBACK_SUFFIXES[locale] || AUTO_PREFILL_FALLBACK_SUFFIXES.en
}

function resolveAutoPrefillOriginFromCoordinates(lat: number, lon: number, locale: string): string {
  const nearest = findNearestAirport(lat, lon)
  if (!nearest) return ''

  const toWord = (TO_KEYWORDS[locale] || TO_KEYWORDS.en)[0]

  // Curated locale-aware name takes priority (en:'Gdansk', de:'Danzig', pl:'Gdańsk')
  const airportMatch = findBestMatch(nearest.c, locale)
  if (airportMatch) {
    return `${getAirportName(airportMatch, locale)} ${toWord}`
  }

  // Fall back to raw OurAirports city name, then stripped airport name
  const cityName = nearest.ci?.trim() || nearest.n
    ?.replace(/\bInternational\b/gi, '')
    ?.replace(/\bAirport\b/gi, '')
    ?.replace(/\s{2,}/g, ' ')
    ?.trim() || nearest.c

  return `${cityName} ${toWord}`
}

async function loadPassiveIpCoordinates(signal: AbortSignal): Promise<{ latitude: number; longitude: number } | null> {
  try {
    const response = await fetch('https://ipinfo.io/json', {
      cache: 'no-store',
      signal,
    })
    if (response.ok) {
      const data = (await response.json()) as { loc?: string }
      const [latRaw = '', lonRaw = ''] = data.loc?.split(',') ?? []
      const latitude = Number.parseFloat(latRaw)
      const longitude = Number.parseFloat(lonRaw)
      if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
        return { latitude, longitude }
      }
    }
  } catch {
    // Fall through to the secondary passive IP provider.
  }

  try {
    const response = await fetch('https://ipapi.co/json/', {
      cache: 'no-store',
      signal,
    })
    if (!response.ok) return null

    const data = (await response.json()) as {
      latitude?: number
      longitude?: number
    }
    const latitude = data.latitude ?? Number.NaN
    const longitude = data.longitude ?? Number.NaN
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null

    return { latitude, longitude }
  } catch {
    return null
  }
}

export default function HomeSearchForm({
  initialQuery = '',
  initialDetectedOrigin = '',
  initialCurrency = 'EUR',
  compact = false,
  autoFocus = true,
  probeMode = false,
  onSearchStart,
  belowFormSlot,
}: HomeSearchFormProps = {}) {
  const router = useRouter()
  const locale = useLocale()
  const td = useTranslations('destinations')
  const th = useTranslations('hero')
  const normalizedInitialQuery = initialQuery.trim()
  const normalizedDetectedOrigin = normalizedInitialQuery ? '' : initialDetectedOrigin.trim()
  const [inputValue, setInputValue] = useState(normalizedInitialQuery || normalizedDetectedOrigin)
  const [query, setQuery] = useState(normalizedInitialQuery || normalizedDetectedOrigin)
  const [prefCurrency, setPrefCurrency] = useState<CurrencyCode>(initialCurrency)
  const [suggestion, setSuggestion] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [dropdownItems, setDropdownItems] = useState<Airport[]>([])
  const [dropdownSlot, setDropdownSlot] = useState<'origin' | 'destination'>('origin')
  const [dropdownActiveIdx, setDropdownActiveIdx] = useState(-1)
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const [mounted, setMounted] = useState(false)
  const [autoPrefillOrigin, setAutoPrefillOrigin] = useState(normalizedDetectedOrigin)
  const formRef = useRef<HTMLFormElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const dropdownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const queryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const suppressDropdownRef = useRef(false)
  const userEditedAutoPrefillRef = useRef(false)

  const DESTINATIONS = DESTINATION_KEYS.map((d) => ({
    ...d,
    city: td(d.key),
    query: td(`${d.key}_query`),
  }))

  // Drag-to-scroll (no pointer capture so child button clicks still fire)
  useEffect(() => {
    const el = rowRef.current
    if (!el) return
    let isDown = false, startX = 0, scrollLeft = 0, totalDrag = 0
    const onMouseDown = (e: MouseEvent) => {
      isDown = true
      totalDrag = 0
      startX = e.pageX
      scrollLeft = el.scrollLeft
      el.style.cursor = 'grabbing'
    }
    const onMouseUp = () => {
      isDown = false
      el.style.cursor = ''
    }
    const onMouseMove = (e: MouseEvent) => {
      if (!isDown) return
      const dx = e.pageX - startX
      // Track peak displacement from origin (not accumulated), so small wobbles don't block clicks
      totalDrag = Math.max(totalDrag, Math.abs(dx))
      el.scrollLeft = scrollLeft - dx
    }
    const onClick = (e: MouseEvent) => {
      // Block click if user dragged more than 5px from the start position
      if (totalDrag > 5) e.stopPropagation()
    }
    el.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mouseup', onMouseUp)
    window.addEventListener('mousemove', onMouseMove)
    el.addEventListener('click', onClick, true)
    return () => {
      el.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('mousemove', onMouseMove)
      el.removeEventListener('click', onClick, true)
    }
  }, [])

  // useLayoutEffect so this fires synchronously after DOM commit, before any useEffect.
  // This means when the query-debounce useEffect runs it sees inputValue = cached value
  // (not ''), so its 80 ms timer never fires setQuery('') and there is no race condition.
  useLayoutEffect(() => {
    const nextInitialQuery = initialQuery.trim()
    const nextDetectedOrigin = nextInitialQuery ? '' : initialDetectedOrigin.trim()
    userEditedAutoPrefillRef.current = false

    if (nextInitialQuery || nextDetectedOrigin) {
      setAutoPrefillOrigin(nextDetectedOrigin)
      setInputValue(nextInitialQuery || nextDetectedOrigin)
      setQuery(nextInitialQuery || nextDetectedOrigin)
      return
    }

    try {
      const cached = localStorage.getItem(lsKeyHomeOriginPrefill(locale))?.trim() || ''
      if (cached) {
        setAutoPrefillOrigin(cached)
        setInputValue(cached)
        setQuery(cached)
        return
      }
    } catch {
      // Ignore storage failures (private mode, etc.)
    }

    setAutoPrefillOrigin('')
    setInputValue('')
    setQuery('')
  }, [initialDetectedOrigin, initialQuery])

  useEffect(() => {
    const normalizedOrigin = initialDetectedOrigin.trim()
    if (!normalizedOrigin) return

    try {
      localStorage.setItem(lsKeyHomeOriginPrefill(locale), normalizedOrigin)
    } catch {
      // Ignore storage failures in private mode.
    }
  }, [initialDetectedOrigin])

  useEffect(() => {
    if (normalizedInitialQuery || normalizedDetectedOrigin || autoPrefillOrigin) return

    try {
      const cachedOrigin = localStorage.getItem(lsKeyHomeOriginPrefill(locale))?.trim() || ''
      if (cachedOrigin && !userEditedAutoPrefillRef.current) {
        // Don't check inputRef.current.value here — userEditedAutoPrefillRef.current=false
        // already guarantees the user hasn't typed anything. The extra DOM check was
        // incorrectly blocking the restore when Chrome autofills name="q" on hard refresh.
        setAutoPrefillOrigin(cachedOrigin)
        setInputValue(cachedOrigin)
        setQuery(cachedOrigin)
        return
      }

      if (sessionStorage.getItem(ssKeyHomeOriginIpLookupAttempted(locale))) return
      sessionStorage.setItem(ssKeyHomeOriginIpLookupAttempted(locale), '1')
    } catch {
      // Ignore storage failures in private mode.
    }

    if (typeof window === 'undefined') return

    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 4000)

    void loadPassiveIpCoordinates(controller.signal).then((data) => {
      if (!data) return

      const detectedOrigin = resolveAutoPrefillOriginFromCoordinates(
        data.latitude,
        data.longitude,
        locale,
      )
      if (!detectedOrigin || userEditedAutoPrefillRef.current) return

      const currentValue = inputRef.current?.value.trim() ?? ''
      if (currentValue) return

      try {
        localStorage.setItem(lsKeyHomeOriginPrefill(locale), detectedOrigin)
      } catch {
        // Ignore storage failures in private mode.
      }

      setAutoPrefillOrigin(detectedOrigin)
      setInputValue(detectedOrigin)
      setQuery(detectedOrigin)
    }).catch(() => {
      // Ignore passive IP lookup failures; the form still works normally.
    }).finally(() => {
      window.clearTimeout(timeoutId)
    })
  }, [autoPrefillOrigin, normalizedDetectedOrigin, normalizedInitialQuery])

  useEffect(() => {
    setPrefCurrency(readBrowserSearchCurrency(initialCurrency))
    const sync = () => setPrefCurrency(readBrowserSearchCurrency(initialCurrency))
    window.addEventListener(CURRENCY_CHANGE_EVENT, sync)
    return () => window.removeEventListener(CURRENCY_CHANGE_EVENT, sync)
  }, [initialCurrency])

  // ── Date-clarification state ─────────────────────────────────────────────────
  const heroPlaceholder = th('placeholder')
  const autoPrefillPristine = !!autoPrefillOrigin && !userEditedAutoPrefillRef.current && query.trim() === autoPrefillOrigin

  const handleInputChange = (nextValue: string) => {
    if (autoPrefillOrigin && nextValue !== autoPrefillOrigin) {
      userEditedAutoPrefillRef.current = true
    }
    setInputValue(nextValue)
  }

  useEffect(() => {
    router.prefetch(`/${locale}/confirm`)
  }, [router, locale])

  const handleSearch = async (event: FormEvent) => {
    event.preventDefault()
    setDropdownItems([])
    setDropdownActiveIdx(-1)
    setDropdownPos(null)
    const trimmed = inputValue.trim()
    if (!trimmed) return
    onSearchStart?.(trimmed)
    setIsLoading(true)

    const params = new URLSearchParams()
    params.set('q', trimmed)
    if (prefCurrency) params.set('cur', prefCurrency)
    if (probeMode) params.set('probe', '1')
    const sp = new URLSearchParams(window.location.search)
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
      const val = sp.get(key)
      if (val) params.set(key, val)
    }
    router.push(`/${locale}/confirm?${params.toString()}`)
  }

  // Select an airport from the dropdown and insert it into the query
  const handleDropdownSelect = (airport: Airport) => {
    const parsed = parseQuery(inputValue, locale)
    const newQuery = insertAirport(parsed, airport, dropdownSlot, locale)
    suppressDropdownRef.current = true
    setInputValue(newQuery)
    setQuery(newQuery)
    setDropdownItems([])
    setDropdownActiveIdx(-1)
    setDropdownPos(null)
    setTimeout(() => {
      const input = inputRef.current
      if (input) {
        input.focus()
        input.setSelectionRange(newQuery.length, newQuery.length)
      }
    }, 0)
  }

  // Set mounted flag for portal
  useEffect(() => { setMounted(true) }, [])

  // Debounce syncing inputValue → query (drives suggestion + dropdown).
  // The input itself always updates instantly via inputValue.
  useEffect(() => {
    if (queryTimerRef.current) clearTimeout(queryTimerRef.current)
    queryTimerRef.current = setTimeout(() => {
      startTransition(() => { setQuery(inputValue) })
    }, 80)
    return () => { if (queryTimerRef.current) clearTimeout(queryTimerRef.current) }
  }, [inputValue])

  // Suggestion updates when autoPrefill state changes (typing suggestions removed — caused lag)
  useEffect(() => {
    if (autoPrefillPristine) {
      setSuggestion(buildAutoPrefillGhostSuffix(locale, heroPlaceholder, autoPrefillOrigin))
      return
    }
    setSuggestion('')
  }, [autoPrefillPristine, heroPlaceholder, locale])

  // Dropdown updates debounced + deferred via startTransition so typing is never blocked
  useEffect(() => {
    if (dropdownTimerRef.current) clearTimeout(dropdownTimerRef.current)
    dropdownTimerRef.current = setTimeout(() => {
      if (autoPrefillPristine) {
        startTransition(() => {
          setDropdownItems([])
          setDropdownActiveIdx(-1)
          setDropdownPos(null)
        })
        return
      }
      if (suppressDropdownRef.current) { suppressDropdownRef.current = false; return }
      const { airports, slot } = computeDropdown(query, locale)
      startTransition(() => {
        setDropdownItems(airports)
        setDropdownSlot(slot)
        setDropdownActiveIdx(-1)
        if (airports.length > 0 && frameRef.current) {
          const r = frameRef.current.getBoundingClientRect()
          setDropdownPos({ top: r.bottom + 8, left: r.left, width: r.width })
        } else {
          setDropdownPos(null)
        }
      })
    }, 120)
    return () => { if (dropdownTimerRef.current) clearTimeout(dropdownTimerRef.current) }
  }, [autoPrefillPristine, query, locale])

  // Recompute dropdown position on scroll/resize while it's open
  useEffect(() => {
    if (!dropdownItems.length) return
    const update = () => {
      if (frameRef.current) {
        const r = frameRef.current.getBoundingClientRect()
        setDropdownPos({ top: r.bottom + 8, left: r.left, width: r.width })
      }
    }
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [dropdownItems.length])

  // Handle keyboard navigation for dropdown + Tab to accept ghost suggestion
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (dropdownItems.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setDropdownActiveIdx(prev => Math.min(prev + 1, dropdownItems.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setDropdownActiveIdx(prev => Math.max(prev - 1, -1))
        return
      }
      if (e.key === 'Enter' && dropdownActiveIdx >= 0) {
        e.preventDefault()
        handleDropdownSelect(dropdownItems[dropdownActiveIdx])
        return
      }
      if (e.key === 'Escape') {
        setDropdownItems([])
        setDropdownActiveIdx(-1)
        return
      }
    }
    if (e.key === 'Tab' && suggestion && !e.shiftKey) {
      e.preventDefault()
      const newVal = inputValue + suggestion
      setInputValue(newVal)
      setQuery(newVal)
    }
  }

  return (
    <div className={`lp-sf-wrap${compact ? ' lp-sf-wrap--compact' : ''}`}>
      {!compact && (
        <div className="lp-sf-disclosure" aria-hidden="false">
          <span className="lp-sf-legal" tabIndex={0} role="note">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.4" />
              <path d="M7 6v4M7 4.5v.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            <span className="lp-sf-legal-tip" role="tooltip">
              By searching, you authorise AI agents to act on your behalf — they connect to airline
              websites and search for flights as you instructed. You are the one directing these
              agents. LetsFG provides the automation; you are responsible for the searches you initiate.
            </span>
          </span>
        </div>
      )}

      <form ref={formRef} id="home-search-form" onSubmit={handleSearch} className="lp-sf-form">
        <div className="lp-sf-frame-wrap" ref={frameRef}>
        <div className="lp-sf-frame">
          <div className="lp-sf-input-wrap">
            <span className="lp-sf-leading" aria-hidden="true">
              <SearchIcon />
            </span>
            <input
              ref={inputRef}
              id="trip-query"
              name="q"
              type="text"
              className="lp-sf-input"
              placeholder={th('placeholder')}
              value={inputValue}
              onChange={(event) => handleInputChange(event.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={() => setTimeout(() => { setDropdownItems([]); setDropdownActiveIdx(-1); setDropdownPos(null) }, 150)}
              disabled={DEMO_LOADING && isLoading}
              autoFocus={autoFocus}
              autoComplete="off"
              spellCheck={false}
            />
            {suggestion && (
              <span className="lp-sf-ghost" aria-hidden="true">
                <span className="lp-sf-ghost-inner">
                  <span className="lp-sf-ghost-hidden">{inputValue}</span>
                  <span className="lp-sf-ghost-suggestion">{suggestion}</span>
                </span>
              </span>
            )}
          </div>
          <button
            type="submit"
            className="lp-sf-button"
            disabled={(DEMO_LOADING && isLoading) || !inputValue.trim()}
            aria-label={isLoading ? 'Searching flights' : 'Search flights'}
          >
            <PlaneIcon />
          </button>
        </div>

        </div>

        {mounted && dropdownItems.length > 0 && dropdownPos && createPortal(
          <div
            className="lp-sf-dropdown"
            style={{ position: 'fixed', top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }}
            role="listbox"
            aria-label="Airport suggestions"
          >
            {dropdownItems.map((airport, idx) => (
              <button
                key={airport.code}
                type="button"
                role="option"
                aria-selected={idx === dropdownActiveIdx}
                className={'lp-sf-dropdown-item' + (idx === dropdownActiveIdx ? ' lp-sf-dropdown-item--active' : '')}
                onMouseDown={(e) => { e.preventDefault(); handleDropdownSelect(airport) }}
              >
                <span className="lp-sf-dropdown-flag" aria-hidden="true">{countryFlag(airport.country)}</span>
                <span className="lp-sf-dropdown-name">
                  {getAirportName(airport, locale)}
                  {airport.isCity && <span className="lp-sf-dropdown-any"> · Any airport</span>}
                </span>
                <span className="lp-sf-dropdown-code">{airport.code}</span>
              </button>
            ))}
          </div>,
          document.body
        )}
      </form>

      {!compact && (
        <button
          type="submit"
          form="home-search-form"
          className={`lp-sf-sticky-btn${isLoading ? ' lp-sf-sticky-btn--busy' : ''}`}
          disabled={(DEMO_LOADING && isLoading) || !inputValue.trim()}
          aria-label={isLoading ? 'Searching flights' : 'Find my flights'}
        >
          <span className="lp-sf-sticky-btn-text">{isLoading ? 'Searching…' : 'Find my flights'}</span>
          <PlaneIcon />
        </button>
      )}

      {!compact && belowFormSlot}

      {!compact && (
        <div className="lp-dest-row" aria-label="Popular destinations">
          <div className="lp-dest-track" ref={rowRef}>
            {DESTINATIONS.map((dest) => (
              <button
                key={dest.code}
                type="button"
                className="lp-dest-card"
                onClick={() => {
                  setInputValue(dest.query)
                  setQuery(dest.query)
                  setTimeout(() => {
                    const input = inputRef.current
                    if (input) {
                      input.focus()
                      input.setSelectionRange(dest.query.length, dest.query.length)
                    }
                  }, 0)
                }}
                onMouseMove={(e) => {
                  const r = e.currentTarget.getBoundingClientRect()
                  const x = ((e.clientX - r.left) / r.width - 0.5) * 7
                  const y = ((e.clientY - r.top) / r.height - 0.5) * 5
                  e.currentTarget.style.setProperty('--mx', `${x}px`)
                  e.currentTarget.style.setProperty('--my', `${y}px`)
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.setProperty('--mx', '0px')
                  e.currentTarget.style.setProperty('--my', '0px')
                }}
              >
                <img src={dest.img} alt={dest.city} className="lp-dest-img" loading="lazy" draggable={false} />
                <div className="lp-dest-overlay" />
                <span className="lp-dest-city">{dest.city}</span>
                <span className="lp-dest-code">{dest.code}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}