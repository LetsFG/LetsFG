import { NextRequest, NextResponse } from 'next/server'

// Shared store (in production this would be Redis/DB)
// For demo purposes, we'll generate mock data
interface SearchData {
  search_id: string
  query: string
  parsed: any
  status: 'searching' | 'completed' | 'expired'
  progress: {
    checked: number
    total: number
    found: number
  }
  offers: any[]
  searched_at?: string
  expires_at?: string
}

// Mock data store (shared with search route in real app)
const mockSearches = new Map<string, SearchData>()

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ searchId: string }> }
) {
  const { searchId } = await params
  
  // In production, fetch from Redis/DB
  // For demo, generate mock data based on search ID
  
  // Check if we have this search in memory
  let search = mockSearches.get(searchId)

  // Special demo ID — always returns a completed state for UI testing
  if (searchId === 'demo-completed') {
    return NextResponse.json({
      ...generateMockCompletedSearch('demo-completed'),
      searched_at: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
      expires_at: new Date(Date.now() + 13 * 60 * 1000).toISOString(),
    })
  }

  // Special demo ID — always returns a searching state for UI testing
  if (searchId === 'demo-loading') {
    return NextResponse.json({
      search_id: 'demo-loading',
      status: 'searching',
      query: 'cheapest flight London to Barcelona next Friday',
      parsed: {
        origin: 'LON',
        origin_name: 'London',
        destination: 'BCN',
        destination_name: 'Barcelona',
        date: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
      },
      progress: { checked: 47, total: 198, found: 12 },
      offers: [],
    })
  }
  
  if (!search) {
    // For demo: if it looks like a valid search ID, generate mock completed results
    if (searchId.startsWith('srch_')) {
      search = generateMockCompletedSearch(searchId)
      mockSearches.set(searchId, search)
    } else {
      return NextResponse.json(
        { error: 'Search not found' },
        { status: 404 }
      )
    }
  }
  
  // Add timestamps
  const response = {
    ...search,
    searched_at: new Date(Date.now() - 2 * 60 * 1000).toISOString(), // 2 min ago
    expires_at: new Date(Date.now() + 13 * 60 * 1000).toISOString(), // 13 min from now
  }
  
  return NextResponse.json(response)
}

function generateMockCompletedSearch(searchId: string): SearchData {
  const airlines = [
    { name: 'Ryanair', code: 'FR' },
    { name: 'Wizz Air', code: 'W6' },
    { name: 'EasyJet', code: 'U2' },
    { name: 'Vueling', code: 'VY' },
    { name: 'British Airways', code: 'BA' },
    { name: 'Iberia', code: 'IB' },
    { name: 'Air France', code: 'AF' },
    { name: 'Lufthansa', code: 'LH' },
    { name: 'Norwegian', code: 'DY' },
    { name: 'TAP Portugal', code: 'TP' },
    { name: 'KLM', code: 'KL' },
    { name: 'Swiss', code: 'LX' },
    { name: 'Brussels Airlines', code: 'SN' },
    { name: 'Transavia', code: 'TO' },
    { name: 'Volotea', code: 'V7' },
    { name: 'Jetblue', code: 'B6' },
    { name: 'Finnair', code: 'AY' },
    { name: 'SAS', code: 'SK' },
    { name: 'Austrian', code: 'OS' },
    { name: 'Aer Lingus', code: 'EI' },
    { name: 'Air Europa', code: 'UX' },
    { name: 'Condor', code: 'DE' },
    { name: 'TUI fly', code: 'X3' },
    { name: 'Jet2', code: 'LS' },
    { name: 'Flybe', code: 'BE' },
    { name: 'easyJet Europe', code: 'EC' },
    { name: 'Pegasus', code: 'PC' },
    { name: 'Iberia Express', code: 'I2' },
    { name: 'Vueling Connect', code: 'VK' },
    { name: 'HOP!', code: 'A5' },
  ]
  
  const baseDate = new Date()
  baseDate.setDate(baseDate.getDate() + 7)
  
  const connectingAirports = [
    { code: 'MAD', name: 'Madrid Barajas' },
    { code: 'CDG', name: 'Paris Charles de Gaulle' },
    { code: 'FRA', name: 'Frankfurt Airport' },
    { code: 'AMS', name: 'Amsterdam Schiphol' },
    { code: 'LIS', name: 'Lisbon Humberto Delgado' },
    { code: 'VIE', name: 'Vienna International' },
  ]

  const offers = airlines.map((airline, i) => {
    const depHour = 6 + Math.floor(Math.random() * 14)
    const stops = Math.random() > 0.6 ? 1 : 0
    // For stops, add extra time for the layover in total duration
    const flightTime = 90 + Math.floor(Math.random() * 120)
    const layoverMins = stops > 0 ? 45 + Math.floor(Math.random() * 60) : 0
    const duration = flightTime + layoverMins

    const depDate = new Date(baseDate)
    depDate.setHours(depHour, Math.floor(Math.random() * 60), 0, 0)

    const arrDate = new Date(depDate)
    arrDate.setMinutes(arrDate.getMinutes() + duration)

    // Build segments for connecting flights
    let segments: object[] | undefined
    if (stops > 0) {
      const via = connectingAirports[i % connectingAirports.length]
      const leg1Duration = Math.floor(flightTime * 0.55)
      const leg2Duration = flightTime - leg1Duration

      const leg1ArrDate = new Date(depDate)
      leg1ArrDate.setMinutes(leg1ArrDate.getMinutes() + leg1Duration)

      const leg2DepDate = new Date(leg1ArrDate)
      leg2DepDate.setMinutes(leg2DepDate.getMinutes() + layoverMins)

      segments = [
        {
          origin: 'STN',
          origin_name: 'London Stansted',
          destination: via.code,
          destination_name: via.name,
          departure_time: depDate.toISOString(),
          arrival_time: leg1ArrDate.toISOString(),
          flight_number: `${airline.code}${1000 + i * 7}`,
          duration_minutes: leg1Duration,
          layover_minutes: layoverMins,
        },
        {
          origin: via.code,
          origin_name: via.name,
          destination: 'BCN',
          destination_name: 'Barcelona El Prat',
          departure_time: leg2DepDate.toISOString(),
          arrival_time: arrDate.toISOString(),
          flight_number: `${airline.code}${2000 + i * 11}`,
          duration_minutes: leg2Duration,
          layover_minutes: 0,
        },
      ]
    }

    return {
      id: `off_${Math.random().toString(36).substring(2, 10)}`,
      price: 29 + i * 12 + Math.floor(Math.random() * 30),
      currency: '€',
      airline: airline.name,
      airline_code: airline.code,
      origin: 'LON',
      origin_name: 'London',
      destination: 'BCN',
      destination_name: 'Barcelona',
      departure_time: depDate.toISOString(),
      arrival_time: arrDate.toISOString(),
      duration_minutes: duration,
      stops,
      segments,
    }
  }).sort((a, b) => a.price - b.price)
  
  return {
    search_id: searchId,
    query: 'London to Barcelona next Friday',
    parsed: {
      origin: 'LON',
      origin_name: 'London',
      destination: 'BCN',
      destination_name: 'Barcelona',
      date: baseDate.toISOString().split('T')[0],
    },
    status: 'completed',
    progress: {
      checked: 180,
      total: 180,
      found: offers.length,
    },
    offers,
  }
}
