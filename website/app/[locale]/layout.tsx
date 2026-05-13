import type { Metadata } from 'next'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { routing } from '../../i18n/routing'
import LocaleCookieSyncer from './LocaleCookieSyncer'

export async function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'meta' })

  return {
    title: t('title'),
    description: t('description'),
    openGraph: {
      title: t('title'),
      description: t('description'),
      siteName: 'LetsFG',
      images: [
        {
          url: '/og-v2.png',
          width: 1400,
          height: 760,
          alt: t('title'),
        },
      ],
      locale: locale.replace('-', '_'),
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: t('title'),
      description: t('description'),
      images: ['/og-v2.png'],
    },
    icons: {
      icon: '/logo.png',
      apple: '/logo.png',
    },
    robots: {
      index: true,
      follow: true,
    },
  }
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params

  if (!routing.locales.includes(locale as (typeof routing.locales)[number])) {
    notFound()
  }

  // Locale layout owns html/body/provider so messages re-load on every locale change.
  const messages = await getMessages()

  return (
    <NextIntlClientProvider messages={messages}>
      <LocaleCookieSyncer locale={locale} />
      {children}
    </NextIntlClientProvider>
  )
}
