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

test('rank route proxies Gemini generation to backend website API', () => {
  const routeSource = readSource('app/api/rank/route.ts')

  assert.match(routeSource, /import \{ getLetsfgApiBase, withLetsfgWebsiteApiHeaders \} from '\.\.\/\.\.\/\.\.\/lib\/letsfg-api'/)
  assert.match(routeSource, /fetch\(`\$\{getLetsfgApiBase\(\)\}\/api\/v1\/flights\/rank-copy`, \{/)
  assert.match(routeSource, /headers: withLetsfgWebsiteApiHeaders\(\{ 'Content-Type': 'application\/json' \}\)/)
  assert.doesNotMatch(routeSource, /GEMINI_API_KEY/)
  assert.doesNotMatch(routeSource, /metadata\.google\.internal/)
  assert.doesNotMatch(routeSource, /execSync\(/)
})

test('checkout screenshot verification flow is fully retired', () => {
  const checkoutSource = readSource('app/book/[offerId]/CheckoutPanel.tsx')

  assert.doesNotMatch(checkoutSource, /verify-share/)
  assert.doesNotMatch(checkoutSource, /share-upload|share-verifying|share-rejected|share-select/)
  assert.equal(fs.existsSync(path.join(WEBSITE_ROOT, 'app/api/checkout/verify-share/route.ts')), false)
  assert.equal(fs.existsSync(path.join(WEBSITE_ROOT, 'app/api/checkout/share-token/route.ts')), false)
})