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

// Hook: browser-mic recording with a 60s cap + live countdown.
// onComplete(blob, filename) fires when a recording finishes.
export function useRecorder(onComplete) {
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [supported, setSupported] = useState(true)

  const mrRef = useRef(null)
  const chunksRef = useRef([])
  const streamRef = useRef(null)
  const timerRef = useRef(null)

  useEffect(() => {
    const ok = typeof navigator !== 'undefined' &&
      navigator.mediaDevices?.getUserMedia &&
      typeof MediaRecorder !== 'undefined'
    setSupported(!!ok)
  }, [])

  const cleanup = useCallback(() => {
    clearInterval(timerRef.current)
    timerRef.current = null
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
        if (blob.size > 0) onComplete(blob, `recording.${ext}`)
      }
      mrRef.current = mr
      mr.start()
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
  }, [cleanup, onComplete, stop])

  useEffect(() => cleanup, [cleanup])

  return { recording, elapsed, supported, start, stop, maxSeconds: MAX_SECONDS }
}
