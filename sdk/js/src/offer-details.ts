export type OfferConditionState = 'allowed' | 'not_allowed' | 'allowed_with_fee' | 'unknown'
export type OfferAmenityState = 'included' | 'available' | 'unavailable' | 'unknown'
export type OfferAmenityConfidence = 'verified' | 'inferred' | 'unknown'
export type OfferAmenitySource = 'ancillary' | 'condition' | 'unknown'

export interface OfferDetailAncillary {
  included?: boolean
  price?: number
  currency?: string
  description?: string
}

export interface OfferDetailConditions {
  refund_before_departure?: OfferConditionState
  change_before_departure?: OfferConditionState
  [key: string]: string | undefined
}

export interface OfferDetailSegmentLike {
  airline?: string
  flight_number?: string
  aircraft?: string
}

export interface OfferDetailLegLike {
  segments?: OfferDetailSegmentLike[]
}

export interface OfferDetailLike {
  airline?: string
  flight_number?: string
  segments?: OfferDetailSegmentLike[]
  inbound?: OfferDetailLegLike
  ancillaries?: {
    cabin_bag?: OfferDetailAncillary
    checked_bag?: OfferDetailAncillary
    seat_selection?: OfferDetailAncillary
  }
  conditions?: OfferDetailConditions
}

export type OfferServiceSignal = 'included' | 'available' | null

export interface OfferAmenityAssessment {
  state: OfferAmenityState
  confidence: OfferAmenityConfidence
  source: OfferAmenitySource
  evidence?: string
}

export interface OfferDetailSignals {
  refundability: OfferConditionState | null
  changeability: OfferConditionState | null
  meals: OfferServiceSignal
  refreshments: OfferServiceSignal
  insurance: OfferServiceSignal
  lounge: OfferServiceSignal
  wifi: OfferServiceSignal
  power: OfferServiceSignal
  entertainment: OfferServiceSignal
  amenities: {
    meals: OfferAmenityAssessment
    refreshments: OfferAmenityAssessment
    insurance: OfferAmenityAssessment
    lounge: OfferAmenityAssessment
    wifi: OfferAmenityAssessment
    power: OfferAmenityAssessment
    entertainment: OfferAmenityAssessment
  }
}

export interface OfferDetailBadge {
  key: string
  label: string
  tone: 'positive' | 'neutral' | 'negative'
}

interface DetailTextSource {
  text: string
  included?: boolean
  source: OfferAmenitySource
}

const MEAL_RE = /\b(meal|meals|meal service|hot meal|catering|breakfast|lunch|dinner|santan)\b/i
const REFRESHMENT_RE = /\b(refreshment|refreshments|drink|drinks|beverage|beverages|snack|snacks|food and drink)\b/i
const INSURANCE_RE = /\b(insurance|coverage|protection|travel insurance|disruption cover)\b/i
const LOUNGE_RE = /\b(lounge|vip lounge|priority pass|airport lounge)\b/i
const WIFI_RE = /\b(wi[ -]?fi|wifi|internet access|onboard internet|wireless internet)\b/i
const POWER_RE = /\b(in[- ]?seat power|usb outlets?|usb ports?|usb power|power outlets?|power sockets?|ac power|seat power|charging ports?|charging outlets?)\b/i
const ENTERTAINMENT_RE = /\b(in[- ]?flight entertainment|ife|seatback screen|entertainment screen|personal entertainment|stream(?:ing)? media(?: to your device)?|stream to your device|watch on your device)\b/i
const WIFI_BARE_RE = /\b(wi[ -]?fi|wifi|internet access|onboard internet|wireless internet)\b/i
const POWER_BARE_RE = /\b(in[- ]?seat power|usb outlets?|usb ports?|usb power|power outlets?|power sockets?|ac power|seat power|charging ports?|charging outlets?)\b/i
const ENTERTAINMENT_BARE_RE = /\b(in[- ]?flight entertainment|ife|seatback screen|entertainment screen|personal entertainment|stream(?:ing)? media(?: to your device)?|stream to your device|watch on your device)\b/i
const SERVICE_INCLUDED_RE = /\b(included?|incl\.?|includes?|including|with|complimentary|provided|free of charge|free)\b/i
const SERVICE_AVAILABLE_RE = /\b(available|optional|option|add[- ]?on|extra|for a fee|with a fee|fee|charges may apply|buy[- ]?on[- ]?board|sold separately|upgrade)\b/i
const SERVICE_UNAVAILABLE_RE = /\b(not available|unavailable|not offered|not included|not possible|sold[- ]?out)\b/i
const REFUND_TEXT_RE = /\b(refund|refundable|cancell|cancel)\b/i
const REFUND_NOT_ALLOWED_RE = /\b(non[- ]?refundable|not refundable|no refunds?|refunds? not allowed|cancellations? not allowed)\b/i
const REFUND_WITH_FEE_RE = /\b(refund|refundable|cancell|cancel)\b.*\b(with fee|fee|penalty|charges may apply)\b/i
const REFUND_ALLOWED_RE = /\b(refundable|refunds? allowed|cancellations? allowed|cancel(?:lation)? allowed|free of charge)\b/i
const CHANGE_TEXT_RE = /\b(change|changes|changeable|rebook|rebooking)\b/i
const CHANGE_NOT_ALLOWED_RE = /\b(no changes?|changes? not allowed|not changeable|not possible)\b/i
const CHANGE_WITH_FEE_RE = /\b(change|changes|rebook|rebooking)\b.*\b(with fee|fee|penalty|charges may apply)\b/i
const CHANGE_ALLOWED_RE = /\b(changes? allowed|changeable|rebook(?:ing)? allowed|free of charge)\b/i
const SEAT_SELECTION_RE = /\b(seat selection|select your seat|choose your seat|choose seats?|seat choice|standard seat|extra legroom|preferred seat)\b/i
const LEGROOM_RE = /\b(?:average\s+legroom|extra legroom|legroom|pitch)\b/i

