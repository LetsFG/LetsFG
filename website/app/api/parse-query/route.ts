import { NextRequest, NextResponse } from 'next/server'
import { vertexParse } from '../../lib/vertex-parse'
import { resolveCity } from '../../lib/searchParsing'

// POST /api/parse-query
// Body: { query: string }
// Returns: VertexParseResult enriched with resolved IATA codes.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { query?: string }
    const query = body?.query?.trim() ?? ''
    if (!query) {
      return NextResponse.json({ error: 'query required' }, { status: 400 })
    }

    const today = new Date().toISOString().slice(0, 10)
    const ai = await vertexParse(query, today)
    if (!ai) {
      return NextResponse.json({ error: 'AI parse unavailable' }, { status: 503 })
    }

    const originResolved =
      ai.origin_city ? resolveCity(ai.origin_city) : null
    const destResolved =
      (ai.destination_city && ai.destination_city !== 'ANYWHERE')
        ? resolveCity(ai.destination_city)
        : null

    return NextResponse.json({
      ...ai,
      origin:               originResolved?.code  ?? null,
      origin_name:          originResolved?.name  ?? ai.origin_city,
      destination:          destResolved?.code    ?? null,
      destination_name:     destResolved?.name    ?? ai.destination_city,
      anywhere_destination: ai.destination_city   === 'ANYWHERE',
    })
  } catch {
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
