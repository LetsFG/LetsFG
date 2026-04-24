import { NextRequest, NextResponse } from 'next/server'

// Mock offer store — in production this would be Redis/DB
// Generates a deterministic offer for any offerId

const AIRLINES = [
  { name: 'Ryanair', code: 'FR', domain: 'ryanair.com' },
  { name: 'Wizz Air', code: 'W6', domain: 'wizzair.com' },
  { name: 'EasyJet', code: 'U2', domain: 'easyjet.com' },
  { name: 'Vueling', code: 'VY', domain: 'vueling.com' },
  { name: 'British Airways', code: 'BA', domain: 'britishairways.com' },
  { name: 'Iberia', code: 'IB', domain: 'iberia.com' },
  { name: 'Norwegian', code: 'DY', domain: 'norwegian.com' },
  { name: 'TAP Portugal', code: 'TP', domain: 'flytap.com' },
]

function seededRandom(seed: number) {
  let x = Math.sin(seed) * 10000
  return x - Math.floor(x)
}

function generateOffer(offerId: string) {
  // Deterministic seed from offerId string
  let seed = 0
  for (let i = 0; i < offerId.length; i++) seed += offerId.charCodeAt(i)

  const airlineIdx = Math.floor(seededRandom(seed + 1) * AIRLINES.length)
  const airline = AIRLINES[airlineIdx]
  const price = Math.round(29 + seededRandom(seed + 2) * 280)
  const depHour = 6 + Math.floor(seededRandom(seed + 3) * 14)
  const depMin = Math.floor(seededRandom(seed + 4) * 60)
  const durationMins = 115 + Math.floor(seededRandom(seed + 5) * 180)
  const stops = seededRandom(seed + 6) > 0.65 ? 1 : 0
  const flightNum = `${airline.code}${1000 + Math.floor(seededRandom(seed + 7) * 8000)}`

  const baseDate = new Date()
  baseDate.setDate(baseDate.getDate() + 7 + Math.floor(seededRandom(seed + 8) * 30))
  baseDate.setHours(depHour, depMin, 0, 0)

  const arrDate = new Date(baseDate)
  arrDate.setMinutes(arrDate.getMinutes() + durationMins)

  return {
    id: offerId,
    price,
    currency: '€',
    airline: airline.name,
    airline_code: airline.code,
    origin: 'STN',
    origin_name: 'London Stansted',
    destination: 'BCN',
    destination_name: 'Barcelona El Prat',
    departure_time: baseDate.toISOString(),
    arrival_time: arrDate.toISOString(),
    duration_minutes: durationMins,
    stops,
    flight_number: flightNum,
    // The booking URL — revealed only after unlock in the real app
    booking_url: `https://www.${airline.domain}/select?from=STN&to=BCN&date=${baseDate.toISOString().split('T')[0]}&price=${price}`,
  }
}

// Special demo offer with fixed values for consistent testing
const DEMO_OFFER = {
  id: 'demo-offer-1',
  price: 29,
  currency: '€',
  airline: 'Ryanair',
  airline_code: 'FR',
  origin: 'STN',
  origin_name: 'London Stansted',
  destination: 'BCN',
  destination_name: 'Barcelona El Prat',
  departure_time: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().replace(/T.*/, 'T10:30:00.000Z'),
  arrival_time: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().replace(/T.*/, 'T14:05:00.000Z'),
  duration_minutes: 215,
  stops: 0,
  flight_number: 'FR2413',
  booking_url: 'https://www.ryanair.com/select?from=STN&to=BCN&date=demo&price=29',
}

const HIGH_VALUE_DEMO = {
  id: 'demo-offer-expensive',
  price: 2499,
  currency: '€',
  airline: 'British Airways',
  airline_code: 'BA',
  origin: 'LHR',
  origin_name: 'London Heathrow',
  destination: 'JFK',
  destination_name: 'New York JFK',
  departure_time: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().replace(/T.*/, 'T09:15:00.000Z'),
  arrival_time: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().replace(/T.*/, 'T12:30:00.000Z'),
  duration_minutes: 435,
  stops: 0,
  flight_number: 'BA117',
  booking_url: 'https://www.britishairways.com/select?from=LHR&to=JFK&date=demo&price=2499',
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ offerId: string }> }
) {
  const { offerId } = await params

  if (offerId === 'demo-offer-1') {
    return NextResponse.json(DEMO_OFFER)
  }
  if (offerId === 'demo-offer-expensive') {
    return NextResponse.json(HIGH_VALUE_DEMO)
  }

  return NextResponse.json(generateOffer(offerId))
}
