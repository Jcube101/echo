import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useRecorder } from './useRecorder.js'
import { uploadAudio, captureMic, friendlyError, getMe, isTryLater } from './api.js'

// Remembers (in this browser only) that the owner has used the Pi mic here, so
// the "sign in again" hint is shown to them and never to ordinary visitors.
const OWNER_FLAG = 'echo_pi_mic_owner'
const flag = {
  get: () => { try { return localStorage.getItem(OWNER_FLAG) === '1' } catch { return false } },
  set: () => { try { localStorage.setItem(OWNER_FLAG, '1') } catch { /* private mode */ } },
}

// A failed Pi-mic capture, as [toast title, message]. Never the generic
// "check your connection" unless the request truly got no answer.
export function captureFailure(err, fallback) {
  switch (err?.kind) {
    case 'timed_out':
      return ['Pi mic timed out', `${err.message} The recording may still have been saved: check History.`]
    case 'mic_timeout':
      return ['Pi mic timed out', err.message]
    case 'mic_busy':
      return ['Pi mic is busy', err.message]
    case 'mic_not_found':
      return ['Pi mic not found', err.message]
    case 'mic_failed':
      return ['Pi mic recording failed', err.message]
    case 'network':
      return ["Couldn't reach Echo", 'The capture request got no answer. Check that this device is online, then try again.']
    default:
      return ['Capture failed', fallback]
  }
}

function signInAgainToast() {
  toast('Pi mic sign-in expired', {
    description: 'Sign in again at /me to use the Pi mic.',
    action: { label: 'Sign in', onClick: () => { window.location.href = '/me' } },
  })
}

// Everything that makes a new clip: file upload, browser recording and Pi mic
// capture. Owned once by App so the desktop header and the phone screens
// (home, recording) drive the SAME recorder and in-flight state.
//
// Reports work through onStatus('processing'|'idle'|'error', msg) and
// onResult(apiResponse, { kind, name }) — kind is 'upload' | 'recording' |
// 'pi_mic', which the clip card uses to say where the clip came from. A toast
// is raised on every success/failure so nothing fails silently or vaguely
// (recall the historical "Failed to fetch" issue).
export function useClipActions({ onStatus, onResult, autoRecord = false, justSignedIn = false }) {
  const fileRef = useRef(null)
  const [captureSecs, setCaptureSecs] = useState('5')
  const [inFlight, setInFlight] = useState(null) // 'upload' | 'capture' | null
  // The Pi mic button exists only for the signed-in owner (GET /api/me).
  const [piMic, setPiMic] = useState(false)

  useEffect(() => {
    let live = true
    getMe().then(({ pi_mic }) => {
      if (!live) return
      setPiMic(pi_mic)
      if (pi_mic) {
        flag.set()
        if (justSignedIn) toast.success('Signed in', { description: 'The Pi mic is available in this browser.' })
      } else if (flag.get()) {
        signInAgainToast()
      }
    })
    return () => { live = false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function runUpload(fileOrBlob, name, kind = 'upload') {
    setInFlight('upload')
    onStatus('processing', 'Analyzing audio…')
    try {
      const res = await uploadAudio(fileOrBlob, name, kind)
      onResult(res, { kind, name })
      onStatus('idle')
      toast.success('Uploaded', { description: name })
    } catch (e) {
      const msg = friendlyError(e)
      if (isTryLater(e)) {
        // Busy (503) or over the upload limit (429): nothing is wrong with
        // the clip, so this is a plain notice, not an error.
        onStatus('idle')
        toast(e.status === 429 ? 'Upload limit reached' : 'Echo is busy', { description: msg })
      } else {
        onStatus('error', msg)
        toast.error('Upload failed', { description: msg })
      }
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
      if (e?.kind === 'signed_out' || e?.signedOut) {
        setPiMic(false)
        onStatus('idle')
        signInAgainToast()
      } else if (isTryLater(e) && !e?.kind) {
        onStatus('idle')
        toast('Echo is busy', { description: msg })
      } else {
        // Say what actually happened (see captureMic for the kinds).
        const [title, description] = captureFailure(e, msg)
        onStatus('error', description)
        toast.error(title, { description })
      }
    } finally {
      setInFlight(null)
    }
  }

  return {
    recorder, startRecording,
    fileRef, pickFile, onPick,
    runCapture, captureSecs, setCaptureSecs, piMic,
    inFlight,
  }
}

export const CAPTURE_SECONDS = [3, 5, 10, 15, 30, 60]
