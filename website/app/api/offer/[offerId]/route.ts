import { NextRequest, NextResponse } from 'next/server'
import { hasActiveUnlock } from '../../../../lib/unlock-cookie'
import { getBookingSiteLabel, summarizeBookingSites } from '../../../../lib/booking-site'
import { getTrustedOffer, toPublicOffer } from '../../../../lib/trusted-offer'
import { hasValidUnlockToken } from '../../../../lib/unlock-token'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ offerId: string }> }
) {
  const { offerId } = await params
  const searchId = request.nextUrl.searchParams.get('from')
  const snapshotRef = request.nextUrl.searchParams.get('ref')
  const view = request.nextUrl.searchParams.get('view')

  const offer = await getTrustedOffer(offerId, searchId, snapshotRef)
  if (!offer) {
    return NextResponse.json({ error: 'Offer not found' }, { status: 404 })
  }

  if (view === 'booking-link') {
    if (!searchId) {
      return NextResponse.json({ error: 'Missing search context' }, { status: 400 })
    }
    if (!hasActiveUnlock(request, searchId) && !hasValidUnlockToken(request, searchId)) {
      return NextResponse.json({ error: 'Search is locked' }, { status: 403 })
    }
    const bookingOptions = (offer.booking_options || []).filter((option) => option.booking_url)
    const primaryBookingUrl = offer.booking_url || bookingOptions[0]?.booking_url
    const bookingOptionsWithSites = bookingOptions.map((option) => ({
      ...option,
      booking_site: getBookingSiteLabel(option.booking_url, option.airline),
    }))
    const primaryBookingSite = getBookingSiteLabel(primaryBookingUrl, offer.airline)
    const bookingSiteSummary = summarizeBookingSites([
      primaryBookingSite,
      ...bookingOptionsWithSites.map((option) => option.booking_site),
    ])

    if (!primaryBookingUrl) {
      return NextResponse.json({ error: 'Booking link unavailable' }, { status: 404 })
    }

    return NextResponse.json({
      offer_id: offer.id,
      booking_url: primaryBookingUrl,
      booking_site: primaryBookingSite,
      booking_site_summary: bookingSiteSummary,
      booking_options: bookingOptionsWithSites,
    })
  }

  if (view === 'source-meta') {
    if (!searchId) {
      return NextResponse.json({ error: 'Missing search context' }, { status: 400 })
    }
    if (!hasActiveUnlock(request, searchId) && !hasValidUnlockToken(request, searchId)) {
      return NextResponse.json({ error: 'Search is locked' }, { status: 403 })
    }

    const bookingOptions = (offer.booking_options || []).filter((option) => option.booking_url)
    const primaryBookingUrl = offer.booking_url || bookingOptions[0]?.booking_url
    const bookingOptionsWithSites = bookingOptions.map((option) => ({
      leg: option.leg,
      airline: option.airline,
      airline_code: option.airline_code,
      booking_site: getBookingSiteLabel(option.booking_url, option.airline),
    }))
    const primaryBookingSite = getBookingSiteLabel(primaryBookingUrl, offer.airline)
    const bookingSiteSummary = summarizeBookingSites([
      primaryBookingSite,
      ...bookingOptionsWithSites.map((option) => option.booking_site),
    ])

    return NextResponse.json({
      offer_id: offer.id,
      booking_site: primaryBookingSite,
      booking_site_summary: bookingSiteSummary,
      booking_options: bookingOptionsWithSites,
    })
  }

  return NextResponse.json(toPublicOffer(offer))
}
