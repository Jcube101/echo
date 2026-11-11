import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRecorder } from '../lib/useRecorder.js'

// Stands in for the browser MediaRecorder API. `pickMime` (useRecorder.js)
// is module-private, so FE-002 exercises its fallback chain indirectly by
// inspecting what mimeType this fake constructor actually received.
class FakeMediaRecorder {
  constructor(stream, options) {
    this.stream = stream
    this.options = options
    this.state = 'inactive'
    this.mimeType = options?.mimeType || 'audio/webm'
    FakeMediaRecorder.instances.push(this)
  }
  start() { this.state = 'recording' }
  stop() {
    this.state = 'inactive'
    this.onstop?.()
  }
}
FakeMediaRecorder.instances = []
FakeMediaRecorder.supportedTypes = new Set()
FakeMediaRecorder.isTypeSupported = (type) => FakeMediaRecorder.supportedTypes.has(type)

function fakeStream() {
  const track = { stop: vi.fn() }
  return { getTracks: () => [track], _track: track }
}

describe('useRecorder', () => {
  let originalMediaRecorder

  beforeEach(() => {
    FakeMediaRecorder.instances = []
    FakeMediaRecorder.supportedTypes = new Set()
    originalMediaRecorder = global.MediaRecorder
    global.MediaRecorder = FakeMediaRecorder
    global.navigator.mediaDevices = { getUserMedia: vi.fn().mockResolvedValue(fakeStream()) }
  })

  afterEach(() => {
    global.MediaRecorder = originalMediaRecorder
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  // --- FE-002: mime negotiation fallback chain --------------------------------
  it('prefers audio/webm;codecs=opus when supported (Android Chrome)', async () => {
    FakeMediaRecorder.supportedTypes = new Set(['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'])
    const { result } = renderHook(() => useRecorder(vi.fn()))
    await act(async () => { await result.current.start() })
    expect(FakeMediaRecorder.instances[0].options.mimeType).toBe('audio/webm;codecs=opus')
  })

  it('falls back to audio/webm when opus codec support is absent', async () => {
    FakeMediaRecorder.supportedTypes = new Set(['audio/webm'])
    const { result } = renderHook(() => useRecorder(vi.fn()))
    await act(async () => { await result.current.start() })
    expect(FakeMediaRecorder.instances[0].options.mimeType).toBe('audio/webm')
  })

  it('falls back to audio/mp4 when only that is supported (iOS Safari)', async () => {
    FakeMediaRecorder.supportedTypes = new Set(['audio/mp4'])
    const { result } = renderHook(() => useRecorder(vi.fn()))
    await act(async () => { await result.current.start() })
    expect(FakeMediaRecorder.instances[0].options.mimeType).toBe('audio/mp4')
  })

  it('falls back to audio/ogg;codecs=opus as the last resort', async () => {
    FakeMediaRecorder.supportedTypes = new Set(['audio/ogg;codecs=opus'])
    const { result } = renderHook(() => useRecorder(vi.fn()))
    await act(async () => { await result.current.start() })
    expect(FakeMediaRecorder.instances[0].options.mimeType).toBe('audio/ogg;codecs=opus')
  })

  it('lets the browser choose when none of the candidates are supported', async () => {
    FakeMediaRecorder.supportedTypes = new Set()
    const { result } = renderHook(() => useRecorder(vi.fn()))
    await act(async () => { await result.current.start() })
    expect(FakeMediaRecorder.instances[0].options).toBeUndefined()
  })

  // --- FE-003: hook behavior ---------------------------------------------------
  it('reports supported=true when MediaRecorder + getUserMedia exist', () => {
    const { result } = renderHook(() => useRecorder(vi.fn()))
    expect(result.current.supported).toBe(true)
  })

  it('maps the recorded blob mime type to the right file extension on stop', async () => {
    FakeMediaRecorder.supportedTypes = new Set(['audio/mp4'])
    const onComplete = vi.fn()
    const { result } = renderHook(() => useRecorder(onComplete))
    await act(async () => { await result.current.start() })
    const mr = FakeMediaRecorder.instances[0]
    mr.ondataavailable({ data: new Blob(['x'], { type: 'audio/mp4' }) })
    act(() => { mr.stop() })

    expect(onComplete).toHaveBeenCalledTimes(1)
    const [, filename] = onComplete.mock.calls[0]
    expect(filename).toBe('recording.m4a')
  })

  it('does not fire onComplete for a zero-byte recording', async () => {
    FakeMediaRecorder.supportedTypes = new Set(['audio/webm'])
    const onComplete = vi.fn()
    const { result } = renderHook(() => useRecorder(onComplete))
    await act(async () => { await result.current.start() })
    const mr = FakeMediaRecorder.instances[0]
    act(() => { mr.stop() })  // no ondataavailable -> zero chunks
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('releases the mic (stops tracks) when recording stops', async () => {
    FakeMediaRecorder.supportedTypes = new Set(['audio/webm'])
    const stream = fakeStream()
    global.navigator.mediaDevices.getUserMedia.mockResolvedValue(stream)
    const { result } = renderHook(() => useRecorder(vi.fn()))
    await act(async () => { await result.current.start() })
    const mr = FakeMediaRecorder.instances[0]
    act(() => { mr.stop() })
    expect(stream._track.stop).toHaveBeenCalled()
  })

  it('auto-stops at the 60s cap', async () => {
    vi.useFakeTimers()
    FakeMediaRecorder.supportedTypes = new Set(['audio/webm'])
    const onComplete = vi.fn()
    const { result } = renderHook(() => useRecorder(onComplete))
    await act(async () => { await result.current.start() })
    const mr = FakeMediaRecorder.instances[0]
    mr.ondataavailable({ data: new Blob(['x'], { type: 'audio/webm' }) })

    act(() => { vi.advanceTimersByTime(61_000) })

    expect(mr.state).toBe('inactive')
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  // --- Design v2 S3: cancel + level meter -----------------------------------
  it('cancel() releases the mic and never fires onComplete', async () => {
    FakeMediaRecorder.supportedTypes = new Set(['audio/webm'])
    const stream = fakeStream()
    global.navigator.mediaDevices.getUserMedia.mockResolvedValue(stream)
    const onComplete = vi.fn()
    const { result } = renderHook(() => useRecorder(onComplete))
    await act(async () => { await result.current.start() })
    FakeMediaRecorder.instances[0].ondataavailable({ data: new Blob(['x'], { type: 'audio/webm' }) })

    act(() => { result.current.cancel() })

    expect(onComplete).not.toHaveBeenCalled()
    expect(stream._track.stop).toHaveBeenCalled()
    expect(result.current.recording).toBe(false)
  })

  it('a recording after a cancelled one completes normally', async () => {
    FakeMediaRecorder.supportedTypes = new Set(['audio/webm'])
    const onComplete = vi.fn()
    const { result } = renderHook(() => useRecorder(onComplete))
    await act(async () => { await result.current.start() })
    act(() => { result.current.cancel() })

    await act(async () => { await result.current.start() })
    const mr = FakeMediaRecorder.instances[1]
    mr.ondataavailable({ data: new Blob(['x'], { type: 'audio/webm' }) })
    act(() => { result.current.stop() })
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('samples live levels from the same stream and closes the audio context on stop', async () => {
    vi.useFakeTimers()
    FakeMediaRecorder.supportedTypes = new Set(['audio/webm'])
    const close = vi.fn().mockResolvedValue()
    const connect = vi.fn()
    const createMediaStreamSource = vi.fn(() => ({ connect }))
    window.AudioContext = vi.fn(() => ({
      createAnalyser: () => ({
        fftSize: 0,
        getByteTimeDomainData: (buf) => buf.fill(192), // a steady, clearly non-silent signal
      }),
      createMediaStreamSource,
      close,
    }))
    const stream = fakeStream()
    global.navigator.mediaDevices.getUserMedia.mockResolvedValue(stream)
    const { result } = renderHook(() => useRecorder(vi.fn()))
    await act(async () => { await result.current.start() })
    expect(global.navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1) // no second mic request
    expect(createMediaStreamSource).toHaveBeenCalledWith(stream)

    act(() => { vi.advanceTimersByTime(350) })
    expect(result.current.levels.length).toBe(3)
    expect(result.current.levels[0]).toBeGreaterThan(0.5)

    act(() => { result.current.stop() })
    expect(close).toHaveBeenCalled()
    expect(result.current.levels).toEqual([])
    delete window.AudioContext
  })

  it('records normally when Web Audio is unavailable (no level meter)', async () => {
    FakeMediaRecorder.supportedTypes = new Set(['audio/webm'])
    delete window.AudioContext
    const { result } = renderHook(() => useRecorder(vi.fn()))
    await act(async () => { await result.current.start() })
    expect(result.current.recording).toBe(true)
    expect(result.current.levels).toEqual([])
  })
})
