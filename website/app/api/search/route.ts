import { NextRequest, NextResponse } from 'next/server'

// In-memory store for demo (would be Redis/DB in production)
const searches = new Map<string, SearchData>()

interface SearchData {
  search_id: string
  query: string
  parsed: {
    origin?: string
    origin_name?: string
    destination?: string
    destination_name?: string
    date?: string
  }
  status: 'searching' | 'completed' | 'expired'
  progress: {
    checked: number
    total: number
    found: number
  }
  offers: any[]
  created_at: number
}

// Generate a random search ID
function generateSearchId(): string {
  return 'srch_' + Math.random().toString(36).substring(2, 15)
}

// Simple NL query parser (would be LLM-powered in production)
function parseQuery(query: string) {
  const q = query.toLowerCase()
  
  // Common patterns
  const patterns = {
    // "london to barcelona" or "london → barcelona"
    route: /(\w+(?:\s+\w+)?)\s*(?:to|→|->|–)\s*(\w+(?:\s+\w+)?)/i,
    // "next friday", "in june", etc
    date: /(next\s+\w+|in\s+\w+|\d{4}-\d{2}-\d{2}|\d{1,2}\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*)/i,
  }
  
  // City to IATA mapping (simplified)
  const cityToIata: Record<string, { code: string, name: string }> = {
    'london': { code: 'LON', name: 'London' },
    'barcelona': { code: 'BCN', name: 'Barcelona' },
    'new york': { code: 'NYC', name: 'New York' },
    'nyc': { code: 'NYC', name: 'New York' },
    'paris': { code: 'PAR', name: 'Paris' },
    'tokyo': { code: 'TYO', name: 'Tokyo' },
    'berlin': { code: 'BER', name: 'Berlin' },
    'rome': { code: 'ROM', name: 'Rome' },
    'bali': { code: 'DPS', name: 'Bali' },
    'madrid': { code: 'MAD', name: 'Madrid' },
    'amsterdam': { code: 'AMS', name: 'Amsterdam' },
    'dubai': { code: 'DXB', name: 'Dubai' },
    'singapore': { code: 'SIN', name: 'Singapore' },
    'bangkok': { code: 'BKK', name: 'Bangkok' },
    'los angeles': { code: 'LAX', name: 'Los Angeles' },
    'miami': { code: 'MIA', name: 'Miami' },
  }
  
  const parsed: any = {}
  
  // Extract route
  const routeMatch = q.match(patterns.route)
  if (routeMatch) {
    const originStr = routeMatch[1].trim()
    const destStr = routeMatch[2].trim()
    
    const origin = cityToIata[originStr] || { code: originStr.toUpperCase().slice(0, 3), name: originStr }
    const dest = cityToIata[destStr] || { code: destStr.toUpperCase().slice(0, 3), name: destStr }
    
    parsed.origin = origin.code
    parsed.origin_name = origin.name
    parsed.destination = dest.code
    parsed.destination_name = dest.name
  }
  
  // Extract date
  const dateMatch = q.match(patterns.date)
  if (dateMatch) {
    // For demo, just use a future date
    const today = new Date()
    today.setDate(today.getDate() + 7)
    parsed.date = today.toISOString().split('T')[0]
  } else {
    // Default to 1 week from now
    const today = new Date()
    today.setDate(today.getDate() + 7)
    parsed.date = today.toISOString().split('T')[0]
  }
  
  return parsed
}

// Simulate flight search (would call LetsFG API in production)
async function simulateSearch(searchId: string) {
  const search = searches.get(searchId)
  if (!search) return
  
  // Simulate progress updates
  const airlines = 180
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 500)) // 500ms per batch
    
    const s = searches.get(searchId)
    if (!s) return
    
    s.progress.checked = Math.min(Math.floor((i + 1) * airlines / 10), airlines)
    s.progress.found = Math.floor(Math.random() * 5) + s.progress.found
    searches.set(searchId, s)
  }
  
  // Generate mock results
  const mockOffers = generateMockOffers(search.parsed)
  
  search.status = 'completed'
  search.progress.checked = airlines
  search.progress.found = mockOffers.length
  search.offers = mockOffers
  searches.set(searchId, search)
  
  // Set expiry (15 minutes)
  setTimeout(() => {
    const s = searches.get(searchId)
    if (s) {
      s.status = 'expired'
      searches.set(searchId, s)
    }
  }, 15 * 60 * 1000)
}

function generateMockOffers(parsed: any) {
  const airlines = [
    { name: 'Ryanair', code: 'FR' },
    { name: 'Wizz Air', code: 'W6' },
    { name: 'EasyJet', code: 'U2' },
    { name: 'Vueling', code: 'VY' },
    { name: 'British Airways', code: 'BA' },
    { name: 'Iberia', code: 'IB' },
    { name: 'Air France', code: 'AF' },
    { name: 'Lufthansa', code: 'LH' },
  ]
  
  const basePrice = 29 + Math.floor(Math.random() * 50)
  
  return airlines.slice(0, 5 + Math.floor(Math.random() * 10)).map((airline, i) => {
    const depHour = 6 + Math.floor(Math.random() * 14)
    const duration = 90 + Math.floor(Math.random() * 180)
    const arrHour = depHour + Math.floor(duration / 60)
    
    const depDate = new Date(parsed.date || Date.now())
    depDate.setHours(depHour, Math.floor(Math.random() * 60))
    
    const arrDate = new Date(depDate)
    arrDate.setMinutes(arrDate.getMinutes() + duration)
    
    return {
      id: `off_${Math.random().toString(36).substring(2, 10)}`,
      price: basePrice + i * 15 + Math.floor(Math.random() * 20),
      currency: '€',
      airline: airline.name,
      airline_code: airline.code,
      origin: parsed.origin || 'LON',
      origin_name: parsed.origin_name || 'London',
      destination: parsed.destination || 'BCN',
      destination_name: parsed.destination_name || 'Barcelona',
      departure_time: depDate.toISOString(),
      arrival_time: arrDate.toISOString(),
      duration_minutes: duration,
      stops: Math.random() > 0.7 ? 1 : 0,
    }
  }).sort((a, b) => a.price - b.price)
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { query } = body
    
    if (!query || typeof query !== 'string') {
      return NextResponse.json(
        { error: 'Query is required' },
        { status: 400 }
      )
    }
    
    // Parse the natural language query
    const parsed = parseQuery(query)
    
    // Generate search ID
    const search_id = generateSearchId()
    
    // Store search data
    const searchData: SearchData = {
      search_id,
      query,
      parsed,
      status: 'searching',
      progress: { checked: 0, total: 180, found: 0 },
      offers: [],
      created_at: Date.now(),
    }
    searches.set(search_id, searchData)
    
    // Start background search (don't await)
    simulateSearch(search_id)
    
    return NextResponse.json({
      search_id,
      status: 'searching',
      parsed,
    })
  } catch (error) {
    console.error('Search error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
