import 'server-only'

// Server-only: proxy NL flight intent parsing to the backend API service.

import { getLetsfgApiBase, withLetsfgWebsiteApiHeaders } from '../../lib/letsfg-api'
import type { HomeConvoFollowUpTopic } from './home-search-assist'
import type { TripPurpose } from './trip-purpose'

export interface VertexFollowUpChoice {
  key: string
  label?: string | null
}

export interface VertexFollowUpQuestion {
  topic: HomeConvoFollowUpTopic
  question?: string | null
  free_hint?: string | null
  multi_choice?: boolean | null
  is_essential?: boolean | null
  suggested_answers?: VertexFollowUpChoice[] | null
}

export interface VertexCityResult {
  ready_to_search?: boolean | null
  follow_up_questions?: VertexFollowUpQuestion[] | null
  origin_city:      string | null  // English city name; include state/country if ambiguous
  destination_city: string | null  // "ANYWHERE" for open-destination searches; null if unclear
  via_city:         string | null  // preferred stopover city or null
  // Approximate centre lat/lon for the named city. Used as a deterministic
  // fallback by /api/search to find the nearest commercial airport (via the
  // bundled OurAirports DB + haversine) when origin_city / destination_city
  // doesn't map to any IATA code in our city alias table. Optional — leave
  // null when the model isn't confident or the query is ambiguous.
  origin_lat?:      number | null
  origin_lon?:      number | null
  destination_lat?: number | null
  destination_lon?: number | null

  // ── Intent fields (extracted alongside cities — same call, zero extra latency) ──
  /** Total traveller count (adults + children). null if not mentioned. */
  passengers?:      number | null
  /** Cabin class. null if not mentioned. */
  cabin_class?:     'economy' | 'premium_economy' | 'business' | 'first' | null
  /** true only if user explicitly wants no connections/layovers. null otherwise. */
  direct_only?:     boolean | null
  /** "price" = cheapest, "duration" = fastest, null = not stated. */
  sort_by?:         'price' | 'duration' | null
  /** Earliest acceptable departure time as "HH:MM" 24 h. null if not stated. */
  depart_after?:    string | null
  /** Latest acceptable departure time as "HH:MM" 24 h. null if not stated. */
  depart_before?:   string | null
  /** true if user wants checked bags included in the ticket price. null otherwise. */
  bags_included?:   boolean | null
  /** All applicable trip purposes, ordered strongest/most explicit first. */
  trip_purposes?:   TripPurpose[] | null
  /** Trip purpose inferred from context. null if unclear. */
  trip_purpose?:    TripPurpose | null
  /** Preferred departure time bucket for the outbound leg. null if not stated. */
  dep_time_pref?:   'early_morning' | 'morning' | 'afternoon' | 'evening' | 'night' | 'red_eye' | null
  /** Preferred departure time bucket for the return leg. null if not a round-trip or not stated. */
  ret_time_pref?:   'early_morning' | 'morning' | 'afternoon' | 'evening' | 'night' | 'red_eye' | null
  /** Passenger group context. null if unclear. */
  passenger_context?: 'solo' | 'couple' | 'family' | 'group' | 'business_traveler' | null
  /** true = round trip, false = one-way, null = unclear. */
  is_round_trip?: boolean | null
  /** Outbound flight date in YYYY-MM-DD. null if not determinable. */
  departure_date?: string | null
  /** Return flight date in YYYY-MM-DD. null for one-way or unclear. */
  return_date?: string | null
  /** Ordered list of clarification topics the homepage convo should ask next. */
  follow_up_topics?: HomeConvoFollowUpTopic[] | null
  /**
   * Short, money-impacting questions Gemini wants surfaced *on the loading
   * page* (after refine completes) while the search runs in the background.
   * Same shape as follow_up_questions but a separate stream — these are
   * shown one-at-a-time as a small agent card and their answers feed the
   * inclusive-price (price_with_all) sort on the results page.
   * Null = no loading-page question for this query.
   */
  loading_questions?: VertexFollowUpQuestion[] | null
}

// Keep old name as alias so callers importing VertexParseResult still compile
export type VertexParseResult = VertexCityResult

type VertexRequestMode = 'full' | 'clarify'

interface VertexRequestOptions {
  label: string
  mode: VertexRequestMode
  timeoutMs: number
}

async function requestVertexJson(
  query: string,
  today: string,
  options: VertexRequestOptions,
): Promise<VertexCityResult | null> {
  const url = `${getLetsfgApiBase()}/api/v1/flights/ai-intent`

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: withLetsfgWebsiteApiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ query, today, mode: options.mode }),
      cache: 'no-store',
      signal: AbortSignal.timeout(options.timeoutMs),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      console.error(`[vertex-parse:${options.label}] backend HTTP ${res.status} body=${errText.slice(0, 400)}`)
      return null
    }

    return await res.json() as VertexCityResult
  } catch (e) {
    console.error(`[vertex-parse:${options.label}] backend error:`, e)
    return null
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function vertexParse(
  query: string,
  today: string,
): Promise<VertexCityResult | null> {
  return requestVertexJson(query, today, {
    label: 'full',
    mode: 'full',
    timeoutMs: 5000,
  })
}

export async function vertexClarify(
  query: string,
  today: string,
): Promise<VertexCityResult | null> {
  return requestVertexJson(query, today, {
    label: 'clarify',
    mode: 'clarify',
    timeoutMs: 15000,
  })
}
