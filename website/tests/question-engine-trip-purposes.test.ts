import assert from 'node:assert/strict'
import test from 'node:test'

import { generateFollowUpQuestions } from '../app/lib/questionEngine.ts'

test('question engine treats multi-purpose intent as already known and still asks business arrival timing', () => {
  const questions = generateFollowUpQuestions({
    origin: 'LON',
    destination: 'BCN',
    date: '2026-06-15',
    trip_purpose: 'city_break',
    trip_purposes: ['city_break', 'business'],
  })

  assert.equal(questions.some((question) => question.id === 'purpose'), false)
  assert.equal(questions.some((question) => question.id === 'arrival_time'), true)
})