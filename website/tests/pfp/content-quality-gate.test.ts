import assert from 'node:assert/strict'
import test from 'node:test'

import { ContentQualityGate } from '../../lib/pfp/quality/content-quality-gate.ts'
import type { QualityInput } from '../../lib/pfp/quality/content-quality-gate.ts'

// ─── HARD FLOOR FAILURES ──────────────────────────────────────────────────────

test('FAIL when offer_count < 15 (hard floor)', () => {
  const gate = new ContentQualityGate()
  const result = gate.evaluate({
    offerCount: 10,
    carrierCount: 3,
    connectorCount: 3,
    priceCV: 0.3,
  })
  assert.equal(result.decision, 'FAIL')
  assert.equal(result.publishAs, 'draft')
  assert.equal(result.score, 0)
  assert.ok(result.reasons.some(r => r.includes('offer_count')))
})

test('FAIL when carrier_count < 2 (hard floor)', () => {
  const gate = new ContentQualityGate()
  const result = gate.evaluate({
    offerCount: 20,
    carrierCount: 1,
    connectorCount: 3,
    priceCV: 0.3,
  })
  assert.equal(result.decision, 'FAIL')
  assert.equal(result.publishAs, 'draft')
  assert.ok(result.reasons.some(r => r.includes('carrier_count')))
})

test('FAIL when price CV < 0.05 (suspiciously uniform prices)', () => {
  const gate = new ContentQualityGate()
  const result = gate.evaluate({
    offerCount: 20,
    carrierCount: 3,
    connectorCount: 3,
    priceCV: 0.02,
  })
  assert.equal(result.decision, 'FAIL')
  assert.equal(result.publishAs, 'draft')
  assert.ok(result.reasons.some(r => r.includes('price_cv') || r.includes('uniform')))
})

test('FAIL when single connector (no market comparison)', () => {
  const gate = new ContentQualityGate()
  const result = gate.evaluate({
    offerCount: 20,
    carrierCount: 3,
    connectorCount: 1,
    priceCV: 0.3,
  })
  assert.equal(result.decision, 'FAIL')
  assert.equal(result.publishAs, 'draft')
  assert.ok(result.reasons.some(r => r.includes('connector_count')))
})

// ─── SCORE-BASED EVALUATION ───────────────────────────────────────────────────

test('CONDITIONAL_PASS (noindex) when score is in range 0.45–0.64', () => {
  // offerCount=20, carrierCount=3, connectorCount=2, priceCV=0.25
  // offerRichness = log2(20)/log2(400) ≈ 0.5
  // carrierDiversity = 3/6 = 0.5
  // priceDistValue = 0.25/0.5 = 0.5
  // connectorDiversity = 2/5 = 0.4
  // score = 0.3*0.5 + 0.25*0.5 + 0.25*0.5 + 0.2*0.4 = 0.48
  const gate = new ContentQualityGate()
  const result = gate.evaluate({
    offerCount: 20,
    carrierCount: 3,
    connectorCount: 2,
    priceCV: 0.25,
  })
  assert.equal(result.decision, 'CONDITIONAL_PASS')
  assert.equal(result.publishAs, 'noindex')
  assert.ok(result.score >= 0.45 && result.score < 0.65)
})

test('PASS (published) when session meets quality threshold (score >= 0.65)', () => {
  // offerCount=40, carrierCount=3, connectorCount=3, priceCV=0.8
  // priceDistValue = min(0.8/0.5, 1) = 1.0
  // score ≈ 0.68
  const gate = new ContentQualityGate()
  const result = gate.evaluate({
    offerCount: 40,
    carrierCount: 3,
    connectorCount: 3,
    priceCV: 0.8,
  })
  assert.equal(result.decision, 'PASS')
  assert.equal(result.publishAs, 'published')
  assert.ok(result.score >= 0.65)
})

test('FAST_TRACK bypasses scoring and goes straight to published', () => {
  // offerCount >= 40 AND carrierCount >= 3 AND connectorCount >= 4
  const gate = new ContentQualityGate()
  const result = gate.evaluate({
    offerCount: 40,
    carrierCount: 3,
    connectorCount: 4,
    priceCV: 0.3,
  })
  assert.equal(result.decision, 'FAST_TRACK')
  assert.equal(result.publishAs, 'published')
})

test('FAST_TRACK does not trigger when connector_count is exactly 3', () => {
  // connectorCount=3 does not meet fast-track threshold of >=4
  const gate = new ContentQualityGate()
  const result = gate.evaluate({
    offerCount: 40,
    carrierCount: 3,
    connectorCount: 3,
    priceCV: 0.8,
  })
  // Should be PASS (score-based), NOT FAST_TRACK
  assert.notEqual(result.decision, 'FAST_TRACK')
})

