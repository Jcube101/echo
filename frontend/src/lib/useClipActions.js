import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useRecorder } from './useRecorder.js'
import { uploadAudio, captureMic, friendlyError } from './api.js'

// Everything that makes a new clip: file upload, browser recording and Pi mic
// capture. Owned once by App so the desktop header and the phone screens
// (home, recording) drive the SAME recorder and in-flight state.
//
// Reports work through onStatus('processing'|'idle'|'error', msg) and
// onResult(apiResponse, { kind, name }) — kind is 'upload' | 'recording' |
// 'pi_mic', which the clip card uses to say where the clip came from. A toast
// is raised on every success/failure so nothing fails silently or vaguely
// (recall the historical "Failed to fetch" issue).
export function useClipActions({ onStatus, onResult, autoRecord = false }) {
  const fileRef = useRef(null)
  const [captureSecs, setCaptureSecs] = useState('5')
  const [inFlight, setInFlight] = useState(null) // 'upload' | 'capture' | null

  async function runUpload(fileOrBlob, name, kind = 'upload') {
    setInFlight('upload')
    onStatus('processing', 'Analyzing audio…')
    try {
      const res = await uploadAudio(fileOrBlob, name)
      onResult(res, { kind, name })
      onStatus('idle')
      toast.success('Uploaded', { description: name })
    } catch (e) {
      const msg = friendlyError(e)
      onStatus('error', msg)
      toast.error('Upload failed', { description: msg })
    } finally {
      setInFlight(null)
    }
  }

  const recorder = useRecorder((blob, name) => runUpload(blob, name, 'recording'))

  async function startRecording() {
    try {
      await recorder.start()
    } catch (e) {
      // getUserMedia rejects on permission denial / no mic — previously silent.
      const msg = /Permission|NotAllowed/i.test(e?.name || e?.message || '')
        ? 'Microphone access denied — allow microphone access in your browser to record.'
        : friendlyError(e)
      onStatus('error', msg)
      toast.error('Recording failed', { description: msg })
    }
  }

  // autoRecord (/app?record=1): start the recorder once on mount. The ref
  // keeps StrictMode's dev double-run of effects from starting it twice.
  // A denied or missing mic surfaces through startRecording's usual toast.
  const autoStarted = useRef(false)
  useEffect(() => {
    if (!autoRecord || autoStarted.current) return
    autoStarted.current = true
    startRecording()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function pickFile() {
    fileRef.current?.click()
  }

  function onPick(e) {
    const f = e.target.files?.[0]
    if (f) runUpload(f, f.name)
    e.target.value = '' // allow re-picking the same file
  }

  async function runCapture() {
    setInFlight('capture')
    onStatus('processing', `Recording ${captureSecs}s on the Pi mic…`)
    try {
      const res = await captureMic(Number(captureSecs))
      onResult(res, { kind: 'pi_mic' })
      onStatus('idle')
      toast.success('Captured', { description: `${captureSecs}s from the Pi mic` })
    } catch (e) {
      const msg = friendlyError(e)
      onStatus('error', msg)
      toast.error('Capture failed', { description: msg })
    } finally {
      setInFlight(null)
    }
  }

  return {
    recorder, startRecording,
    fileRef, pickFile, onPick,
    runCapture, captureSecs, setCaptureSecs,
    inFlight,
  }
}

export const CAPTURE_SECONDS = [3, 5, 10, 15, 30, 60]
