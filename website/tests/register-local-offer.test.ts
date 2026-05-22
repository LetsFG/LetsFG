import assert from 'node:assert/strict'
import test from 'node:test'

import { validateLocalOfferBookingUrl } from '../app/api/offer/register-local/validate.ts'

test('validateLocalOfferBookingUrl accepts HTTPS airline URLs', () => {
  assert.equal(validateLocalOfferBookingUrl('https://www.ryanair.com/book?tok=abc'), true)
  assert.equal(validateLocalOfferBookingUrl('https://www.wizzair.com/en-gb/booking/select'), true)
  assert.equal(validateLocalOfferBookingUrl('https://www.skyscanner.com/flights/KRK/BCN'), true)
  assert.equal(validateLocalOfferBookingUrl('https://kiwi.com/booking/123'), true)
})

test('validateLocalOfferBookingUrl rejects http:// URLs', () => {
  assert.equal(validateLocalOfferBookingUrl('http://www.ryanair.com/book'), false)
  assert.equal(validateLocalOfferBookingUrl('http://example.com'), false)
})

test('validateLocalOfferBookingUrl rejects localhost and loopback', () => {
  assert.equal(validateLocalOfferBookingUrl('https://localhost/book'), false)
  assert.equal(validateLocalOfferBookingUrl('https://127.0.0.1/book'), false)
  assert.equal(validateLocalOfferBookingUrl('https://[::1]/book'), false)
  assert.equal(validateLocalOfferBookingUrl('https://0.0.0.0/book'), false)
})

test('validateLocalOfferBookingUrl rejects internal hostnames without TLD', () => {
  assert.equal(validateLocalOfferBookingUrl('https://internalhost/book'), false)
  assert.equal(validateLocalOfferBookingUrl('https://myservice/path'), false)
})

test('validateLocalOfferBookingUrl rejects private RFC-1918 IP addresses', () => {
  assert.equal(validateLocalOfferBookingUrl('https://192.168.1.1/book'), false)
  assert.equal(validateLocalOfferBookingUrl('https://10.0.0.1/book'), false)
  assert.equal(validateLocalOfferBookingUrl('https://172.16.0.1/book'), false)
})

test('validateLocalOfferBookingUrl rejects empty / non-string inputs', () => {
  assert.equal(validateLocalOfferBookingUrl(''), false)
  assert.equal(validateLocalOfferBookingUrl(null as any), false)
  assert.equal(validateLocalOfferBookingUrl(undefined as any), false)
  assert.equal(validateLocalOfferBookingUrl(42 as any), false)
})

test('validateLocalOfferBookingUrl rejects letsfg.co to prevent circular booking', () => {
  assert.equal(validateLocalOfferBookingUrl('https://letsfg.co/book/123'), false)
  assert.equal(validateLocalOfferBookingUrl('https://www.letsfg.co/api/offer'), false)
})
