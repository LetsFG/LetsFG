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

test('results launch path always merges Gemini intent for new searches and persists parsed context', () => {
  const source = readSource('app/results/page.tsx')

  assert.doesNotMatch(source, /const needsAi =/)
  assert.match(source, /const _ai = !sid \? await vertexParse\(query, today\)\.catch\(\(\) => null\) : null/)
  assert.match(source, /const appliedAi = applyVertexIntent\(parsed, _ai, parsed\.adults \|\| 1\)/)
  assert.match(source, /parsed_context: parsedResponse/)
})