import React from 'react'

// Echo wordmark: the trail mark + "Echo" in the display face. Links to the
// landing page. Colour comes from the surrounding text colour. `as` picks the
// element for the name: the app header uses its page <h1>; the landing page,
// whose <h1> is the hero headline, uses a plain span.
export default function Wordmark({ className = '', as: Name = 'h1', small = false }) {
  return (
    <a
      href="/"
      title="Echo home"
      className={'inline-flex items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber ' + className}
    >
      <svg viewBox="0 0 28 28" className={small ? 'h-6 w-6' : 'h-7 w-7'} fill="none" aria-hidden>
        <path d="M4 22 C9 21 9.5 14 14.5 12.5 S20 9.5 22 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <circle cx="22.6" cy="7.4" r="2.2" fill="currentColor" />
      </svg>
      <Name className={'font-display font-semibold leading-none tracking-tight ' + (small ? 'text-xl' : 'text-2xl')}>Echo</Name>
    </a>
  )
}
