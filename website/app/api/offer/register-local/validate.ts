/**
 * Validates a booking URL submitted by the SDK via POST /api/offer/register-local.
 *
 * We only accept HTTPS URLs pointing to real airline / OTA domains.
 * The following are explicitly blocked:
 *  - HTTP (unencrypted)
 *  - localhost / 127.x / ::1 / RFC-1918 private ranges
 *  - letsfg.co itself (would create an open-redirect loop)
 *  - URLs longer than 2 KB
 */

const MAX_URL_LENGTH = 2048

const PRIVATE_IP_RE =
  /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|::1|fc[0-9a-f]{2}:|fd[0-9a-f]{2}:)/i

const LETSFG_HOST_RE = /^(.*\.)?letsfg\.co$/i

export type BookingUrlValidationResult =
  | { ok: true }
  | { ok: false; reason: string }

export function validateLocalOfferBookingUrl(rawUrl: unknown): BookingUrlValidationResult {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) {
    return { ok: false, reason: 'booking_url is required' }
  }
  if (rawUrl.length > MAX_URL_LENGTH) {
    return { ok: false, reason: `booking_url exceeds maximum length (${MAX_URL_LENGTH} chars)` }
  }

  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return { ok: false, reason: 'booking_url is not a valid URL' }
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, reason: 'booking_url must use HTTPS' }
  }

  const hostname = parsed.hostname.toLowerCase()

  if (PRIVATE_IP_RE.test(hostname)) {
    return { ok: false, reason: 'booking_url must not point to a private/local network address' }
  }

  if (LETSFG_HOST_RE.test(hostname)) {
    return { ok: false, reason: 'booking_url must not point to letsfg.co' }
  }

  return { ok: true }
}
