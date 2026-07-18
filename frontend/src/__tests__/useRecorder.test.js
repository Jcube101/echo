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
})
