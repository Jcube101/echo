import React from 'react'
import { HardDrive, Loader2, Mic, Square, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { CAPTURE_SECONDS, usePiElapsed } from '../lib/useClipActions.js'
import { fmtClock } from '../lib/format.js'

// Header controls (DESIGN_V2.md §4.3): 44px-tall targets. Secondary actions
// are outlined night-2 tiles; Record is the rust primary pill.
export const HEADER_BTN =
  'h-11 rounded-[10px] border border-night-line bg-night-2 px-4 text-[15px] font-medium text-cream shadow-none ' +
  'hover:bg-night-3 focus-visible:ring-2'
const RECORD_BTN =
  'h-11 rounded-full bg-rust px-5 text-[15px] font-semibold text-white shadow-none hover:bg-rust/90 focus-visible:ring-2'

// Pi mic: one outlined tile holding the capture button and its duration chip.
// Shared by the desktop header and the phone home screen. Owner only: both
// render it only when `actions.piMic` is true (see useClipActions).
export function PiMicControl({ actions, busy, className = '' }) {
  const { runCapture, captureSecs, setCaptureSecs, inFlight } = actions
  return (
    <div className={'flex h-11 items-center rounded-[10px] border border-night-line bg-night-2 pr-1.5 ' + className}>
      <Button
        onClick={runCapture}
        disabled={busy}
        title="Record from the Pi's USB mic"
        className="h-full flex-1 rounded-l-[9px] rounded-r-none bg-transparent pl-4 pr-2.5 text-[15px] font-medium text-cream shadow-none hover:bg-night-3 focus-visible:ring-2"
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
          {CAPTURE_SECONDS.map((s) => (
            <SelectItem key={s} value={String(s)} className="font-mono text-xs">{s} s</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

// The Pi mic while it is recording (desktop header): a countdown, Stop (keep
// what was recorded) and Cancel (throw it away), matching browser recording.
// Once the recording time is up it reads "Analysing" and only Cancel remains.
export function PiMicLive({ actions }) {
  const { piCapture, stopCapture, cancelCapture } = actions
  const elapsed = usePiElapsed(piCapture)
  const recording = piCapture.phase === 'recording'
  const pct = Math.min(100, (elapsed / piCapture.seconds) * 100)
  return (
    <div className="flex items-center gap-2" role="group" aria-label="Pi mic recording">
      <div
        role="timer"
        aria-label={recording ? `Pi mic is listening, ${fmtClock(elapsed)} of ${fmtClock(piCapture.seconds)}` : 'Pi mic: analysing the recording'}
        className="flex h-11 items-center gap-2.5 rounded-[10px] border border-night-line bg-night-2 px-3.5 text-[15px] text-cream"
      >
        {recording ? (
          <span className="relative flex h-2 w-2" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber/70" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-amber" />
          </span>
        ) : <Loader2 className="h-4 w-4 animate-spin text-amber" aria-hidden />}
        <span className="font-medium">{recording ? 'Pi mic is listening' : 'Analysing…'}</span>
        {recording && (
          <>
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {fmtClock(elapsed)} / {fmtClock(piCapture.seconds)}
            </span>
            <span className="h-1.5 w-16 overflow-hidden rounded-full bg-night-3" aria-hidden>
              <span className="block h-full bg-amber transition-[width] duration-200 ease-linear" style={{ width: `${pct}%` }} />
            </span>
          </>
        )}
      </div>
      {recording && (
        <Button onClick={stopCapture} disabled={!!piCapture.ending} title="Stop now and keep what was recorded" className={RECORD_BTN}>
          <Square className="fill-current" />
          Stop
        </Button>
      )}
      <Button onClick={cancelCapture} disabled={piCapture.ending === 'cancel'} title="Cancel: nothing is saved" className={HEADER_BTN}>
        <X />
        Cancel
      </Button>
    </div>
  )
}

// Header toolbar: browser recording + file upload + Pi mic capture. The
// behaviour lives in useClipActions (owned by App); this only draws it.
export default function Controls({ actions, busy }) {
  const { recorder, startRecording, pickFile, inFlight } = actions
  const recPct = Math.min(100, (recorder.elapsed / recorder.maxSeconds) * 100)

  // While the Pi mic records, its controls stand alone: Record and Upload
  // can't be used then, and showing all of them wraps the header onto a
  // second row.
  if (actions.piMic && actions.piCapture) {
    return (
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <PiMicLive actions={actions} />
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
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
        onClick={pickFile}
        disabled={busy}
        title="Upload an audio or video file"
        className={HEADER_BTN}
      >
        {inFlight === 'upload' ? <Loader2 className="animate-spin" /> : <Upload />}
        Upload
      </Button>

      {actions.piMic && <PiMicControl actions={actions} busy={busy} />}
    </div>
  )
}
