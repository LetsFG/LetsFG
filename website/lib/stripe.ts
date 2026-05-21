/**
 * Stripe client singleton.
 *
 * Set STRIPE_SECRET_KEY in your environment (use sk_test_... for dev,
 * sk_live_... for production).
 */

import Stripe from 'stripe'

let _stripe: Stripe | null = null
let _testStripe: Stripe | null = null
let _monitorStripe: Stripe | null = null

export function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY
    if (!key) throw new Error('STRIPE_SECRET_KEY environment variable is not set')
    _stripe = new Stripe(key)
  }
  return _stripe
}

export function getTestStripe(): Stripe {
  if (!_testStripe) {
    const key = process.env.STRIPE_TEST_SECRET_KEY
    if (!key) throw new Error('STRIPE_TEST_SECRET_KEY environment variable is not set')
    _testStripe = new Stripe(key)
  }
  return _testStripe
}

/** Returns test Stripe client for test offers (offerId starts with 'test_'), live otherwise. */
export function getStripeForOffer(offerId: string): Stripe {
  return offerId.startsWith('test_') ? getTestStripe() : getStripe()
}

/** Returns test Stripe client for test sessions (cs_test_...), live otherwise. */
export function getStripeForSession(sessionId: string): Stripe {
  return sessionId.startsWith('cs_test_') ? getTestStripe() : getStripe()
}

/**
 * Stripe client for monitor payments.
 * Uses STRIPE_MONITOR_SECRET_KEY if set, otherwise falls back to STRIPE_SECRET_KEY.
 * This allows monitor to run on test Stripe while unlock/book stays on live Stripe.
 */
export function getMonitorStripe(): Stripe {
  if (!_monitorStripe) {
    const key = process.env.STRIPE_MONITOR_SECRET_KEY || process.env.STRIPE_SECRET_KEY
    if (!key) throw new Error('STRIPE_SECRET_KEY environment variable is not set')
    _monitorStripe = new Stripe(key)
  }
  return _monitorStripe
}

/**
 * Currencies where Stripe expects the amount in the base unit (no cents).
 * All others are multiplied by 100.
 */
const ZERO_DECIMAL_CURRENCIES = new Set([
  'bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga',
  'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf',
])

/**
 * Convert a float amount to Stripe's expected integer (smallest currency unit).
 * e.g. EUR 1.50 → 150,  JPY 150 → 150
 */
export function toStripeAmount(amount: number, currency: string): number {
  if (ZERO_DECIMAL_CURRENCIES.has(currency.toLowerCase())) {
    return Math.round(amount)
  }
  return Math.round(amount * 100)
}
