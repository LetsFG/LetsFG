/**
 * GET /api/date-grid
 *
 * Returns the Google Flights ±3-day price grid for a given route + dates.
 * Used by the /refine page to show real price-flexibility signal.
 *
 * Resolution order:
 *   1. Backend endpoint  POST {LETSFG_API_URL}/api/v1/flights/date-grid
 *      (the proper architecture — runs the Python connector serverside)
 *   2. Dev subprocess    LETSFG_DEV_DATE_GRID_PY=1 spawns
 *      `python website/scripts/date_grid_runner.py ...` for local testing
 *      WITHOUT a backend. Requires Python + the connectors deps installed.
 *   3. 503               nothing worked — caller should show a graceful fallback
 *
 * Query params:
 *   origin       IATA code (3 letters), required
 *   destination  IATA code (3 letters), required
 *   dep          outbound date YYYY-MM-DD, required
 *   ret          return date YYYY-MM-DD, optional (one-way if omitted)
 */

import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'node:child_process'
import { resolve as resolvePath } from 'node:path'
import { getLetsfgApiBase, withLetsfgWebsiteApiHeaders } from '../../../lib/letsfg-api'

const ALLOWED_ORIGIN_RE = /^https:\/\/(www\.)?letsfg\.co$|^https:\/\/(\w[\w-]*---)?letsfg-website[\w-]*(?:\.[\w-]+)*\.run\.app$|^http:\/\/localhost(:\d+)?$/

interface GridCell {
  outbound: string  // ISO date YYYY-MM-DD
  return: string    // ISO date YYYY-MM-DD
  price: number
  currency: string
  is_cheaper: boolean
}

interface DateGridResponse {
  origin: string
  destination: string
  currency: string | null
  selected_outbound: string
  selected_return: string | null
  scraped_at: string
  grid: GridCell[]
  source: 'backend' | 'subprocess'
}

const IATA_RE = /^[A-Z]{3}$/
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function validate(searchParams: URLSearchParams): { ok: true; origin: string; destination: string; dep: string; ret: string | null } | { ok: false; error: string } {
  const origin = (searchParams.get('origin') ?? '').toUpperCase().trim()
  const destination = (searchParams.get('destination') ?? '').toUpperCase().trim()
  const dep = (searchParams.get('dep') ?? '').trim()
  const retRaw = (searchParams.get('ret') ?? '').trim()
  const ret = retRaw === '' ? null : retRaw
  if (!IATA_RE.test(origin)) return { ok: false, error: 'origin must be a 3-letter IATA code' }
  if (!IATA_RE.test(destination)) return { ok: false, error: 'destination must be a 3-letter IATA code' }
  if (!ISO_DATE_RE.test(dep)) return { ok: false, error: 'dep must be YYYY-MM-DD' }
  if (ret !== null && !ISO_DATE_RE.test(ret)) return { ok: false, error: 'ret must be YYYY-MM-DD or omitted' }
  return { ok: true, origin, destination, dep, ret }
}

async function callBackend(p: { origin: string; destination: string; dep: string; ret: string | null }): Promise<DateGridResponse | null> {
  const base = getLetsfgApiBase()
  if (!base) return null
  try {
    const res = await fetch(`${base}/api/v1/flights/date-grid`, {
      method: 'POST',
      headers: withLetsfgWebsiteApiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(p),
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) {
      // 404 means "endpoint not deployed yet" — keep going to fallback
      return null
    }
    const data = await res.json().catch(() => null) as DateGridResponse | null
    if (!data || !Array.isArray(data.grid)) return null
    return { ...data, source: 'backend' }
  } catch {
    return null
  }
}

async function callSubprocess(p: { origin: string; destination: string; dep: string; ret: string | null }): Promise<DateGridResponse | null> {
  if (process.env.LETSFG_DEV_DATE_GRID_PY !== '1') return null

  const repoRoot = resolvePath(process.cwd(), '..')
  const script = resolvePath(process.cwd(), 'scripts', 'date_grid_runner.py')
  const args = [script, p.origin, p.destination, p.dep, ...(p.ret ? [p.ret] : [])]
  const python = process.env.PYTHON_BIN || 'python'

  return new Promise(resolve => {
    const child = spawn(python, args, {
      cwd: repoRoot,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* noop */ }
    }, 60_000)
    child.stdout.on('data', d => { stdout += d.toString() })
    child.stderr.on('data', d => { stderr += d.toString() })
    child.on('error', err => {
      clearTimeout(timer)
      console.error('[date-grid] subprocess spawn failed:', err.message)
      resolve(null)
    })
    child.on('close', code => {
      clearTimeout(timer)
      if (code !== 0) {
        console.error(`[date-grid] subprocess exited ${code}: ${stderr.slice(0, 400)}`)
        resolve(null)
        return
      }
      try {
        const parsed = JSON.parse(stdout) as DateGridResponse
        resolve({ ...parsed, source: 'subprocess' })
      } catch (e) {
        console.error('[date-grid] subprocess returned non-JSON:', stdout.slice(0, 200))
        resolve(null)
      }
    })
  })
}

export async function GET(request: NextRequest) {
  const origin = request.headers.get('origin') ?? ''
  if (origin && !ALLOWED_ORIGIN_RE.test(origin)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const params = validate(request.nextUrl.searchParams)
  if (!params.ok) {
    return NextResponse.json({ error: params.error }, { status: 400 })
  }

  const fromBackend = await callBackend(params)
  if (fromBackend) {
    return NextResponse.json(fromBackend, {
      headers: { 'Cache-Control': 'no-store' },
    })
  }

  const fromPython = await callSubprocess(params)
  if (fromPython) {
    return NextResponse.json(fromPython, {
      headers: { 'Cache-Control': 'no-store' },
    })
  }

  return NextResponse.json(
    { error: 'date-grid unavailable — backend endpoint not deployed and LETSFG_DEV_DATE_GRID_PY not set' },
    { status: 503 },
  )
}
