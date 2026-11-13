import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useRecorder } from './useRecorder.js'
import {
  uploadAudio, captureMic, endCapture, friendlyError, getClip, getHistory, getMe, isTryLater,
} from './api.js'

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

// After a capture's answer is lost, how long past the recording time to keep
// looking for its clip (the Pi still has to analyse it), and how often.
const CAPTURE_RECOVERY_S = 25
const CAPTURE_RECOVER_AFTER_MS = 3000
const RECOVERY_POLL_MS = 2000

// Look in History for a Pi-mic clip that wasn't there before the capture
// started; load it when it appears. Null if none shows up by `untilMs`.
export async function recoverCapture(before, untilMs, onLooking, pollMs = RECOVERY_POLL_MS) {
  onLooking?.()
  for (;;) {
    try {
      const fresh = (await getHistory()).find((r) => r.source_type === 'pi_mic' && !before.has(r.id))
      if (fresh) return await getClip(fresh.id)
    } catch { /* still offline: keep trying until the deadline */ }
    if (Date.now() >= untilMs) return null
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
}

// Seconds since a Pi-mic capture started, ticking while it records. Reads the
// clock rather than counting ticks, so it is right again after the phone was
// locked or the app was in the background.
export function usePiElapsed(capture) {
  const [, tick] = useState(0)
  useEffect(() => {
    if (!capture) return undefined
    const id = setInterval(() => tick((n) => n + 1), 200)
    return () => clearInterval(id)
  }, [capture])
  if (!capture) return 0
  return Math.min(capture.seconds, Math.max(0, (Date.now() - capture.startedAt) / 1000))
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
export function useClipActions({
  onStatus, onResult, autoRecord = false, justSignedIn = false,
  recoverAfterMs = CAPTURE_RECOVER_AFTER_MS,
}) {
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

  // --- Pi mic capture ---------------------------------------------------------
  // `piCapture` is set while a capture is running: { seconds, startedAt,
  // phase: 'recording' | 'finishing', ending: null | 'cancel' | 'stop' }.
  // The screens draw their countdown from it (see usePiElapsed).
  const [piCapture, setPiCapture] = useState(null)
  const piRef = useRef(null)
  function updatePi(next) {
    piRef.current = typeof next === 'function' ? next(piRef.current) : next
    setPiCapture(piRef.current)
  }

  async function runCapture() {
    if (piRef.current) return
    const secs = Number(captureSecs)
    // What History holds now, so a capture that finishes while the app can't
    // hear the answer (phone locked, app in the background) can be found again.
    let before = null
    try { before = new Set((await getHistory()).map((r) => r.id)) } catch { /* recovery just won't run */ }

    const startedAt = Date.now()
    updatePi({ seconds: secs, startedAt, phase: 'recording', ending: null })
    setInFlight('capture')
    onStatus('idle')
    const toFinishing = setTimeout(
      () => updatePi((c) => (c && c.phase === 'recording' ? { ...c, phase: 'finishing' } : c)),
      secs * 1000)
    try {
      const res = await captureMic(secs)
      if (res?.cancelled) {
        if (res.reason === 'too_short') {
          toast('Stopped too soon', { description: 'Less than a second was recorded, so nothing was saved.' })
        } else {
          toast('Recording cancelled', { description: 'Nothing was saved.' })
        }
      } else {
        onResult(res, { kind: 'pi_mic' })
        toast.success('Captured', { description: `${Math.round(res.duration_s ?? secs)}s from the Pi mic` })
      }
      onStatus('idle')
    } catch (e) {
      const msg = friendlyError(e)
      const cancelled = piRef.current?.ending === 'cancel'
      // The Pi finishes a capture whether or not this device is still
      // listening. If the answer was lost, look for the new clip in History
      // before calling it a failure.
      const lostAnswer = e?.kind === 'network' || e?.kind === 'timed_out'
      // …but only if the capture had been running a while. A failure in the
      // first moments means the request never left (offline when pressed),
      // and searching History would just delay saying so.
      const hadStarted = Date.now() - startedAt >= recoverAfterMs
      const recovered = lostAnswer && hadStarted && !cancelled && before
        ? await recoverCapture(before, startedAt + (secs + CAPTURE_RECOVERY_S) * 1000,
            () => updatePi((c) => (c ? { ...c, phase: 'finishing' } : c)))
        : null
      if (recovered) {
        onResult(recovered, { kind: 'pi_mic' })
        onStatus('idle')
        toast.success('Captured', { description: 'The Pi finished this recording while the app was away.' })
      } else if (cancelled && lostAnswer) {
        onStatus('idle')
        toast('Recording cancelled', { description: 'Nothing was saved.' })
      } else if (e?.kind === 'signed_out' || e?.signedOut) {
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
      clearTimeout(toFinishing)
      updatePi(null)
      setInFlight(null)
    }
  }

  // Cancel (throw away) or stop (keep what was recorded) the running capture.
  // The answer to the capture request itself then ends runCapture above.
  async function endPiCapture(action) {
    const cur = piRef.current
    if (!cur || cur.ending) return
    updatePi({ ...cur, ending: action, phase: action === 'stop' ? 'finishing' : cur.phase })
    try {
      await endCapture(action)
    } catch (e) {
      updatePi((c) => (c ? { ...c, ending: null } : c))
      if (e?.kind === 'signed_out') {
        signInAgainToast()
      } else {
        toast.error(action === 'stop' ? "Couldn't stop the Pi mic" : "Couldn't cancel the Pi mic",
          { description: friendlyError(e) })
      }
    }
  }
  const cancelCapture = () => endPiCapture('cancel')
  const stopCapture = () => endPiCapture('stop')

  return {
    recorder, startRecording,
    fileRef, pickFile, onPick,
    runCapture, captureSecs, setCaptureSecs, piMic,
    piCapture, cancelCapture, stopCapture,
    inFlight,
  }
}

export const CAPTURE_SECONDS = [3, 5, 10, 15, 30, 60]
