import assert from 'node:assert/strict'
import test from 'node:test'

import { extractFswSession } from '../lib/fsw-search'

test('extractFswSession reads __session from getSetCookie when available', () => {
  const headers = new Headers()
  Object.assign(headers, {
    getSetCookie: () => [
      'lfg_uid=anon123; Path=/; HttpOnly',
      '__session=session456; Path=/; HttpOnly; Secure',
    ],
  })

  assert.equal(extractFswSession(headers), 'session456')
})

test('extractFswSession falls back to merged set-cookie header strings', () => {
  const headers = new Headers({
    'set-cookie': 'lfg_uid=anon123; Path=/; HttpOnly, __session=session456; Path=/; HttpOnly; Secure',
  })

  assert.equal(extractFswSession(headers), 'session456')
})

test('extractFswSession returns undefined when __session is absent', () => {
  const headers = new Headers({
    'set-cookie': 'lfg_uid=anon123; Path=/; HttpOnly',
  })

  assert.equal(extractFswSession(headers), undefined)
})