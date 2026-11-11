import { useCallback, useEffect, useRef, useState } from 'react'

const MAX_SECONDS = 60

// Pick a mime type the browser actually supports. Android Chrome gives
// audio/webm;codecs=opus; iOS Safari typically only audio/mp4. The backend
// transcodes any of these with ffmpeg, so we just take the first supported.
function pickMime() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ]
  if (typeof MediaRecorder === 'undefined') return null
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c
  }
  return '' // let the browser choose a default
}

const LEVEL_BARS = 48      // how many recent level samples to keep
const LEVEL_EVERY_MS = 100

// Hook: browser-mic recording with a 60s cap + live countdown.
// onComplete(blob, filename) fires when a recording finishes — but not after
// cancel(), which stops the mic and throws the audio away.
// `levels` is a rolling list of recent loudness samples (0..1, newest last)
// for the phone recording screen's level bars. It comes from an AnalyserNode
// on the SAME stream — no second mic request — and is torn down with it, so
// the mic is still released the moment recording stops.
export function useRecorder(onComplete) {
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [supported, setSupported] = useState(true)

  const mrRef = useRef(null)
  const chunksRef = useRef([])
  const streamRef = useRef(null)
  const timerRef = useRef(null)
  const cancelledRef = useRef(false)
  const audioCtxRef = useRef(null)
  const levelTimerRef = useRef(null)
  const [levels, setLevels] = useState([])

  useEffect(() => {
    const ok = typeof navigator !== 'undefined' &&
      navigator.mediaDevices?.getUserMedia &&
      typeof MediaRecorder !== 'undefined'
    setSupported(!!ok)
  }, [])

  const cleanup = useCallback(() => {
    clearInterval(timerRef.current)
    timerRef.current = null
    clearInterval(levelTimerRef.current)
    levelTimerRef.current = null
    if (audioCtxRef.current) {
      audioCtxRef.current.close?.().catch?.(() => {})
      audioCtxRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [])

  const stop = useCallback(() => {
    if (mrRef.current && mrRef.current.state !== 'inactive') {
      mrRef.current.stop()
    }
  }, [])

  // Stop and discard: the mic is released, nothing is uploaded.
  const cancel = useCallback(() => {
    cancelledRef.current = true
    stop()
  }, [stop])

  // Level meter. Best-effort: if Web Audio isn't available the recording
  // itself is unaffected and the bars simply stay flat.
  const startLevels = useCallback((stream) => {
    setLevels([])
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext
      if (!Ctx) return
      const ctx = new Ctx()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      ctx.createMediaStreamSource(stream).connect(analyser)
      audioCtxRef.current = ctx
      const buf = new Uint8Array(analyser.fftSize)
      levelTimerRef.current = setInterval(() => {
        analyser.getByteTimeDomainData(buf)
        let sum = 0
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128
          sum += v * v
        }
        // RMS, with a square-root curve so quiet sounds still move the bars.
        const level = Math.min(1, Math.sqrt(Math.sqrt(sum / buf.length)) * 1.4)
        setLevels((prev) => [...prev.slice(-(LEVEL_BARS - 1)), level])
      }, LEVEL_EVERY_MS)
    } catch {
      /* no level meter */
    }
  }, [])

  const start = useCallback(async () => {
    const mime = pickMime()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      chunksRef.current = []
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.onstop = () => {
        const type = mr.mimeType || 'audio/webm'
        const blob = new Blob(chunksRef.current, { type })
        const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm'
        cleanup()
        setRecording(false)
        setElapsed(0)
        setLevels([])
        const cancelled = cancelledRef.current
        cancelledRef.current = false
        if (!cancelled && blob.size > 0) onComplete(blob, `recording.${ext}`)
      }
      mrRef.current = mr
      cancelledRef.current = false
      mr.start()
      startLevels(stream)
      setRecording(true)
      setElapsed(0)

      const startedAt = Date.now()
      timerRef.current = setInterval(() => {
        const secs = (Date.now() - startedAt) / 1000
        setElapsed(secs)
        if (secs >= MAX_SECONDS) stop()
      }, 200)
    } catch (err) {
      cleanup()
      setRecording(false)
      throw err
    }
  }, [cleanup, onComplete, stop, startLevels])

  useEffect(() => cleanup, [cleanup])

  return {
    recording, elapsed, supported, levels, start, stop, cancel,
    maxSeconds: MAX_SECONDS, levelBars: LEVEL_BARS,
  }
}