function normalizeDetailText(value: string): string {
  const withoutKey = value.replace(/^[a-z][a-z_ ]{0,40}:\s*/i, '')
  return withoutKey.replace(/\s+/g, ' ').trim()
}

function truncateDetailText(value: string, maxLength = 96): string {
  if (value.length <= maxLength) {
    return value
  }
  return `${value.slice(0, maxLength - 3).trimEnd()}...`
}

function pushUniqueNote(notes: string[], note: string | null | undefined): void {
  if (!note || notes.includes(note)) {
    return
  }
  notes.push(note)
}

function getConditionValue(offer: OfferDetailLike, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = offer.conditions?.[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }
  return null
}

function summarizeConditionList(value: string | null, maxItems = 3): string | null {
  if (!value) {
    return null
  }

  const parts = splitDetailText(value)
    .map((part) => normalizeDetailText(part))
    .filter((part) => part.length > 0)

  if (parts.length === 0) {
    return null
  }

  return truncateDetailText(parts.slice(0, maxItems).join('; '))
}

function collectOfferSegments(offer: OfferDetailLike): OfferDetailSegmentLike[] {
  return [
    ...(offer.segments ?? []),
    ...(offer.inbound?.segments ?? []),
  ]
}

function collectUniqueDetailValues(values: Array<string | undefined>): string[] {
  const seen = new Set<string>()
  const output: string[] = []

  for (const value of values) {
    const normalized = typeof value === 'string' ? value.trim() : ''
    if (!normalized) {
      continue
    }

    const key = normalized.toLowerCase()
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    output.push(normalized)
  }

  return output
}

function collectFlightNumbers(offer: OfferDetailLike): string[] {
  const segmentFlightNumbers = collectOfferSegments(offer).map((segment) => segment.flight_number)
  return collectUniqueDetailValues([
    ...segmentFlightNumbers,
    offer.flight_number,
  ])
}

function collectAircraftTypes(offer: OfferDetailLike): string[] {
  return collectUniqueDetailValues(
    collectOfferSegments(offer).map((segment) => segment.aircraft?.replace(/\s*\([^)]*\)/g, '').trim()),
  )
}

function collectOperatingCarriers(offer: OfferDetailLike): string[] {
  return collectUniqueDetailValues(
    collectOfferSegments(offer).map((segment) => segment.airline),
  )
}

function findMatchingSourceText(sources: DetailTextSource[], pattern: RegExp): string | null {
  for (const source of sources) {
    if (!pattern.test(source.text)) {
      continue
    }

    const cleaned = normalizeDetailText(source.text)
    if (cleaned.length > 0) {
      return truncateDetailText(cleaned)
    }
  }

  return null
}

function formatFareFamilyBadgeLabel(value: string): string {
  return truncateDetailText(`Fare: ${value}`, 28)
}

