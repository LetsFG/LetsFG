import assert from 'node:assert/strict'
import test from 'node:test'

import { buildRationalePrompt, parseRationaleResponse } from '../../../lib/pfp/ingest/llm-rationale.ts'
import type { RouteDistributionData } from '../../../lib/pfp/types/route-distribution.types.ts'

// ─── Minimal RouteDistributionData fixture ───────────────────────────────────

function makeDistribution(overrides: Partial<RouteDistributionData> = {}): RouteDistributionData {
  return {
    origin_iata: 'GDN',
    dest_iata: 'BCN',
    origin_city: 'Gdansk',
    dest_city: 'Barcelona',
    snapshot_computed_at: '2026-06-15T10:00:00Z',
    staleness: 'fresh',
    data_confidence: 'high',
    total_offers_analyzed: 120,
    session_count: 1,
    price_distribution: {
      p10: 49, p25: 69, p50: 89, p75: 130, p90: 180, p95: 220,
      min: 39, max: 350,
      histogram: [],
      currency: 'EUR',
      is_bimodal: false,
    },
    fee_analysis: {
      avg_hidden_fees_amount: 15,
      avg_hidden_fees_pct: 0.17,
      fee_variance: 'medium',
      fee_breakdown_available: true,
      breakdown: [{ carrier: 'FR', avg_fee: 12, avg_fee_pct: 0.13 }],
    },
    carrier_summary: [
      { carrier: 'FR', offer_count: 80, price_p50: 69, hidden_fees_avg: 12, hidden_fees_pct: 0.17 },
      { carrier: 'W6', offer_count: 40, price_p50: 99, hidden_fees_avg: 18, hidden_fees_pct: 0.18 },
    ],
    connector_comparison: [],
    tldr: {
      summary: 'GDN → BCN: from EUR 39, median EUR 89, 120 offers analyzed',
      key_facts: ['Cheapest on 2026-06-15: EUR 39', 'Median EUR 89 on 2026-06-15', '120 offers from 3 connectors'],
    },
    page_status: 'published',
    is_preview: true,
    ...overrides,
  }
}

// ─── buildRationalePrompt ─────────────────────────────────────────────────────

test('buildRationalePrompt: includes route identifiers', () => {
  const dist = makeDistribution()
  const prompt = buildRationalePrompt(dist)
  assert.ok(prompt.includes('GDN'))
  assert.ok(prompt.includes('BCN'))
  assert.ok(prompt.includes('Gdansk'))
  assert.ok(prompt.includes('Barcelona'))
})

test('buildRationalePrompt: includes price data', () => {
  const dist = makeDistribution()
  const prompt = buildRationalePrompt(dist)
  assert.ok(prompt.includes('39') || prompt.includes('89'))
  assert.ok(prompt.includes('EUR'))
})

test('buildRationalePrompt: includes carrier count', () => {
  const dist = makeDistribution()
  const prompt = buildRationalePrompt(dist)
  assert.ok(prompt.includes('2') || prompt.includes('carrier'))
})

test('buildRationalePrompt: mentions bimodal when present', () => {
  const dist = makeDistribution({
    price_distribution: {
      p10: 49, p25: 69, p50: 89, p75: 180, p90: 250, p95: 300,
      min: 39, max: 400,
      histogram: [],
      currency: 'EUR',
      is_bimodal: true,
      bimodal_insight: 'Two fare clusters: budget €49–€90, premium €150–€250',
    },
  })
  const prompt = buildRationalePrompt(dist)
  assert.ok(prompt.includes('bimodal') || prompt.includes('cluster') || prompt.includes('Two fare'))
})

test('buildRationalePrompt: does not mention individual user/searcher', () => {
  const dist = makeDistribution()
  const prompt = buildRationalePrompt(dist)
  assert.ok(!prompt.toLowerCase().includes('your search'))
  assert.ok(!prompt.toLowerCase().includes('you searched'))
})

test('buildRationalePrompt: asks for JSON output', () => {
  const dist = makeDistribution()
  const prompt = buildRationalePrompt(dist)
  assert.ok(prompt.toLowerCase().includes('json'))
})

// ─── parseRationaleResponse ───────────────────────────────────────────────────

test('parseRationaleResponse: parses valid JSON response', () => {
  const raw = JSON.stringify({
    value_proposition: 'Good value short-haul route.',
    best_for: ['Budget travelers', 'Weekend trips'],
    booking_tips: 'Book 3 weeks in advance for best prices.',
    price_context: 'Prices are 20% below European average.',
  })
  const result = parseRationaleResponse(raw, 'claude-haiku-4-5')
  assert.ok(result)
  assert.equal(result!.value_proposition, 'Good value short-haul route.')
  assert.deepEqual(result!.best_for, ['Budget travelers', 'Weekend trips'])
  assert.equal(result!.model, 'claude-haiku-4-5')
  assert.ok(result!.generated_at)
})

test('parseRationaleResponse: extracts JSON from markdown code block', () => {
  const raw = '```json\n{"value_proposition":"VP","best_for":["A"],"booking_tips":"BT","price_context":"PC"}\n```'
  const result = parseRationaleResponse(raw, 'claude-haiku-4-5')
  assert.ok(result)
  assert.equal(result!.value_proposition, 'VP')
})

test('parseRationaleResponse: returns null for invalid JSON', () => {
  const result = parseRationaleResponse('not json at all', 'claude-haiku-4-5')
  assert.equal(result, null)
})

test('parseRationaleResponse: returns null when required fields missing', () => {
  const raw = JSON.stringify({ value_proposition: 'VP' }) // missing best_for etc.
  const result = parseRationaleResponse(raw, 'claude-haiku-4-5')
  assert.equal(result, null)
})

test('parseRationaleResponse: best_for coerced to array when string', () => {
  const raw = JSON.stringify({
    value_proposition: 'VP',
    best_for: 'Single string value',
    booking_tips: 'BT',
    price_context: 'PC',
  })
  const result = parseRationaleResponse(raw, 'claude-haiku-4-5')
  assert.ok(result)
  assert.ok(Array.isArray(result!.best_for))
})

test('parseRationaleResponse: truncates value_proposition to 400 chars', () => {
  const longText = 'A'.repeat(500)
  const raw = JSON.stringify({
    value_proposition: longText,
    best_for: ['A'],
    booking_tips: 'BT',
    price_context: 'PC',
  })
  const result = parseRationaleResponse(raw, 'claude-haiku-4-5')
  assert.ok(result)
  assert.ok(result!.value_proposition.length <= 400)
})
