/**
 * Tests that the client-side offer accumulator correctly snaps to the
 * authoritative final snapshot when search completes, instead of retaining
 * phantom offers that appeared in early polls but vanished from FSW state.
 *
 * Root cause (confirmed 2026-05-24 via live FSW probe, LON→BCN):
 *  - ~65 offers appeared in polls 5-6 (early connectors: Vueling, combo) then
 *    vanished from the final completed snapshot
 *  - 43 offers have the same `id` but different `inbound.departure_time` across
 *    polls (combo offers re-emitted with multiple return-date variants)
 *  - Client kept all of these via the accumulate-union strategy, inflating
 *    `offers.length` (= header count) and leaving un-bookable cards in the list
 *
 * The fix: during `status === 'searching'` keep accumulating (climbing-counter
 * UX); when `status === 'completed'` snap to the authoritative incoming set.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { getOfferInstanceKey } from '../app/lib/rankOffers.ts'
import type { FlightOffer } from '../app/results/[searchId]/search-share-model.ts'

function offer(id: string, inboundDep?: string): FlightOffer {
  return {
    id,
    price: 100,
    currency: 'EUR',
    airline: 'Test Air',
    airline_code: 'TA',
    origin: 'LON',
    origin_name: 'London',
    destination: 'BCN',
    destination_name: 'Barcelona',
    departure_time: '2026-06-07T09:00:00',
    arrival_time: '2026-06-07T11:15:00',
    duration_minutes: 135,
    stops: 0,
    inbound: inboundDep ? { departure_time: inboundDep, arrival_time: '2026-06-14T12:00:00', stops: 0 } : undefined,
  }
}

// Mirrors SearchPageClient.tsx:475-477
function dedup(offers: FlightOffer[]): FlightOffer[] {
  return Array.from(new Map(offers.map(o => [getOfferInstanceKey(o), o])).values())
}

// Mirrors SearchPageClient.tsx:817 — current (buggy) accumulator
function accumulateAlways(prev: FlightOffer[], incoming: FlightOffer[]): FlightOffer[] {
  return dedup([...prev, ...incoming])
}

// The fixed version: snap on completion
function accumulateOrSnap(prev: FlightOffer[], incoming: FlightOffer[], isSearching: boolean): FlightOffer[] {
  if (isSearching) return dedup([...prev, ...incoming])
  return dedup(incoming)
}

// ── transient phantom test ──────────────────────────────────────────────────

test('accumulate-always retains phantom offers that vanished from FSW', () => {
  // poll 1 (searching): FSW returns A, B, C — B and C are transient
  const poll1 = [offer('A'), offer('B'), offer('C')]
  // poll 2 (completed): FSW has pruned B and C — only A remains + new offer D
  const poll2 = [offer('A'), offer('D')]

  const acc = accumulateAlways(poll1, poll2)
  // Bug: accumulator keeps B and C even though they're gone from FSW
  assert.equal(acc.length, 4, 'accumulate-always retains phantoms B and C → inflated count')
  assert.ok(acc.some(o => o.id === 'B'), 'phantom B is still in accumulator')
  assert.ok(acc.some(o => o.id === 'C'), 'phantom C is still in accumulator')
})

test('snap-on-complete drops phantom offers (EXPECTED BEHAVIOR after fix)', () => {
  const poll1 = [offer('A'), offer('B'), offer('C')]
  const poll2Completed = [offer('A'), offer('D')]

  // During searching: still accumulate
  const midSearch = accumulateOrSnap(poll1, poll2Completed, true)
  assert.equal(midSearch.length, 4, 'during searching: still accumulates')

  // On completion: snap to authoritative incoming
  const onComplete = accumulateOrSnap(poll1, poll2Completed, false)
  assert.equal(onComplete.length, 2, 'on completion: snaps to [A, D], drops phantoms')
  assert.ok(!onComplete.some(o => o.id === 'B'), 'phantom B removed')
  assert.ok(!onComplete.some(o => o.id === 'C'), 'phantom C removed')
  assert.ok(onComplete.some(o => o.id === 'A'), 'real offer A kept')
  assert.ok(onComplete.some(o => o.id === 'D'), 'new offer D kept')
})

// ── id-drift test ───────────────────────────────────────────────────────────

test('same id with different inbound timestamps creates multiple instance keys', () => {
  // Confirmed in probe: combo offers share an id but FSW emits them with
  // different inbound departure dates (Jun 16, 17, 18, 19). The client key
  // includes inbound.departure_time so each is treated as a distinct offer.
  const comboJun16 = offer('wo_combo_1', '2026-06-16T10:00:00')
  const comboJun17 = offer('wo_combo_1', '2026-06-17T10:00:00')

  const key16 = getOfferInstanceKey(comboJun16)
  const key17 = getOfferInstanceKey(comboJun17)
  assert.notEqual(key16, key17, 'same id but different inbound dep → different instance key')

  // Current behavior: both are kept in the accumulator (inflation)
  const accumulated = accumulateAlways([comboJun16], [comboJun17])
  assert.equal(accumulated.length, 2, 'accumulate-always: both variants kept (inflation)')

  // Fixed behavior: snap-on-complete sees only the final poll's version
  const snapped = accumulateOrSnap([comboJun16], [comboJun17], false)
  assert.equal(snapped.length, 1, 'snap-on-complete: only the latest variant kept')
  assert.equal((snapped[0] as any).inbound.departure_time, '2026-06-17T10:00:00', 'keeps latest variant')
})

// ── count consistency test ──────────────────────────────────────────────────

test('snap-on-complete makes live count consistent with cached reload count', () => {
  // Simulate: 3 searching polls accumulate offers, then final completed poll
  // delivers the authoritative set. After snap, offers.length must equal
  // what the durable cache stored (= final poll's deduped count).

  // Early polls (searching) — some offers are transient
  const earlyOffers = [offer('A'), offer('B_transient'), offer('C_transient')]
  const midOffers = [offer('A'), offer('D'), offer('E_transient')]
  const finalOffers = [offer('A'), offer('D'), offer('F')]  // B,C,E gone; F new

  // Simulate searching accumulation
  let state = dedup([])
  state = accumulateOrSnap(state, earlyOffers, true)   // [A, B, C]
  state = accumulateOrSnap(state, midOffers, true)     // [A, B, C, D, E]
  assert.equal(state.length, 5, 'mid-search: accumulated 5 offers')

  // Final completed poll → snap
  state = accumulateOrSnap(state, finalOffers, false)  // [A, D, F]
  assert.equal(state.length, 3, 'on completion: snapped to 3 authoritative offers')

  // Cached reload would serve finalOffers directly — counts match
  const cacheRead = dedup(finalOffers)
  assert.equal(state.length, cacheRead.length, 'live count after snap === cached reload count')
  assert.deepEqual(state.map(o => o.id).sort(), cacheRead.map(o => o.id).sort())
})
