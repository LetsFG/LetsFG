import type { ReactNode } from 'react'
import { Caveat, Lexend, JetBrains_Mono } from 'next/font/google'
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

const caveat = Caveat({
  subsets: ['latin'],
  variable: '--font-script',
  display: 'swap',
})

export default function BookLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${lexend.variable} ${jetbrainsMono.variable} ${caveat.variable}`}>
      <body>{children}</body>
    </html>
  )
}
