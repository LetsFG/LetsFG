export function normalizeGoogleFlightsComparisonPrice(
  googleFlightsPrice: number | null | undefined,
  _travelerCount = 1,
): number | null {
  if (!Number.isFinite(googleFlightsPrice)) {
    return null
  }

  // google_flights_price is sourced from a like-for-like Google itinerary match,
  // so it is already on the same per-traveler basis as offer.price.
  const normalized = Math.round((googleFlightsPrice as number) * 100) / 100
  return normalized > 0 ? normalized : null
}

export function getGoogleFlightsSavingsAmount(
  price: number,
  googleFlightsPrice: number | null | undefined,
  travelerCount = 1,
): number | null {
  const normalizedGoogleFlightsPrice = normalizeGoogleFlightsComparisonPrice(googleFlightsPrice, travelerCount)
  if (!Number.isFinite(price) || !Number.isFinite(normalizedGoogleFlightsPrice)) {
    return null
  }

  const diff = Math.round(((normalizedGoogleFlightsPrice as number) - price) * 100) / 100
  if (diff <= 0.005) {
    return null
  }

  return diff
}

export function formatGoogleFlightsSavings(amount: number, currency: string, locale?: string): string {
  const rounded = Math.round(amount * 100) / 100

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: Number.isInteger(rounded) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(rounded)
  } catch {
    const formatted = Number.isInteger(rounded)
      ? String(rounded)
      : rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
    return `${formatted} ${currency}`
  }
}