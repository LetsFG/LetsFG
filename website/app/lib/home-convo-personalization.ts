import type { ParsedQuery } from './searchParsing'
import { normalizeTripPurposes, type TripPurpose } from './trip-purpose'

type ChipId =
  | 'solo'
  | 'just_me'
  | 'two'
  | 'partner'
  | 'family'
  | 'friends'
  | 'squad'
  | 'colleague'
  | 'small_team'
  | 'small_group'
  | 'lowest_price'
  | 'direct'
  | 'good_times'
  | 'flexible'
  | 'cheapest'
  | 'comfort'
  | 'flex_price'
  | 'biz_class'
  | 'direct_only'
  | 'early_dep'
  | 'cheapest_opt'
  | 'latest_return'

export interface HomeConvoChipSpec {
  labelKey: string
  englishKey: string
}

export interface HomeConvoQuestionSpec {
  questionKey: 'pax_q' | 'pax_q_beach' | 'pax_q_business' | 'pax_q_city' | 'priority_q' | 'priority_q_budget' | 'priority_q_speed'
  chips: HomeConvoChipSpec[]
}

const CHIP_SPECS: Record<ChipId, HomeConvoChipSpec> = {
  solo: { labelKey: 'chip_solo', englishKey: 'Solo' },
  just_me: { labelKey: 'chip_just_me', englishKey: 'Just me' },
  two: { labelKey: 'chip_two', englishKey: 'Two of us' },
  partner: { labelKey: 'chip_partner', englishKey: 'Partner' },
  family: { labelKey: 'chip_family', englishKey: 'Family' },
  friends: { labelKey: 'chip_friends', englishKey: 'Group of friends' },
  squad: { labelKey: 'chip_squad', englishKey: 'Squad' },
  colleague: { labelKey: 'chip_colleague', englishKey: 'With a colleague' },
  small_team: { labelKey: 'chip_small_team', englishKey: 'Small team' },
  small_group: { labelKey: 'chip_small_group', englishKey: 'Small group' },
  lowest_price: { labelKey: 'chip_lowest_price', englishKey: 'Lowest price' },
  direct: { labelKey: 'chip_direct', englishKey: 'Direct flights' },
  good_times: { labelKey: 'chip_good_times', englishKey: 'Good times' },
  flexible: { labelKey: 'chip_flexible', englishKey: 'Flexible dates' },
  cheapest: { labelKey: 'chip_cheapest', englishKey: 'Cheapest possible' },
  comfort: { labelKey: 'chip_comfort', englishKey: 'Some comfort ok' },
  flex_price: { labelKey: 'chip_flex_price', englishKey: 'Flexible on price' },
  biz_class: { labelKey: 'chip_biz_class', englishKey: 'Business class' },
  direct_only: { labelKey: 'chip_direct_only', englishKey: 'Direct flights only' },
  early_dep: { labelKey: 'chip_early_dep', englishKey: 'Early departure' },
  cheapest_opt: { labelKey: 'chip_cheapest_opt', englishKey: 'Cheapest option' },
  latest_return: { labelKey: 'chip_latest_return', englishKey: 'Latest return' },
}

const CITY_LIKE_PURPOSES = new Set<TripPurpose>([
  'city_break',
  'concert_festival',
  'sports_event',
  'graduation',
])

const RELAXED_PURPOSES = new Set<TripPurpose>([
  'beach',
  'honeymoon',
  'spring_break',
])

function resolveTripPurposes(parsed: Pick<ParsedQuery, 'trip_purpose' | 'trip_purposes'>): TripPurpose[] {
  return normalizeTripPurposes({
    tripPurpose: parsed.trip_purpose,
    tripPurposes: parsed.trip_purposes,
  })
}

function uniqueChips(ids: ChipId[]): HomeConvoChipSpec[] {
  const seen = new Set<string>()
  const chips: HomeConvoChipSpec[] = []

  for (const id of ids) {
    const chip = CHIP_SPECS[id]
    if (!chip || seen.has(chip.englishKey)) continue
    seen.add(chip.englishKey)
    chips.push(chip)
  }

  return chips
}

