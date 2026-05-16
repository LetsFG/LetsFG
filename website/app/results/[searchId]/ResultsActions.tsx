'use client'

import { useState } from 'react'

interface ResultsActionsProps {
  sharePath?: string
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" width="18" height="18" aria-hidden="true">
      <path
        d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline
        points="16,6 12,2 8,6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line
        x1="12"
        y1="2"
        x2="12"
        y2="15"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch (_) {
    const input = document.createElement('input')
    input.value = text
    document.body.appendChild(input)
    input.select()
    const copied = document.execCommand('copy')
    document.body.removeChild(input)
    return copied
  }
}

export default function ResultsActions({ sharePath }: ResultsActionsProps) {
  const [shareState, setShareState] = useState<'idle' | 'copied'>('idle')

  async function handleShare() {
    const url = sharePath
      ? new URL(sharePath, window.location.origin).toString()
      : window.location.href
    const shareData = {
      title: document.title,
      url,
    }

    if (typeof navigator.share === 'function') {
      try {
        if (typeof navigator.canShare !== 'function' || navigator.canShare(shareData)) {
          await navigator.share(shareData)
          return
        }
      } catch (error) {
        if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'NotAllowedError')) {
          return
        }
      }
    }

    const copied = await copyToClipboard(url)
    if (!copied) return

    setShareState('copied')
    setTimeout(() => setShareState('idle'), 2500)
  }

  return (
    <button
      type="button"
      className={`rf-share-btn${shareState === 'copied' ? ' rf-share-btn--copied' : ''}`}
      onClick={handleShare}
      aria-label={shareState === 'copied' ? 'Search link copied' : 'Share search'}
      title={shareState === 'copied' ? 'Search link copied' : 'Share search'}
    >
      <span className="rf-share-btn-icon" aria-hidden="true">
        <ShareIcon />
      </span>
      <span className="rf-share-btn-label">{shareState === 'copied' ? 'Copied!' : 'Share'}</span>
    </button>
  )
}
