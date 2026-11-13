import React, { useEffect, useState } from 'react'
import { ChevronLeft, History, Loader2, Mic, Play, Square, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Wordmark from './Wordmark.jsx'
import { HEADER_BTN, PiMicControl } from './Controls.jsx'
import { usePiElapsed } from '../lib/useClipActions.js'
import { getSamples } from '../lib/api.js'
import { fmtClock, fmtSigned } from '../lib/format.js'
import { thumbFor } from '../lib/sampleArt.js'

// Phone layouts (DESIGN_V2.md §4.5–4.7), shown below 640px. App decides which
// screen is up; these only draw it. Touch targets are at least 44px.

const ICON_BTN =
  'grid h-12 w-12 shrink-0 place-items-center rounded-[14px] border border-night-line bg-night-2 text-cream ' +
  'hover:bg-night-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export function HistoryButton({ onClick }) {
  return (
    <button type="button" onClick={onClick} title="Browse past clips" aria-label="History" className={ICON_BTN}>
      <History className="h-5 w-5" aria-hidden />
    </button>
  )
}

// The four samples the home screen leads with (the mockup's picks); if the
// library changes, whatever comes first fills the gaps.
const FEATURED = ['asian-koel', 'common-myna', 'wolf-howl', 'lion-roar']
export function featuredSamples(all, ids = FEATURED) {
  const picked = ids.map((id) => all.find((s) => s.id === id)).filter(Boolean)
  for (const s of all) {
    if (picked.length >= 4) break
    if (!picked.includes(s)) picked.push(s)
  }
  return picked.slice(0, 4)
}

