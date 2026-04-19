import type { ReactNode } from 'react'

// Next.js requires a root layout file, but the real layout
// (html, body, fonts, NextIntlClientProvider) lives in
// app/[locale]/layout.tsx so that it re-renders on locale changes.
// Next.js 14+ allows the root layout to simply return children when
// a nested layout provides the html and body tags.
export default function RootLayout({ children }: { children: ReactNode }) {
  return children
}

