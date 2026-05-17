import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { resolveHomeOriginFromCoordinates } from '../lib/home-origin-prefill.ts'

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url))
const WEBSITE_ROOT = path.resolve(TEST_DIR, '..')

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(WEBSITE_ROOT, relativePath), 'utf8')
}

test('home origin prefill maps Bytow coordinates to Gdansk as the nearest airport city', () => {
  const resolved = resolveHomeOriginFromCoordinates(54.1708, 17.4919, 'en')

  assert.ok(resolved)
  assert.equal(resolved?.code, 'GDN')
  assert.equal(resolved?.label, 'Gdansk')
})

test('homepage passes the detected origin into the search form and keeps the richer ghost hint scoped to untouched auto-prefills', () => {
  const pageSource = readSource('app/[locale]/page.tsx')
  const formSource = readSource('app/home-search-form.tsx')

  assert.match(pageSource, /resolveHomeOriginPrefill\(requestHeaders, locale\)\?\.label \|\| ''/)
  assert.match(pageSource, /initialDetectedOrigin=\{initialDetectedOrigin\}/)

  assert.match(formSource, /initialDetectedOrigin\?: string/)
  assert.match(formSource, /const autoPrefillPristine = !!autoPrefillOrigin/)
  assert.match(formSource, /buildAutoPrefillGhostSuffix\(locale, heroPlaceholder\)/)
  assert.match(formSource, /if \(autoPrefillPristine\) \{/)
})