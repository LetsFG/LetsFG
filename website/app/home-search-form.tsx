'use client'

import { FormEvent, useState, useRef, useEffect, useCallback, KeyboardEvent, startTransition } from 'react'
import { createPortal } from 'react-dom'
import { useRouter, useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { findBestMatch, getAirportName, normalizeForSearch, AIRPORTS, Airport, searchAirports } from './airports'
import {
  CURRENCY_CHANGE_EVENT,
  readBrowserSearchCurrency,
  type CurrencyCode,
} from '../lib/currency-preference'
import { parseNLQuery } from './lib/searchParsing'

const DESTINATION_KEYS = [
  { key: 'barcelona', code: 'BCN', flag: '/flags/es.svg', img: '/destinations/barcelona.jpg' },
  { key: 'tokyo',     code: 'NRT', flag: '/flags/jp.svg', img: '/destinations/tokyo.jpg' },
  { key: 'newYork',   code: 'JFK', flag: '/flags/us.svg', img: '/destinations/newyork.jpg' },
  { key: 'paris',     code: 'CDG', flag: '/flags/fr.svg', img: '/destinations/paris.jpg' },
  { key: 'bali',      code: 'DPS', flag: '/flags/id.svg', img: '/destinations/bali.jpg' },
  { key: 'dubai',     code: 'DXB', flag: '/flags/ae.svg', img: '/destinations/dubai.jpg' },
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

// Month names by locale
const MONTH_NAMES: Record<string, string[]> = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  pl: ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'],
  de: ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'],
  es: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
  fr: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
  it: ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'],
  pt: ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'],
  nl: ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'],
  sv: ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'],
  hr: ['siječnja', 'veljače', 'ožujka', 'travnja', 'svibnja', 'lipnja', 'srpnja', 'kolovoza', 'rujna', 'listopada', 'studenoga', 'prosinca'],
  sq: ['janar', 'shkurt', 'mars', 'prill', 'maj', 'qershor', 'korrik', 'gusht', 'shtator', 'tetor', 'nëntor', 'dhjetor'],
}

// Ordinal suffixes for English
function getOrdinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

// Generate a dynamic date suggestion based on current date
function generateDateSuggestion(locale: string, isReturn: boolean = false): string {
  const now = new Date()
  // Random offset: 7-60 days for outbound, +3-14 days for return
  const baseOffset = isReturn ? 3 : 7
  const randomOffset = Math.floor(Math.random() * (isReturn ? 12 : 54)) + baseOffset
  const targetDate = new Date(now.getTime() + randomOffset * 24 * 60 * 60 * 1000)
  
  const day = targetDate.getDate()
  const month = targetDate.getMonth()
  const months = MONTH_NAMES[locale] || MONTH_NAMES.en
  const monthName = months[month]
  
  // Format varies by locale
  switch (locale) {
    case 'en':
      return `on ${monthName} ${getOrdinal(day)}`
    case 'pl':
      return `${day} ${monthName}`
    case 'de':
      return `am ${day}. ${monthName}`
    case 'es':
      return `el ${day} de ${monthName}`
    case 'fr':
      return `le ${day} ${monthName}`
    case 'it':
      return `il ${day} ${monthName}`
    case 'pt':
      return `${day} de ${monthName}`
    case 'nl':
      return `op ${day} ${monthName}`
    case 'sv':
      return `den ${day} ${monthName}`
    case 'hr':
      return `${day}. ${monthName}`
    case 'sq':
      return `më ${day} ${monthName}`
    default:
      return `on ${monthName} ${getOrdinal(day)}`
  }
}

// Generate return date suggestion
function generateReturnSuggestion(locale: string): string {
  const returnWord = (RETURN_KEYWORDS[locale] || RETURN_KEYWORDS.en)[0]
  const dateSuggestion = generateDateSuggestion(locale, true)
  return `, ${returnWord} ${dateSuggestion}`
}

// Generate direct flight suggestion
function generateDirectSuggestion(locale: string): string {
  const directWord = (DIRECT_KEYWORDS[locale] || DIRECT_KEYWORDS.en)[0]
  return `, ${directWord}`
}

// Generate class suggestion
function generateClassSuggestion(locale: string): string {
  const classes = CLASS_KEYWORDS[locale] || CLASS_KEYWORDS.en
  // Randomly pick business or economy
  const classWord = Math.random() > 0.5 ? classes[0] : classes[1]
  return `, ${classWord}`
}

// Generate time filter suggestion
function generateTimeSuggestion(locale: string): string {
  const times = TIME_KEYWORDS[locale] || TIME_KEYWORDS.en
  const timeOptions: Record<string, string> = {
    en: ['morning departure', 'afternoon flight', 'evening departure', 'departing after 2pm', 'leaving before noon'][Math.floor(Math.random() * 5)],
    pl: ['wylot rano', 'lot popołudniowy', 'wylot wieczorem', 'wylot po 14:00'][Math.floor(Math.random() * 4)],
    de: ['morgens abflug', 'nachmittags', 'abends abflug', 'abflug nach 14 Uhr'][Math.floor(Math.random() * 4)],
    es: ['salida por la mañana', 'vuelo de tarde', 'salida por la noche'][Math.floor(Math.random() * 3)],
    fr: ['départ le matin', 'vol l\'après-midi', 'départ le soir'][Math.floor(Math.random() * 3)],
    it: ['partenza di mattina', 'volo pomeridiano', 'partenza di sera'][Math.floor(Math.random() * 3)],
    pt: ['partida de manhã', 'voo à tarde', 'partida à noite'][Math.floor(Math.random() * 3)],
    nl: ['ochtend vertrek', 'middag vlucht', 'avond vertrek'][Math.floor(Math.random() * 3)],
    sv: ['avgång på morgonen', 'eftermiddagsflyg', 'kvällsavgång'][Math.floor(Math.random() * 3)],
    hr: ['polazak ujutro', 'popodnevni let', 'večernji polazak'][Math.floor(Math.random() * 3)],
    sq: ['nisje në mëngjes', 'fluturim pasdite', 'nisje në mbrëmje'][Math.floor(Math.random() * 3)],
  }
  return `, ${timeOptions[locale] || timeOptions.en}`
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
    /\b(?:honeymoon|romantic|anniversary|business\s+trip|for\s+work|ski(?:ing)?\s+(?:trip|holiday)|beach\s+(?:trip|holiday|vacation)|city\s+break|weekend\s+(?:trip|break|getaway)|long\s+weekend)\b/i.test(query)

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

function getSuggestion(query: string, locale: string): string {
  if (!query || query.length < 2) return ''
  
  const parsed = parseQuery(query, locale)
  const toWord = (TO_KEYWORDS[locale] || TO_KEYWORDS.en)[0]
  
  // Helper to get airport name completion
  const getNameCompletion = (input: string, airport: Airport): string => {
    const fullName = getAirportName(airport, locale)
    const normalizedInput = normalizeForSearch(input)
    const normalizedFull = normalizeForSearch(fullName)
    
    if (!normalizedFull.startsWith(normalizedInput) || normalizedInput.length >= normalizedFull.length) {
      return ''
    }
    
    let completionStart = input.length
    let matchedSoFar = 0
    for (let i = 0; i < fullName.length && matchedSoFar < input.length; i++) {
      const fullChar = normalizeForSearch(fullName[i])
      const inputChar = normalizeForSearch(input[matchedSoFar])
      if (fullChar === inputChar) {
        matchedSoFar++
        completionStart = i + 1
      }
    }
    
    return fullName.slice(completionStart)
  }
  
  // Helper to get trailing partial word from query (after last space/comma)
  const getTrailingPartial = (): string => {
    const trimmed = query.trimEnd()
    const lastSep = Math.max(trimmed.lastIndexOf(' '), trimmed.lastIndexOf(','))
    if (lastSep === -1) return trimmed.toLowerCase()
    return trimmed.slice(lastSep + 1).trim().toLowerCase()
  }
  
  // Helper to find keyword completion - checks if partial is prefix of any keyword
  const getKeywordCompletion = (partial: string, keywords: string[]): string | null => {
    if (!partial || partial.length < 2) return null
    const lowerPartial = partial.toLowerCase()
    for (const kw of keywords) {
      if (kw.toLowerCase().startsWith(lowerPartial) && kw.toLowerCase() !== lowerPartial) {
        return kw.slice(partial.length)
      }
    }
    return null
  }
  
  // Stage 1: Just typing origin (no "to" yet)
  if (!parsed.toKeyword && parsed.origin) {
    const match = findBestMatch(parsed.origin, locale)
    if (match) {
      const completion = getNameCompletion(parsed.origin, match)
      if (completion) {
        return completion + ' ' + toWord + ' ...'
      }
    }
    return ''
  }
  
  // Stage 2: Has "to" but no destination yet
  if (parsed.toKeyword && !parsed.destination) {
    return ' ...'
  }
  
  // Stage 3+: Has "to" and destination (possibly partial)
  if (parsed.toKeyword && parsed.destination) {
    // If user is typing "anywhere" / "wherever" / etc — confirm the open-search intent
    const anywhereRe = /^(?:anywhere|wherever|any(?:\s+(?:destination|place|airport|country))?|surprise\s*me)/i
    if (anywhereRe.test(parsed.destination.trim())) {
      return ''
    }

    // Only do airport matching while destination is still being typed (no date yet)
    if (!parsed.hasOutboundDate) {
      const match = findBestMatch(parsed.destination, locale)
      if (match) {
        const completion = getNameCompletion(parsed.destination, match)
        if (completion) {
          // Suggest rest of destination + outbound date
          return completion + ' ' + generateDateSuggestion(locale)
        }
      }
    }
    
    // Stage 4: Need outbound date
    if (!parsed.hasOutboundDate) {
      return ' ' + generateDateSuggestion(locale)
    }
    
    // Stage 5: Have outbound date, suggest return or trip duration
    if (parsed.hasOutboundDate && !parsed.hasReturnKeyword && !parsed.hasReturnDate) {
      const trailing = getTrailingPartial()
      const returnKeywords = RETURN_KEYWORDS[locale] || RETURN_KEYWORDS.en
      const completion = getKeywordCompletion(trailing, returnKeywords)
      if (completion !== null) {
        // User is typing return keyword - complete it + add date
        const returnDate = generateReturnSuggestion(locale)
        // returnDate is like ", returning on May 5th" - extract just the date part
        const dateMatch = returnDate.match(/\d+/)
        if (dateMatch) {
          const months = MONTH_NAMES[locale] || MONTH_NAMES.en
          const futureDate = new Date()
          futureDate.setDate(futureDate.getDate() + 7 + Math.floor(Math.random() * 54) + 3 + Math.floor(Math.random() * 12))
          const month = months[futureDate.getMonth()]
          const day = futureDate.getDate()
          return completion + ' ' + month + ' ' + day
        }
        return completion
      }
      // Check if query ends with comma or space (ready for return keyword or trip duration)
      const endsWithSep = query.endsWith(',') || query.endsWith(', ') || query.endsWith(' ')
      if (endsWithSep) {
        // Alternate between suggesting a return date and a trip duration range
        if (Math.random() < 0.4) {
          // Suggest trip duration style: "for 7-10 days"
          const durSuggestion = generateTripDurationSuggestion(locale)
          const trimmed = durSuggestion.replace(/^[,\s]+/, '')
          return (query.endsWith(', ') || query.endsWith(' ')) ? trimmed : ' ' + trimmed
        }
        // Suggest full return phrase but without leading comma/space
        const returnKw = returnKeywords[0]
        const months = MONTH_NAMES[locale] || MONTH_NAMES.en
        const futureDate = new Date()
        futureDate.setDate(futureDate.getDate() + 7 + Math.floor(Math.random() * 54) + 3 + Math.floor(Math.random() * 12))
        const month = months[futureDate.getMonth()]
        const day = futureDate.getDate()
        if (query.endsWith(', ') || query.endsWith(' ')) {
          return returnKw + ' ' + month + ' ' + day
        }
        return ' ' + returnKw + ' ' + month + ' ' + day
      }
      return generateReturnSuggestion(locale)
    }
    
    // Stage 6: Have return, suggest direct (or complete partial direct keyword)
    if ((parsed.hasReturnDate || parsed.hasReturnKeyword) && !parsed.hasDirectKeyword) {
      const trailing = getTrailingPartial()
      const directKeywords = DIRECT_KEYWORDS[locale] || DIRECT_KEYWORDS.en
      const completion = getKeywordCompletion(trailing, directKeywords)
      if (completion !== null) {
        return completion
      }
      const endsWithSep = query.endsWith(',') || query.endsWith(', ') || query.endsWith(' ')
      if (endsWithSep) {
        const directKw = directKeywords[0]
        if (query.endsWith(', ') || query.endsWith(' ')) {
          return directKw
        }
        return ' ' + directKw
      }
      return generateDirectSuggestion(locale)
    }
    
    // Stage 7: Have direct, suggest class (or complete partial class keyword)
    if (parsed.hasDirectKeyword && !parsed.hasClassKeyword) {
      const trailing = getTrailingPartial()
      const classKeywords = CLASS_KEYWORDS[locale] || CLASS_KEYWORDS.en
      const completion = getKeywordCompletion(trailing, classKeywords)
      if (completion !== null) {
        return completion
      }
      const endsWithSep = query.endsWith(',') || query.endsWith(', ') || query.endsWith(' ')
      if (endsWithSep) {
        const classKw = classKeywords[Math.floor(Math.random() * classKeywords.length)]
        if (query.endsWith(', ') || query.endsWith(' ')) {
          return classKw
        }
        return ' ' + classKw
      }
      return generateClassSuggestion(locale)
    }
    
    // Stage 8: Have class, suggest time (or complete partial time keyword)
    if (parsed.hasClassKeyword && !parsed.hasTimeKeyword) {
      const trailing = getTrailingPartial()
      const timeKeywords = TIME_KEYWORDS[locale] || TIME_KEYWORDS.en
      const completion = getKeywordCompletion(trailing, timeKeywords)
      if (completion !== null) {
        return completion
      }
      const endsWithSep = query.endsWith(',') || query.endsWith(', ') || query.endsWith(' ')
      if (endsWithSep) {
        const timeKw = timeKeywords[Math.floor(Math.random() * timeKeywords.length)]
        if (query.endsWith(', ') || query.endsWith(' ')) {
          return timeKw
        }
        return ' ' + timeKw
      }
      return generateTimeSuggestion(locale)
    }

    // Stage 9: Have time (or direct/class filled), suggest passenger context if missing
    const hasEnoughContext = parsed.hasReturnDate || parsed.hasReturnKeyword || parsed.hasTripDuration
    if (hasEnoughContext && !parsed.hasPassengerKeyword) {
      const endsWithSep = query.endsWith(',') || query.endsWith(', ') || query.endsWith(' ')
      if (endsWithSep) {
        return generatePassengerSuggestion(locale)
      }
    }

    // Stage 10: Have passengers, suggest ancillaries if missing
    if (parsed.hasPassengerKeyword && !parsed.hasAncillaryKeyword) {
      const endsWithSep = query.endsWith(',') || query.endsWith(', ') || query.endsWith(' ')
      if (endsWithSep) {
        return generateAncillarySuggestion(locale)
      }
    }
  }
  
  return ''
}

// Trip duration suffix suggestions for ghost text
// Used after a date is typed: "... for 14 days" or "... for 7-10 days"
function generateTripDurationSuggestion(locale: string): string {
  const examples: Record<string, string[]> = {
    en: [', for 7 days', ', for 10-14 days', ', for 2 weeks', ', back 14-18 days later'],
    pl: [', na 7 dni', ', na 10-14 dni', ', na 2 tygodnie'],
    de: [', für 7 Tage', ', für 10-14 Tage', ', für 2 Wochen'],
    es: [', por 7 días', ', por 10-14 días', ', por 2 semanas'],
    fr: [', pour 7 jours', ', pour 10-14 jours', ', pour 2 semaines'],
    it: [', per 7 giorni', ', per 10-14 giorni', ', per 2 settimane'],
    pt: [', por 7 dias', ', por 10-14 dias', ', por 2 semanas'],
    nl: [', voor 7 dagen', ', voor 10-14 dagen', ', voor 2 weken'],
    sv: [', i 7 dagar', ', i 10-14 dagar', ', i 2 veckor'],
    hr: [', za 7 dana', ', za 10-14 dana'],
    sq: [', për 7 ditë', ', për 10-14 ditë'],
  }
  const list = examples[locale] || examples.en
  return list[Math.floor(Math.random() * list.length)]
}

// Passenger context ghost-text suggestions
function generatePassengerSuggestion(locale: string): string {
  const examples: Record<string, string[]> = {
    en: ['with 2 adults', 'for a family', 'as a couple', 'solo', 'with kids'],
    pl: ['dla 2 dorosłych', 'dla rodziny', 'jako para', 'samotnie', 'z dziećmi'],
    de: ['für 2 Erwachsene', 'für die Familie', 'als Paar', 'alleine', 'mit Kindern'],
    es: ['para 2 adultos', 'para la familia', 'en pareja', 'solo', 'con niños'],
    fr: ['pour 2 adultes', 'en famille', 'en couple', 'seul', 'avec enfants'],
    it: ['per 2 adulti', 'in famiglia', 'in coppia', 'da solo', 'con bambini'],
    pt: ['para 2 adultos', 'em família', 'a dois', 'sozinho', 'com crianças'],
    nl: ['voor 2 volwassenen', 'met gezin', 'als koppel', 'alleen', 'met kinderen'],
    sv: ['för 2 vuxna', 'med familj', 'som par', 'ensam', 'med barn'],
    hr: ['za 2 odrasle', 's obitelji', 'kao par', 'sam', 's djecom'],
    sq: ['për 2 të rritur', 'me familje', 'si çift', 'vetëm', 'me fëmijë'],
  }
  const list = examples[locale] || examples.en
  return list[Math.floor(Math.random() * list.length)]
}

// Ancillary ghost-text suggestions
function generateAncillarySuggestion(locale: string): string {
  const examples: Record<string, string[]> = {
    en: ['with checked baggage', 'with seat selection', 'refundable', 'carry-on only', 'with meals'],
    pl: ['z bagażem rejestrowanym', 'z wyborem miejsca', 'z możliwością zwrotu', 'tylko bagaż podręczny'],
    de: ['mit Gepäck', 'mit Sitzplatzwahl', 'erstattungsfähig', 'nur Handgepäck'],
    es: ['con equipaje facturado', 'con selección de asiento', 'reembolsable', 'solo equipaje de mano'],
    fr: ['avec bagages enregistrés', 'avec choix de siège', 'remboursable', 'bagage cabine uniquement'],
    it: ['con bagaglio registrato', 'con scelta del posto', 'rimborsabile', 'solo bagaglio a mano'],
    pt: ['com bagagem despachada', 'com seleção de assento', 'reembolsável', 'só bagagem de mão'],
    nl: ['met ruimbagage', 'met stoelkeuze', 'restitueerbaar', 'alleen handbagage'],
    sv: ['med incheckat bagage', 'med platsval', 'återbetalningsbar', 'bara handbagage'],
    hr: ['s predanom prtljagom', 's odabirom sjedišta', 'povratna karta', 'samo ručna prtljaga'],
    sq: ['me bagazh të kontrolluar', 'me zgjedhje vendi', 'i rimbursueshëm', 'vetëm bagazh dore'],
  }
  const list = examples[locale] || examples.en
  return list[Math.floor(Math.random() * list.length)]
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

interface HomeSearchFormProps {
  initialQuery?: string
  initialCurrency?: CurrencyCode
  compact?: boolean
  autoFocus?: boolean
  probeMode?: boolean
}

export default function HomeSearchForm({
  initialQuery = '',
  initialCurrency = 'EUR',
  compact = false,
  autoFocus = true,
  probeMode = false,
}: HomeSearchFormProps = {}) {
  const router = useRouter()
  const params = useParams()
  const locale = (params?.locale as string) || 'en'
  const td = useTranslations('destinations')
  const th = useTranslations('hero')
  const tc = useTranslations('Clarify')
  const ths = useTranslations('HomeSearch')
  const [inputValue, setInputValue] = useState(initialQuery)
  const [query, setQuery] = useState(initialQuery)
  const [prefCurrency, setPrefCurrency] = useState<CurrencyCode>(initialCurrency)
  const [suggestion, setSuggestion] = useState('')
  const [inputScrollLeft, setInputScrollLeft] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [dropdownItems, setDropdownItems] = useState<Airport[]>([])
  const [dropdownSlot, setDropdownSlot] = useState<'origin' | 'destination'>('origin')
  const [dropdownActiveIdx, setDropdownActiveIdx] = useState(-1)
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const [mounted, setMounted] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const dropdownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const queryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rowRef = useRef<HTMLDivElement>(null)

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

  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    const onScroll = () => setInputScrollLeft(input.scrollLeft)
    input.addEventListener('scroll', onScroll)
    return () => input.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    setInputValue(initialQuery)
    setQuery(initialQuery)
  }, [initialQuery])

  useEffect(() => {
    setPrefCurrency(readBrowserSearchCurrency(initialCurrency))
    const sync = () => setPrefCurrency(readBrowserSearchCurrency(initialCurrency))
    window.addEventListener(CURRENCY_CHANGE_EVENT, sync)
    return () => window.removeEventListener(CURRENCY_CHANGE_EVENT, sync)
  }, [initialCurrency])

  // ── Date-clarification state ─────────────────────────────────────────────────
  const [dateClarify, setDateClarify] = useState<{
    a_date: string; b_date: string
    a_label: string; b_label: string
    originalFragment: string   // the "10/12" token to replace
    pendingQuery: string       // full original query
  } | null>(null)

  // ── Conversational personalization state ─────────────────────────────────────
  type QAnswer = { q: string; a: string; aDisplay: string }
  interface ConvoState {
    pendingQuery: string
    step: number
    answers: QAnswer[]
    collapsing: boolean
    missingOrigin?: boolean       // true when user gave destination-only query
    missingDestination?: boolean  // true when user gave origin-only query (single city, no "to")
    parsed?: ReturnType<typeof parseNLQuery>  // already-computed NLP result
    disambigOriginRaw?: string  // failed origin text to replace when disambig resolves
    disambigDestRaw?: string    // failed dest text to replace when disambig resolves
  }
  const [convo, setConvo] = useState<ConvoState | null>(null)
  const convoBottomRef = useRef<HTMLDivElement>(null)
  const convoFreeRef = useRef<HTMLInputElement>(null)
  const [convoFreeText, setConvoFreeText] = useState('')
  const [convoMultiSel, setConvoMultiSel] = useState<string[]>([])
  // Pre-fired search: started in background as soon as convo begins, so the
  // results page opens with the search already running.
  const prefiredSearchRef = useRef<{ searchId: string; startedAt: number; fswSession?: string } | null>(null)

  type ConvoQuestion = { q: string; chips: { label: string; key: string }[]; freeHint?: string; isOriginQuestion?: boolean; multiChoice?: boolean; isCityDisambig?: 'origin' | 'destination'; failedRaw?: string; isEssential?: boolean }

  // Helper: chip object with a translated display label and English key for phrase lookup
  const mkChip = (labelKey: Parameters<typeof ths>[0], englishKey: string) => ({ label: ths(labelKey), key: englishKey })

  // Build a personalised 2-3 question set from the raw query text.
  // Skips questions the user already answered in their query.
  // Uses the structured parseNLQuery result stored in convo.parsed — fully
  // language-agnostic, no raw-string regexes needed here.
  function buildConvoQuestions(_raw: string): ConvoQuestion[] {
    const p = convo?.parsed   // structured NLP result
    const qs: ConvoQuestion[] = []

    // ── 0a. City disambiguation — when we couldn’t resolve a city, show candidates ──
    // These are blocking questions: fix the city first, then the rest of the convo.
    const originCands = convo?.parsed?.origin_candidates
    const destCands = convo?.parsed?.destination_candidates
    const failedOriginRaw = convo?.disambigOriginRaw
    const failedDestRaw = convo?.disambigDestRaw
    if (failedOriginRaw && originCands && originCands.length > 0) {
      qs.push({
        q: `Couldn’t find “${failedOriginRaw}” — did you mean?`,
        chips: originCands.map(c => ({ label: c.name, key: c.code })),
        freeHint: 'or type another city…',
        isCityDisambig: 'origin',
        failedRaw: failedOriginRaw,
      })
    }
    if (failedDestRaw && destCands && destCands.length > 0) {
      qs.push({
        q: `Couldn’t find “${failedDestRaw}” — did you mean?`,
        chips: destCands.map(c => ({ label: c.name, key: c.code })),
        freeHint: 'or type another city…',
        isCityDisambig: 'destination',
        failedRaw: failedDestRaw,
      })
    }
    // If we have disambig questions, they’re the only ones we need right now
    if (qs.length > 0) return qs

    // ── 0b. Origin — ask FIRST when no departure city given ──────────────
    if (convo?.missingOrigin) {
      qs.push({
        q: ths('where_from_q'),
        chips: [],
        freeHint: ths('where_from_hint'),
        isOriginQuestion: true,
        isEssential: true,
      })
      // Don't return — continue building date + personalization questions below
    }

    // ── 0c. Destination — ask FIRST when user gave only the departure city ──
    if (convo?.missingDestination) {
      qs.push({
        q: ths('where_to_q'),
        chips: [],
        freeHint: ths('where_to_hint'),
        isEssential: true,
      })
      // Don't return — continue building date + personalization questions below
    }

    // ── 1. Date — MUST come immediately after origin/dest (before personalization) ──
    // Essential: we can't start searching without a date.
    if (!p?.date || p?.date_is_default) {
      qs.push({
        q: ths('when_q'),
        chips: [
          { label: ths('chip_this_weekend'), key: 'this weekend' },
          { label: ths('chip_next_weekend'), key: 'next weekend' },
          { label: ths('chip_in_2_weeks'), key: 'in 2 weeks' },
          { label: ths('chip_next_month'), key: 'next month' },
        ],
        freeHint: ths('when_hint'),
        isEssential: true,
      })
    }

    // ── 2. Party size — skip if parseNLQuery found pax info ──────────────
    const hasPax = (p?.adults !== undefined && p.adults > 1)
      || !!(p?.children) || !!(p?.infants)
      || !!(p?.passenger_context) || !!(p?.group_size)
    if (!hasPax) {
      const purpose = p?.trip_purpose
      const isBeach = purpose === 'beach'
      const isBusiness = purpose === 'business'
      const isCity = purpose === 'city_break'

      let q = ths('pax_q')
      let chips = [mkChip('chip_solo', 'Solo'), mkChip('chip_two', 'Two of us'), mkChip('chip_family', 'Family'), mkChip('chip_friends', 'Group of friends')]
      if (isBeach) { q = ths('pax_q_beach'); chips = [mkChip('chip_just_me', 'Just me'), mkChip('chip_partner', 'Partner'), mkChip('chip_squad', 'Squad'), mkChip('chip_family', 'Family')] }
      else if (isBusiness) { q = ths('pax_q_business'); chips = [mkChip('chip_solo', 'Solo'), mkChip('chip_colleague', 'With a colleague'), mkChip('chip_small_team', 'Small team'), mkChip('chip_with_family', 'With family')] }
      else if (isCity) { q = ths('pax_q_city'); chips = [mkChip('chip_just_me', 'Just me'), mkChip('chip_two', 'Two of us'), mkChip('chip_small_group', 'Small group'), mkChip('chip_family', 'Family')] }
      qs.push({ q, chips, freeHint: ths('pax_hint') })
    }

    // ── 2.5. Trip type — skip if parser found return date or trip length ──
    const hasRtContext = !!(p?.return_date) || !!(p?.min_trip_days) || !!(p?.max_trip_days)
    if (!hasRtContext) {
      qs.push({ q: ths('rt_q'), chips: [
        mkChip('chip_one_way', 'one way'),
        mkChip('chip_rt_weekend', 'return weekend'),
        mkChip('chip_rt_1week', 'return 1 week'),
        mkChip('chip_rt_2weeks', 'return 2 weeks'),
      ], freeHint: ths('or_describe_trip') })
    }

    // ── 3. Trip purpose — skip if parseNLQuery detected one ──────────────
    if (!p?.trip_purpose) {
      const isLong = !!(p?.min_trip_days && p.min_trip_days >= 14)
      let q = ths('trip_q')
      let chips = [mkChip('chip_sun_relax', 'Sun & relax'), mkChip('chip_city_explore', 'City exploring'), mkChip('chip_business', 'Business'), mkChip('chip_occasion', 'Special occasion')]
      if (isLong) { q = ths('trip_q_long'); chips = [mkChip('chip_adventure', 'Adventure'), mkChip('chip_backpacking', 'Backpacking'), mkChip('chip_luxury', 'Luxury'), mkChip('chip_remote_work', 'Remote work')] }
      qs.push({ q, chips, freeHint: ths('trip_hint'), multiChoice: true })
    }

    // ── 3. Priority — skip if parser found stops/cabin preference ─────────
    const hasPriority = p?.stops === 0 || !!(p?.cabin)
    if (!hasPriority) {
      const isBudget = !!(p?.max_price)
      const isCity = p?.trip_purpose === 'city_break'

      let q = ths('priority_q')
      let chips = [mkChip('chip_lowest_price', 'Lowest price'), mkChip('chip_direct', 'Direct flights'), mkChip('chip_good_times', 'Good times'), mkChip('chip_flexible', 'Flexible dates')]
      if (isBudget) { q = ths('priority_q_budget'); chips = [mkChip('chip_cheapest', 'Cheapest possible'), mkChip('chip_comfort', 'Some comfort ok'), mkChip('chip_flex_price', 'Flexible on price'), mkChip('chip_biz_class', 'Business class')] }
      else if (isCity) { q = ths('priority_q_speed'); chips = [mkChip('chip_direct_only', 'Direct flights only'), mkChip('chip_early_dep', 'Early departure'), mkChip('chip_cheapest_opt', 'Cheapest option'), mkChip('chip_latest_return', 'Latest return')] }
      qs.push({ q, chips, freeHint: ths('priority_hint'), multiChoice: true })
    }

    // Always return at least 2 personalization questions (only if essential slots are filled)
    if (qs.length === 0 && !convo?.missingOrigin && !convo?.missingDestination) {
      qs.push({ q: ths('fallback_q1'), chips: [mkChip('chip_just_me', 'Just me'), mkChip('chip_two', 'Two of us'), mkChip('chip_family', 'Family'), mkChip('chip_group', 'Group')] })
      qs.push({ q: ths('fallback_q2'), chips: [mkChip('chip_cheapest_fare', 'Cheapest fare'), mkChip('chip_no_stops', 'No stops'), mkChip('chip_good_timing', 'Good timing'), mkChip('chip_flexible', 'Flexible')], multiChoice: true })
    }

    return qs
  }

  const CONVO_QUESTIONS = convo ? buildConvoQuestions(convo.pendingQuery) : []

  // Translate convo chip answers into phrases parseNLQuery already understands.
  // Bare chip labels like "Family" or "Sun & relax" don't match the parser's regexes,
  // so we expand them into natural language that does.
  const CONVO_ANSWER_PHRASES: Record<string, string> = {
    // Party / who
    'solo': 'travelling solo',
    'just me': 'travelling solo',
    'two of us': 'as a couple',
    'partner': 'as a couple',
    'family': 'travelling with family',
    'group of friends': 'with friends',
    'squad': 'with friends',
    'small team': 'with colleagues',
    'with a colleague': 'with a colleague',
    'with family': 'travelling with family',
    // Trip purpose
    'sun & relax': 'beach holiday',
    'city exploring': 'city break',
    'business': 'business trip',
    'special occasion': 'special occasion',
    'adventure': 'adventure trip',
    'backpacking': 'backpacking trip',
    'luxury': 'luxury holiday',
    'remote work': 'remote work trip',
    'ski trip': 'ski trip',
    'honeymoon': 'honeymoon',
    // Trip type / duration
    'one way': 'one way',
    'return weekend': 'round trip for 3 days',
    'return 1 week': 'round trip for 7 days',
    'return 2 weeks': 'round trip for 14 days',
    'return 3+ weeks': 'round trip for 21 days',
    // Priority / constraints
    'direct flights': 'direct flights only',
    'direct flights only': 'direct flights only',
    'no stops': 'direct flights only',
    'lowest price': 'cheapest option',
    'cheapest possible': 'cheapest possible',
    'cheapest option': 'cheapest option',
    'cheapest fare': 'cheapest option',
    'some comfort ok': 'comfortable flight',
    'good times': 'good departure times',
    'flexible dates': 'flexible dates',
    'flexible on price': 'flexible on price',
    'business class': 'business class',
    'early departure': 'early morning departure',
    'latest return': 'evening return',
    'seat together': 'need seats together',
    'seats together': 'need seats together',
    'quick flight': 'shortest possible flight',
    'comfortable': 'comfortable flight',
    'morning flights': 'morning departure',
  }

  function expandConvoAnswer(answer: string): string {
    // Multi-selection answers are stored as comma-joined keys — expand each part
    if (answer.includes(',')) {
      return answer.split(',').map(part => {
        const k = part.toLowerCase().trim()
        return CONVO_ANSWER_PHRASES[k] ?? k
      }).join(', ')
    }
    const key = answer.toLowerCase().trim()
    return CONVO_ANSWER_PHRASES[key] ?? answer
  }

  const currentQ = convo ? CONVO_QUESTIONS[convo.step] : null

  // Commit one answer and advance — or collapse and navigate if done.
  // `answer` is the English key (for phrase lookup); `display` is the localised label shown to the user.
  // Build the final search query, handling the case where the first answer was
  // the missing origin (prepend "from X to" instead of appending).
  function buildFinalQuery(pending: string, answers: QAnswer[], missingOrigin?: boolean, disambigOriginRaw?: string, disambigDestRaw?: string, missingDestination?: boolean): string {
    let q = pending
    const remaining: QAnswer[] = []
    for (const ans of answers) {
      // City disambig answers substitute the failed raw text directly in the query
      if (disambigOriginRaw && ans.a && q.toLowerCase().includes(disambigOriginRaw.toLowerCase())) {
        const re = new RegExp(disambigOriginRaw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
        q = q.replace(re, ans.aDisplay)
        disambigOriginRaw = undefined
      } else if (disambigDestRaw && ans.a && q.toLowerCase().includes(disambigDestRaw.toLowerCase())) {
        const re = new RegExp(disambigDestRaw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
        q = q.replace(re, ans.aDisplay)
        disambigDestRaw = undefined
      } else {
        remaining.push(ans)
      }
    }
    if (missingOrigin && remaining.length > 0) {
      const originAnswer = remaining[0].a.trim()
      const rest = remaining.slice(1).map(qa => expandConvoAnswer(qa.a)).join(', ')
      const base = rest ? `${q}, ${rest}` : q
      return `from ${originAnswer} to ${base}`
    }
    if (missingDestination && remaining.length > 0) {
      const destAnswer = remaining[0].a.trim()
      const rest = remaining.slice(1).map(qa => expandConvoAnswer(qa.a)).join(', ')
      return rest ? `${q} to ${destAnswer}, ${rest}` : `${q} to ${destAnswer}`
    }
    const contextParts = remaining.map(qa => expandConvoAnswer(qa.a)).join(', ')
    return contextParts ? `${q}, ${contextParts}` : q
  }

  const commitConvoAnswer = useCallback((answer: string, display?: string) => {
    if (!convo) return
    setConvoMultiSel([])
    const newAnswers = [...convo.answers, { q: currentQ!.q, a: answer, aDisplay: display ?? answer }]
    const nextStep = convo.step + 1
    if (nextStep >= CONVO_QUESTIONS.length) {
      // All done — build context suffix and navigate
      setConvo({ ...convo, answers: newAnswers, step: nextStep, collapsing: true })
      setTimeout(() => {
        // If the user edited the search box during the wizard use the current text
        // as the base — do NOT blindly trust convo.pendingQuery which was captured
        // at wizard open time. Also cancel the stale pre-fired search if any.
        const currentInput = inputRef.current?.value.trim() ?? ''
        const baseQuery = (currentInput && currentInput !== convo.pendingQuery)
          ? currentInput
          : convo.pendingQuery
        if (currentInput && currentInput !== convo.pendingQuery) {
          const stale = prefiredSearchRef.current
          if (stale?.searchId) {
            const cancelUrl = `/api/results/cancel/${encodeURIComponent(stale.searchId)}`
            if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
              navigator.sendBeacon(cancelUrl)
            } else {
              fetch(cancelUrl, { method: 'POST', keepalive: true }).catch(() => {})
            }
          }
          prefiredSearchRef.current = null
        }
        const finalQuery = buildFinalQuery(baseQuery, newAnswers, convo.missingOrigin, convo.disambigOriginRaw, convo.disambigDestRaw, convo.missingDestination)
        setConvo(null)
        setConvoFreeText('')
        navigateSearch(finalQuery)
      }, 420)
    } else {
      setConvo({ ...convo, answers: newAnswers, step: nextStep, collapsing: false })
      setConvoFreeText('')
      // Fire background search as soon as the last essential question is answered.
      // Essential = origin, destination, date. Once we have all three the search can run
      // in parallel while the user answers personalization questions.
      const moreEssentialRemaining = CONVO_QUESTIONS.slice(nextStep).some(q => q.isEssential)
      if (!moreEssentialRemaining && !prefiredSearchRef.current) {
        // Set sentinel IMMEDIATELY — before the fetch resolves — so that any
        // subsequent question answers don't trigger a second pre-fire.
        prefiredSearchRef.current = { searchId: '', startedAt: Date.now() }
        const partialQuery = buildFinalQuery(convo.pendingQuery, newAnswers, convo.missingOrigin, convo.disambigOriginRaw, convo.disambigDestRaw, convo.missingDestination)
        void fetch('/api/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: partialQuery, ...(prefCurrency ? { currency: prefCurrency } : {}), ...(probeMode ? { probe: '1' } : {}) }),
        }).then(r => r.ok ? r.json() : null)
          .then((d: { search_id?: string; fsw_session?: string } | null) => {
            if (d?.search_id) {
              prefiredSearchRef.current = { searchId: d.search_id, startedAt: Date.now(), fswSession: d.fsw_session }
            }
          })
          .catch(() => {
            // Reset so navigateSearch falls back to query-based URL
            prefiredSearchRef.current = null
          })
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convo, currentQ])

  // Skip remaining questions and navigate
  const skipConvo = useCallback(() => {
    if (!convo) return
    setConvo({ ...convo, collapsing: true })
    setTimeout(() => {
      const currentInput = inputRef.current?.value.trim() ?? ''
      const baseQuery = (currentInput && currentInput !== convo.pendingQuery)
        ? currentInput
        : convo.pendingQuery
      if (currentInput && currentInput !== convo.pendingQuery) {
        const stale = prefiredSearchRef.current
        if (stale?.searchId) {
          const cancelUrl = `/api/results/cancel/${encodeURIComponent(stale.searchId)}`
          if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
            navigator.sendBeacon(cancelUrl)
          } else {
            fetch(cancelUrl, { method: 'POST', keepalive: true }).catch(() => {})
          }
        }
        prefiredSearchRef.current = null
      }
      const finalQuery = buildFinalQuery(baseQuery, convo.answers, convo.missingOrigin, convo.disambigOriginRaw, convo.disambigDestRaw, convo.missingDestination)
      setConvo(null)
      setConvoFreeText('')
      navigateSearch(finalQuery)
    }, 420)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convo])

  // Scroll new question into view
  useEffect(() => {
    if (convo && !convo.collapsing && convoBottomRef.current) {
      setTimeout(() => {
        convoBottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }, 50)
    }
  }, [convo?.step])

  const _MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

  // Navigate to results with the given query string.
  // If the pre-fire already resolved to a search_id, jump straight to that
  // running search so the results page can start polling immediately.
  // If not (pre-fire still in-flight or failed), navigate to /results?q=...
  // which starts its own search on the server side. Either way we navigate
  // instantly — never wait for the pre-fire.
  const navigateSearch = (q: string) => {
    if (DEMO_LOADING) {
      setIsLoading(true)
      router.push(`/results/demo-loading${probeMode ? '?probe=1' : ''}`)
      return
    }
    const sp = new URLSearchParams(window.location.search)
    const params = new URLSearchParams()
    params.set('q', q)
    if (prefCurrency) params.set('cur', prefCurrency)
    if (probeMode) params.set('probe', '1')
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
      const val = sp.get(key)
      if (val) params.set(key, val)
    }

    const pre = prefiredSearchRef.current
    prefiredSearchRef.current = null
    if (pre?.searchId && Date.now() - pre.startedAt < 3 * 60 * 1000) {
      if (pre.fswSession) params.set('_fss', pre.fswSession)
      startTransition(() => { router.push(`/results/${pre.searchId}?${params.toString()}`) })
    } else {
      startTransition(() => { router.push(`/results?${params.toString()}`) })
    }
  }

  // When the user picks a date from the clarification strip, replace the ambiguous
  // fragment with an unambiguous "12 October" / "October 12" form and navigate.
  const pickDate = (isoDate: string) => {
    if (!dateClarify) return
    const d = new Date(isoDate + 'T00:00:00')
    const replacement = `${d.getDate()} ${_MONTHS[d.getMonth()]}`
    const newQuery = dateClarify.pendingQuery.replace(dateClarify.originalFragment, replacement)
    setDateClarify(null)
    navigateSearch(newQuery)
  }

  const handleSearch = (event: FormEvent) => {
    event.preventDefault()
    // Always clear the airport dropdown immediately — it must not overlay the convo panel
    setDropdownItems([])
    setDropdownActiveIdx(-1)
    setDropdownPos(null)
    const trimmed = inputValue.trim()
    if (!trimmed) return

    // Detect ambiguous date fragment like "10/12" or "3.11" where both parts ≤ 12.
    // Do this before navigating so we can ask the user which interpretation they meant.
    const ambRe = /\b(\d{1,2})[\/\.](\d{1,2})\b(?!\s*[\/\.]\s*\d{4})/
    const ambMatch = ambRe.exec(trimmed)
    if (ambMatch) {
      const n1 = parseInt(ambMatch[1], 10)
      const n2 = parseInt(ambMatch[2], 10)
      if (n1 >= 1 && n1 <= 12 && n2 >= 1 && n2 <= 12 && n1 !== n2) {
        const today = new Date()
        const yr = today.getFullYear()
        // Interpretation A: n1 = month, n2 = day  (MM/DD — US style)
        const dA = new Date(yr, n1 - 1, n2)
        if (dA <= today) dA.setFullYear(yr + 1)
        // Interpretation B: n1 = day, n2 = month  (DD/MM — international style)
        const dB = new Date(yr, n2 - 1, n1)
        if (dB <= today) dB.setFullYear(yr + 1)
        setDateClarify({
          a_date: dA.toISOString().slice(0, 10),
          b_date: dB.toISOString().slice(0, 10),
          a_label: `${_MONTHS[dA.getMonth()]} ${dA.getDate()}`,
          b_label: `${dB.getDate()} ${_MONTHS[dB.getMonth()]}`,
          originalFragment: ambMatch[0],
          pendingQuery: trimmed,
        })
        return   // hold — wait for user to pick
      }
    }

    // No ambiguity — launch personalization conversation
    setDateClarify(null)
    let _nlp: ReturnType<typeof parseNLQuery> | null = null
    try { _nlp = parseNLQuery(trimmed) } catch { /* ignore */ }

    // Detect whether the user explicitly said "from <city>" (true directional origin).
    // A bare city name with no direction word is treated as destination — we ask where they depart FROM.
    const hasExplicitFromKeyword = /\bfrom\b/i.test(trimmed)

    // No city detected for origin at all (empty query, dates only, etc.)
    const noOriginDetected = !_nlp?.origin && !_nlp?.failed_origin_raw
    // No city detected for destination
    const noDestinationDetected = !_nlp?.destination && !_nlp?.failed_destination_raw && !_nlp?.anywhere_destination

    // Single implicit city with no "from" keyword → user almost certainly means their destination
    // (e.g. "Buenos Aires" = "I want to fly TO Buenos Aires"). Treat as destination, ask "where from?".
    const implicitSingleCityAsDestination = !!_nlp?.origin && noDestinationDetected && !hasExplicitFromKeyword

    // missingOrigin: no city at all, OR single bare city (treated as destination — origin still unknown)
    const missingOrigin = noOriginDetected || implicitSingleCityAsDestination
    // missingDestination: user gave an explicit "from <city>" but no destination
    const missingDestination = noDestinationDetected && hasExplicitFromKeyword && !noOriginDetected

    // City disambiguation: unresolved cities that have fuzzy candidates
    const needsOriginDisambig = !!(_nlp?.failed_origin_raw && _nlp?.origin_candidates?.length)
    const needsDestDisambig = !!(_nlp?.failed_destination_raw && _nlp?.destination_candidates?.length)
    const needsDisambig = needsOriginDisambig || needsDestDisambig

    if (missingOrigin || missingDestination || needsDisambig || (!_nlp?.trip_purpose && !_nlp?.passenger_context)) {
      const nextConvo = {
        pendingQuery: trimmed,
        step: 0,
        answers: [] as QAnswer[],
        collapsing: false,
        missingOrigin,
        missingDestination,
        parsed: _nlp ?? undefined,
        disambigOriginRaw: needsOriginDisambig ? _nlp!.failed_origin_raw : undefined,
        disambigDestRaw: needsDestDisambig ? _nlp!.failed_destination_raw : undefined,
      }
      if (convo && convo.pendingQuery !== trimmed) {
        // Different query while convo is open — close it instantly then reopen so the
        // user can see the panel reset rather than appear frozen.
        // Cancel the stale pre-fired search (for the old query) before discarding it.
        const staleOnQueryChange = prefiredSearchRef.current
        if (staleOnQueryChange?.searchId) {
          const cancelUrl = `/api/results/cancel/${encodeURIComponent(staleOnQueryChange.searchId)}`
          if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
            navigator.sendBeacon(cancelUrl)
          } else {
            fetch(cancelUrl, { method: 'POST', keepalive: true }).catch(() => {})
          }
        }
        prefiredSearchRef.current = null
        setConvo(null)
        setConvoFreeText('')
        setConvoMultiSel([])
        setTimeout(() => setConvo(nextConvo), 0)
      } else {
        setConvo(nextConvo)
      }
      // Pre-fire the search in the background only when origin, destination, AND date are all
      // already known from the initial query — we need all three to avoid a useless search.
      const dateAlreadyKnown = !!((_nlp?.date) && !_nlp?.date_is_default)
      if (!missingOrigin && !missingDestination && dateAlreadyKnown) {
        // Set sentinel immediately so mid-convo answers don't fire a second pre-fire
        prefiredSearchRef.current = { searchId: '', startedAt: Date.now() }
        void fetch('/api/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: trimmed, ...(prefCurrency ? { currency: prefCurrency } : {}), ...(probeMode ? { probe: '1' } : {}) }),
        }).then(r => r.ok ? r.json() : null)
          .then((d: { search_id?: string; fsw_session?: string } | null) => {
            if (d?.search_id) {
              prefiredSearchRef.current = { searchId: d.search_id, startedAt: Date.now(), fswSession: d.fsw_session }
            } else {
              prefiredSearchRef.current = null
            }
          })
          .catch(() => { prefiredSearchRef.current = null })
      }
      return
    }
    navigateSearch(trimmed)
  }

  // Select an airport from the dropdown and insert it into the query
  const handleDropdownSelect = (airport: Airport) => {
    const parsed = parseQuery(inputValue, locale)
    const newQuery = insertAirport(parsed, airport, dropdownSlot, locale)
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

  // Suggestion updates when query settles
  useEffect(() => {
    setSuggestion(getSuggestion(query, locale))
  }, [query, locale])

  // Dropdown updates debounced + deferred via startTransition so typing is never blocked
  useEffect(() => {
    if (dropdownTimerRef.current) clearTimeout(dropdownTimerRef.current)
    dropdownTimerRef.current = setTimeout(() => {
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
  }, [query, locale])

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

  // Add/remove body class when convo is open — lets CSS lower stats-sheet z-index
  // so the absolutely-positioned panel can render above it without a portal
  useEffect(() => {
    const open = !!(convo && !dateClarify)
    document.body.classList.toggle('lp-convo-open', open)
    return () => { document.body.classList.remove('lp-convo-open') }
  }, [convo, dateClarify])

  // Dismiss convo panel when user clicks outside the search frame
  useEffect(() => {
    if (!convo) return
    const handler = (e: MouseEvent) => {
      if (frameRef.current && !frameRef.current.contains(e.target as Node)) {
        setConvo(null)
        setConvoFreeText('')
        setConvoMultiSel([])
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [convo])

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

      <form onSubmit={handleSearch} className={`lp-sf-form${convo && !dateClarify ? ' lp-sf-form--convo-open' : ''}`}>
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
              onChange={(event) => setInputValue(event.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={() => setTimeout(() => { setDropdownItems([]); setDropdownActiveIdx(-1); setDropdownPos(null) }, 150)}
              disabled={DEMO_LOADING && isLoading}
              autoFocus={autoFocus}
              autoComplete="off"
              spellCheck={false}
            />
            {suggestion && (
              <span className="lp-sf-ghost" aria-hidden="true">
                <span className="lp-sf-ghost-inner" style={{ transform: `translateX(-${inputScrollLeft}px)` }}>
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

        {/* ── Conversational personalization panel (absolute, overlays content below) */}
        {convo && !dateClarify && (
          <div className={`lp-convo${convo.collapsing ? ' lp-convo--collapsing' : ''}`}>
            {convo.answers.map((qa, i) => (
              <div key={i} className="lp-convo-row lp-convo-row--past">
                <span className="lp-convo-q lp-convo-q--past">{qa.q}</span>
                <span className="lp-convo-a">{qa.aDisplay}</span>
              </div>
            ))}
            {currentQ && (
              <div className="lp-convo-row lp-convo-row--active" ref={convoBottomRef}>
                <span className="lp-convo-q">{currentQ.q}</span>
                <div className="lp-convo-chips">
                  {currentQ.chips.map(chip => (
                    <button
                      key={chip.key}
                      type="button"
                      className={`lp-convo-chip${currentQ.multiChoice && convoMultiSel.includes(chip.key) ? ' lp-convo-chip--sel' : ''}`}
                      onClick={() => {
                        if (currentQ.multiChoice) {
                          setConvoMultiSel(prev =>
                            prev.includes(chip.key) ? prev.filter(k => k !== chip.key) : [...prev, chip.key]
                          )
                        } else {
                          commitConvoAnswer(chip.key, chip.label)
                        }
                      }}
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
                {currentQ.multiChoice && convoMultiSel.length > 0 && (
                  <button
                    type="button"
                    className="lp-convo-confirm"
                    onClick={() => {
                      const keys = convoMultiSel.join(', ')
                      const labels = convoMultiSel
                        .map(k => currentQ.chips.find(c => c.key === k)?.label ?? k)
                        .join(' + ')
                      commitConvoAnswer(keys, labels)
                    }}
                  >
                    Continue →
                  </button>
                )}
                {currentQ.freeHint && (
                  <div className="lp-convo-free">
                    <input
                      ref={convoFreeRef}
                      type="text"
                      className="lp-convo-free-input"
                      placeholder={currentQ.freeHint}
                      value={convoFreeText}
                      onChange={e => setConvoFreeText(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && convoFreeText.trim()) {
                          e.preventDefault()
                          commitConvoAnswer(convoFreeText.trim())
                        }
                      }}
                    />
                    {convoFreeText.trim() && (
                      <button
                        type="button"
                        className="lp-convo-free-go"
                        onClick={() => commitConvoAnswer(convoFreeText.trim())}
                      >
                        ↵
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
            <div className="lp-convo-footer">
              <div className="lp-convo-dots">
                {CONVO_QUESTIONS.map((_, i) => (
                  <span
                    key={i}
                    className={`lp-convo-dot${i < convo.step ? ' lp-convo-dot--done' : i === convo.step ? ' lp-convo-dot--active' : ''}`}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
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

      {/* ── Ambiguous-date clarification strip ─────────────────────────────── */}
      {dateClarify && (
        <div style={{
          display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px',
          padding: '10px 14px', marginTop: '8px',
          background: 'rgba(255,255,255,0.07)', borderRadius: '12px',
          fontSize: '13px', color: 'rgba(255,255,255,0.85)',
          backdropFilter: 'blur(8px)',
        }}>
          <span style={{ opacity: 0.7 }}>Did you mean</span>
          <button
            type="button"
            onClick={() => pickDate(dateClarify.a_date)}
            style={{
              padding: '4px 12px', borderRadius: '20px', border: 'none', cursor: 'pointer',
              background: 'rgba(255,255,255,0.15)', color: '#fff', fontSize: '13px',
              fontWeight: 600, transition: 'background 0.15s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.28)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.15)' }}
          >
            {dateClarify.a_label}
          </button>
          <span style={{ opacity: 0.5 }}>or</span>
          <button
            type="button"
            onClick={() => pickDate(dateClarify.b_date)}
            style={{
              padding: '4px 12px', borderRadius: '20px', border: 'none', cursor: 'pointer',
              background: 'rgba(255,255,255,0.15)', color: '#fff', fontSize: '13px',
              fontWeight: 600, transition: 'background 0.15s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.28)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.15)' }}
          >
            {dateClarify.b_label}
          </button>
          <span style={{ opacity: 0.5 }}>?</span>
          <button
            type="button"
            onClick={() => { setDateClarify(null); navigateSearch(dateClarify.pendingQuery) }}
            aria-label="Skip — search anyway"
            style={{
              marginLeft: 'auto', padding: '2px 8px', borderRadius: '20px', border: 'none',
              cursor: 'pointer', background: 'transparent', color: 'rgba(255,255,255,0.4)',
              fontSize: '18px', lineHeight: 1,
            }}
          >×</button>
        </div>
      )}



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
                <img src={dest.flag} alt="" className="lp-dest-flag" draggable={false} />
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