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

test('results flow surfaces richer offer detail metadata to cards and Gemini', () => {
  const clientSource = readSource('app/results/[searchId]/SearchPageClient.tsx')
  const panelSource = readSource('app/results/[searchId]/ResultsPanel.tsx')
  const routeSource = readSource('app/api/rank/route.ts')

  assert.match(clientSource, /const requireMeals = !!\(nlParsed\?\.require_meals\)/)
  assert.match(clientSource, /requireMeals=\{requireMeals\}/)

  assert.match(panelSource, /import \{ getOfferDetailBadges \} from '\.\.\/\.\.\/\.\.\/lib\/offer-details'/)
  assert.match(panelSource, /requireMeals\?: boolean/)
  assert.match(panelSource, /const offerDetailBadges = getOfferDetailBadges\(offer\)/)
  assert.match(panelSource, /conditions: r\.offer\.conditions,/)
  assert.match(panelSource, /requireMeals,/)
  assert.match(panelSource, /requireCancellation,/)
  assert.match(panelSource, /rf-card-badge--detail-\$\{badge\.tone\}/)

  assert.match(routeSource, /getOfferDetailPromptNotes/)
  assert.match(routeSource, /FARE DETAILS FROM SEARCH DATA:/)
  assert.match(routeSource, /Meals\/food are ONLY known/)
  assert.match(routeSource, /Wi-Fi, power\/USB, refreshments, or in-flight entertainment are ONLY known/)
  assert.match(routeSource, /Insurance or lounge access are ONLY known/)
  assert.match(routeSource, /cares about meal \/ food availability/)
})