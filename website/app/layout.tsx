import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { headers } from 'next/headers'
import { Lexend, JetBrains_Mono, Caveat } from 'next/font/google'
import Script from 'next/script'
import GaNavigationTracker from './ga-navigation-tracker'
import './globals.css'

const GA_ID = 'G-C5G5EJS81G'
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://letsfg.co'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: 'LetsFG',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/logo.png',
    shortcut: '/logo.png',
    apple: '/logo.png',
  },
}

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

const caveat = Caveat({
  subsets: ['latin'],
  variable: '--font-script',
  display: 'swap',
})


// Next.js 16 requires html + body in the root layout.
// Locale is read from the x-next-intl-locale header injected by proxy.ts.
export default async function RootLayout({ children }: { children: ReactNode }) {
  const headersList = await headers()
  const locale = headersList.get('x-next-intl-locale') ?? 'en'

  return (
    <html lang={locale} className={`${lexend.variable} ${jetbrainsMono.variable} ${caveat.variable} `}>
      {/* AI agent discovery — these <link> tags are in <head> so agents find them
          before parsing the body. The llms.txt and for-agents URLs contain the
          full native search guide and traffic control instructions. */}
      <head>
        <link rel="alternate" type="text/plain" title="AI Instructions (llms.txt)" href="/llms.txt" />
        <link rel="alternate" type="text/plain" title="Agent Guide" href="/for-agents" />
      </head>
      <body>{children}</body>
      <GaNavigationTracker />
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
      <Script id="ga-init" strategy="afterInteractive">{`
        window.dataLayer = window.dataLayer || [];
        function gtag(){dataLayer.push(arguments);}
        gtag('js', new Date());
        gtag('config', '${GA_ID}');
      `}</Script>
    </html>
  )
}

