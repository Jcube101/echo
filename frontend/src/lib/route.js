// Design v2 routing (DESIGN_V2.md §2) — no router library. The app lives at
// /app (and /app/*, reserved for later deep links); every other path shows
// the landing page.
export function isAppPath(pathname) {
  return pathname === '/app' || pathname.startsWith('/app/')
}

// /app?record=1 opens the app with the browser recorder already started
// (the landing page's "Record a sound" link).
export function wantsAutoRecord(search) {
  return new URLSearchParams(search).get('record') === '1'
}
