'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// __lfg_js is a JS-only cookie — only this component sets it, never the server.
// The server gate in results/page.tsx checks for it instead of __session.
// A Level-2 bot (cookie-persistent, no JS) can acquire __session by hitting /
// but can never set __lfg_js, so it gets the skeleton forever.
// sessionStorage guards against infinite refresh loops if cookies are blocked.
export default function NoCookieBootstrap() {
  const router = useRouter()
  useEffect(() => {
    const key = '__lfg_boot'
    if (sessionStorage.getItem(key)) return
    sessionStorage.setItem(key, '1')
    document.cookie = '__lfg_js=1; path=/; max-age=31536000; SameSite=Lax'
    router.refresh()
  }, [router])
  return null
}
