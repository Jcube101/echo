import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { useClipActions } from '../lib/useClipActions.js'
import * as api from '../lib/api.js'

vi.mock('sonner', () => {
  const t = vi.fn()
  t.success = vi.fn()
  t.error = vi.fn()
  return { toast: t }
})
vi.mock('../lib/api.js', async (orig) => {
  const real = await orig()
  return { ...real, uploadAudio: vi.fn(), captureMic: vi.fn(), getMe: vi.fn() }
})

// FE-015 — launch behaviour of the clip actions (docs/LAUNCH.md §2 and §3):
// the Pi mic is the owner's only, and "try later" answers are plain notices.
const failing = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra })

function setup(props = {}) {
  const onStatus = vi.fn()
  const onResult = vi.fn()
  const hook = renderHook(() => useClipActions({ onStatus, onResult, ...props }))
  return { ...hook, onStatus, onResult }
}

describe('useClipActions', () => {
  beforeEach(() => { localStorage.clear() })
  afterEach(() => { vi.clearAllMocks() })

  it('keeps the Pi mic off for an ordinary visitor, with no sign-in hint', async () => {
    api.getMe.mockResolvedValue({ pi_mic: false })
    const { result } = setup()
    await waitFor(() => expect(api.getMe).toHaveBeenCalled())
    expect(result.current.piMic).toBe(false)
    expect(toast).not.toHaveBeenCalled()
  })

  it('turns the Pi mic on for the signed-in owner and confirms a fresh sign-in', async () => {
    api.getMe.mockResolvedValue({ pi_mic: true })
    const { result } = setup({ justSignedIn: true })
    await waitFor(() => expect(result.current.piMic).toBe(true))
    expect(toast.success).toHaveBeenCalledWith('Signed in', expect.anything())
  })

  it('tells only a browser that had the Pi mic before to sign in again at /me', async () => {
    api.getMe.mockResolvedValue({ pi_mic: true })
    const first = setup()
    await waitFor(() => expect(first.result.current.piMic).toBe(true))
    first.unmount()
    expect(toast).not.toHaveBeenCalled()

    api.getMe.mockResolvedValue({ pi_mic: false })   // the month-long session ran out
    const later = setup()
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1))
    expect(later.result.current.piMic).toBe(false)
    expect(toast.mock.calls[0][1].description).toMatch(/Sign in again at \/me/)
  })

  it('hides the Pi mic and points at /me when a capture finds the sign-in expired', async () => {
    api.getMe.mockResolvedValue({ pi_mic: true })
    api.captureMic.mockRejectedValue(Object.assign(new Error('expired'), { signedOut: true }))
    const { result, onStatus } = setup()
    await waitFor(() => expect(result.current.piMic).toBe(true))
    await act(() => result.current.runCapture())
    expect(result.current.piMic).toBe(false)
    expect(toast.mock.calls[0][1].description).toMatch(/Sign in again at \/me/)
    expect(toast.error).not.toHaveBeenCalled()
    expect(onStatus).toHaveBeenLastCalledWith('idle')
  })

  it.each([
    ['timed_out', 'No answer from the Pi after 85 seconds, so the app stopped waiting.', 'Pi mic timed out', /may still have been saved: check History/],
    ['mic_timeout', "The Pi mic didn't finish a 10 s recording within 20 s, so it was stopped. Try again.", 'Pi mic timed out', /so it was stopped/],
    ['mic_busy', 'The Pi mic is busy: something else is recording right now.', 'Pi mic is busy', /something else is recording/],
    ['mic_not_found', "The Pi couldn't open its mic.", 'Pi mic not found', /couldn't open its mic/],
    ['network', 'Failed to fetch', "Couldn't reach Echo", /got no answer/],
  ])('names a %s capture failure for what it is', async (kind, message, title, body) => {
    api.getMe.mockResolvedValue({ pi_mic: true })
    api.captureMic.mockRejectedValue(Object.assign(new Error(message), { kind, status: kind.startsWith('mic') ? 503 : undefined }))
    const { result, onStatus } = setup()
    await waitFor(() => expect(result.current.piMic).toBe(true))
    await act(() => result.current.runCapture())
    expect(toast.error).toHaveBeenCalledTimes(1)
    const [gotTitle, { description }] = toast.error.mock.calls[0]
    expect(gotTitle).toBe(title)
    expect(description).toMatch(body)
    if (kind !== 'network') expect(description).not.toMatch(/check your connection/i)
    expect(result.current.piMic).toBe(true)          // only a sign-out hides the button
    expect(onStatus).toHaveBeenLastCalledWith('error', description)
  })

  it.each([
    [503, 'Echo is busy — try again in a moment.', 'Echo is busy'],
    [429, "You've reached the upload limit (10 per hour). Try again in about 12 minutes.", 'Upload limit reached'],
  ])('shows a %i as a plain notice, not an error', async (status, message, title) => {
    api.getMe.mockResolvedValue({ pi_mic: false })
    api.uploadAudio.mockRejectedValue(failing(status, message))
    const { result, onStatus, onResult } = setup()
    await act(() => result.current.onPick({ target: { files: [new File(['x'], 'a.wav')], value: '' } }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith(title, { description: message }))
    expect(toast.error).not.toHaveBeenCalled()
    expect(onStatus).toHaveBeenLastCalledWith('idle')
    expect(onStatus).not.toHaveBeenCalledWith('error', expect.anything())
    expect(onResult).not.toHaveBeenCalled()
  })

  it('still shows a real failure as an error', async () => {
    api.getMe.mockResolvedValue({ pi_mic: false })
    api.uploadAudio.mockRejectedValue(failing(422, 'That file has no audio track.'))
    const { result, onStatus } = setup()
    await act(() => result.current.onPick({ target: { files: [new File(['x'], 'a.wav')], value: '' } }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Upload failed', { description: 'That file has no audio track.' }))
    expect(onStatus).toHaveBeenLastCalledWith('error', 'That file has no audio track.')
  })
})
