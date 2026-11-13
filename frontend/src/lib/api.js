// API client. Same-origin in production (FastAPI serves the build); in dev,
// Vite proxies these paths to :8014. No CORS, no credentials (locked): the
// browser sends this site's own cookies on same-origin requests by default,
// which is all the private-history cookie needs.

async function parseError(res) {
  try {
    const data = await res.json()
    return data.detail || `Request failed (${res.status})`
  } catch {
    return `Request failed (${res.status})`
  }
}

// The error thrown for a non-OK response. `status` lets callers tell the two
// "come back later" answers apart from real failures: 503 (Echo is analysing
// someone else's clip) and 429 (this browser has hit its upload limit).
async function apiError(res) {
  const err = new Error(await parseError(res))
  err.status = res.status
  return err
}

// True for the server's polite "not right now" answers, which the app shows
// as a plain notice rather than a red error.
export function isTryLater(err) {
  return err?.status === 503 || err?.status === 429
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
// `source` ('upload' | 'recording') only labels the clip in the history list.
export async function uploadAudio(fileOrBlob, filename = 'clip', source = 'upload') {
  const form = new FormData()
  form.append('file', fileOrBlob, filename)
  form.append('source', source)
  const res = await fetch('/upload', { method: 'POST', body: form })
  if (!res.ok) throw await apiError(res)
  return res.json()
}

// Is this the owner's browser? The Pi mic is for the site's owner only, behind
// a Cloudflare Access sign-in at /me; the app shows its button only when this
// says so. Any failure reads as "no".
export async function getMe() {
  try {
    const res = await fetch('/api/me')
    if (!res.ok) return { pi_mic: false }
    const data = await res.json()
    return { pi_mic: data.pi_mic === true }
  } catch {
    return { pi_mic: false }
  }
}

// How long the app waits for a Pi-mic capture before giving up: the recording
// time plus this. The server kills an overrunning recording at +10 s and the
// analysis at +60 s, so past this point no answer is coming.
export const CAPTURE_EXTRA_WAIT_S = 75

// Trigger a Pi-mic capture of `duration` seconds (owner only).
//
// The duration goes in the URL and the request has NO body. A capture once
// hung for minutes because the server was still waiting for the end of the
// request body; with nothing to send there is nothing to wait for.
//
// Failures are told apart on `err.kind`, so the app can say what happened:
//   'signed_out'  the owner's sign-in has expired. Cloudflare then answers the
//                 request itself with a redirect to its sign-in page (which
//                 fetch can't follow across origins; `redirect: 'manual'`
//                 makes it visible), or Echo answers 404.
//   'timed_out'   no answer within duration + CAPTURE_EXTRA_WAIT_S; the
//                 request is aborted.
//   'mic_busy' | 'mic_not_found' | 'mic_timeout' | 'mic_failed'
//                 the server's X-Echo-Error reason for a failed recording.
//   'network'     the request never got an answer (offline, tunnel down).
export async function captureMic(duration, { timeoutMs } = {}) {
  const limit = timeoutMs ?? (Number(duration) + CAPTURE_EXTRA_WAIT_S) * 1000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), limit)
  let res
  try {
    res = await fetch(`/capture?duration=${encodeURIComponent(duration)}`, {
      method: 'POST',
      redirect: 'manual',
      signal: controller.signal,
    })
  } catch (e) {
    const timedOut = controller.signal.aborted
    const err = new Error(timedOut
      ? `No answer from the Pi after ${Math.round(limit / 1000)} seconds, so the app stopped waiting.`
      : (e?.message || 'Failed to fetch'))
    err.kind = timedOut ? 'timed_out' : 'network'
    throw err
  } finally {
    clearTimeout(timer)
  }
  if (res.type === 'opaqueredirect' || [401, 403, 404].includes(res.status)) {
    const err = new Error('Your Pi mic sign-in has expired.')
    err.kind = 'signed_out'
    err.signedOut = true
    throw err
  }
  if (!res.ok) {
    const err = await apiError(res)
    err.kind = res.headers?.get?.('X-Echo-Error') || undefined
    throw err
  }
  return res.json()
}

export async function getHistory() {
  const res = await fetch('/history')
  if (!res.ok) throw await apiError(res)
  return res.json()
}

export async function getClip(id) {
  const res = await fetch(`/history/${id}`)
  if (!res.ok) throw await apiError(res)
  return res.json()
}

// Delete one of this browser's clips (its audio and features go with it).
export async function deleteClip(id) {
  const res = await fetch(`/history/${id}`, { method: 'DELETE' })
  if (!res.ok) throw await apiError(res)
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
