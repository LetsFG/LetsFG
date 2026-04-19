'use client'
import { useEffect, useRef } from 'react'

export default function HeroBgVideo() {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    let rafId: number
    let lastTs: number | null = null

    const reverse = (ts: number) => {
      if (lastTs !== null) {
        const delta = (ts - lastTs) / 1000
        video.currentTime = Math.max(0, video.currentTime - delta)
      }
      lastTs = ts
      if (video.currentTime > 0) {
        rafId = requestAnimationFrame(reverse)
      } else {
        lastTs = null
        video.play()
      }
    }

    const onEnded = () => {
      lastTs = null
      rafId = requestAnimationFrame(reverse)
    }

    video.addEventListener('ended', onEnded)
    return () => {
      video.removeEventListener('ended', onEnded)
      cancelAnimationFrame(rafId)
    }
  }, [])

  return (
    <video
      ref={videoRef}
      className="lp-hero-sky"
      src="/hero-bg.mp4"
      autoPlay
      muted
      playsInline
      aria-hidden="true"
    />
  )
}
