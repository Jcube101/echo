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

// What a link into the app asks for (all optional, read once on load):
//   ?record=1      start the browser recorder straight away
//   ?sample=<id>   open with that sample loaded ("See its shape")
//   ?samples=1     open the Samples sheet ("Open the sample library")
//   ?owner=1       the owner has just signed in at /me (Pi mic sign-in)
export function appIntent(search) {
  const q = new URLSearchParams(search)
  const sample = q.get('sample')
  return {
    record: q.get('record') === '1',
    sample: sample && /^[a-z0-9-]{1,64}$/.test(sample) ? sample : null,
    samples: q.get('samples') === '1',
    owner: q.get('owner') === '1',
  }
}
