import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  RESULTS_LOCALE_QUERY_PARAM,
  buildLocaleHomePath,
  resolveLocaleCookieValue,
  resolveLocaleSearchParamValue,
  setResultsLocaleSearchParam,
} from '../lib/locale-routing.ts'

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url))
const WEBSITE_ROOT = path.resolve(TEST_DIR, '..')

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(WEBSITE_ROOT, relativePath), 'utf8')
}

test('locale cookie resolution honors LetsFG and next-intl cookies', () => {
  assert.equal(resolveLocaleCookieValue((name) => ({ LETSFG_LOCALE: 'ja' }[name])), 'ja')
  assert.equal(resolveLocaleCookieValue((name) => ({ NEXT_LOCALE: 'zh' }[name])), 'zh')
  assert.equal(resolveLocaleCookieValue((name) => ({ LETSFG_LOCALE: 'xx', NEXT_LOCALE: 'pl' }[name])), 'pl')
  assert.equal(resolveLocaleCookieValue(() => undefined), null)
  assert.equal(resolveLocaleSearchParamValue('ja'), 'ja')
  assert.equal(resolveLocaleSearchParamValue('xx'), null)

  const jaParams = new URLSearchParams('q=tokyo')
  setResultsLocaleSearchParam(jaParams, 'ja')
  assert.equal(jaParams.get(RESULTS_LOCALE_QUERY_PARAM), 'ja')

  const enParams = new URLSearchParams('q=tokyo&hl=ja')
  setResultsLocaleSearchParam(enParams, 'en')
  assert.equal(enParams.get(RESULTS_LOCALE_QUERY_PARAM), null)

  assert.equal(buildLocaleHomePath('ja', false), '/ja')
  assert.equal(buildLocaleHomePath('ja', true), '/ja?probe=1')
  assert.equal(buildLocaleHomePath('xx', true), '/en?probe=1')
})

test('results routing reuses locale helpers instead of hardcoded English fallbacks', () => {
  const requestSource = readSource('i18n/request.ts')
  const proxySource = readSource('proxy.ts')
  const localePageSource = readSource('app/[locale]/page.tsx')
  const homeSearchSource = readSource('app/home-search-form.tsx')
  const resultsPageSource = readSource('app/results/page.tsx')
  const searchPageClientSource = readSource('app/results/[searchId]/SearchPageClient.tsx')
  const resultsLoadingSource = readSource('app/results/loading.tsx')
  const searchLoadingSource = readSource('app/results/[searchid]/loading.tsx')
  const exploreSource = readSource('app/results/explore/[searchid]/ExplorePageClient.tsx')
  const currencySource = readSource('app/currency-button.tsx')
  const globeSource = readSource('app/globe-button.tsx')

  assert.match(requestSource, /resolveLocaleCookieValue\(/)
  assert.match(proxySource, /resolveLocaleCookieValue\(/)
  assert.match(proxySource, /resolveLocaleSearchParamValue\(/)
  assert.match(localePageSource, /setResultsLocaleSearchParam\(/)
  assert.match(homeSearchSource, /setResultsLocaleSearchParam\(/)
  assert.match(resultsPageSource, /setResultsLocaleSearchParam\(/)
  assert.match(searchPageClientSource, /setResultsLocaleSearchParam\(/)
  assert.match(currencySource, /setResultsLocaleSearchParam\(/)

  assert.match(resultsPageSource, /buildLocaleHomePath\(/)
  assert.match(resultsLoadingSource, /buildLocaleHomePath\(/)
  assert.match(searchLoadingSource, /buildLocaleHomePath\(/)
  assert.match(exploreSource, /buildLocaleHomePath\(/)
  assert.match(globeSource, /const locale = useLocale\(\)/)

  assert.doesNotMatch(resultsPageSource, /const homeHref = isProbe \? '\/en\?probe=1' : '\/en'/)
  assert.doesNotMatch(resultsLoadingSource, /<Link href="\/en"/)
  assert.doesNotMatch(searchLoadingSource, /<Link href="\/en"/)
  assert.doesNotMatch(exploreSource, /<Link href="\/en"/)
})