// ─── COMPONENT SCORES ─────────────────────────────────────────────────────────

test('component scores are computed and returned correctly', () => {
  const gate = new ContentQualityGate()
  const result = gate.evaluate({
    offerCount: 400,
    carrierCount: 6,
    connectorCount: 5,
    priceCV: 0.5,
  })
  // All components should be capped at 1.0
  assert.equal(result.scores.offerRichness, 1.0)
  assert.equal(result.scores.carrierDiversity, 1.0)
  assert.equal(result.scores.priceDistributionValue, 1.0)
  assert.equal(result.scores.connectorDiversity, 1.0)
})

test('offerRichness is capped at 1.0 for very large offer counts', () => {
  const gate = new ContentQualityGate()
  const result = gate.evaluate({
    offerCount: 999,
    carrierCount: 6,
    connectorCount: 5,
    priceCV: 0.5,
  })
  assert.equal(result.scores.offerRichness, 1.0)
})

// ─── ROUTE-LEVEL EVALUATION (multiple sessions) ───────────────────────────────

test('evaluateRoute returns FAIL for empty sessions array', () => {
  const gate = new ContentQualityGate()
  const result = gate.evaluateRoute([])
  assert.equal(result.decision, 'FAIL')
  assert.equal(result.publishAs, 'draft')
})

test('score accumulates correctly: single weak session is CONDITIONAL_PASS', () => {
  // session1 alone: score ≈ 0.505 → CONDITIONAL_PASS
  const gate = new ContentQualityGate()
  const session1: QualityInput = { offerCount: 20, carrierCount: 3, connectorCount: 2, priceCV: 0.3 }
  const result = gate.evaluateRoute([session1])
  assert.equal(result.decision, 'CONDITIONAL_PASS')
  assert.equal(result.publishAs, 'noindex')
})

test('score accumulates correctly: adding strong session upgrades to PASS', () => {
  // session1 alone: CONDITIONAL_PASS
  // route with session1+session2 → PASS (aggregate uses best stats)
  const gate = new ContentQualityGate()
  const session1: QualityInput = { offerCount: 20, carrierCount: 3, connectorCount: 2, priceCV: 0.3 }
  const session2: QualityInput = { offerCount: 50, carrierCount: 5, connectorCount: 3, priceCV: 0.5 }
  const result = gate.evaluateRoute([session1, session2])
  assert.ok(
    result.decision === 'PASS' || result.decision === 'FAST_TRACK',
    `expected PASS or FAST_TRACK, got ${result.decision} (score=${result.score})`
  )
  assert.equal(result.publishAs, 'published')
})

// ─── BOT DETECTION ────────────────────────────────────────────────────────────

test('detects bot data: all prices identical (CV = 0)', () => {
  const gate = new ContentQualityGate()
  const result = gate.evaluate({
    offerCount: 50,
    carrierCount: 3,
    connectorCount: 3,
    priceCV: 0.0,
  })
  assert.equal(result.decision, 'FAIL')
  assert.equal(result.publishAs, 'draft')
  // Should mention CV or uniform prices
  assert.ok(result.reasons.some(r => r.includes('price_cv') || r.includes('uniform')))
})

test('detects bot data: all sessions have identical offer_count (3+ sessions)', () => {
  const gate = new ContentQualityGate()
  const sessions: QualityInput[] = [
    { offerCount: 30, carrierCount: 4, connectorCount: 3, priceCV: 0.4 },
    { offerCount: 30, carrierCount: 3, connectorCount: 2, priceCV: 0.3 },
    { offerCount: 30, carrierCount: 5, connectorCount: 4, priceCV: 0.5 },
  ]
  const result = gate.evaluateRoute(sessions)
  assert.equal(result.decision, 'FAIL')
  assert.equal(result.publishAs, 'draft')
  assert.ok(result.reasons.some(r => r.includes('bot_suspected') || r.includes('identical')))
})

test('does NOT flag bot when 2 sessions have same count (not enough signal)', () => {
  const gate = new ContentQualityGate()
  // 2 sessions with same count — not enough to flag as bot
  const sessions: QualityInput[] = [
    { offerCount: 30, carrierCount: 4, connectorCount: 3, priceCV: 0.4 },
    { offerCount: 30, carrierCount: 3, connectorCount: 2, priceCV: 0.3 },
  ]
  const result = gate.evaluateRoute(sessions)
  // Not flagged as bot — should evaluate normally
  assert.notEqual(result.reasons.some(r => r.includes('bot_suspected')), true)
})
