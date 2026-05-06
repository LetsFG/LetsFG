/**
 * experiment-context.test.ts — tests for resolveExperimentContext()
 * and variant assignment consistency.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  resolveExperimentContext,
  hashToBucket,
  selectVariant,
  type ExperimentDefinition,
  type VariantDefinition,
  EXPERIMENT_HERO_CTA,
  EXPERIMENT_HERO_STAT,
} from '../../../lib/pfp/experiments/experiment-context.ts'
import { DEFAULT_FLAGS } from '../../../lib/pfp/experiments/flags.types.ts'

// ─── hashToBucket ──────────────────────────────────────────────────────────────

test('hashToBucket returns a number 0–99 inclusive', () => {
  const samples = ['sess_abc', 'sess_xyz', 'sess_000', 'sess_aaa', 'sess_999']
  for (const sessionId of samples) {
    const bucket = hashToBucket(sessionId, 'flight_pages.hero_cta_copy')
    assert.ok(bucket >= 0 && bucket <= 99, `bucket ${bucket} out of range for ${sessionId}`)
  }
})

test('same session_id always resolves to same bucket (determinism)', () => {
  const sessionId = 'sess_determinism_test'
  const key = 'flight_pages.hero_cta_copy'
  const first = hashToBucket(sessionId, key)
  for (let i = 0; i < 100; i++) {
    const result = hashToBucket(sessionId, key)
    assert.equal(result, first, `Non-deterministic: got ${result} !== ${first} on iteration ${i}`)
  }
})

test('same session_id always resolves to same variant across 1000 calls', () => {
  const sessionId = 'sess_stable_variant'
  const experiment = EXPERIMENT_HERO_CTA
  const first = selectVariant(sessionId, experiment)
  for (let i = 0; i < 1000; i++) {
    const result = selectVariant(sessionId, experiment)
    assert.equal(result.key, first.key, `Variant changed on iteration ${i}`)
  }
})

// ─── selectVariant — distribution ─────────────────────────────────────────────

test('10,000 sessions distribute within ±5% of target traffic allocation for EXPERIMENT_HERO_CTA', () => {
  const experiment = EXPERIMENT_HERO_CTA
  const counts: Record<string, number> = {}
  for (const v of experiment.variants) counts[v.key] = 0

  const n = 10_000
  for (let i = 0; i < n; i++) {
    const variant = selectVariant(`sess_${i}`, experiment)
    counts[variant.key] = (counts[variant.key] ?? 0) + 1
  }

  for (const variant of experiment.variants) {
    const actual = (counts[variant.key]! / n) * 100
    const expected = variant.traffic_pct
    const diff = Math.abs(actual - expected)
    assert.ok(
      diff <= 5,
      `Variant "${variant.key}" got ${actual.toFixed(1)}% vs expected ${expected}% (diff ${diff.toFixed(1)}% > 5%)`,
    )
  }
})

test('10,000 sessions distribute within ±5% of target for EXPERIMENT_HERO_STAT', () => {
  const experiment = EXPERIMENT_HERO_STAT
  const counts: Record<string, number> = {}
  for (const v of experiment.variants) counts[v.key] = 0

  const n = 10_000
  for (let i = 0; i < n; i++) {
    const variant = selectVariant(`sess_stat_${i}`, experiment)
    counts[variant.key] = (counts[variant.key] ?? 0) + 1
  }

  for (const variant of experiment.variants) {
    const actual = (counts[variant.key]! / n) * 100
    const expected = variant.traffic_pct
    const diff = Math.abs(actual - expected)
    assert.ok(
      diff <= 5,
      `Variant "${variant.key}" got ${actual.toFixed(1)}% vs expected ${expected}% (diff ${diff.toFixed(1)}% > 5%)`,
    )
  }
})

// ─── resolveExperimentContext ──────────────────────────────────────────────────

test('resolveExperimentContext returns flags and variantIds', async () => {
  const ctx = await resolveExperimentContext('sess_basic_test', 'GDN-BCN')
  assert.ok('flags' in ctx, 'flags missing from context')
  assert.ok('variantIds' in ctx, 'variantIds missing from context')
})

test('resolveExperimentContext flags contain all required keys', async () => {
  const ctx = await resolveExperimentContext('sess_flags_test', 'GDN-BCN')
  const required = Object.keys(DEFAULT_FLAGS) as Array<keyof typeof DEFAULT_FLAGS>
  for (const key of required) {
    assert.ok(key in ctx.flags, `flags missing key: "${key}"`)
  }
})

test('resolveExperimentContext variantIds include hero_cta and hero_stat experiments', async () => {
  const ctx = await resolveExperimentContext('sess_variant_test', 'GDN-BCN')
  assert.ok(
    EXPERIMENT_HERO_CTA.key in ctx.variantIds,
    `variantIds missing key: "${EXPERIMENT_HERO_CTA.key}"`,
  )
  assert.ok(
    EXPERIMENT_HERO_STAT.key in ctx.variantIds,
    `variantIds missing key: "${EXPERIMENT_HERO_STAT.key}"`,
  )
})

test('returns default flags on error — never throws', async () => {
  // Pass a null session_id to force an unusual code path; should still return defaults
  // without throwing
  let result: Awaited<ReturnType<typeof resolveExperimentContext>> | null = null
  let threw = false
  try {
    result = await resolveExperimentContext('', 'GDN-BCN')
  } catch {
    threw = true
  }
  assert.equal(threw, false, 'resolveExperimentContext threw instead of returning defaults')
  assert.ok(result !== null)
  // On empty session_id, should still return all default flag keys
  for (const key of Object.keys(DEFAULT_FLAGS)) {
    assert.ok(key in result!.flags, `flag key "${key}" missing from fallback result`)
  }
})

test('DEFAULT_FLAGS has correct types for each flag', () => {
  assert.equal(typeof DEFAULT_FLAGS['flight_pages.enabled'], 'boolean')
  assert.equal(typeof DEFAULT_FLAGS['flight_pages.ingest_enabled'], 'boolean')
  assert.equal(typeof DEFAULT_FLAGS['flight_pages.min_offers_threshold'], 'number')
  assert.equal(typeof DEFAULT_FLAGS['flight_pages.fast_track_offer_count'], 'number')
  assert.equal(typeof DEFAULT_FLAGS['flight_pages.hero_cta_copy'], 'string')
  assert.equal(typeof DEFAULT_FLAGS['flight_pages.hero_primary_stat'], 'string')
  assert.equal(typeof DEFAULT_FLAGS['flight_pages.show_histogram'], 'boolean')
  assert.equal(typeof DEFAULT_FLAGS['flight_pages.show_connector_comparison'], 'boolean')
  assert.equal(typeof DEFAULT_FLAGS['flight_pages.social_proof_counter'], 'boolean')
  assert.equal(typeof DEFAULT_FLAGS['flight_pages.faq_count'], 'number')
  assert.equal(typeof DEFAULT_FLAGS['flight_pages.history_default_open'], 'boolean')
})

test('EXPERIMENT_HERO_CTA has three variants summing to 100%', () => {
  const total = EXPERIMENT_HERO_CTA.variants.reduce((s, v) => s + v.traffic_pct, 0)
  assert.equal(total, 100)
  assert.equal(EXPERIMENT_HERO_CTA.variants.length, 3)
})

test('EXPERIMENT_HERO_STAT has three variants summing to 100%', () => {
  const total = EXPERIMENT_HERO_STAT.variants.reduce((s, v) => s + v.traffic_pct, 0)
  assert.equal(total, 100)
  assert.equal(EXPERIMENT_HERO_STAT.variants.length, 3)
})

test('EXPERIMENT_HERO_CTA has correct hypothesis metadata', () => {
  assert.ok(EXPERIMENT_HERO_CTA.hypothesis.length > 10, 'hypothesis too short')
  assert.ok(EXPERIMENT_HERO_CTA.min_sample_per_variant >= 1000)
  assert.ok(EXPERIMENT_HERO_CTA.duration_days >= 14)
  assert.ok(EXPERIMENT_HERO_CTA.guardrail_metrics.length >= 2)
})

test('EXPERIMENT_HERO_STAT has correct hypothesis metadata', () => {
  assert.ok(EXPERIMENT_HERO_STAT.hypothesis.length > 10, 'hypothesis too short')
  assert.ok(EXPERIMENT_HERO_STAT.min_sample_per_variant >= 1500)
  assert.ok(EXPERIMENT_HERO_STAT.duration_days >= 14)
  assert.ok(EXPERIMENT_HERO_STAT.guardrail_metrics.length >= 1)
})
