/**
 * refine-decision.ts — uses Vertex AI Gemini to decide whether to surface
 * the date-flexibility refine step after the user confirms their search.
 *
 * Returns true  → skip the refine question (user is already flexible, or
 *                 explicitly said fixed-only, or didn't mention any dates)
 * Returns false → show the refine question
 * Returns null  → couldn't reach Vertex (no creds, timeout, etc.) — caller
 *                 should fall back to the heuristic
 *
 * Same auth + endpoint pattern as lib/pfp/ingest/llm-rationale.ts.
 */

const MAX_TOKENS = 64

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
    const data = (await res.json()) as { access_token: string }
    return data.access_token
  } catch {
    return null
  }
}

function buildPrompt(query: string): string {
  return [
    `You are deciding whether a follow-up screen should be shown to a user after they confirm a flight search.`,
    `The follow-up asks: "How flexible are you with your travel dates?"`,
    ``,
    `User's original search query:`,
    `"""${query}"""`,
    ``,
    `Return skip=true when ANY of these apply:`,
    `  - The user already indicated flexibility (e.g. "anywhere in June", "flexible dates", "sometime in May", "in spring")`,
    `  - The user did not mention dates at all`,
    `  - The user explicitly opted out of flexibility (e.g. "only on 12 June", "must be these exact dates", "fixed dates only", "no flexibility")`,
    ``,
    `Return skip=false when:`,
    `  - The user gave one or more concrete dates AND did not opt out of flexibility (this is the most common case)`,
    ``,
    `Respond with ONLY a JSON object, no markdown, no prose:`,
    `{"skip": true|false, "reason": "one short clause"}`,
  ].join('\n')
}

interface DecisionResult {
  skip: boolean
  reason?: string
}

function parseDecision(raw: string): DecisionResult | null {
  try {
    const cleaned = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim()
    const parsed = JSON.parse(cleaned) as { skip?: unknown; reason?: unknown }
    if (typeof parsed.skip !== 'boolean') return null
    return {
      skip: parsed.skip,
      reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 200) : undefined,
    }
  } catch {
    return null
  }
}

/**
 * Ask Gemini whether the refine-question screen should be skipped.
 * Returns null when Vertex isn't configured or the call fails — the caller
 * should fall back to a deterministic heuristic in that case.
 */
export async function decideSkipRefineQuestion(query: string): Promise<DecisionResult | null> {
  const project = process.env.VERTEX_PROJECT
  if (!project || !query.trim()) return null

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

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: buildPrompt(query) }] }],
        generationConfig: { maxOutputTokens: MAX_TOKENS, temperature: 0 },
      }),
      signal: AbortSignal.timeout(6_000),
    })

    if (!res.ok) return null

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) return null

    return parseDecision(text)
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      console.error('[refine-decision] gemini call failed:', err)
    }
    return null
  }
}
