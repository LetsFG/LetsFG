'use client'

import { useState } from 'react'

function BookmarkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" width="20" height="20" aria-hidden="true">
      <path
        d="M5 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16l-7-3.5L5 21V5z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" width="20" height="20" aria-hidden="true">
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

export default function ResultsActions() {
  const [saveState, setSaveState] = useState<'idle' | 'hint'>('idle')
  const [shareState, setShareState] = useState<'idle' | 'copied'>('idle')

  function handleSave() {
    setSaveState('hint')
    setTimeout(() => setSaveState('idle'), 3000)
    // Try legacy Firefox API (no-op in Chrome)
    const win = window as unknown as { sidebar?: { addPanel?: (t: string, u: string, e: string) => void } }
    if (win.sidebar?.addPanel) {
      win.sidebar.addPanel(document.title, window.location.href, '')
    }
  }

  async function handleShare() {
    const url = window.location.href
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      // Fallback for browsers without clipboard API
      const el = document.createElement('input')
      el.value = url
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
    }
    setShareState('copied')
    setTimeout(() => setShareState('idle'), 2500)
  }

  return (
    <aside className="rf-sidebar">
      <button
        className="rf-action-btn"
        onClick={handleSave}
        aria-label="Save this search as a bookmark"
      >
        <BookmarkIcon />
        <span className="rf-action-label">
          {saveState === 'hint' ? 'Press\nCtrl+D' : 'Save\nsearch'}
        </span>
      </button>

      <button
        className="rf-action-btn"
        onClick={handleShare}
        aria-label="Copy link to clipboard"
      >
        <ShareIcon />
        <span className="rf-action-label">
          {shareState === 'copied' ? 'Copied!' : 'Share\nsearch'}
        </span>
      </button>
    </aside>
  )
}
