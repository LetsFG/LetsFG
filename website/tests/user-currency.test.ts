import assert from 'node:assert/strict'
import test from 'node:test'

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