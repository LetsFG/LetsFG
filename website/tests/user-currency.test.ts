import assert from 'node:assert/strict'
import test from 'node:test'

import { DISPLAY_CURRENCIES, resolveSearchCurrency } from '../lib/currency-preference.ts'
import { detectPreferredCurrency, formatCurrencyAmount } from '../lib/user-currency.ts'

test('detectPreferredCurrency prefers geo headers when available', () => {
  const headers = new Headers({
    'cf-ipcountry': 'GB',
    'accept-language': 'en-US,en;q=0.9',
  })

  assert.equal(detectPreferredCurrency(headers), 'GBP')
})

test('detectPreferredCurrency falls back to accept-language regions', () => {
  const headers = new Headers({
    'accept-language': 'en-GB,en;q=0.9',
  })

  assert.equal(detectPreferredCurrency(headers), 'GBP')
})

test('detectPreferredCurrency uses locale fallback when only a language header remains', () => {
  const headers = new Headers({
    'x-next-intl-locale': 'pl',
  })

  assert.equal(detectPreferredCurrency(headers), 'PLN')
})

test('formatCurrencyAmount renders currency symbols for visible prices', () => {
  assert.equal(formatCurrencyAmount(123, 'GBP', 'en-GB'), '£123')
  assert.equal(formatCurrencyAmount(123.4, 'EUR', 'de-DE'), '123,40\u00a0€')
})

test('resolveSearchCurrency prefers explicit query param over cookie and fallback', () => {
  assert.equal(resolveSearchCurrency({
    queryParam: 'usd',
    cookieValue: 'GBP',
    fallback: 'PLN',
  }), 'USD')
})

test('resolveSearchCurrency falls back to cookie when query is missing', () => {
  assert.equal(resolveSearchCurrency({
    cookieValue: 'CHF',
    fallback: 'GBP',
  }), 'CHF')
})

test('resolveSearchCurrency preserves detected local fallback when supported', () => {
  assert.equal(resolveSearchCurrency({ fallback: 'AUD' }), 'AUD')
})

test('resolveSearchCurrency falls back to EUR for invalid values', () => {
  assert.equal(resolveSearchCurrency({
    queryParam: 'not-a-currency',
    cookieValue: '%E0',
    fallback: '???',
  }), 'EUR')
})

test('DISPLAY_CURRENCIES exposes an expanded deduplicated currency picker', () => {
  const codes = DISPLAY_CURRENCIES.map((row) => row.code)

  assert.ok(codes.length >= 20)
  assert.ok(codes.includes('AUD'))
  assert.ok(codes.includes('JPY'))
  assert.ok(codes.includes('SEK'))
  assert.equal(new Set(codes).size, codes.length)
})