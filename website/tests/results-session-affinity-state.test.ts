import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url))
const WEBSITE_ROOT = path.resolve(TEST_DIR, '..')

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(WEBSITE_ROOT, relativePath), 'utf8')
}

test('results client preserves FSW affinity in the live URL without leaking it into share links', () => {
  const source = readSource('app/results/[searchId]/SearchPageClient.tsx')

  assert.match(source, /fswSession\?: string/)
  assert.match(source, /if \(fswSession\) \{\s*params\.set\('_fss', fswSession\)\s*\}/s)
  assert.match(source, /const activeResultsPath = useMemo\([\s\S]*fswSession: status === 'searching' \? fswSession : undefined,[\s\S]*\)/s)
  assert.match(source, /const nextUrl = new URL\(activeResultsPath, currentUrl\.origin\)/)
  assert.match(source, /sharePath=\{canonicalSharePath\}/)
})