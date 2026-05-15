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

  assert.match(checkoutPanel, /CHECKOUT_UNLOCK_PATH_EXPERIMENT_ID = 'exp_checkout-unlock-path-v1'/)
  assert.match(
    checkoutPanel,
    /const CHECKOUT_UNLOCK_PATH_EXPERIMENT: ExperimentConfig<CheckoutUnlockPathVariant> = \{\s*id: CHECKOUT_UNLOCK_PATH_EXPERIMENT_ID,\s*variants: \{ share_and_pay: 0\.5, payment_only: 0\.5 \},\s*\}/s,
  )
  assert.match(
    checkoutPanel,
    /const \{ variant: unlockPathVariant \} = useExperiment\(CHECKOUT_UNLOCK_PATH_EXPERIMENT, analyticsSearchId\)/,
  )
  assert.match(
    checkoutPanel,
    /function shouldShowShareUnlockOption\(variant: CheckoutUnlockPathVariant \| null\) \{\s*return variant === 'share_and_pay'\s*\}/s,
  )
  assert.match(checkoutPanel, /const showShareOption = shouldShowShareUnlockOption\(unlockPathVariant\)/)
  assert.match(checkoutPanel, /const handleSelectPlatform = useCallback\(\(platform: Platform\) => \{\s*if \(!showShareOption\) return/s)
  assert.match(checkoutPanel, /const handleVerify = useCallback\(async \(\) => \{\s*if \(!showShareOption \|\| !uploadedFile \|\| step\.type !== 'share-upload'\) return/s)
})