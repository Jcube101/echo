import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  uploadAudio, captureMic, deleteClip, friendlyError, getHistory, getClip, getMe, getSamples, getSample,
  isTryLater, CAPTURE_EXTRA_WAIT_S,
} from '../lib/api.js'

// FE-005 — api.js error parsing. This is what the user sees in the error
// toast (App.jsx's `status === 'error'` banner), e.g. the backend's 413 "20
// MB limit" detail (API-002) surfacing verbatim.
describe('api.js error parsing', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function mockFetch(status, body, ok = status < 400) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok,
      status,
      json: async () => body,
    }))
  }

  it('surfaces the backend detail string on a non-OK JSON response', async () => {
    mockFetch(413, { detail: 'File exceeds the 20 MB limit.' })
    await expect(uploadAudio(new Blob(['x']), 'clip.wav')).rejects.toThrow(
      'File exceeds the 20 MB limit.',
    )
  })

  it('falls back to a generic message for a non-JSON error body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => { throw new SyntaxError('not json') },
    }))
    await expect(getHistory()).rejects.toThrow('Request failed (500)')
  })

  it('resolves with the parsed JSON on success', async () => {
    mockFetch(200, { id: 'abc123', features: [] })
    const result = await getClip('abc123')
    expect(result).toEqual({ id: 'abc123', features: [] })
  })

  it('marks "try later" answers (503 busy, 429 limit) apart from real failures', async () => {
    mockFetch(503, { detail: 'Echo is busy — try again in a moment.' })
    const busy = await uploadAudio(new Blob(['x']), 'a.wav').catch((e) => e)
    expect(busy.message).toBe('Echo is busy — try again in a moment.')
    expect(busy.status).toBe(503)
    expect(isTryLater(busy)).toBe(true)

    mockFetch(429, { detail: "You've reached the upload limit (10 per hour). Try again in about 12 minutes." })
    const limited = await uploadAudio(new Blob(['x']), 'a.wav').catch((e) => e)
    expect(limited.status).toBe(429)
    expect(isTryLater(limited)).toBe(true)

    mockFetch(422, { detail: 'That file has no audio track.' })
    expect(isTryLater(await uploadAudio(new Blob(['x']), 'a.wav').catch((e) => e))).toBe(false)
    expect(isTryLater(new TypeError('Failed to fetch'))).toBe(false)
  })

  it('getMe is true only for an explicit pi_mic: true, and false on any failure', async () => {
    mockFetch(200, { pi_mic: true })
    expect(await getMe()).toEqual({ pi_mic: true })
    mockFetch(200, { pi_mic: 'yes' })
    expect(await getMe()).toEqual({ pi_mic: false })
    mockFetch(500, {})
    expect(await getMe()).toEqual({ pi_mic: false })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    expect(await getMe()).toEqual({ pi_mic: false })
  })

  it('captureMic reports an expired owner sign-in as signedOut (redirect or 404), never following the redirect', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 0, type: 'opaqueredirect' })
    vi.stubGlobal('fetch', fetchMock)
    const redirected = await captureMic(5).catch((e) => e)
    expect(redirected.signedOut).toBe(true)
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', redirect: 'manual' })

    for (const status of [404, 401, 403]) {
      mockFetch(status, { detail: 'Not Found' })
      expect((await captureMic(5).catch((e) => e)).signedOut).toBe(true)
    }
    mockFetch(503, { detail: 'Mic capture failed: audio open error' })
    const broken = await captureMic(5).catch((e) => e)
    expect(broken.signedOut).toBeUndefined()
    expect(broken.message).toBe('Mic capture failed: audio open error')
  })

  it('captureMic sends the duration in the URL with no body and no extra headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'x' }) })
    vi.stubGlobal('fetch', fetchMock)
    await captureMic(10)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/capture?duration=10')
    expect(init.method).toBe('POST')
    expect(init.redirect).toBe('manual')
    expect(init.body).toBeUndefined()        // nothing for the server to wait for
    expect(init.headers).toBeUndefined()
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('captureMic gives up after duration + 75 s and says so (timed_out), not "check your connection"', async () => {
    expect(CAPTURE_EXTRA_WAIT_S).toBe(75)
    vi.useFakeTimers()
    try {
      // A server that never answers; fetch rejects only when the app aborts.
      vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise((_res, rej) => {
        init.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))
      })))
      const pending = captureMic(10).catch((e) => e)
      await vi.advanceTimersByTimeAsync(84_000)
      expect(fetch.mock.calls[0][1].signal.aborted).toBe(false)   // still waiting at 84 s
      await vi.advanceTimersByTimeAsync(1_000)                    // 85 s = 10 + 75
      const err = await pending
      expect(err.kind).toBe('timed_out')
      expect(err.message).toBe('No answer from the Pi after 85 seconds, so the app stopped waiting.')
      expect(friendlyError(err)).not.toMatch(/check your connection/i)
    } finally {
      vi.useRealTimers()
    }
  })

  it('captureMic tells a network failure and each mic failure apart', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    expect((await captureMic(5).catch((e) => e)).kind).toBe('network')

    for (const kind of ['mic_busy', 'mic_not_found', 'mic_timeout', 'mic_failed']) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false, status: kind === 'mic_timeout' ? 504 : 503,
        headers: { get: (h) => (h === 'X-Echo-Error' ? kind : null) },
        json: async () => ({ detail: `server says ${kind}` }),
      }))
      const err = await captureMic(5).catch((e) => e)
      expect(err.kind).toBe(kind)
      expect(err.message).toBe(`server says ${kind}`)
    }
    mockFetch(404, { detail: 'Not Found' })
    expect((await captureMic(5).catch((e) => e)).kind).toBe('signed_out')
  })

  it('deleteClip sends DELETE /history/{id} and surfaces a refusal', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 })
    vi.stubGlobal('fetch', fetchMock)
    await expect(deleteClip('abc')).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledWith('/history/abc', { method: 'DELETE' })

    mockFetch(404, { detail: 'Clip not found.' })
    await expect(deleteClip('abc')).rejects.toThrow('Clip not found.')
  })

  it('never asks fetch to send credentials cross-site (CLAUDE.md: no credentials: include)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    await Promise.all([getHistory(), getClip('a'), getMe(), getSamples(), deleteClip('a'),
      uploadAudio(new Blob(['x']), 'a.wav'), captureMic(3)])
    for (const [, init] of fetchMock.mock.calls) expect(init?.credentials).toBeUndefined()
  })

  it('propagates errors for /capture and the samples endpoints too', async () => {
    mockFetch(503, { detail: 'Pi mic wrapper (~/bin/rec) not found.' })
    await expect(captureMic(5)).rejects.toThrow('Pi mic wrapper (~/bin/rec) not found.')

    mockFetch(404, { detail: 'Sample not found.' })
    await expect(getSample('nope')).rejects.toThrow('Sample not found.')

    mockFetch(200, [{ id: 'asian-koel' }])
    expect(await getSamples()).toEqual([{ id: 'asian-koel' }])
  })
})
