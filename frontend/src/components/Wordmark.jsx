import React from 'react'

// Echo wordmark: the trail mark + "Echo" in the display face. Links to the
// landing page.
export default function Wordmark({ className = '' }) {
  return (
    <a
      href="/"
      title="Echo home"
      className={'inline-flex items-center gap-3 rounded-md text-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' + className}
    >
      <svg viewBox="0 0 28 28" className="h-7 w-7" fill="none" aria-hidden>
        <path d="M4 22 C9 21 9.5 14 14.5 12.5 S20 9.5 22 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <circle cx="22.6" cy="7.4" r="2.2" fill="currentColor" />
      </svg>
      <h1 className="font-display text-2xl font-semibold leading-none tracking-tight">Echo</h1>
    </a>
  )
}
