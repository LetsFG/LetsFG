/** End-to-end: site allCards+sortCards vs plugin prepareRaw+summarizeOffers+sortOffers. */
import { sortCards, type SortMode } from './app/flow/FlowResults'
import { deduplicateOffers, type RankOffer } from './app/lib/rankOffers'
import { applyOfferMarkup } from './lib/pricing'
import { createRequire } from 'node:module'
import fs from 'node:fs'
const require_ = createRequire(import.meta.url)
const Model = require_('C:/Users/Adam/Desktop/omarchy-plugin-letsfg/Model.js')
const Ranking = require_('C:/Users/Adam/Desktop/omarchy-plugin-letsfg/assets/ranking.js')

const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const offers = data.offers || []
console.log('raw offers:', offers.length)

// ---- SITE: allCards
const sDedup = deduplicateOffers(offers as unknown as RankOffer[]) as any[]
const sList = sDedup
  // rawToCard applies the markup, and the site SORTS on that rounded number.
  .map((o: any) => ({ id: o.id, price: applyOfferMarkup(Number(o.price) || 0), durationMin: o.duration_minutes ?? 0, stops: o.stops ?? 0, segments: [] }))
  .filter((c: any) => c.price > 0)
  .sort((a: any, b: any) => a.price - b.price)
const seen = new Set<string>()
const siteCards = sList.filter((c: any) => (seen.has(c.id) ? false : (seen.add(c.id), true)))

// ---- PLUGIN: prepareRaw -> summarizeOffers
let pDedup = Ranking.deduplicateOffers(offers)
if (!Array.isArray(pDedup) || pDedup.length === 0) pDedup = offers
const pluginShaped = Model.summarizeOffers({ offers: Model.dedupePricedOffers(pDedup) })

console.log(`site cards: ${siteCards.length}   plugin cards: ${pluginShaped.length}   ${siteCards.length === pluginShaped.length ? 'COUNTS MATCH' : 'COUNTS DIFFER'}`)

let allSame = siteCards.length === pluginShaped.length
for (const mode of ['best', 'cheapest', 'fastest'] as SortMode[]) {
  const a = sortCards(siteCards as any, mode).map((c: any) => c.id)
  const b = Model.sortOffers(pluginShaped, mode).map((o: any) => o.offerId)
  const same = a.join(',') === b.join(',')
  if (!same) allSame = false
  let d = -1
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) { d = i; break }
  console.log(`  ${mode.padEnd(9)} ${same ? 'IDENTICAL' : 'DIFFERENT at ' + d}`)
  if (mode === 'best') {
    console.log('    site top3  :', a.slice(0, 3).map((x: string) => {
      const o = offers.find((z: any) => z.id === x) || {}; return `${o.airline} ${o.price} ${o.stops}st ${o.duration_minutes}m` }).join(' | '))
    console.log('    plugin top3:', b.slice(0, 3).map((x: string) => {
      const o = offers.find((z: any) => z.id === x) || {}; return `${o.airline} ${o.price} ${o.stops}st ${o.duration_minutes}m` }).join(' | '))
  }
}
console.log(allSame ? '\nPIPELINE PARITY: identical' : '\nPIPELINE PARITY: NOT identical')