export function buildPartySizeQuestionSpec(
  parsed: Pick<ParsedQuery, 'trip_purpose' | 'trip_purposes'>,
): HomeConvoQuestionSpec {
  const tripPurposes = resolveTripPurposes(parsed)
  const hasBusiness = tripPurposes.includes('business')
  const hasCityLike = tripPurposes.some((purpose) => CITY_LIKE_PURPOSES.has(purpose))
  const hasRelaxed = tripPurposes.some((purpose) => RELAXED_PURPOSES.has(purpose))
  const hasFamily = tripPurposes.includes('family_holiday')

  if (tripPurposes.length === 1) {
    if (tripPurposes[0] === 'beach') {
      return {
        questionKey: 'pax_q_beach',
        chips: uniqueChips(['just_me', 'partner', 'squad', 'family']),
      }
    }
    if (tripPurposes[0] === 'business') {
      return {
        questionKey: 'pax_q_business',
        chips: uniqueChips(['solo', 'colleague', 'small_team', 'family']),
      }
    }
    if (tripPurposes[0] === 'city_break') {
      return {
        questionKey: 'pax_q_city',
        chips: uniqueChips(['just_me', 'two', 'small_group', 'family']),
      }
    }
  }

  let chipIds: ChipId[]
  if (hasBusiness && hasCityLike) {
    chipIds = ['solo', 'colleague', 'two', 'small_team']
  } else if (hasBusiness && hasRelaxed) {
    chipIds = ['solo', 'colleague', 'partner', 'small_team']
  } else if (hasCityLike && hasRelaxed) {
    chipIds = ['just_me', 'partner', 'two', 'small_group']
  } else if (hasBusiness) {
    chipIds = ['solo', 'colleague', 'small_team', 'two']
  } else if (hasRelaxed) {
    chipIds = ['just_me', 'partner', 'squad', 'family']
  } else if (hasCityLike) {
    chipIds = ['just_me', 'two', 'small_group', 'family']
  } else {
    chipIds = ['solo', 'two', 'family', 'friends']
  }

  if (hasFamily && !chipIds.includes('family')) {
    chipIds = [...chipIds.slice(0, 3), 'family']
  }

  return {
    questionKey: 'pax_q',
    chips: uniqueChips(chipIds),
  }
}

export function buildPriorityQuestionSpec(
  parsed: Pick<ParsedQuery, 'trip_purpose' | 'trip_purposes' | 'max_price'>,
): HomeConvoQuestionSpec {
  if (parsed.max_price) {
    return {
      questionKey: 'priority_q_budget',
      chips: uniqueChips(['cheapest', 'comfort', 'flex_price', 'biz_class']),
    }
  }

  const tripPurposes = resolveTripPurposes(parsed)
  const hasBusiness = tripPurposes.includes('business')
  const hasCityLike = tripPurposes.some((purpose) => CITY_LIKE_PURPOSES.has(purpose))
  const hasRelaxed = tripPurposes.some((purpose) => RELAXED_PURPOSES.has(purpose))

  if (tripPurposes.length === 1 && tripPurposes[0] === 'city_break') {
    return {
      questionKey: 'priority_q_speed',
      chips: uniqueChips(['direct_only', 'early_dep', 'cheapest_opt', 'latest_return']),
    }
  }

  let chipIds: ChipId[]
  if (hasBusiness && hasCityLike) {
    chipIds = ['direct_only', 'good_times', 'latest_return', 'early_dep']
  } else if (hasBusiness && hasRelaxed) {
    chipIds = ['direct_only', 'good_times', 'early_dep', 'flexible']
  } else if (hasBusiness) {
    chipIds = ['direct_only', 'good_times', 'early_dep', 'biz_class']
  } else if (hasCityLike && hasRelaxed) {
    chipIds = ['direct_only', 'latest_return', 'cheapest_opt', 'good_times']
  } else if (hasCityLike) {
    chipIds = ['direct_only', 'early_dep', 'cheapest_opt', 'latest_return']
  } else if (hasRelaxed) {
    chipIds = ['cheapest_opt', 'direct', 'good_times', 'flexible']
  } else {
    chipIds = ['lowest_price', 'direct', 'good_times', 'flexible']
  }

  return {
    questionKey: 'priority_q',
    chips: uniqueChips(chipIds),
  }
}

export function hasTripTypeContext(
  parsed: Pick<ParsedQuery, 'return_date' | 'min_trip_days' | 'max_trip_days' | 'return_depart_time_pref'>,
): boolean {
  return Boolean(
    parsed.return_date
    || parsed.min_trip_days !== undefined
    || parsed.max_trip_days !== undefined
    || parsed.return_depart_time_pref,
  )
}