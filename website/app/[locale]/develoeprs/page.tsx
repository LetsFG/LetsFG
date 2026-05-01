import { redirect } from 'next/navigation'

export default async function DevelopersTypoLocaleRedirectPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  redirect(`/${locale}/developers`)
}