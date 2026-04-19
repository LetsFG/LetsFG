import type { Metadata } from 'next'
import { Lexend, JetBrains_Mono } from 'next/font/google'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { routing } from '../../i18n/routing'
import '../globals.css'

const lexend = Lexend({
  subsets: ['latin'],
  variable: '--font-lexend',
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
})

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
      title: 'LetsFG — Find cheap flights',
      description: t('description'),
      url: 'https://letsfg.co',
      siteName: 'LetsFG',
      images: [
        {
          url: 'https://raw.githubusercontent.com/LetsFG/LetsFG/main/assets/banner.png',
          width: 1200,
          height: 400,
          alt: 'LetsFG',
        },
      ],
      locale: locale.replace('-', '_'),
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: 'LetsFG — Find cheap flights',
      description: t('description'),
      images: ['https://raw.githubusercontent.com/LetsFG/LetsFG/main/assets/banner.png'],
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
    <html lang={locale} className={`${lexend.variable} ${jetbrainsMono.variable}`}>
      <body>
        <NextIntlClientProvider messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
