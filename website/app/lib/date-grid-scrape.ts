/**
 * Server-side scrape helper for the Google Flights date grid. Wraps the
 * backend-call → Python-subprocess fallback chain in a reusable function
 * so both /api/date-grid and the parse-query pre-warm can call it.
 */

import { spawn } from 'node:child_process'
import { resolve as resolvePath } from 'node:path'
import { getLetsfgApiBase, withLetsfgWebsiteApiHeaders } from '../../lib/letsfg-api'
import type { DateGridKey, DateGridPayload } from './date-grid-cache'

async function callBackend(p: DateGridKey): Promise<DateGridPayload | null> {
  const base = getLetsfgApiBase()
  if (!base) return null
  try {
    const res = await fetch(`${base}/api/v1/flights/date-grid`, {
      method: 'POST',
      headers: withLetsfgWebsiteApiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        origin: p.origin,
        destination: p.destination,
        dep: p.dep,
        ret: p.ret,
        mode: p.mode ?? 'grid',
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) return null
    const data = await res.json().catch(() => null) as DateGridPayload | null
    if (!data || !Array.isArray(data.grid)) return null
    return { ...data, source: 'backend' }
  } catch {
    return null
  }
}

async function callSubprocess(p: DateGridKey): Promise<DateGridPayload | null> {
  if (process.env.LETSFG_DEV_DATE_GRID_PY !== '1') return null

  const repoRoot = resolvePath(process.cwd(), '..')
  const script = resolvePath(process.cwd(), 'scripts', 'date_grid_runner.py')
  const args = [
    script,
    p.origin,
    p.destination,
    p.dep,
    ...(p.ret ? [p.ret] : []),
    `--mode=${p.mode ?? 'grid'}`,
  ]
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
        const parsed = JSON.parse(stdout) as DateGridPayload
        resolve({ ...parsed, source: 'subprocess' })
      } catch (e) {
        console.error('[date-grid] subprocess returned non-JSON:', stdout.slice(0, 200))
        resolve(null)
      }
    })
  })
}

/** Scrape the date grid. Tries the backend first, then the Python subprocess
 *  (dev only), and returns null if both fail. Callers should wrap this in
 *  the request-coalescing cache (`setInflight`) so the same scrape isn't
 *  fired twice in parallel for the same route+dates. */
export async function scrapeDateGrid(p: DateGridKey): Promise<DateGridPayload | null> {
  const fromBackend = await callBackend(p)
  if (fromBackend) return fromBackend
  const fromPython = await callSubprocess(p)
  if (fromPython) return fromPython
  return null
}
