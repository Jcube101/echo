import React, { useRef, useState } from 'react'
import { Loader2, Mic, Square, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useRecorder } from '../lib/useRecorder.js'
import { uploadAudio, captureMic, friendlyError } from '../lib/api.js'

// Toolbar buttons keep Echo's existing neutral translucent look (bg-white/10,
// hover bg-white/20) rather than shadcn Button's default filled "secondary"
// look — passed as an explicit className override on top of the primitive so
// the pixel-level identity Echo already has is preserved (Part A goal), while
// still getting Button's real value: focus-visible ring, disabled state,
// consistent sizing, and a slot for the loading spinner.
const TOOLBAR_BTN = 'bg-white/10 hover:bg-white/20 text-slate-100'

// Toolbar: file upload (picker) + browser recording + Pi mic capture.
// Reports work through onStatus('processing'|'idle'|'error', msg) and
// onResult(apiResponse). Surfaces a toast on every success/failure so nothing
// fails silently or vaguely (recall the historical "Failed to fetch" issue).
export default function Controls({ busy, onStatus, onResult }) {
  const fileRef = useRef(null)
  const [captureSecs, setCaptureSecs] = useState('5')
  const [inFlight, setInFlight] = useState(null) // 'upload' | 'capture' | null — which button is spinning

  async function runUpload(fileOrBlob, name) {
    setInFlight('upload')
    onStatus('processing', 'Analyzing audio…')
    try {
      const res = await uploadAudio(fileOrBlob, name)
      onResult(res)
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

  const recorder = useRecorder((blob, name) => runUpload(blob, name))

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
      onResult(res)
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

  const recPct = Math.min(100, (recorder.elapsed / recorder.maxSeconds) * 100)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={fileRef}
        type="file"
        accept="audio/*,video/*,.opus,.m4a,.webm,.ogg"
        className="hidden"
        onChange={onPick}
      />

      <Button
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        title="Upload an audio or video file"
        className={TOOLBAR_BTN}
      >
        {inFlight === 'upload' ? <Loader2 className="animate-spin" /> : <Upload />}
        Upload file
      </Button>

      {recorder.supported ? (
        recorder.recording ? (
          <div className="flex items-center gap-2">
            <Button onClick={recorder.stop} variant="destructive" title="Stop recording">
              <span className="relative flex h-2 w-2" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/70" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
              </span>
              <Square className="fill-current" />
              Stop {Math.ceil(recorder.maxSeconds - recorder.elapsed)}s
            </Button>
            <div className="w-24 h-1.5 bg-white/10 rounded overflow-hidden">
              <div
                className="h-full bg-rose-400 transition-[width] duration-200 ease-linear"
                style={{ width: `${recPct}%` }}
              />
            </div>
          </div>
        ) : (
          <Button
            onClick={startRecording}
            disabled={busy}
            title="Record from your device mic (max 60s)"
            className={TOOLBAR_BTN}
          >
            <span className="h-2.5 w-2.5 rounded-full bg-rose-500" aria-hidden />
            Record
          </Button>
        )
      ) : (
        <span className="text-xs text-slate-500">recording unsupported here</span>
      )}

      <div className="flex items-center gap-1 ml-1">
        <Button
          onClick={runCapture}
          disabled={busy}
          title="Record from the Pi's USB mic"
          className={TOOLBAR_BTN}
        >
          {inFlight === 'capture' ? <Loader2 className="animate-spin" /> : <Mic />}
          Pi mic
        </Button>
        <Select value={captureSecs} onValueChange={setCaptureSecs} disabled={busy}>
          <SelectTrigger
            className="w-[4.5rem] h-9 bg-white/10 hover:bg-white/20 border-none text-sm text-slate-100 focus:ring-1 focus:ring-ring"
            title="Capture duration"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-popover text-popover-foreground border-border">
            {[3, 5, 10, 15, 30, 60].map((s) => (
              <SelectItem key={s} value={String(s)}>{s}s</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
