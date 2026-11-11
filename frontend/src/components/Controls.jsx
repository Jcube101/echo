import React, { useEffect, useRef, useState } from 'react'
import { HardDrive, Loader2, Mic, Square, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useRecorder } from '../lib/useRecorder.js'
import { uploadAudio, captureMic, friendlyError } from '../lib/api.js'

// Header controls (DESIGN_V2.md §4.3): 44px-tall targets. Secondary actions
// are outlined night-2 tiles; Record is the rust primary pill.
export const HEADER_BTN =
  'h-11 rounded-[10px] border border-night-line bg-night-2 px-4 text-[15px] font-medium text-cream shadow-none ' +
  'hover:bg-night-3 focus-visible:ring-2'
const RECORD_BTN =
  'h-11 rounded-full bg-rust px-5 text-[15px] font-semibold text-white shadow-none hover:bg-rust/90 focus-visible:ring-2'

// Toolbar: file upload (picker) + browser recording + Pi mic capture.
// Reports work through onStatus('processing'|'idle'|'error', msg) and
// onResult(apiResponse, { kind, name }) — kind is 'upload' | 'recording' |
// 'pi_mic', which the sidebar's clip card uses to say where the clip came from. Surfaces a toast on every success/failure so nothing
// fails silently or vaguely (recall the historical "Failed to fetch" issue).
export default function Controls({ busy, onStatus, onResult, autoRecord = false }) {
  const fileRef = useRef(null)
  const [captureSecs, setCaptureSecs] = useState('5')
  const [inFlight, setInFlight] = useState(null) // 'upload' | 'capture' | null — which button is spinning

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

  const recPct = Math.min(100, (recorder.elapsed / recorder.maxSeconds) * 100)

  return (
    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
      <input
        ref={fileRef}
        type="file"
        accept="audio/*,video/*,.opus,.m4a,.webm,.ogg"
        className="hidden"
        onChange={onPick}
      />

      {recorder.supported ? (
        recorder.recording ? (
          <div className="flex items-center gap-2">
            <Button onClick={recorder.stop} title="Stop recording" className={RECORD_BTN}>
              <span className="relative flex h-2 w-2" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/70" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
              </span>
              <Square className="fill-current" />
              <span className="tabular-nums">Stop {Math.ceil(recorder.maxSeconds - recorder.elapsed)}s</span>
            </Button>
            <div className="w-24 h-1.5 bg-night-3 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber transition-[width] duration-200 ease-linear"
                style={{ width: `${recPct}%` }}
              />
            </div>
          </div>
        ) : (
          <Button
            onClick={startRecording}
            disabled={busy}
            title="Record from your device mic (max 60s)"
            className={RECORD_BTN}
          >
            <Mic />
            Record
          </Button>
        )
      ) : (
        <span className="text-xs text-muted-foreground">recording unsupported here</span>
      )}

      <Button
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        title="Upload an audio or video file"
        className={HEADER_BTN}
      >
        {inFlight === 'upload' ? <Loader2 className="animate-spin" /> : <Upload />}
        Upload
      </Button>

      {/* Pi mic: one outlined tile holding the capture button and its
          duration chip. */}
      <div className="flex h-11 items-center rounded-[10px] border border-night-line bg-night-2 pr-1.5">
        <Button
          onClick={runCapture}
          disabled={busy}
          title="Record from the Pi's USB mic"
          className="h-full rounded-l-[9px] rounded-r-none bg-transparent pl-4 pr-2.5 text-[15px] font-medium text-cream shadow-none hover:bg-night-3 focus-visible:ring-2"
        >
          {inFlight === 'capture' ? <Loader2 className="animate-spin" /> : <HardDrive />}
          Pi mic
        </Button>
        <Select value={captureSecs} onValueChange={setCaptureSecs} disabled={busy}>
          <SelectTrigger
            className="h-8 w-auto gap-1.5 rounded-md border-none bg-night-3 px-2 font-mono text-xs text-cream shadow-none hover:bg-night-line focus:ring-2 focus:ring-ring"
            title="Capture duration"
            aria-label="Capture duration"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-popover text-popover-foreground border-border">
            {[3, 5, 10, 15, 30, 60].map((s) => (
              <SelectItem key={s} value={String(s)} className="font-mono text-xs">{s} s</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
