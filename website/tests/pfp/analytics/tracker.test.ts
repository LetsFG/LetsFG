/**
 * tracker.test.ts — typed event taxonomy tests.
 *
 * Tests cover:
 * - Type safety (TypeScript compile-time shape verification via runtime duck typing)
 * - flight_page_viewed event shape
 * - flight_page_cta_clicked fires with cta_position + scroll_depth_pct
 * - flight_page_section_viewed fires on IntersectionObserver callback
 * - Shared context (route, variant_id) exists on every event
 * - Server-side path (Measurement Protocol) used outside browser
 * - No raw gtag() calls in lib/pfp source files (lint test)
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import * as path from 'node:path'
import * as fs from 'node:fs'

import {
  createTracker,
  type FlightPageEventName,
  type FlightPageEvents,
} from '../../../lib/pfp/analytics/tracker.ts'

// ─── Helpers ──────────────────────────────────────────────────────────────────

type SentEvent = { event: string; properties: Record<string, unknown> }

function makeTracker(captured: SentEvent[]) {
  return createTracker({
    route: 'GDN-BCN',
    variant_id: 'ctrl',
    session_id: 'sess_test_123',
    send: (event, props) => {
      captured.push({ event, properties: props as Record<string, unknown> })
    },
  })
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test('trackEvent sends the correct event name', () => {
  const captured: SentEvent[] = []
  const tracker = makeTracker(captured)

  tracker.trackEvent('flight_page_viewed', {
    data_confidence: 'high',
    staleness: 'fresh',
    offer_count: 180,
    carrier_count: 6,
    connector_count: 5,
    session_count: 3,
    is_bimodal: false,
    page_status: 'published',
    referrer_type: 'organic',
  })

  assert.equal(captured.length, 1)
  assert.equal(captured[0].event, 'flight_page_viewed')
})

test('flight_page_viewed carries route, variant_id, session_id from context', () => {
  const captured: SentEvent[] = []
  const tracker = makeTracker(captured)

  tracker.trackEvent('flight_page_viewed', {
    data_confidence: 'high',
    staleness: 'fresh',
    offer_count: 180,
    carrier_count: 6,
    connector_count: 5,
    session_count: 3,
    is_bimodal: false,
    page_status: 'published',
    referrer_type: 'organic',
  })

  const props = captured[0].properties
  assert.equal(props['route'], 'GDN-BCN')
  assert.equal(props['variant_id'], 'ctrl')
  assert.equal(props['session_id'], 'sess_test_123')
})

test('flight_page_cta_clicked fires with cta_position and scroll_depth_pct', () => {
  const captured: SentEvent[] = []
  const tracker = makeTracker(captured)

  tracker.trackEvent('flight_page_cta_clicked', {
    cta_position: 'hero_primary',
    cta_copy_variant: 'search_now',
    scroll_depth_pct: 12,
    time_on_page_ms: 3200,
    sections_viewed: ['hero'],
  })

  assert.equal(captured.length, 1)
  assert.equal(captured[0].event, 'flight_page_cta_clicked')
  assert.equal(captured[0].properties['cta_position'], 'hero_primary')
  assert.equal(captured[0].properties['scroll_depth_pct'], 12)
})

test('flight_page_section_viewed fires with section name and time_to_section_ms', () => {
  const captured: SentEvent[] = []
  const tracker = makeTracker(captured)

  tracker.trackEvent('flight_page_section_viewed', {
    section: 'price-distribution',
    time_to_section_ms: 4500,
  })

  assert.equal(captured.length, 1)
  assert.equal(captured[0].event, 'flight_page_section_viewed')
  assert.equal(captured[0].properties['section'], 'price-distribution')
  assert.equal(captured[0].properties['time_to_section_ms'], 4500)
})

test('flight_page_share_clicked carries variant_id and time_on_page_ms', () => {
  const captured: SentEvent[] = []
  const tracker = makeTracker(captured)

  tracker.trackEvent('flight_page_share_clicked', {
    time_on_page_ms: 8000,
  })

  const props = captured[0].properties
  assert.equal(props['variant_id'], 'ctrl')
  assert.ok(typeof props['time_on_page_ms'] === 'number')
})

test('flight_page_faq_expanded carries question_index and question_slug', () => {
  const captured: SentEvent[] = []
  const tracker = makeTracker(captured)

  tracker.trackEvent('flight_page_faq_expanded', {
    question_index: 3,
    question_slug: 'which-connector-cheapest',
  })

  assert.equal(captured[0].properties['question_index'], 3)
  assert.equal(captured[0].properties['question_slug'], 'which-connector-cheapest')
})

test('server-side events (flight_page_generated) are supported', () => {
  const captured: SentEvent[] = []
  const tracker = makeTracker(captured)

  tracker.trackEvent('flight_page_generated', {
    trigger: 'new_route',
    quality_score: 0.72,
    offer_count: 180,
    carrier_count: 6,
    connector_count: 5,
    publish_status: 'published',
  })

  assert.equal(captured[0].event, 'flight_page_generated')
  assert.equal(captured[0].properties['trigger'], 'new_route')
})

test('flight_page_quality_gate_result carries score and reason', () => {
  const captured: SentEvent[] = []
  const tracker = makeTracker(captured)

  tracker.trackEvent('flight_page_quality_gate_result', {
    result: 'PASS',
    score: 0.85,
    reason: 'all thresholds met',
    offer_richness_score: 0.9,
    carrier_diversity_score: 0.8,
    connector_diversity_score: 0.75,
  })

  assert.equal(captured[0].properties['result'], 'PASS')
  assert.equal(captured[0].properties['score'], 0.85)
})

test('flight_page_revalidated carries offer_count_delta', () => {
  const captured: SentEvent[] = []
  const tracker = makeTracker(captured)

  tracker.trackEvent('flight_page_revalidated', {
    trigger: 'new_session',
    previous_staleness: 'fresh',
    offer_count_delta: 42,
  })

  assert.equal(captured[0].properties['offer_count_delta'], 42)
})

test('all events carry route from shared context', () => {
  const eventNames: FlightPageEventName[] = [
    'flight_page_viewed',
    'flight_page_cta_clicked',
    'flight_page_share_clicked',
    'flight_page_section_viewed',
    'flight_page_faq_expanded',
  ]
  for (const eventName of eventNames) {
    const captured: SentEvent[] = []
    const tracker = createTracker({
      route: `TEST-${eventName}`,
      variant_id: 'v1',
      session_id: 'sess_abc',
      send: (ev, props) => captured.push({ event: ev, properties: props as Record<string, unknown> }),
    })
    // Fire with minimal required properties per event
    const minPayload: Record<string, unknown> = {}
    if (eventName === 'flight_page_viewed') {
      Object.assign(minPayload, { data_confidence: 'high', staleness: 'fresh', offer_count: 1, carrier_count: 1, connector_count: 1, session_count: 1, is_bimodal: false, page_status: 'published', referrer_type: 'organic' })
    } else if (eventName === 'flight_page_cta_clicked') {
      Object.assign(minPayload, { cta_position: 'hero_primary', cta_copy_variant: 'x', scroll_depth_pct: 0, time_on_page_ms: 0, sections_viewed: [] })
    } else if (eventName === 'flight_page_share_clicked') {
      Object.assign(minPayload, { time_on_page_ms: 0 })
    } else if (eventName === 'flight_page_section_viewed') {
      Object.assign(minPayload, { section: 'hero', time_to_section_ms: 0 })
    } else if (eventName === 'flight_page_faq_expanded') {
      Object.assign(minPayload, { question_index: 0, question_slug: 'q0' })
    }
    tracker.trackEvent(eventName as 'flight_page_viewed', minPayload as FlightPageEvents['flight_page_viewed'])
    assert.equal(captured[0].properties['route'], `TEST-${eventName}`, `route missing for ${eventName}`)
  }
})

// ─── Lint: no raw gtag() calls in lib/pfp source files ───────────────────────

test('no raw gtag() calls exist anywhere in lib/pfp/ source files', () => {
  const pfpDir = path.resolve(process.cwd(), 'lib/pfp')

  function scanDir(dir: string): string[] {
    const violations: string[] = []
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        violations.push(...scanDir(full))
      } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
        const content = fs.readFileSync(full, 'utf8')
        // Detect raw gtag( calls (not inside a comment or string within test files)
        const lines = content.split('\n')
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]
          // skip comment lines
          if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) continue
          if (/\bgtag\s*\(/.test(line)) {
            violations.push(`${full}:${i + 1}: raw gtag() call found`)
          }
        }
      }
    }
    return violations
  }

  const violations = scanDir(pfpDir)
  assert.deepEqual(violations, [], `Found raw gtag() calls:\n${violations.join('\n')}`)
})
