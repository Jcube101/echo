import React from 'react'

// Placeholder landing page (Design v2, session 1 — routing only). The real
// landing page (DESIGN_V2.md §4.1–4.2) replaces this in session 4; it is
// deliberately unstyled beyond the app's existing look.
export default function Landing() {
  return (
    <main className="h-full w-full grid place-items-center bg-ink text-slate-100 px-6">
      <div className="text-center">
        <h1 className="text-4xl font-semibold tracking-tight">Echo</h1>
        <p className="mt-3 text-slate-400">Every sound has a shape.</p>
        <a
          href="/app"
          className="mt-6 inline-flex items-center rounded-md bg-white/10 hover:bg-white/20 px-4 py-2 text-sm font-medium text-slate-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          Open Echo
        </a>
      </div>
    </main>
  )
}
