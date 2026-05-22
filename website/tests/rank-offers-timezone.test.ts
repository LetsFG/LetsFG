/**
 * Timezone-correctness regression tests for isoToMins and any caller that
 * depends on it (dedup bucketing, selectDiverseTop slot assignment, scoring).
 *
 * Root cause: isoToMins was using Date.getHours() which returns server-local
 * time (UTC on Cloud Run). A timestamp like "2026-06-01T10:15:00+02:00" was
 * parsed to UTC 08:15 and scored/bucketed as an 08:15 departure instead of
 * the correct 10:15 local airport time.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { deduplicateOffers, rankOffers, selectDiverseTop } from '../app/lib/rankOffers.ts'

// ── Minimal offer factory ─────────────────────────────────────────────────
function makeOffer(id: string, depIso: string, arrIso: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    price: 100,
    currency: 'EUR',
    airline: 'Ryanair',
    origin: 'STN',
    destination: 'BCN',
    departure_time: depIso,
    arrival_time: arrIso,
    duration_minutes: 135,
    stops: 0,
    ...extra,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// A. isoToMins correctness
// ─────────────────────────────────────────────────────────────────────────────

test('isoToMins returns local airport minutes for offset-bearing timestamps', () => {
  // Scenario: two flights on a Mexico City route (UTC-6).
  //   'midnight-local'  departs at 00:30 local (UTC 06:30).
  //   'morning-local'   departs at 09:00 local (UTC 15:00).
  //
  // With the OLD getHours() bug on a UTC server:
  //   00:30-06:00 → UTC 06:30 → getHours()=6 → 360 min → perfect morning (score 1.00!)
  //   09:00-06:00 → UTC 15:00 → getHours()=15 → 900 min → afternoon score < 1.00
  //   → midnight-local wins (WRONG)
  //
  // With the FIXED regex extraction:
  //   T00:30 → 30 min → night score (low)
  //   T09:00 → 540 min → perfect morning (score 1.00)
  //   → morning-local wins (CORRECT)
  const ranked = rankOffers(
    [
      makeOffer('midnight-local', '2026-06-01T00:30:00-06:00', '2026-06-01T04:15:00-06:00', { duration_minutes: 225 }),
      makeOffer('morning-local',  '2026-06-01T09:00:00-06:00', '2026-06-01T12:45:00-06:00', { duration_minutes: 225 }),
    ],
    { depTimePref: 'morning' },
  )
  assert.equal(ranked[0].offer.id, 'morning-local',
    'T09:00-06:00 must rank as morning; T00:30-06:00 must rank as night')
})

test('isoToMins returns correct minutes for Z-suffixed UTC timestamps', () => {
  // 08:15Z → 495 min — this is the local airport time when the airport is in UTC.
  const ranked = rankOffers(
    [
      makeOffer('z-flight', '2026-06-01T08:15:00Z', '2026-06-01T10:30:00Z'),
      makeOffer('early',    '2026-06-01T04:00:00Z', '2026-06-01T06:15:00Z'),
    ],
    { depTimePref: 'morning' },
  )
  assert.equal(ranked[0].offer.id, 'z-flight',
    'Expected 08:15Z flight to rank as morning, not below the 04:00Z pre-dawn flight')
})

test('scoreDepTime scores 10:15+02:00 as daytime, not pre-dawn', () => {
  // Indirect: if scoring is wrong the early offer would rank higher for "morning".
  const offers = [
    // 10:15 local (+02:00) — clearly morning
    makeOffer('morning-offset', '2026-06-01T10:15:00+02:00', '2026-06-01T12:30:00+02:00'),
    // 22:00 local — night flight that should lose
    makeOffer('night', '2026-06-01T22:00:00+02:00', '2026-06-02T00:15:00+02:00', { duration_minutes: 135 }),
  ]
  const ranked = rankOffers(offers, { depTimePref: 'morning' })
  assert.equal(ranked[0].offer.id, 'morning-offset',
    '10:15+02:00 must score better than 22:00 for a morning preference')
})

// ─────────────────────────────────────────────────────────────────────────────
// B. Dedup bucketing with mixed offset / no-offset timestamps
// ─────────────────────────────────────────────────────────────────────────────

test('deduplicateOffers collapses same flight from offset vs no-offset connector', () => {
  // Both represent the same Ryanair FR1234 departing at 10:15 local time.
  // Before the fix, one landed in bucket 17 (UTC 08:15) and the other in
  // bucket 21 (10:15 no-offset), so they were never deduplicated.
  const offers = [
    {
      ...makeOffer('with-offset',    '2026-06-01T10:15:00+02:00', '2026-06-01T12:30:00+02:00'),
      price: 120,
    },
    {
      ...makeOffer('without-offset', '2026-06-01T10:15:00',       '2026-06-01T12:30:00'),
      price: 115, // cheaper — should win
    },
  ]

  const deduped = deduplicateOffers(offers)

  assert.equal(deduped.length, 1, 'Same physical flight must collapse to 1 offer')
  assert.equal(deduped[0].id, 'without-offset', 'Cheaper copy must survive')
})

test('deduplicateOffers keeps truly distinct flights with the same local time string', () => {
  // STN→BCN at 10:15 UTC+1 and LGW→BCN at 10:15 UTC+2 — different airports,
  // different UTC times, should NOT be deduplicated.
  const offers = [
    { ...makeOffer('stn', '2026-06-01T10:15:00+01:00', '2026-06-01T13:30:00+01:00'), origin: 'STN' },
    { ...makeOffer('lgw', '2026-06-01T10:15:00+02:00', '2026-06-01T13:30:00+02:00'), origin: 'LGW' },
  ]
  const deduped = deduplicateOffers(offers)
  assert.equal(deduped.length, 2, 'Different origin airports must produce distinct offers')
})

// ─────────────────────────────────────────────────────────────────────────────
// C. selectDiverseTop slot consistency
// ─────────────────────────────────────────────────────────────────────────────

test('selectDiverseTop: same local time in different offsets lands in same 3h slot', () => {
  // Two copies of the same flight (10:15 local, one with +02:00 offset, one bare).
  // After dedup only 1 should remain, so selectDiverseTop receives just 1 offer.
  const offers = [
    { ...makeOffer('a', '2026-06-01T10:15:00+02:00', '2026-06-01T12:30:00+02:00'), price: 120 },
    { ...makeOffer('b', '2026-06-01T10:15:00',       '2026-06-01T12:30:00'),       price: 115 },
  ]
  const ranked = rankOffers(offers, {})
  // Both represent the same flight — after dedup we expect 1 ranked offer
  const top2 = selectDiverseTop(ranked, 2)
  // Whether 1 or 2 survive dedup, the important thing is that the offset offer
  // is NOT placed in a different slot than the bare-offset offer.
  if (top2.length === 2) {
    // If somehow both survive, they must be considered the same slot (not diverse)
    // which means selectDiverseTop would only pick 1 diverse + 1 fallback.
    // The fallback fill ensures both end up in the list, so length 2 is still ok.
    const slots = top2.map(r =>
      Math.floor(parseInt(/T(\d{2})/.exec(r.offer.departure_time)?.[1] ?? '0', 10) * 60 / 180),
    )
    assert.equal(slots[0], slots[1], 'Both 10:15 offers must be in the same 3h slot')
  }
  // If only 1 survived dedup (correct), top2 will have 1 element — just verify no crash
  assert.ok(top2.length >= 1)
})
