import assert from 'node:assert/strict'
import test from 'node:test'

import { buildPartySizeQuestionSpec, buildPriorityQuestionSpec } from '../app/lib/home-convo-personalization.ts'

test('mixed business and city intents use blended party-size chips instead of a single-purpose prompt', () => {
  const spec = buildPartySizeQuestionSpec({
    trip_purpose: 'city_break',
    trip_purposes: ['city_break', 'business'],
  })

  assert.equal(spec.questionKey, 'pax_q')
  assert.deepEqual(
    spec.chips.map((chip) => chip.englishKey),
    ['Solo', 'With a colleague', 'Two of us', 'Small team'],
  )
})

test('mixed business and city intents use blended priority chips instead of only the city-break set', () => {
  const spec = buildPriorityQuestionSpec({
    trip_purpose: 'city_break',
    trip_purposes: ['city_break', 'business'],
  })

  assert.equal(spec.questionKey, 'priority_q')
  assert.deepEqual(
    spec.chips.map((chip) => chip.englishKey),
    ['Direct flights only', 'Good times', 'Latest return', 'Early departure'],
  )
})