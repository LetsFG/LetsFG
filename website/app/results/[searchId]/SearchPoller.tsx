'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  searchId: string
  isSearching: boolean
  intervalMs?: number
}

/**
 * Invisible component that polls for search completion via router.refresh().
 * router.refresh() re-fetches server data without unmounting client components,
 * so SearchingTasks stays mounted and its animation state is never lost.
 */
export default function SearchPoller({ searchId, isSearching, intervalMs = 7000 }: Props) {
  const router = useRouter()

  useEffect(() => {
    if (!isSearching) return
    const id = setInterval(() => router.refresh(), intervalMs)
    return () => clearInterval(id)
  }, [searchId, isSearching, intervalMs, router])

  return null
}
