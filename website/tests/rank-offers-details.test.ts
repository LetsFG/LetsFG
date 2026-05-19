import assert from 'node:assert/strict'
import test from 'node:test'

import { deduplicateOffers, rankOffers } from '../app/lib/rankOffers.ts'
import { extractOfferDetailSignals, getOfferDetailBadges, getOfferDetailPromptNotes } from '../lib/offer-details.ts'

test('offer detail helper extracts flexibility and optional perks from descriptions', () => {
  const offer = {
    ancillaries: {
      checked_bag: {
        included: true,
        description: 'Starter Plus bundle with bag + seat + meal',
      },
      seat_selection: {
        included: true,
        description: 'Travel insurance available during checkout',
      },
    },
    conditions: {
      refund_before_departure: 'allowed' as const,
      change_before_departure: 'allowed_with_fee' as const,
      fare_note: 'Airport lounge package available',
    },
  }

  const details = extractOfferDetailSignals(offer)
  const badges = getOfferDetailBadges(offer).map((badge) => badge.label)
  const promptNotes = getOfferDetailPromptNotes(offer)

  assert.equal(details.refundability, 'allowed')
  assert.equal(details.changeability, 'allowed_with_fee')
  assert.equal(details.meals, 'included')
  assert.equal(details.insurance, 'available')
  assert.equal(details.lounge, 'available')
  assert.equal(details.amenities.meals.confidence, 'verified')
  assert.equal(details.amenities.insurance.confidence, 'verified')
  assert.ok(badges.includes('Refundable'))
  assert.ok(badges.includes('Changes with fee'))
  assert.ok(badges.includes('Meal included'))
  assert.ok(badges.includes('Insurance option'))
  assert.ok(promptNotes.includes('Refunds allowed before departure'))
  assert.ok(promptNotes.includes('Meal included in the fare data'))
  assert.ok(promptNotes.includes('Insurance option shown in the fare data'))
  assert.ok(promptNotes.includes('Lounge access option shown in the fare data'))
})

test('offer detail helper infers flexibility from descriptive fare-rule notes', () => {
  const offer = {
    conditions: {
      fare_rules: 'Non-refundable fare; changes available with fee',
      meal_service: 'Buy-on-board meals and snacks available',
    },
  }

  const details = extractOfferDetailSignals(offer)
  const badges = getOfferDetailBadges(offer).map((badge) => badge.label)

  assert.equal(details.refundability, 'not_allowed')
  assert.equal(details.changeability, 'allowed_with_fee')
  assert.equal(details.meals, 'available')
  assert.ok(badges.includes('No refund'))
  assert.ok(badges.includes('Changes with fee'))
  assert.ok(badges.includes('Meal option'))
})

test('offer detail helper keeps ambiguous amenity mentions as unknown', () => {
  const offer = {
    ancillaries: {
      checked_bag: {
        included: true,
        description: 'Premium bundle meal',
      },
    },
    conditions: {
      fare_note: 'Lounge bundle',
    },
  }

  const details = extractOfferDetailSignals(offer)
  const badges = getOfferDetailBadges(offer).map((badge) => badge.label)
  const promptNotes = getOfferDetailPromptNotes(offer)

  assert.equal(details.meals, null)
  assert.equal(details.lounge, null)
  assert.equal(details.amenities.meals.confidence, 'inferred')
  assert.equal(details.amenities.lounge.confidence, 'inferred')
  assert.ok(!badges.includes('Meal included'))
  assert.ok(!badges.includes('Meal option'))
  assert.ok(!badges.includes('Lounge included'))
  assert.ok(!badges.includes('Lounge option'))
  assert.ok(!promptNotes.includes('Meal included in the fare data'))
  assert.ok(!promptNotes.includes('Meal option shown in the fare data'))
})

test('offer detail helper surfaces only explicit onboard amenity claims', () => {
  const offer = {
    conditions: {
      cabin_features:
        'Complimentary refreshments; Wi-Fi for a fee; USB outlet; In-flight entertainment; Meal provided',
    },
  }

  const details = extractOfferDetailSignals(offer)
  const badges = getOfferDetailBadges(offer).map((badge) => badge.label)
  const promptNotes = getOfferDetailPromptNotes(offer)

  assert.equal(details.meals, 'included')
  assert.equal(details.refreshments, 'included')
  assert.equal(details.wifi, 'available')
  assert.equal(details.power, 'included')
  assert.equal(details.entertainment, 'included')
  assert.equal(details.amenities.wifi.confidence, 'verified')
  assert.equal(details.amenities.power.confidence, 'verified')
  assert.equal(details.amenities.entertainment.confidence, 'verified')
  assert.ok(badges.includes('Meal included'))
  assert.ok(badges.includes('Refreshments included'))
  assert.ok(badges.includes('Wi-Fi available'))
  assert.ok(badges.includes('USB / power at seat'))
  assert.ok(promptNotes.includes('Meal included in the fare data'))
  assert.ok(promptNotes.includes('Refreshments included in the fare data'))
  assert.ok(promptNotes.includes('Wi-Fi availability shown in the fare data'))
  assert.ok(promptNotes.includes('USB or power outlet shown in the fare data'))
  assert.ok(promptNotes.includes('In-flight entertainment shown in the fare data'))
})

