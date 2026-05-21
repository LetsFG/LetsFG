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

test('CTA section appears before comparison table in checkout JSX', () => {
  const panel = readSource('app/book/[offerId]/CheckoutPanel.tsx')
  const ctaIdx = panel.indexOf('ck-cta-section')
  const elsewhereIdx = panel.indexOf('ck-elsewhere')
  assert.ok(ctaIdx !== -1, 'ck-cta-section class not found')
  assert.ok(elsewhereIdx !== -1, 'ck-elsewhere class not found')
  assert.ok(ctaIdx < elsewhereIdx, `CTA section (pos ${ctaIdx}) must appear before comparison table (pos ${elsewhereIdx}) in JSX`)
})

test('"LetsFG total" hardcoded string does not appear in checkout', () => {
  const panel = readSource('app/book/[offerId]/CheckoutPanel.tsx')
  assert.ok(
    !panel.includes('LetsFG total'),
    '"LetsFG total" should not appear as a hardcoded string — use t(\'yourPrice\') instead',
  )
})

test('Guarantee row appears before comparison table in checkout JSX', () => {
  const panel = readSource('app/book/[offerId]/CheckoutPanel.tsx')
  const guaranteeIdx = panel.indexOf('ck-guarantee-row')
  const elsewhereIdx = panel.indexOf('ck-elsewhere')
  assert.ok(guaranteeIdx !== -1, 'ck-guarantee-row class not found')
  assert.ok(elsewhereIdx !== -1, 'ck-elsewhere class not found')
  assert.ok(guaranteeIdx < elsewhereIdx, `Guarantee row (pos ${guaranteeIdx}) must appear before comparison table (pos ${elsewhereIdx})`)
})

test('Competitor comparison uses real site names', () => {
  const panel = readSource('app/book/[offerId]/CheckoutPanel.tsx')
  assert.ok(panel.includes('Skyscanner'), 'Skyscanner should appear in comparison table')
  assert.ok(panel.includes('Expedia'), 'Expedia should appear in comparison table')
  assert.ok(panel.includes('Booking.com'), 'Booking.com should appear in comparison table')
  assert.ok(!panel.includes('Popular flight aggregator'), '"Popular flight aggregator" generic label should be removed')
  assert.ok(!panel.includes('Leading booking platform'), '"Leading booking platform" generic label should be removed')
  assert.ok(!panel.includes('Full-service travel site'), '"Full-service travel site" generic label should be removed')
})

test('yourPrice i18n key used in comparison table and defined in en.json', () => {
  const panel = readSource('app/book/[offerId]/CheckoutPanel.tsx')
  assert.ok(panel.includes("t('yourPrice')"), "t('yourPrice') translation key should be used in comparison table")
  const messages = JSON.parse(readSource('messages/en.json')) as { Checkout?: { yourPrice?: string } }
  assert.ok(
    typeof messages.Checkout?.yourPrice === 'string' && messages.Checkout.yourPrice.length > 0,
    'yourPrice key must be defined in en.json Checkout namespace',
  )
})

test('Promo code input is hidden behind a showPromo toggle', () => {
  const panel = readSource('app/book/[offerId]/CheckoutPanel.tsx')
  assert.ok(panel.includes('showPromo'), 'showPromo state variable must exist')
  assert.ok(panel.includes('ck-promo-toggle'), 'ck-promo-toggle class must be used for the collapsed toggle button')
  const promoInputIdx = panel.indexOf('ck-promo-input')
  const showPromoConditionalIdx = panel.indexOf('showPromo ?')
  assert.ok(promoInputIdx !== -1, 'ck-promo-input must still exist')
  assert.ok(showPromoConditionalIdx !== -1, 'showPromo ternary/conditional must exist')
  assert.ok(showPromoConditionalIdx < promoInputIdx, `showPromo conditional (pos ${showPromoConditionalIdx}) must guard the promo input (pos ${promoInputIdx})`)
})

test('Confirmation header is present in checkout JSX', () => {
  const panel = readSource('app/book/[offerId]/CheckoutPanel.tsx')
  assert.ok(panel.includes('ck-confirm-header'), 'ck-confirm-header class must be present')
})

test('Flight card has collapsible details controlled by showFlightDetails', () => {
  const panel = readSource('app/book/[offerId]/CheckoutPanel.tsx')
  assert.ok(panel.includes('showFlightDetails'), 'showFlightDetails state variable must exist')
  assert.ok(panel.includes('ck-flight-toggle'), 'ck-flight-toggle class must be present for the expand/collapse button')
})

test('Why-better explanation covers both direct sourcing and community fee', () => {
  const panel = readSource('app/book/[offerId]/CheckoutPanel.tsx')
  assert.ok(panel.includes("t('whyBetterNote')"), "t('whyBetterNote') key must be used in the comparison section")
  const messages = JSON.parse(readSource('messages/en.json')) as { Checkout?: { whyBetterNote?: string } }
  const copy = messages.Checkout?.whyBetterNote ?? ''
  assert.ok(copy.length > 0, 'whyBetterNote must be defined in en.json')
  // Must mention direct sourcing (no markup angle)
  assert.ok(
    /direct|markup|inflation|commission/i.test(copy),
    'whyBetterNote must mention direct sourcing / no markup',
  )
  // Must mention the fee purpose (community / service)
  assert.ok(
    /fee|community|service|keep/i.test(copy),
    'whyBetterNote must explain what the fee is for',
  )
})

test('Risk-reversal guarantee element is present in CTA section', () => {
  const panel = readSource('app/book/[offerId]/CheckoutPanel.tsx')
  assert.ok(panel.includes('ck-risk-reversal'), 'ck-risk-reversal class must be present')
  assert.ok(panel.includes("t('refundGuarantee')"), "t('refundGuarantee') key must be used")
  const messages = JSON.parse(readSource('messages/en.json')) as { Checkout?: { refundGuarantee?: string } }
  const copy = messages.Checkout?.refundGuarantee ?? ''
  assert.ok(copy.length > 0, 'refundGuarantee must be defined in en.json')
  // Must convey refund / guarantee
  assert.ok(
    /refund|guarantee|money.back|make it right|not happy/i.test(copy),
    'refundGuarantee copy must convey a refund/guarantee promise',
  )
})

test('Risk-reversal guarantee appears inside CTA section (before checkout card)', () => {
  const panel = readSource('app/book/[offerId]/CheckoutPanel.tsx')
  const ctaSectionEnd = panel.indexOf('ck-checkout-card')
  const riskReversalIdx = panel.indexOf('ck-risk-reversal')
  assert.ok(riskReversalIdx !== -1, 'ck-risk-reversal must exist')
  assert.ok(
    riskReversalIdx < ctaSectionEnd,
    `ck-risk-reversal (pos ${riskReversalIdx}) must appear before ck-checkout-card (pos ${ctaSectionEnd})`,
  )
})
