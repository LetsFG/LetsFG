/**
 * LetsFG service fee calculation.
 *
 * Fee = max(1% of ticket price, configured minimum floor by currency).
 * Applied at display time only — raw airline prices are never mutated.
 *
 * Floor rates are rough pegged values; they don't need to be live-rates —
 * the point is just that no ticket under roughly the low-hundreds pays less
 * than the minimum unlock fee.
 */

// Currency-specific minimum unlock fees.
const MIN_FEE_FLOOR: Record<string, number> = {
  EUR: 3,
  USD: 3,
  GBP: 2.55,
  PLN: 12.75,
  CZK: 75,
  HUF: 1200,
  RON: 15,
  SEK: 33,
  NOK: 36,
  DKK: 22.5,
  CHF: 2.85,
  TRY: 108,
  AED: 12,
  SAR: 12.3,
  INR: 276,
  THB: 117,
  MYR: 15,
  SGD: 4.5,
  AUD: 5.1,
  NZD: 5.55,
  CAD: 4.5,
  MXN: 66,
  BRL: 18,
  JPY: 486,
  KRW: 4500,
  HKD: 25.8,
  ZAR: 60,
  EGP: 165,
}

/**
 * Returns the LetsFG service fee for a given ticket price + currency.
 * fee = max(price × 1%, minimum fee floor for the currency)
 */
export function calculateFee(price: number, currency: string): number {
  const floor = MIN_FEE_FLOOR[currency.toUpperCase()] ?? 3
  return Math.max(price * 0.01, floor)
}

/**
 * Returns the customer-facing price (ticket + fee), rounded to 2 dp.
 */
export function withFee(price: number, currency: string): number {
  return Math.round((price + calculateFee(price, currency)) * 100) / 100
}

/**
 * Formats a price for display. Uses integer for values ≥ 10, 2dp below.
 */
export function fmtPrice(amount: number, currency: string): string {
  const rounded = amount >= 10 ? Math.round(amount) : Number(amount.toFixed(2))
  return `${currency}${rounded}`
}
