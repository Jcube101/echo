import { afterEach, describe, expect, it, vi } from 'vitest'
import { uploadAudio, captureMic, getHistory, getClip, getSamples, getSample } from '../lib/api.js'

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

  it('propagates errors for /capture and the samples endpoints too', async () => {
    mockFetch(503, { detail: 'Pi mic wrapper (~/bin/rec) not found.' })
    await expect(captureMic(5)).rejects.toThrow('Pi mic wrapper (~/bin/rec) not found.')

    mockFetch(404, { detail: 'Sample not found.' })
    await expect(getSample('nope')).rejects.toThrow('Sample not found.')

    mockFetch(200, [{ id: 'asian-koel' }])
    expect(await getSamples()).toEqual([{ id: 'asian-koel' }])
  })
})
