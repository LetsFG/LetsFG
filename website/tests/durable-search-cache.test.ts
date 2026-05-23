/**
 * Tests for the durable search-cache client (lib/durable-search-cache.ts).
 *
 * The client talks to the LetsFG-private backend endpoint
 * `/api/v1/internal/search-cache/{search_id}`. The website uses this so
 * completed search results survive Cloud Run cold starts and instance churn
 * (origin: ws_47776b352af74a1b reload-instability on 2026-05-23).
 *
 * These tests mock global.fetch and assert URL, method, headers, body, and
 * graceful failure modes — never throw for the caller.
 */

import assert from 'node:assert/strict'
import test, { afterEach, beforeEach } from 'node:test'

import { getDurableSearchResult, putDurableSearchResult } from '../lib/durable-search-cache.ts'

type FetchCall = { url: string; init: RequestInit }

let calls: FetchCall[] = []
let mockResponse: { status: number; body: unknown } = { status: 200, body: {} }
const originalFetch = globalThis.fetch
const originalEnv = { ...process.env }

beforeEach(() => {
  calls = []
  mockResponse = { status: 200, body: {} }
  process.env.LETSFG_API_URL = 'https://api.test.local'
  process.env.LETSFG_WEBSITE_API_KEY = 'test-website-key'
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: input.toString(), init })
    return {
      ok: mockResponse.status >= 200 && mockResponse.status < 300,
      status: mockResponse.status,
      json: async () => mockResponse.body,
      text: async () => JSON.stringify(mockResponse.body),
    } as unknown as Response
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
  process.env = { ...originalEnv }
})

// ── GET ──────────────────────────────────────────────────────────────────────

test('getDurableSearchResult returns the cached payload on 200', async () => {
  const payload = {
    search_id: 'ws_xyz',
    status: 'completed',
    offers: [{ id: 'wo_001' }, { id: 'wo_002' }],
  }
  mockResponse = { status: 200, body: { search_id: 'ws_xyz', status: 'completed', payload } }

  const result = await getDurableSearchResult('ws_xyz')
  assert.notEqual(result, null)
  assert.equal(result!.status, 'completed')
  assert.equal(result!.offers.length, 2)
})

test('getDurableSearchResult hits the correct URL with website api key', async () => {
  mockResponse = { status: 200, body: { search_id: 'ws_a', status: 'completed', payload: { status: 'completed' } } }
  await getDurableSearchResult('ws_a')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://api.test.local/api/v1/internal/search-cache/ws_a')
  assert.equal((calls[0].init.method ?? 'GET').toUpperCase(), 'GET')
  const headers = calls[0].init.headers as Record<string, string>
  assert.equal(headers['X-API-Key'], 'test-website-key')
})

test('getDurableSearchResult returns null on 404 (miss)', async () => {
  mockResponse = { status: 404, body: { detail: 'No cached result' } }
  const result = await getDurableSearchResult('ws_missing')
  assert.equal(result, null)
})

test('getDurableSearchResult returns null on 5xx (graceful fallback)', async () => {
  mockResponse = { status: 502, body: { detail: 'Bad gateway' } }
  const result = await getDurableSearchResult('ws_err')
  assert.equal(result, null)
})

test('getDurableSearchResult returns null when fetch throws (network error)', async () => {
  globalThis.fetch = (async () => { throw new Error('ECONNREFUSED') }) as typeof fetch
  const result = await getDurableSearchResult('ws_unreachable')
  assert.equal(result, null)
})

test('getDurableSearchResult URL-encodes the search_id', async () => {
  mockResponse = { status: 404, body: {} }
  await getDurableSearchResult('ws/needs encoding')
  assert.equal(calls[0].url, 'https://api.test.local/api/v1/internal/search-cache/ws%2Fneeds%20encoding')
})

// ── PUT ──────────────────────────────────────────────────────────────────────

test('putDurableSearchResult posts the payload with PUT and correct shape', async () => {
  mockResponse = { status: 200, body: { stored: true } }
  const payload = { search_id: 'ws_x', status: 'completed', offers: [] }
  await putDurableSearchResult('ws_x', payload)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://api.test.local/api/v1/internal/search-cache/ws_x')
  assert.equal((calls[0].init.method ?? '').toUpperCase(), 'PUT')
  const body = JSON.parse(calls[0].init.body as string)
  assert.deepEqual(body, { payload })
  const headers = calls[0].init.headers as Record<string, string>
  assert.equal(headers['X-API-Key'], 'test-website-key')
  assert.equal(headers['Content-Type'], 'application/json')
})

test('putDurableSearchResult does NOT throw on backend error (fire-and-forget)', async () => {
  mockResponse = { status: 500, body: { detail: 'boom' } }
  await putDurableSearchResult('ws_x', { search_id: 'ws_x', status: 'completed' })
  // Reaching here without throw means graceful.
})

test('putDurableSearchResult does NOT throw on network error', async () => {
  globalThis.fetch = (async () => { throw new Error('ETIMEDOUT') }) as typeof fetch
  await putDurableSearchResult('ws_x', { search_id: 'ws_x', status: 'completed' })
})

test('putDurableSearchResult refuses to store non-completed payloads', async () => {
  await putDurableSearchResult('ws_x', { search_id: 'ws_x', status: 'searching' })
  // Should NOT have made any fetch call — guard rejects locally.
  assert.equal(calls.length, 0)
})
