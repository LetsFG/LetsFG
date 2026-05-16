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

test('checkout unlock experiment routes half of traffic to payment-only', () => {
  const checkoutPanel = readSource('app/book/[offerId]/CheckoutPanel.tsx')

  assert.ok(!checkoutPanel.includes('CHECKOUT_UNLOCK_PATH_EXPERIMENT_ID'))
  assert.ok(!checkoutPanel.includes('CHECKOUT_UNLOCK_PATH_EXPERIMENT'))
  assert.ok(checkoutPanel.includes('const showShareOption = false'))
  assert.match(checkoutPanel, /!isUnlocked && !isLoading && showShareOption && step\.type !== 'paying'/)
})