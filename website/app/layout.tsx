import type { ReactNode } from 'react'
import { headers } from 'next/headers'
import { Lexend, JetBrains_Mono, Caveat } from 'next/font/google'
import Script from 'next/script'
import './globals.css'

const GA_ID = 'G-C5G5EJS81G'

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
    <html lang={locale} className={`${lexend.variable} ${jetbrainsMono.variable} ${caveat.variable}`}>
      <body>{children}</body>
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

