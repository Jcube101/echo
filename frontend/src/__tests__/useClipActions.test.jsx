import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { recoverCapture, useClipActions } from '../lib/useClipActions.js'
import * as api from '../lib/api.js'

vi.mock('sonner', () => {
  const t = vi.fn()
  t.success = vi.fn()
  t.error = vi.fn()
  return { toast: t }
})
vi.mock('../lib/api.js', async (orig) => {
  const real = await orig()
  return {
    ...real, uploadAudio: vi.fn(), captureMic: vi.fn(), getMe: vi.fn(),
    endCapture: vi.fn(), getHistory: vi.fn(), getClip: vi.fn(),
  }
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
  beforeEach(() => { localStorage.clear(); api.getHistory.mockResolvedValue([]) })
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

  // --- cancel / stop (DELETE /capture) --------------------------------------
  function deferred() {
    let resolve, reject
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
  }

  async function startCapture(props) {
    api.getMe.mockResolvedValue({ pi_mic: true })
    const pending = deferred()
    api.captureMic.mockReturnValue(pending.promise)
    const hook = setup(props)
    await waitFor(() => expect(hook.result.current.piMic).toBe(true))
    let run
    await act(async () => { run = hook.result.current.runCapture(); await Promise.resolve() })
    await waitFor(() => expect(hook.result.current.piCapture).not.toBeNull())
    return { ...hook, pending, run }
  }

  it('shows a running Pi capture, and Cancel ends it quietly with nothing saved', async () => {
    api.endCapture.mockResolvedValue({ active: true, action: 'cancel' })
    const { result, pending, run, onResult, onStatus } = await startCapture()
    expect(result.current.piCapture).toMatchObject({ seconds: 5, phase: 'recording', ending: null })
    expect(api.captureMic).toHaveBeenCalledWith(5)

    await act(() => result.current.cancelCapture())
    expect(api.endCapture).toHaveBeenCalledWith('cancel')
    expect(result.current.piCapture.ending).toBe('cancel')
    await act(() => result.current.cancelCapture())          // a second press does nothing
    expect(api.endCapture).toHaveBeenCalledTimes(1)

    await act(async () => { pending.resolve({ cancelled: true, reason: 'cancelled' }); await run })
    expect(result.current.piCapture).toBeNull()
    expect(toast).toHaveBeenCalledWith('Recording cancelled', { description: 'Nothing was saved.' })
    expect(toast.error).not.toHaveBeenCalled()
    expect(onResult).not.toHaveBeenCalled()
    expect(onStatus).toHaveBeenLastCalledWith('idle')
  })

  it('Stop keeps what was recorded: the shorter clip comes back as a normal result', async () => {
    api.endCapture.mockResolvedValue({ active: true, action: 'stop' })
    const { result, pending, run, onResult } = await startCapture()
    await act(() => result.current.stopCapture())
    expect(api.endCapture).toHaveBeenCalledWith('stop')
    expect(result.current.piCapture).toMatchObject({ ending: 'stop', phase: 'finishing' })
    const clip = { id: 'c1', features: [], duration_s: 2.9, audio_url: '/audio/c1.opus' }
    await act(async () => { pending.resolve(clip); await run })
    expect(onResult).toHaveBeenCalledWith(clip, { kind: 'pi_mic' })
    expect(toast.success).toHaveBeenCalledWith('Captured', { description: '3s from the Pi mic' })
    expect(result.current.piCapture).toBeNull()
  })

  it('says so when a stop came too early to keep anything', async () => {
    const { pending, run, onResult } = await startCapture()
    await act(async () => { pending.resolve({ cancelled: true, reason: 'too_short' }); await run })
    expect(toast).toHaveBeenCalledWith('Stopped too soon', expect.anything())
    expect(onResult).not.toHaveBeenCalled()
  })

  it('re-enables Cancel if the cancel request itself fails', async () => {
    api.endCapture.mockRejectedValue(new Error('Request failed (500)'))
    const { result, pending, run } = await startCapture()
    await act(() => result.current.cancelCapture())
    expect(result.current.piCapture.ending).toBeNull()
    expect(toast.error).toHaveBeenCalledWith("Couldn't cancel the Pi mic", expect.anything())
    await act(async () => { pending.resolve({ cancelled: true, reason: 'cancelled' }); await run })
  })

  // --- the answer is lost (phone locked, app in the background) ---------------
  it('finds the clip in History when the capture finished while the app was away', async () => {
    const saved = { id: 'new1', source_type: 'pi_mic', features: [{ t: 0 }], duration_s: 5, audio_url: '/audio/new1.opus' }
    api.getHistory
      .mockResolvedValueOnce([{ id: 'old1', source_type: 'pi_mic' }])                    // before the capture
      .mockResolvedValue([{ id: 'new1', source_type: 'pi_mic' }, { id: 'old1', source_type: 'pi_mic' }])
    api.getClip.mockResolvedValue(saved)
    const { result, pending, run, onResult, onStatus } = await startCapture({ recoverAfterMs: 0 })
    await act(async () => {
      pending.reject(Object.assign(new Error('Failed to fetch'), { kind: 'network' }))
      await run
    })
    expect(api.getClip).toHaveBeenCalledWith('new1')
    expect(onResult).toHaveBeenCalledWith(saved, { kind: 'pi_mic' })
    expect(toast.success).toHaveBeenCalledWith('Captured', { description: 'The Pi finished this recording while the app was away.' })
    expect(toast.error).not.toHaveBeenCalled()
    expect(onStatus).not.toHaveBeenCalledWith('error', expect.anything())
    expect(result.current.piCapture).toBeNull()
  })

  it('does not go looking for a clip after a cancel whose answer was lost', async () => {
    api.endCapture.mockResolvedValue({ active: true, action: 'cancel' })
    const { result, pending, run, onResult } = await startCapture({ recoverAfterMs: 0 })
    await act(() => result.current.cancelCapture())
    api.getHistory.mockClear()
    await act(async () => {
      pending.reject(Object.assign(new Error('Failed to fetch'), { kind: 'network' }))
      await run
    })
    expect(api.getHistory).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith('Recording cancelled', { description: 'Nothing was saved.' })
    expect(toast.error).not.toHaveBeenCalled()
    expect(onResult).not.toHaveBeenCalled()
  })

  it('a capture that fails in its first moments is reported at once, with no search of History', async () => {
    const { pending, run, onResult } = await startCapture()          // default: recover only after 3 s
    api.getHistory.mockClear()
    await act(async () => {
      pending.reject(Object.assign(new Error('Failed to fetch'), { kind: 'network' }))
      await run
    })
    expect(api.getHistory).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith("Couldn't reach Echo", expect.anything())
    expect(onResult).not.toHaveBeenCalled()
  })

  it('recoverCapture ignores older and non-Pi clips, keeps trying while offline, and gives up at the deadline', async () => {
    const before = new Set(['old1'])
    api.getHistory.mockResolvedValue([{ id: 'old1', source_type: 'pi_mic' }, { id: 'up1', source_type: 'upload' }])
    expect(await recoverCapture(before, Date.now() - 1)).toBeNull()                      // nothing new: gives up

    api.getClip.mockResolvedValue({ id: 'new1' })
    api.getHistory
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))                           // still offline
      .mockResolvedValueOnce([{ id: 'old1', source_type: 'pi_mic' }])                    // not there yet
      .mockResolvedValue([{ id: 'new1', source_type: 'pi_mic' }, { id: 'old1', source_type: 'pi_mic' }])
    const looking = vi.fn()
    expect(await recoverCapture(before, Date.now() + 5000, looking, 5)).toEqual({ id: 'new1' })
    expect(looking).toHaveBeenCalledTimes(1)
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
