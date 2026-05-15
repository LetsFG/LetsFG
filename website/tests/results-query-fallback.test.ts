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

test('results page prefers the explicit rerun query before falling back to result or parsed data', () => {
  const source = readSource('app/results/[searchId]/page.tsx')

  assert.match(
    source,
    /function buildFallbackSearchQuery\(parsed: SearchResult\['parsed'\]\): string \{[\s\S]*const origin = parsed\.origin \|\| parsed\.origin_name[\s\S]*const destination = parsed\.destination \|\| parsed\.destination_name[\s\S]*const parts = \[`\$\{origin\} to \$\{destination\}`\][\s\S]*if \(parsed\.date\) parts\.push\(parsed\.date\)[\s\S]*if \(parsed\.return_date\) parts\.push\(`return \$\{parsed\.return_date\}`\)[\s\S]*return parts\.join\(' '\)\.trim\(\)[\s\S]*\}/,
  )

  assert.match(
    source,
    /const query = sp\?\.q\?\.trim\(\) \|\| resultQuery\?\.trim\(\) \|\| buildFallbackSearchQuery\(parsed\)/,
  )
})