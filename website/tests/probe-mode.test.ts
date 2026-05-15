import assert from 'node:assert/strict'
import test from 'node:test'

import { firstQueryValue, isProbeModeValue } from '../lib/probe-mode.ts'

test('firstQueryValue normalizes probe values from non-string callers', () => {
  assert.equal(firstQueryValue('1'), '1')
  assert.equal(firstQueryValue(1), '1')
  assert.equal(firstQueryValue(true), 'true')
  assert.equal(firstQueryValue([1, '0']), '1')
  assert.equal(firstQueryValue(null), undefined)
})

test('isProbeModeValue accepts normalized truthy probe inputs', () => {
  assert.equal(isProbeModeValue('1'), true)
  assert.equal(isProbeModeValue(' yes '), true)
  assert.equal(isProbeModeValue(1), true)
  assert.equal(isProbeModeValue(true), true)
  assert.equal(isProbeModeValue([1]), true)

  assert.equal(isProbeModeValue(false), false)
  assert.equal(isProbeModeValue(0), false)
  assert.equal(isProbeModeValue('0'), false)
  assert.equal(isProbeModeValue(undefined), false)
})