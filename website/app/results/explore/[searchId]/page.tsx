import { Suspense } from 'react'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import {
  LETSFG_CURRENCY_COOKIE,
  resolveSearchCurrency,
  type CurrencyCode,
} from '../../../../lib/currency-preference'
import ExplorePageClient from './ExplorePageClient'

interface Props {
  params: Promise<{ searchId: string }>
  searchParams: Promise<{ q?: string; currency?: string }>
}

export default async function ExploreSearchPage({ params, searchParams }: Props) {
  const { searchId } = await params
  const sp = await searchParams

  if (!searchId || !searchId.startsWith('we_')) notFound()

  const cookieStore = await cookies()
  const cookieCurrency = cookieStore.get(LETSFG_CURRENCY_COOKIE)?.value
  const currency = resolveSearchCurrency({ queryParam: sp.currency, cookieValue: cookieCurrency, fallback: 'EUR' }) as CurrencyCode

  const query = sp.q || ''

  return (
    <Suspense>
      <ExplorePageClient searchId={searchId} query={query} currency={currency} />
    </Suspense>
  )
}

export async function generateMetadata({ searchParams }: Props) {
  const sp = await searchParams
  const query = sp.q || 'Explore flights'
  return {
    title: `${query} — LetsFG`,
    description: `Explore the cheapest destinations with LetsFG.`,
  }
}
