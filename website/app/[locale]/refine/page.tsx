import { cookies, headers } from 'next/headers'
import { LETSFG_CURRENCY_COOKIE, resolveSearchCurrency } from '../../../lib/currency-preference'
import { detectPreferredCurrency } from '../../../lib/user-currency'
import { isProbeModeValue } from '../../../lib/probe-mode'
import RefineClient from './RefineClient'

export const dynamic = 'force-dynamic'

interface RefinePageProps {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ q?: string; cur?: string; probe?: string }>
}

export default async function RefinePage({ params, searchParams }: RefinePageProps) {
  const { locale } = await params
  const { q, cur, probe } = await searchParams
  const isProbe = isProbeModeValue(probe)
  const requestHeaders = await headers()
  const cookieStore = await cookies()
  const initialCurrency = resolveSearchCurrency({
    queryParam: cur?.trim(),
    cookieValue: cookieStore.get(LETSFG_CURRENCY_COOKIE)?.value,
    fallback: detectPreferredCurrency(requestHeaders),
  })

  return (
    <RefineClient
      query={q?.trim() ?? ''}
      locale={locale}
      initialCurrency={initialCurrency}
      probeMode={isProbe}
    />
  )
}
