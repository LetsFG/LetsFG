import { TermsPage, resolveLegalLocale, termsMetadata } from '../../legal-pages'

export const metadata = termsMetadata

export default async function LocalizedTermsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params

  return <TermsPage locale={resolveLegalLocale(locale)} />
}