// --- §4.5 App home (idle) ----------------------------------------------------
export function PhoneHome({ actions, busy, onOpenHistory, onOpenSamples, onPickSample, loadingSampleId }) {
  const { recorder, startRecording, pickFile, inFlight } = actions
  const [samples, setSamples] = useState([])

  useEffect(() => {
    let live = true
    getSamples().then((rows) => { if (live) setSamples(rows) }).catch(() => {})
    return () => { live = false }
  }, [])

  const featured = featuredSamples(samples)

  return (
    <div className="flex h-full flex-col overflow-y-auto scroll-thin px-5 pb-8">
      <header className="flex items-center justify-between py-3">
        <Wordmark />
        <HistoryButton onClick={onOpenHistory} />
      </header>

      <div className="flex flex-col items-center pt-3">
        {recorder.supported ? (
          <button
            type="button"
            onClick={startRecording}
            disabled={busy}
            title="Record from your device mic (max 60s)"
            aria-label="Record"
            className={'grid h-[168px] w-[168px] place-items-center rounded-full bg-rust text-white transition-transform ' +
              'shadow-[0_0_0_14px_rgba(181,83,42,0.22),0_0_0_30px_rgba(181,83,42,0.1)] ' +
              'active:scale-95 disabled:opacity-60 ' +
              'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber'}
          >
            <Mic className="h-12 w-12" strokeWidth={2} aria-hidden />
          </button>
        ) : (
          <div className="grid h-[168px] w-[168px] place-items-center rounded-full bg-night-3 px-6 text-center text-sm text-muted-foreground">
            Recording isn’t supported in this browser
          </div>
        )}
        <h2 className="mt-11 font-display text-[26px] font-semibold leading-tight text-cream">
          {recorder.supported ? 'Tap to record' : 'Upload a clip instead'}
        </h2>
        <p className="mt-2 text-[15px] text-muted-foreground">Up to 60 seconds</p>
      </div>

      <div className={'mt-7 grid gap-3 ' + (actions.piMic ? 'grid-cols-2' : 'grid-cols-1')}>
        <Button onClick={pickFile} disabled={busy} title="Upload an audio or video file" className={HEADER_BTN + ' h-[52px] rounded-[14px]'}>
          {inFlight === 'upload' ? <Loader2 className="animate-spin" /> : <Upload />}
          Upload
        </Button>
        {actions.piMic && <PiMicControl actions={actions} busy={busy} className="h-[52px] rounded-[14px]" />}
      </div>

      <section aria-label="Samples" className="mt-8">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[15px] font-semibold text-cream">Or try a sample</h2>
          <button
            type="button"
            onClick={onOpenSamples}
            title="Curated example sounds"
            className="rounded py-1 text-[15px] text-amber hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {samples.length ? `All ${samples.length}` : 'All samples'}
          </button>
        </div>
        <ul className="mt-2">
          {featured.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                data-testid="home-sample"
                onClick={() => onPickSample(s.id)}
                disabled={busy}
                className="flex min-h-[60px] w-full items-center justify-between gap-3 border-b border-night-line py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                {thumbFor(s.id)
                  ? <img src={thumbFor(s.id)} alt="" width="72" height="44" loading="lazy" className="h-11 w-[72px] shrink-0 rounded-lg object-cover" />
                  : <span className="h-11 w-[72px] shrink-0 rounded-lg bg-[#16201A]" aria-hidden />}
                <span className="min-w-0 flex-1">
                  <span className="block text-[17px] font-medium text-cream">{s.species}</span>
                  <span className="block text-sm text-muted-foreground">{Math.round(s.duration_s)} s</span>
                </span>
                {loadingSampleId === s.id
                  ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
                  : <Play className="h-4 w-4 fill-current text-muted-foreground" aria-hidden />}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

// --- §4.6 Recording ----------------------------------------------------------
const RING_R = 130
const RING_C = 2 * Math.PI * RING_R

export function PhoneRecording({ recorder, onOpenHistory }) {
  const { elapsed, maxSeconds, levels, levelBars } = recorder
  const frac = Math.min(1, elapsed / maxSeconds)
  // Newest level on the right of the filled run; the rest are dim placeholders.
  const bars = Array.from({ length: levelBars }, (_, i) => (i < levels.length ? levels[i] : null))

  return (
    <div className="flex h-full flex-col overflow-y-auto px-5 pb-6">
      <header className="flex items-center justify-between py-3">
        <Wordmark />
        <HistoryButton onClick={onOpenHistory} />
      </header>

      <div className="mt-4 text-center">
        <div className="font-mono text-[13px] uppercase tracking-[0.12em] text-amber">Listening</div>
        <h2 className="mt-2 font-display text-[30px] font-semibold leading-tight text-cream">Point toward the sound</h2>
      </div>

      <div className="relative mx-auto mt-8 h-[280px] w-[280px] shrink-0" role="timer" aria-label={`Recording, ${fmtClock(elapsed)} of ${fmtClock(maxSeconds)}`}>
        <svg viewBox="0 0 280 280" className="h-full w-full -rotate-90" aria-hidden>
          <circle cx="140" cy="140" r={RING_R} fill="none" stroke="#2E3D33" strokeWidth="10" />
          <circle
            cx="140" cy="140" r={RING_R} fill="none" stroke="#E8B04B" strokeWidth="10" strokeLinecap="round"
            strokeDasharray={RING_C} strokeDashoffset={RING_C * (1 - frac)}
            style={{ transition: 'stroke-dashoffset 200ms linear' }}
          />
        </svg>
        <div className="absolute inset-0 grid place-content-center text-center">
          <div className="font-mono text-[56px] leading-none tabular-nums text-cream">{fmtClock(elapsed)}</div>
          <div className="mt-3 text-[15px] text-muted-foreground">of {fmtClock(maxSeconds)} max</div>
        </div>
      </div>

      <div className="mx-auto mt-8 flex h-[56px] w-full max-w-[320px] items-center justify-between" aria-hidden>
        {bars.map((lv, i) => (
          <span
            key={i}
            className={'w-[3px] rounded-full ' + (lv == null ? 'bg-night-line' : 'bg-amber')}
            style={{ height: `${lv == null ? 14 + ((i * 7) % 5) * 5 : Math.max(8, lv * 100)}%` }}
          />
        ))}
      </div>

      <div className="mt-auto pt-8">
        <button
          type="button"
          onClick={recorder.stop}
          title="Stop recording"
          className="flex h-16 w-full items-center justify-center gap-3 rounded-full bg-rust text-[17px] font-semibold text-white active:bg-rust/90 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber"
        >
          <Square className="h-4 w-4 fill-current" aria-hidden />
          Stop and see its shape
        </button>
        <button
          type="button"
          onClick={recorder.cancel}
          className="mt-2 h-12 w-full rounded-full text-[17px] text-muted-foreground hover:text-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Cancel
        </button>
        <p className="mt-2 text-center text-sm leading-relaxed text-muted-foreground">
          Echo stops by itself at one minute. The mic switches off as soon as you stop.
        </p>
      </div>
    </div>
  )
}

// Pi mic recording (phone): the same screen as browser recording, for the
// same reason: you should always see that a mic is listening, and be able to
// stop it. There are no live level bars because the sound is on the Pi, not
// on this phone. Stop keeps what was recorded; Cancel throws it away.
export function PiMicRecording({ actions, onOpenHistory }) {
  const { piCapture, stopCapture, cancelCapture } = actions
  const elapsed = usePiElapsed(piCapture)
  const recording = piCapture.phase === 'recording'
  const frac = recording ? Math.min(1, elapsed / piCapture.seconds) : 1

  return (
    <div className="flex h-full flex-col overflow-y-auto px-5 pb-6">
      <header className="flex items-center justify-between py-3">
        <Wordmark />
        <HistoryButton onClick={onOpenHistory} />
      </header>

      <div className="mt-4 text-center">
        <div className="font-mono text-[13px] uppercase tracking-[0.12em] text-amber">
          {recording ? 'Listening' : 'Analysing'}
        </div>
        <h2 className="mt-2 font-display text-[30px] font-semibold leading-tight text-cream">
          {recording ? 'Pi mic is listening' : 'Drawing its shape'}
        </h2>
      </div>

      <div
        className="relative mx-auto mt-8 h-[280px] w-[280px] shrink-0"
        role="timer"
        aria-label={recording ? `Pi mic is listening, ${fmtClock(elapsed)} of ${fmtClock(piCapture.seconds)}` : 'Analysing the recording'}
      >
        <svg viewBox="0 0 280 280" className="h-full w-full -rotate-90" aria-hidden>
          <circle cx="140" cy="140" r={RING_R} fill="none" stroke="#2E3D33" strokeWidth="10" />
          <circle
            cx="140" cy="140" r={RING_R} fill="none" stroke="#E8B04B" strokeWidth="10" strokeLinecap="round"
            strokeDasharray={RING_C} strokeDashoffset={RING_C * (1 - frac)}
            style={{ transition: 'stroke-dashoffset 200ms linear' }}
          />
        </svg>
        <div className="absolute inset-0 grid place-content-center text-center">
          {recording ? (
            <>
              <div className="font-mono text-[56px] leading-none tabular-nums text-cream">{fmtClock(elapsed)}</div>
              <div className="mt-3 text-[15px] text-muted-foreground">of {fmtClock(piCapture.seconds)}</div>
            </>
          ) : (
            <Loader2 className="mx-auto h-12 w-12 animate-spin text-amber" aria-hidden />
          )}
        </div>
      </div>

      <p className="mx-auto mt-8 max-w-[320px] text-center text-[15px] leading-relaxed text-muted-foreground" aria-live="polite">
        {recording
          ? 'Recording on the Pi, not on this phone.'
          : 'The recording is done. This takes a few seconds.'}
      </p>

      <div className="mt-auto pt-8">
        {recording && (
          <button
            type="button"
            onClick={stopCapture}
            disabled={!!piCapture.ending}
            title="Stop now and keep what was recorded"
            className="flex h-16 w-full items-center justify-center gap-3 rounded-full bg-rust text-[17px] font-semibold text-white active:bg-rust/90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber"
          >
            <Square className="h-4 w-4 fill-current" aria-hidden />
            Stop and see its shape
          </button>
        )}
        <button
          type="button"
          onClick={cancelCapture}
          disabled={piCapture.ending === 'cancel'}
          className="mt-2 h-12 w-full rounded-full text-[17px] text-muted-foreground hover:text-cream disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {piCapture.ending === 'cancel' ? 'Cancelling…' : 'Cancel'}
        </button>
        <p className="mt-2 text-center text-sm leading-relaxed text-muted-foreground">
          It stops by itself at {piCapture.seconds} seconds. If you lock the phone or leave the app,
          the Pi still finishes and the clip appears in History.
        </p>
      </div>
    </div>
  )
}

// --- §4.7 Result: header + readout chips (App supplies stage and dock) --------
export function PhoneResultHeader({ title, subtitle, onBack, onOpenHistory }) {
  return (
    <header className="flex items-center gap-2 px-3 py-3">
      <button
        type="button"
        onClick={onBack}
        title="Back"
        aria-label="Back to home"
        className="grid h-12 w-12 shrink-0 place-items-center rounded-[14px] text-cream hover:bg-night-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronLeft className="h-6 w-6" aria-hidden />
      </button>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[17px] font-semibold leading-tight text-cream">{title}</h1>
        <div className="truncate text-sm text-muted-foreground">{subtitle}</div>
      </div>
      <HistoryButton onClick={onOpenHistory} />
    </header>
  )
}

export function PlayheadChips({ frame }) {
  const items = [['Pitch', frame?.pitch], ['Timbre', frame?.timbre], ['Motion', frame?.motion]]
  return (
    <div className="grid grid-cols-3 gap-2" role="group" aria-label="At the playhead">
      {items.map(([label, v]) => (
        <div key={label} className="rounded-[14px] border border-night-line bg-night-2 px-3 py-2">
          <div className="text-[13px] text-muted-foreground">{label}</div>
          <div className="font-mono text-[15px] tabular-nums text-cream">{typeof v === 'number' ? fmtSigned(v) : '—'}</div>
        </div>
      ))}
    </div>
  )
}
