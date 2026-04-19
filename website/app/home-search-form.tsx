'use client'

import { FormEvent, useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

const DESTINATION_KEYS = [
  { key: 'barcelona', code: 'BCN', flag: '/flags/es.svg', img: '/destinations/barcelona.jpg' },
  { key: 'tokyo',     code: 'NRT', flag: '/flags/jp.svg', img: '/destinations/tokyo.jpg' },
  { key: 'newYork',   code: 'JFK', flag: '/flags/us.svg', img: '/destinations/newyork.jpg' },
  { key: 'paris',     code: 'CDG', flag: '/flags/fr.svg', img: '/destinations/paris.jpg' },
  { key: 'bali',      code: 'DPS', flag: '/flags/id.svg', img: '/destinations/bali.jpg' },
  { key: 'dubai',     code: 'DXB', flag: '/flags/ae.svg', img: '/destinations/dubai.jpg' },
] as const

function PlaneIcon() {
  // Font Awesome 6 Free Solid — fa-plane-departure (CC BY 4.0)
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512" aria-hidden="true" className="lp-sf-icon" fill="currentColor">
      <path d="M372 143.9L172.7 40.2c-8-4.1-17.3-4.8-25.7-1.7l-41.1 15c-10.3 3.7-13.8 16.4-7.1 25L200.3 206.4 100.1 242.8 40 206.2c-6.2-3.8-13.8-4.5-20.7-2.1L3 210.1c-9.4 3.4-13.4 14.5-8.3 23.1l53.6 91.8c15.6 26.7 48.1 38.4 77.1 27.8l12.9-4.7 0 0 398.4-145c29.1-10.6 44-42.7 33.5-71.8s-42.7-44-71.8-33.5L372 143.9zM32.2 448c-17.7 0-32 14.3-32 32s14.3 32 32 32l512 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-512 0z"/>
    </svg>
  )
}

export default function HomeSearchForm() {
  const router = useRouter()
  const td = useTranslations('destinations')
  const th = useTranslations('hero')
  const [query, setQuery] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const rowRef = useRef<HTMLDivElement>(null)

  const DESTINATIONS = DESTINATION_KEYS.map((d) => ({
    ...d,
    city: td(d.key),
    query: td(`${d.key}_query`),
  }))

  // Drag-to-scroll
  useEffect(() => {
    const el = rowRef.current
    if (!el) return
    let isDown = false, startX = 0, scrollLeft = 0
    const onDown = (e: PointerEvent) => { isDown = true; startX = e.pageX - el.offsetLeft; scrollLeft = el.scrollLeft; el.setPointerCapture(e.pointerId) }
    const onUp = (e: PointerEvent) => { isDown = false; el.releasePointerCapture(e.pointerId) }
    const onMove = (e: PointerEvent) => { if (!isDown) return; e.preventDefault(); el.scrollLeft = scrollLeft - (e.pageX - el.offsetLeft - startX) }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointermove', onMove)
    return () => { el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointerup', onUp); el.removeEventListener('pointermove', onMove) }
  }, [])

  const handleSearch = async (event: FormEvent) => {
    event.preventDefault()
    if (!query.trim()) return

    setIsLoading(true)

    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim() }),
      })

      if (!response.ok) {
        throw new Error('Search failed')
      }

      const data = await response.json()
      router.push(`/results/${data.search_id}`)
    } catch (error) {
      console.error('Search error:', error)
      setIsLoading(false)
    }
  }

  return (
    <div className="lp-sf-wrap">
      <form onSubmit={handleSearch} className="lp-sf-form">
        <div className="lp-sf-frame">
          <input
            id="trip-query"
            type="text"
            className="lp-sf-input"
            placeholder={th('placeholder')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            disabled={isLoading}
            autoFocus
          />
          <button
            type="submit"
            className="lp-sf-button"
            disabled={isLoading || !query.trim()}
            aria-label={isLoading ? 'Searching flights' : 'Search flights'}
          >
            <PlaneIcon />
          </button>
        </div>
      </form>

      <div className="lp-dest-row" ref={rowRef} aria-label="Popular destinations">
        {DESTINATIONS.map((dest) => (
          <button
            key={dest.code}
            type="button"
            className="lp-dest-card"
            onClick={() => setQuery(dest.query)}
            onMouseMove={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              const x = ((e.clientX - r.left) / r.width  - 0.5) * 7
              const y = ((e.clientY - r.top)  / r.height - 0.5) * 5
              e.currentTarget.style.setProperty('--mx', `${x}px`)
              e.currentTarget.style.setProperty('--my', `${y}px`)
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.setProperty('--mx', '0px')
              e.currentTarget.style.setProperty('--my', '0px')
            }}
          >
            <img src={dest.img} alt={dest.city} className="lp-dest-img" draggable={false} />
            <div className="lp-dest-overlay" />
            <img src={dest.flag} alt="" className="lp-dest-flag" draggable={false} />
            <span className="lp-dest-city">{dest.city}</span>
            <span className="lp-dest-code">{dest.code}</span>
          </button>
        ))}
      </div>
    </div>
  )
}