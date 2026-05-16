import { PrivacyPolicyPage, privacyMetadata, resolveLegalLocale } from '../../legal-pages'

export const metadata = privacyMetadata

export default async function LocalizedPrivacyPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params

  return <PrivacyPolicyPage locale={resolveLegalLocale(locale)} />
}