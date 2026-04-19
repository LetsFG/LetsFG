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
  ]
  
  const baseDate = new Date()
  baseDate.setDate(baseDate.getDate() + 7)
  
  const offers = airlines.map((airline, i) => {
    const depHour = 6 + Math.floor(Math.random() * 14)
    const duration = 90 + Math.floor(Math.random() * 180)
    
    const depDate = new Date(baseDate)
    depDate.setHours(depHour, Math.floor(Math.random() * 60))
    
    const arrDate = new Date(depDate)
    arrDate.setMinutes(arrDate.getMinutes() + duration)
    
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
      stops: Math.random() > 0.6 ? 1 : 0,
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
