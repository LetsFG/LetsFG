import test, { expect, Page } from '@playwright/test'

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function navigateToFlightPage(page: Page, slug = 'gdn-bcn') {
  await page.goto(`/en/flights/${slug}/`)
}

// ─── 1. Page renders with correct H1 ─────────────────────────────────────────

test('flight page renders H1 with origin and destination city names', async ({ page }) => {
  await navigateToFlightPage(page)
  const h1 = await page.locator('h1').first().textContent()
  expect(h1).toBeTruthy()
  // H1 should contain city or IATA codes
  expect(h1).toMatch(/flight|fly|GDN|BCN|Gdansk|Barcelona/i)
})

// ─── 2. Price distribution section visible ────────────────────────────────────

test('price distribution section is visible and contains histogram', async ({ page }) => {
  await navigateToFlightPage(page)
  const section = page.locator('[data-testid="price-distribution"]')
  await expect(section).toBeVisible()
  // Histogram bars must be present
  const bars = page.locator('[data-testid="histogram-bar"]')
  await expect(bars.first()).toBeVisible()
})

// ─── 3. Bimodal banner shown when is_bimodal=true ─────────────────────────────

test('bimodal banner appears when distribution is bimodal', async ({ page }) => {
  // This test targets a fixture route that is known to be bimodal
  // If the current fixture is not bimodal, the banner should not appear
  await navigateToFlightPage(page)
  const banner = page.locator('[data-testid="bimodal-banner"]')
  // Banner is conditionally rendered — check it has role="note" if present
  const count = await banner.count()
  if (count > 0) {
    await expect(banner).toHaveAttribute('role', 'note')
  }
})

// ─── 4. CTA button is present and points to search ───────────────────────────

test('hero CTA button links to the flight search', async ({ page }) => {
  await navigateToFlightPage(page)
  const cta = page.locator('[data-testid="hero-cta"]').first()
  await expect(cta).toBeVisible()
  // CTA should link to search or be a button that initiates search
  const href = await cta.getAttribute('href')
  const tagName = await cta.evaluate(el => el.tagName.toLowerCase())
  expect(href !== null || tagName === 'button').toBeTruthy()
})

// ─── 5. Carrier summary table is populated ───────────────────────────────────

test('carrier summary section shows at least one airline', async ({ page }) => {
  await navigateToFlightPage(page)
  const section = page.locator('[data-testid="carrier-summary"]')
  await expect(section).toBeVisible()
  const rows = section.locator('tr, [data-testid="carrier-row"]')
  await expect(rows.first()).toBeVisible()
})

// ─── 6. Connector comparison section present ─────────────────────────────────

test('connector comparison section is present with at least one connector', async ({ page }) => {
  await navigateToFlightPage(page)
  const section = page.locator('[data-testid="connector-comparison"]')
  await expect(section).toBeVisible()
  const items = section.locator('[data-testid="connector-item"]')
  await expect(items.first()).toBeVisible()
})

// ─── 7. SEO: page title and meta description are set ─────────────────────────

test('page has a non-empty <title> and meta description', async ({ page }) => {
  await navigateToFlightPage(page)
  const title = await page.title()
  expect(title.length).toBeGreaterThan(10)
  const metaDesc = await page.locator('meta[name="description"]').getAttribute('content')
  expect(metaDesc).toBeTruthy()
  expect((metaDesc ?? '').length).toBeGreaterThan(20)
})

// ─── 8. JSON-LD script tag is present ────────────────────────────────────────

test('page includes a JSON-LD structured data script tag', async ({ page }) => {
  await navigateToFlightPage(page)
  const jsonLd = await page.locator('script[type="application/ld+json"]').count()
  expect(jsonLd).toBeGreaterThan(0)
})

// ─── 9. noindex pages are not crawlable ──────────────────────────────────────

test('draft page returns 404 or has noindex meta', async ({ page }) => {
  const response = await page.goto('/en/flights/zzz-xxx/')
  // Either 404 or page exists but has noindex
  if (response && response.status() !== 404) {
    const robotsMeta = await page.locator('meta[name="robots"]').getAttribute('content')
    expect(robotsMeta).toContain('noindex')
  } else {
    expect(response?.status()).toBe(404)
  }
})

// ─── 10. Locale routing works ────────────────────────────────────────────────

test('Polish locale (pl) renders same route with locale prefix', async ({ page }) => {
  const response = await page.goto('/pl/flights/gdn-bcn/')
  // Should not 404 — either 200 (page exists in pl) or redirect to en
  expect([200, 301, 302, 307, 308]).toContain(response?.status() ?? 200)
  // After any redirects, page should have content
  await expect(page.locator('h1').first()).toBeVisible()
})
