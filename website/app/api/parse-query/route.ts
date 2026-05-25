import { NextRequest, NextResponse } from 'next/server'
import { vertexClarify } from '../../lib/vertex-parse'
import { resolveCity } from '../../lib/searchParsing'
import { decideSkipRefineQuestion } from '../../lib/refine-decision'

const ALLOWED_ORIGIN_RE = /^https:\/\/(www\.)?letsfg\.co$|^https:\/\/(\w[\w-]*---)?letsfg-website[\w-]*(?:\.[\w-]+)*\.run\.app$|^http:\/\/localhost(:\d+)?$/

// POST /api/parse-query
// Body: { query: string }
// Returns: VertexParseResult enriched with resolved IATA codes.
export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get('origin') ?? ''
    if (!ALLOWED_ORIGIN_RE.test(origin)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    const body = await request.json() as { query?: string }
    const query = body?.query?.trim() ?? ''
    if (!query) {
      return NextResponse.json({ error: 'query required' }, { status: 400 })
    }

    const today = new Date().toISOString().slice(0, 10)
    // Run the city/intent parse and the refine-question decision in parallel —
    // both go to Vertex AI Gemini independently.
    const [ai, refineDecision] = await Promise.all([
      vertexClarify(query, today),
      decideSkipRefineQuestion(query),
    ])

    if (!ai) {
      return NextResponse.json({ error: 'AI parse unavailable' }, { status: 503 })
    }

    const originCity = typeof ai.origin_city === 'string' ? ai.origin_city : null
    const destinationCity = typeof ai.destination_city === 'string' ? ai.destination_city : null

    const originResolved =
      originCity ? resolveCity(originCity) : null
    const destResolved =
      (destinationCity && destinationCity !== 'ANYWHERE')
        ? resolveCity(destinationCity)
        : null

    return NextResponse.json({
      ...ai,
      origin:               originResolved?.code  ?? null,
      origin_name:          originResolved?.name  ?? originCity,
      destination:          destResolved?.code    ?? null,
      destination_name:     destResolved?.name    ?? destinationCity,
      anywhere_destination: destinationCity       === 'ANYWHERE',
      // Gemini-driven decision on whether to surface the date-flexibility step.
      // null when Vertex was unavailable — the client falls back to a heuristic.
      skip_refine_question:        refineDecision?.skip ?? null,
      skip_refine_question_reason: refineDecision?.reason ?? null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'internal error'
    console.error('[parse-query] error:', error)
    return NextResponse.json(
      { error: process.env.NODE_ENV === 'development' ? message : 'internal error' },
      { status: 500 },
    )
  }
}