test('offer detail helper surfaces trusted Google fare and operational metadata', () => {
  const offer = {
    airline: 'American Airlines',
    flight_number: 'AA2600',
    segments: [
      {
        airline: 'American Airlines',
        flight_number: 'AA2600',
        aircraft: 'Boeing 737',
      },
      {
        airline: 'American Airlines',
        flight_number: 'AA3730',
        aircraft: 'Embraer 175',
      },
    ],
    conditions: {
      fare_family: 'Main Cabin',
      fare_bundle_benefits: 'Choose your seat for a fee; 1 checked bag from $35',
      cabin_features:
        'Free Wi-Fi; In-seat power & USB outlets; Stream media to your device; Average legroom (30 in)',
    },
  }

  const details = extractOfferDetailSignals(offer)
  const badges = getOfferDetailBadges(offer).map((badge) => badge.label)
  const promptNotes = getOfferDetailPromptNotes(offer)

  assert.equal(details.wifi, 'included')
  assert.equal(details.power, 'included')
  assert.equal(details.entertainment, 'included')
  assert.ok(badges.includes('Fare: Main Cabin'))
  assert.ok(promptNotes.includes('Fare family shown: Main Cabin'))
  assert.ok(promptNotes.includes('Fare bundle benefits shown: Choose your seat for a fee; 1 checked bag from $35'))
  assert.ok(promptNotes.includes('Legroom shown in fare data: Average legroom (30 in)'))
  assert.ok(promptNotes.includes('Flight numbers shown: AA2600, AA3730'))
  assert.ok(promptNotes.includes('Aircraft shown: Boeing 737, Embraer 175'))
  assert.ok(promptNotes.includes('Wi-Fi included in the fare data'))
  assert.ok(promptNotes.includes('USB or power outlet shown in the fare data'))
  assert.ok(promptNotes.includes('In-flight entertainment shown in the fare data'))
})

test('rankOffers prefers fares with meal detail when meals are required', () => {
  const offers = [
    {
      id: 'meal-bundle',
      price: 150,
      displayPrice: 150,
      currency: 'EUR',
      airline: 'Example Air',
      origin: 'BCN',
      destination: 'ATH',
      departure_time: '2026-07-02T08:30:00Z',
      arrival_time: '2026-07-02T11:15:00Z',
      duration_minutes: 165,
      stops: 0,
      ancillaries: {
        checked_bag: {
          included: true,
          description: 'Starter Plus bundle with bag + seat + meal',
        },
      },
    },
    {
      id: 'cheaper-unknown',
      price: 145,
      displayPrice: 145,
      currency: 'EUR',
      airline: 'Example Air',
      origin: 'BCN',
      destination: 'ATH',
      departure_time: '2026-07-02T09:20:00Z',
      arrival_time: '2026-07-02T12:05:00Z',
      duration_minutes: 165,
      stops: 0,
    },
  ]

  const ranked = rankOffers(offers, { requireMeals: true })

  assert.equal(ranked[0].offer.id, 'meal-bundle')
  assert.ok(ranked[0].heroFacts.includes('meal included in fare'))
  assert.ok(ranked[1].tradeoffs.includes('meal availability not shown in the fare data'))
})

test('deduplicateOffers enriches the surviving cheapest copy with same-price duplicate metadata', () => {
  const deduped = deduplicateOffers([
    {
      id: 'plain-copy',
      price: 180,
      displayPrice: 180,
      currency: 'EUR',
      airline: 'Example Air',
      origin: 'BCN',
      destination: 'ATH',
      departure_time: '2026-07-02T08:30:00Z',
      arrival_time: '2026-07-02T11:15:00Z',
      duration_minutes: 165,
      stops: 0,
    },
    {
      id: 'richer-copy',
      price: 180,
      displayPrice: 180,
      currency: 'EUR',
      airline: 'Example Air',
      origin: 'BCN',
      destination: 'ATH',
      departure_time: '2026-07-02T08:35:00Z',
      arrival_time: '2026-07-02T11:20:00Z',
      duration_minutes: 165,
      stops: 0,
      ancillaries: {
        checked_bag: {
          description: 'Starter Plus bundle with bag + seat + meal',
        },
      },
      conditions: {
        fare_note: 'Airport lounge package available',
      },
    },
  ])

  assert.equal(deduped.length, 1)
  assert.equal(deduped[0].id, 'plain-copy')
  assert.equal(extractOfferDetailSignals(deduped[0]).meals, 'included')
  assert.equal(extractOfferDetailSignals(deduped[0]).lounge, 'available')
})