function splitDetailText(value: string): string[] {
  return value
    .split(/(?:\r?\n|;|•|\|)+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

function collectTextSources(offer: OfferDetailLike): DetailTextSource[] {
  const sources: DetailTextSource[] = []
  const ancillaries = offer.ancillaries

  for (const ancillary of [ancillaries?.cabin_bag, ancillaries?.checked_bag, ancillaries?.seat_selection]) {
    if (typeof ancillary?.description === 'string' && ancillary.description.trim().length > 0) {
      for (const fragment of splitDetailText(ancillary.description.trim())) {
        sources.push({
          text: fragment,
          included: ancillary.included,
          source: 'ancillary',
        })
      }
    }
  }

  for (const [key, value] of Object.entries(offer.conditions ?? {})) {
    if (key === 'refund_before_departure' || key === 'change_before_departure') {
      continue
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      for (const fragment of splitDetailText(value.trim())) {
        sources.push({
          text: `${key.replace(/_/g, ' ')}: ${fragment}`,
          source: 'condition',
        })
      }
    }
  }

  return sources
}

function buildUnknownAmenityAssessment(): OfferAmenityAssessment {
  return {
    state: 'unknown',
    confidence: 'unknown',
    source: 'unknown',
  }
}

function scoreAmenityAssessment(assessment: OfferAmenityAssessment): number {
  const confidenceScore = assessment.confidence === 'verified'
    ? 20
    : assessment.confidence === 'inferred'
      ? 10
      : 0
  const stateScore = assessment.state === 'included'
    ? 3
    : assessment.state === 'available'
      ? 2
      : assessment.state === 'unavailable'
        ? 1
        : 0
  return confidenceScore + stateScore
}

function chooseAmenityAssessment(
  current: OfferAmenityAssessment,
  next: OfferAmenityAssessment,
): OfferAmenityAssessment {
  return scoreAmenityAssessment(next) > scoreAmenityAssessment(current) ? next : current
}

function normalizeAmenitySignal(assessment: OfferAmenityAssessment): OfferServiceSignal {
  if (assessment.confidence !== 'verified') {
    return null
  }
  if (assessment.state === 'included' || assessment.state === 'available') {
    return assessment.state
  }
  return null
}

function assessServiceSignal(
  pattern: RegExp,
  sources: DetailTextSource[],
  options?: {
    barePattern?: RegExp
    bareState?: Extract<OfferAmenityState, 'included' | 'available'>
  },
): OfferAmenityAssessment {
  let best = buildUnknownAmenityAssessment()

  for (const source of sources) {
    if (!pattern.test(source.text)) {
      continue
    }

    const normalized = source.text.toLowerCase()
    let candidate: OfferAmenityAssessment

    if (SERVICE_UNAVAILABLE_RE.test(normalized)) {
      candidate = {
        state: 'unavailable',
        confidence: 'verified',
        source: source.source,
        evidence: source.text,
      }
    } else if (SERVICE_AVAILABLE_RE.test(normalized) || source.included === false) {
      candidate = {
        state: 'available',
        confidence: 'verified',
        source: source.source,
        evidence: source.text,
      }
    } else if (SERVICE_INCLUDED_RE.test(normalized)) {
      candidate = {
        state: 'included',
        confidence: 'verified',
        source: source.source,
        evidence: source.text,
      }
    } else if (options?.barePattern?.test(normalized)) {
      candidate = {
        state: options.bareState ?? 'included',
        confidence: 'verified',
        source: source.source,
        evidence: source.text,
      }
    } else if (source.included === true) {
      candidate = {
        state: 'included',
        confidence: 'inferred',
        source: source.source,
        evidence: source.text,
      }
    } else {
      candidate = {
        state: 'available',
        confidence: 'inferred',
        source: source.source,
        evidence: source.text,
      }
    }

    best = chooseAmenityAssessment(best, candidate)
  }

  return best
}

function classifyConditionStateFromText(
  sources: DetailTextSource[],
  textRe: RegExp,
  notAllowedRe: RegExp,
  withFeeRe: RegExp,
  allowedRe: RegExp,
): OfferConditionState | null {
  for (const source of sources) {
    const normalized = source.text.toLowerCase()
    if (!textRe.test(normalized)) {
      continue
    }
    if (notAllowedRe.test(normalized)) {
      return 'not_allowed'
    }
    if (withFeeRe.test(normalized)) {
      return 'allowed_with_fee'
    }
    if (allowedRe.test(normalized)) {
      return 'allowed'
    }
  }

  return null
}

export function extractOfferDetailSignals(offer: OfferDetailLike): OfferDetailSignals {
  const textSources = collectTextSources(offer)
  const mealAssessment = assessServiceSignal(MEAL_RE, textSources)
  const refreshmentAssessment = assessServiceSignal(REFRESHMENT_RE, textSources)
  const insuranceAssessment = assessServiceSignal(INSURANCE_RE, textSources)
  const loungeAssessment = assessServiceSignal(LOUNGE_RE, textSources)
  const wifiAssessment = assessServiceSignal(WIFI_RE, textSources, {
    barePattern: WIFI_BARE_RE,
    bareState: 'available',
  })
  const powerAssessment = assessServiceSignal(POWER_RE, textSources, {
    barePattern: POWER_BARE_RE,
    bareState: 'included',
  })
  const entertainmentAssessment = assessServiceSignal(ENTERTAINMENT_RE, textSources, {
    barePattern: ENTERTAINMENT_BARE_RE,
    bareState: 'included',
  })

  return {
    refundability:
      offer.conditions?.refund_before_departure ??
      classifyConditionStateFromText(
        textSources,
        REFUND_TEXT_RE,
        REFUND_NOT_ALLOWED_RE,
        REFUND_WITH_FEE_RE,
        REFUND_ALLOWED_RE,
      ),
    changeability:
      offer.conditions?.change_before_departure ??
      classifyConditionStateFromText(
        textSources,
        CHANGE_TEXT_RE,
        CHANGE_NOT_ALLOWED_RE,
        CHANGE_WITH_FEE_RE,
        CHANGE_ALLOWED_RE,
      ),
    meals: normalizeAmenitySignal(mealAssessment),
    refreshments: normalizeAmenitySignal(refreshmentAssessment),
    insurance: normalizeAmenitySignal(insuranceAssessment),
    lounge: normalizeAmenitySignal(loungeAssessment),
    wifi: normalizeAmenitySignal(wifiAssessment),
    power: normalizeAmenitySignal(powerAssessment),
    entertainment: normalizeAmenitySignal(entertainmentAssessment),
    amenities: {
      meals: mealAssessment,
      refreshments: refreshmentAssessment,
      insurance: insuranceAssessment,
      lounge: loungeAssessment,
      wifi: wifiAssessment,
      power: powerAssessment,
      entertainment: entertainmentAssessment,
    },
  }
}

const AMENITY_BADGE_META = [
  {
    key: 'meals',
    included: { key: 'meal_included', label: 'Meal included', tone: 'positive' as const },
    available: { key: 'meal_option', label: 'Meal option', tone: 'neutral' as const },
    includedNote: 'Meal included in the fare data',
    availableNote: 'Meal option shown in the fare data',
  },
  {
    key: 'refreshments',
    included: { key: 'refreshments_included', label: 'Refreshments included', tone: 'positive' as const },
    available: { key: 'refreshments_option', label: 'Refreshments available', tone: 'neutral' as const },
    includedNote: 'Refreshments included in the fare data',
    availableNote: 'Refreshments shown in the fare data',
  },
  {
    key: 'wifi',
    included: { key: 'wifi_included', label: 'Wi-Fi included', tone: 'positive' as const },
    available: { key: 'wifi_available', label: 'Wi-Fi available', tone: 'neutral' as const },
    includedNote: 'Wi-Fi included in the fare data',
    availableNote: 'Wi-Fi availability shown in the fare data',
  },
  {
    key: 'power',
    included: { key: 'power_included', label: 'USB / power at seat', tone: 'positive' as const },
    available: { key: 'power_available', label: 'USB / power available', tone: 'neutral' as const },
    includedNote: 'USB or power outlet shown in the fare data',
    availableNote: 'USB or power availability shown in the fare data',
  },
  {
    key: 'entertainment',
    included: { key: 'ife_included', label: 'In-flight entertainment', tone: 'positive' as const },
    available: { key: 'ife_available', label: 'Entertainment available', tone: 'neutral' as const },
    includedNote: 'In-flight entertainment shown in the fare data',
    availableNote: 'Entertainment availability shown in the fare data',
  },
  {
    key: 'insurance',
    included: { key: 'insurance_included', label: 'Insurance included', tone: 'positive' as const },
    available: { key: 'insurance_option', label: 'Insurance option', tone: 'neutral' as const },
    includedNote: 'Insurance included in the fare data',
    availableNote: 'Insurance option shown in the fare data',
  },
  {
    key: 'lounge',
    included: { key: 'lounge_included', label: 'Lounge included', tone: 'positive' as const },
    available: { key: 'lounge_option', label: 'Lounge option', tone: 'neutral' as const },
    includedNote: 'Lounge access included in the fare data',
    availableNote: 'Lounge access option shown in the fare data',
  },
] as const

export function getOfferDetailBadges(offer: OfferDetailLike): OfferDetailBadge[] {
  const signals = extractOfferDetailSignals(offer)
  const badges: OfferDetailBadge[] = []
  const fareFamily = getConditionValue(offer, 'fare_family', 'fare_bundle')

  if (signals.refundability === 'allowed' && signals.changeability === 'allowed') {
    badges.push({ key: 'flexible', label: 'Flexible fare', tone: 'positive' })
  } else {
    if (signals.refundability === 'allowed') {
      badges.push({ key: 'refund_allowed', label: 'Refundable', tone: 'positive' })
    } else if (signals.refundability === 'allowed_with_fee') {
      badges.push({ key: 'refund_fee', label: 'Refund with fee', tone: 'neutral' })
    } else if (signals.refundability === 'not_allowed') {
      badges.push({ key: 'refund_none', label: 'No refund', tone: 'negative' })
    }

    if (signals.changeability === 'allowed') {
      badges.push({ key: 'change_allowed', label: 'Changes allowed', tone: 'positive' })
    } else if (signals.changeability === 'allowed_with_fee') {
      badges.push({ key: 'change_fee', label: 'Changes with fee', tone: 'neutral' })
    } else if (signals.changeability === 'not_allowed') {
      badges.push({ key: 'change_none', label: 'No changes', tone: 'negative' })
    }
  }

  if (fareFamily) {
    badges.push({ key: 'fare_family', label: formatFareFamilyBadgeLabel(fareFamily), tone: 'neutral' })
  }

  for (const amenity of AMENITY_BADGE_META) {
    const signal = signals[amenity.key]
    if (signal === 'included') {
      badges.push(amenity.included)
    } else if (signal === 'available') {
      badges.push(amenity.available)
    }
  }

  return badges.slice(0, 4)
}

export function getOfferDetailPromptNotes(offer: OfferDetailLike): string[] {
  const signals = extractOfferDetailSignals(offer)
  const textSources = collectTextSources(offer)
  const notes: string[] = []
  const fareFamily = getConditionValue(offer, 'fare_family', 'fare_bundle')
  const fareBenefits = summarizeConditionList(getConditionValue(offer, 'fare_bundle_benefits', 'fare_bundle_description'))

  if (fareFamily) {
    notes.push(`Fare family shown: ${fareFamily}`)
  }

  if (fareBenefits) {
    notes.push(`Fare bundle benefits shown: ${fareBenefits}`)
  }

  if (signals.refundability === 'allowed') {
    notes.push('Refunds allowed before departure')
  } else if (signals.refundability === 'allowed_with_fee') {
    notes.push('Refunds allowed before departure with a fee')
  } else if (signals.refundability === 'not_allowed') {
    notes.push('No refunds shown before departure')
  }

  if (signals.changeability === 'allowed') {
    notes.push('Changes allowed before departure')
  } else if (signals.changeability === 'allowed_with_fee') {
    notes.push('Changes allowed before departure with a fee')
  } else if (signals.changeability === 'not_allowed') {
    notes.push('No changes shown before departure')
  }

  for (const amenity of AMENITY_BADGE_META) {
    const signal = signals[amenity.key]
    if (signal === 'included') {
      notes.push(amenity.includedNote)
    } else if (signal === 'available') {
      notes.push(amenity.availableNote)
    }
  }

  const seatSelectionEvidence = findMatchingSourceText(textSources, SEAT_SELECTION_RE)
  if (seatSelectionEvidence && !(fareBenefits && fareBenefits.toLowerCase().includes(seatSelectionEvidence.toLowerCase()))) {
    pushUniqueNote(notes, `Seat selection shown in fare data: ${seatSelectionEvidence}`)
  }

  const legroomEvidence = findMatchingSourceText(textSources, LEGROOM_RE)
  if (legroomEvidence) {
    pushUniqueNote(notes, `Legroom shown in fare data: ${legroomEvidence}`)
  }

  const flightNumbers = collectFlightNumbers(offer)
  if (flightNumbers.length > 0) {
    pushUniqueNote(notes, `Flight numbers shown: ${flightNumbers.join(', ')}`)
  }

  const aircraftTypes = collectAircraftTypes(offer)
  if (aircraftTypes.length > 0) {
    pushUniqueNote(notes, `Aircraft shown: ${aircraftTypes.join(', ')}`)
  }

  const operatingCarriers = collectOperatingCarriers(offer)
  const normalizedOfferAirline = typeof offer.airline === 'string' ? offer.airline.trim().toLowerCase() : ''
  if (operatingCarriers.length === 1 && operatingCarriers[0].toLowerCase() !== normalizedOfferAirline) {
    pushUniqueNote(notes, `Operating carrier shown: ${operatingCarriers[0]}`)
  } else if (operatingCarriers.length > 1) {
    pushUniqueNote(notes, `Operating carriers shown: ${operatingCarriers.join(', ')}`)
  }

  return notes
}
