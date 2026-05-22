/**
 * Tests for timezone-safe duration computation in normalizeTrustedOffer.
 *
 * Root cause: Before the fix, getRouteTiming computed duration_minutes via
 * `new Date(arrival) - new Date(departure)` even when the timestamps lacked
 * explicit timezone information.  On Cloud Run (UTC server), an LHR→CDG
 * departure "09:00:00" (UK local, UTC+1) and arrival "12:00:00" (FR local,
 * UTC+2) would produce 3h epoch diff instead of the true 2h flight time,
 * because both strings are misread as UTC.
 *
 * The fix: only use the epoch diff when both timestamps carry explicit `Z` or
 * `±HH:MM` timezone suffixes.  Otherwise fall back to total_duration_seconds.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeTrustedOffer, toPublicOffer } from '../lib/trusted-offer.ts'

// ── helpers ───────────────────────────────────────────────────────────────────

function buildRaw(dep: string | undefined, arr: string | undefined, durationSecs?: number) {
  const segments: Record<string, unknown>[] = [
    {
      origin: 'STN',
      destination: 'BCN',
      ...(dep !== undefined ? { departure: dep } : {}),
      ...(arr !== undefined ? { arrival: arr } : {}),
      ...(durationSecs !== undefined ? { duration_seconds: durationSecs } : {}),
    },
  ]
  return {
    id: 'test-offer',
    price: 89,
    currency: 'EUR',
    airlines: ['Example Air'],
    airline_code: 'EA',
    source: 'test',
    outbound: {
      origin: 'STN',
      destination: 'BCN',
      segments,
      stopovers: 0,
      ...(durationSecs !== undefined ? { total_duration_seconds: durationSecs } : {}),
    },
  }
}

function getDuration(dep: string | undefined, arr: string | undefined, durationSecs?: number): number {
  const raw = buildRaw(dep, arr, durationSecs)
  const trusted = normalizeTrustedOffer(raw, 0)
  return toPublicOffer(trusted).duration_minutes ?? 0
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('duration uses total_duration_seconds when present', () => {
  // 7200 seconds = 120 minutes.  total_duration_seconds is the canonical source.
  const mins = getDuration(
    '2026-06-15T09:00:00Z',
    '2026-06-15T11:00:00Z',
    7200,
  )
  assert.equal(mins, 120,
    'total_duration_seconds=7200 must produce duration_minutes=120')
})

test('duration fallback from timestamp diff is timezone-safe (both with explicit tz)', () => {
  // Dep 09:00 UTC+0, arr 12:00 UTC+2 → real flight time = 1h (10:00 UTC – 09:00 UTC = 1h).
  // Without the fix (epoch diff on naive strings): 12:00 - 09:00 = 3h (wrong).
  // With the fix: both carry explicit tz info → safe to use diff → 1h.
  // We pass no total_duration_seconds so the only source is the timestamp diff.
  const mins = getDuration(
    '2026-06-15T09:00:00+00:00',
    '2026-06-15T12:00:00+02:00',
    undefined, // no connector-provided duration
  )
  // The correct duration is 60 minutes.
  assert.ok(mins >= 55 && mins <= 65,
    `Expected ~60 minutes for London→Paris hop, got ${mins}`)
})

test('duration is 0 when timestamps are missing and no duration_seconds provided', () => {
  // Completely unknown flight — must not fabricate a duration.
  const mins = getDuration(undefined, undefined, undefined)
  assert.equal(mins, 0,
    'Duration must be 0 when no timing info is available at all')
})

test('duration not wrong for cross-timezone short-haul (STN→BCN)', () => {
  // STN departure 10:15 UTC+1, BCN arrival 13:30 UTC+2.
  // UTC departure = 09:15, UTC arrival = 11:30 → diff = 135 minutes.
  const mins = getDuration(
    '2026-06-15T10:15:00+01:00',
    '2026-06-15T13:30:00+02:00',
    undefined,
  )
  assert.ok(mins >= 130 && mins <= 140,
    `Expected ~135 minutes for STN→BCN, got ${mins}`)
})

test('duration is NOT derived from naive-string epoch diff (no tz suffix)', () => {
  // When both strings lack timezone suffixes, the connector has not provided
  // timezone info.  Using epoch diff would interpret them as UTC-midnight-relative
  // and produce a wrong result on a UTC server.  Duration must fall back to 0.
  const mins = getDuration(
    '2026-06-15T09:00:00',
    '2026-06-15T12:00:00',
    undefined,
  )
  // The fix: no timezone info → duration_minutes must be 0 (safe fallback).
  assert.equal(mins, 0,
    'Duration must be 0 when timestamps have no explicit timezone suffix')
})

test('duration uses segment duration_seconds when total_duration_seconds absent', () => {
  // Segment-level duration_seconds is the secondary fallback.
  const raw = {
    id: 'seg-dur',
    price: 100,
    currency: 'EUR',
    airlines: ['Example Air'],
    airline_code: 'EA',
    source: 'test',
    outbound: {
      origin: 'STN',
      destination: 'BCN',
      segments: [
        {
          origin: 'STN',
          destination: 'BCN',
          departure: '2026-06-15T09:00:00Z',
          arrival: '2026-06-15T11:15:00Z',
          flight_no: 'EA1001',
          duration_seconds: 8100, // 135 minutes
        },
      ],
      stopovers: 0,
      // no total_duration_seconds
    },
  }
  const trusted = normalizeTrustedOffer(raw, 0)
  const offer = toPublicOffer(trusted)
  assert.ok((offer.duration_minutes ?? 0) >= 130 && (offer.duration_minutes ?? 0) <= 140,
    `Expected ~135 minutes from segment duration_seconds, got ${offer.duration_minutes}`)
})
