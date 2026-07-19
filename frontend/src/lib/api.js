// API client. Same-origin in production (FastAPI serves the build); in dev,
// Vite proxies these paths to :8014. No CORS, no credentials (locked).

async function parseError(res) {
  try {
    const data = await res.json()
    return data.detail || `Request failed (${res.status})`
  } catch {
    return `Request failed (${res.status})`
  }
}

// A caught error's message, in plain terms — for toasts and status banners.
// `fetch` itself throws a generic "Failed to fetch"/"NetworkError" on a dropped
// connection (the historical "Failed to fetch" symptom, see LEARNINGS.md); this
// turns that into something a person can actually act on, rather than passing
// the raw browser wording through.
export function friendlyError(err) {
  const msg = err?.message || ''
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
    return "Couldn't reach the server — check your connection and try again."
  }
  return msg || 'Request failed for an unknown reason.'
}

// Upload an audio file OR a recorded blob — same endpoint, same pipeline.
export async function uploadAudio(fileOrBlob, filename = 'clip') {
  const form = new FormData()
  form.append('file', fileOrBlob, filename)
  const res = await fetch('/upload', { method: 'POST', body: form })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

// Trigger a Pi-mic capture of `duration` seconds.
export async function captureMic(duration) {
  const res = await fetch('/capture', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ duration }),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function getHistory() {
  const res = await fetch('/history')
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function getClip(id) {
  const res = await fetch(`/history/${id}`)
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

// Curated sample library (permanent, separate from personal history).
export async function getSamples() {
  const res = await fetch('/samples')
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function getSample(id) {
  const res = await fetch(`/samples/${id}`)
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}
