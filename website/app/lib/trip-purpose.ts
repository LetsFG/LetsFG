export type TripPurpose =
  | 'honeymoon'
  | 'business'
  | 'ski'
  | 'beach'
  | 'city_break'
  | 'family_holiday'
  | 'graduation'
  | 'concert_festival'
  | 'sports_event'
  | 'spring_break'

export const TRIP_PURPOSES: readonly TripPurpose[] = [
  'honeymoon',
  'business',
  'ski',
  'beach',
  'city_break',
  'family_holiday',
  'graduation',
  'concert_festival',
  'sports_event',
  'spring_break',
]

export interface TripPurposeOptions {
  tripPurpose?: TripPurpose | null
  tripPurposes?: ReadonlyArray<TripPurpose | null | undefined> | null
}

export function normalizeTripPurposes({ tripPurpose, tripPurposes }: TripPurposeOptions): TripPurpose[] {
  const normalized: TripPurpose[] = []
  const seen = new Set<TripPurpose>()

  for (const purpose of tripPurposes ?? []) {
    if (!purpose || seen.has(purpose)) continue
    seen.add(purpose)
    normalized.push(purpose)
  }

  if (tripPurpose && !seen.has(tripPurpose)) {
    normalized.push(tripPurpose)
  }

  return normalized
}

export function getPrimaryTripPurpose(options: TripPurposeOptions): TripPurpose | undefined {
  return normalizeTripPurposes(options)[0]
}