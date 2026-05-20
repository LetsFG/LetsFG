/**
 * llm-rationale.ts — generates AI-powered route context using Vertex AI Gemini.
 *
 * The rationale is framed for GENERAL visitors, not the specific searcher who
 * triggered page creation. It explains why this route's pricing is interesting,
 * who benefits most, and actionable booking tips derived from the distribution data.
 *
 * Design:
 *  - Uses gemini-2.5-flash-lite (cheapest Gemini model) for cost efficiency
 *  - Vertex AI REST endpoint — authenticated via GCP service account
 *    (Cloud Run: automatic via metadata server; local: GOOGLE_ACCESS_TOKEN env var)
 *  - Structured JSON output via prompt instruction
 *  - Returns null on any failure — page renders fine without it
 *  - Never exposes user-specific data in the prompt (no session IDs, no PII)
 *  - VERTEX_PROJECT env var required; function is a no-op when absent
 */

import type { RouteDistributionData, LlmRationale } from '../types/route-distribution.types.ts'

const MAX_TOKENS = 512

// ─── GCP access token ─────────────────────────────────────────────────────────

/**
 * Fetch a GCP OAuth2 access token.
 * On Cloud Run the metadata server provides it automatically.
 * For local dev, set GOOGLE_ACCESS_TOKEN (from: gcloud auth print-access-token).
 */
async function getAccessToken(): Promise<string | null> {
  if (process.env.GOOGLE_ACCESS_TOKEN) return process.env.GOOGLE_ACCESS_TOKEN
  try {
    const res = await fetch(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
      {
        headers: { 'Metadata-Flavor': 'Google' },
        signal: AbortSignal.timeout(2_000),
      },
    )
    if (!res.ok) return null
    const data = await res.json() as { access_token: string }
    return data.access_token
  } catch {
    return null
  }
}

// ─── buildRationalePrompt ─────────────────────────────────────────────────────

/**
 * Build the user message content for the Gemini API call.
 * Exported for testability — no API calls happen here.
 */
export function buildRationalePrompt(dist: RouteDistributionData): string {
  const pd = dist.price_distribution
  const carriers = dist.carrier_summary.map(c => c.carrier).join(', ') || 'unknown'
  const feePct = dist.fee_analysis.avg_hidden_fees_pct !== null
    ? `${Math.round(dist.fee_analysis.avg_hidden_fees_pct * 100)}%`
    : 'unknown'

  const bimodalNote = pd.is_bimodal && pd.bimodal_insight
    ? `\nPrice distribution is bimodal: ${pd.bimodal_insight}`
    : ''

  return `Analyze flight pricing data for route ${dist.origin_iata} → ${dist.dest_iata} ` +
    `(${dist.origin_city} → ${dist.dest_city}).

Route data:
- Price range: ${pd.currency} ${pd.min}–${pd.max}
- Median price (p50): ${pd.currency} ${pd.p50}
- p25: ${pd.currency} ${pd.p25}, p75: ${pd.currency} ${pd.p75}
- Total offers analyzed: ${dist.total_offers_analyzed}
- Main carriers: ${carriers}
- Average hidden fees (bags/seat): ${feePct} of base fare${bimodalNote}

Respond with ONLY a JSON object (no markdown, no explanation outside JSON):
{
  "value_proposition": "1-2 sentences on the value of this route for a general traveler",
  "best_for": ["traveler type 1", "traveler type 2"],
  "booking_tips": "1-2 sentences of actionable booking advice citing the actual price data",
  "price_context": "1 sentence on how these prices compare to typical similar-distance routes"
}

Important: Write for GENERAL visitors searching this route. Do not reference a specific user, their search, or their requirements.`
}

// ─── parseRationaleResponse ───────────────────────────────────────────────────

/**
 * Parse and validate a raw LLM response string into an LlmRationale.
 * Returns null on parse failure or missing required fields.
 * Exported for testability.
 */
export function parseRationaleResponse(
  raw: string,
  model: string,
): LlmRationale | null {
  try {
    // Strip markdown code fences if present
    const cleaned = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim()
    const parsed = JSON.parse(cleaned)

    const vp = parsed.value_proposition
    const bf = parsed.best_for
    const bt = parsed.booking_tips
    const pc = parsed.price_context

    if (!vp || !bt || !pc) return null

    return {
      value_proposition: String(vp).slice(0, 400),
      best_for: Array.isArray(bf) ? bf.map(String).slice(0, 5) : [String(bf)],
      booking_tips: String(bt).slice(0, 400),
      price_context: String(pc).slice(0, 300),
      model,
      generated_at: new Date().toISOString(),
    }
  } catch {
    return null
  }
}

// ─── generateLlmRationale ─────────────────────────────────────────────────────

/**
 * Call Vertex AI Gemini to generate a route rationale.
 * Returns null when VERTEX_PROJECT is absent or the call fails.
 *
 * This function is designed to never throw — all errors are caught and logged
 * in non-test environments.
 */
export async function generateLlmRationale(
  dist: RouteDistributionData,
): Promise<LlmRationale | null> {
  const project = process.env.VERTEX_PROJECT
  if (!project) return null

  try {
    const token = await getAccessToken()
    if (!token) return null

    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite'
    const location = process.env.VERTEX_LOCATION || 'global'
    const apiBase = location === 'global'
      ? 'https://aiplatform.googleapis.com'
      : `https://${location}-aiplatform.googleapis.com`
    const url =
      `${apiBase}/v1/projects/${project}/locations/${location}` +
      `/publishers/google/models/${model}:generateContent`

    const prompt = buildRationalePrompt(dist)

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: MAX_TOKENS, temperature: 0.2 },
      }),
      signal: AbortSignal.timeout(15_000),
    })

    if (!res.ok) return null

    const data = await res.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) return null

    return parseRationaleResponse(text, model)
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      console.error('[pfp/llm-rationale] generation failed:', err)
    }
    return null
  }
}
