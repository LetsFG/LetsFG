import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_FX_VS_EUR } from '../lib/display-price'
import { fetchLiveFxRates, parseFrankfurterRatesPayload } from '../lib/live-fx'

test('parseFrankfurterRatesPayload merges Frankfurter rows onto the fallback table', () => {
  const rates = parseFrankfurterRatesPayload([
    { date: '2026-05-17', base: 'EUR', quote: 'USD', rate: 1.1649 },
    { date: '2026-05-17', base: 'EUR', quote: 'INR', rate: 95.32 },
    { date: '2026-05-17', base: 'USD', quote: 'AED', rate: 3.67 },
    { date: '2026-05-17', base: 'EUR', quote: 'BAD', rate: 'nope' },
  ])

  assert.equal(rates.EUR, 1)
  assert.equal(rates.USD, 1.1649)
  assert.equal(rates.INR, 95.32)
  assert.equal(rates.AED, DEFAULT_FX_VS_EUR.AED)
})

test('fetchLiveFxRates requests EUR-based Frankfurter quotes and returns a rate table', async () => {
  let requestedUrl = ''

  const rates = await fetchLiveFxRates((input) => {
    requestedUrl = String(input)
    return Promise.resolve(new Response(JSON.stringify([
      { date: '2026-05-17', base: 'EUR', quote: 'USD', rate: 1.2 },
      { date: '2026-05-17', base: 'EUR', quote: 'GBP', rate: 0.85 },
    ]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
  })

  assert.match(requestedUrl, /\/rates\?/)
  assert.match(requestedUrl, /base=EUR/)
  assert.match(requestedUrl, /quotes=/)
  assert.equal(rates.USD, 1.2)
  assert.equal(rates.GBP, 0.85)
})