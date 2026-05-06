import { NextRequest, NextResponse } from 'next/server'

const FSW_URL = process.env.FSW_URL || 'https://flight-search-worker-qryvus4jia-uc.a.run.app'
const FSW_SECRET = process.env.FSW_SECRET || ''

/**
 * POST /api/results/cancel/[searchId]
 *
 * Proxies a cancel signal to the Flight Search Worker. Called fire-and-forget
 * by the client (via sendBeacon) when the user starts a new search while one
 * is already in progress. The FSW will abort Phase 2 connector fan-out,
 * saving connector-worker costs.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ searchId: string }> },
) {
  const { searchId } = await params
  if (!searchId || typeof searchId !== 'string') {
    return NextResponse.json({ error: 'invalid searchId' }, { status: 400 })
  }

  try {
    const fswRes = await fetch(`${FSW_URL}/web-cancel/${encodeURIComponent(searchId)}`, {
      method: 'POST',
      headers: { 'X-FSW-Secret': FSW_SECRET },
      // Short timeout — this is fire-and-forget, we don't want to block the UI
      signal: AbortSignal.timeout(3000),
    })
    const body = await fswRes.json().catch(() => ({}))
    return NextResponse.json(body, { status: fswRes.ok ? 200 : fswRes.status })
  } catch {
    // Swallow errors — the cancel is best-effort
    return NextResponse.json({ ok: true, note: 'fsw unreachable' })
  }
}
