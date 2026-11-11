import React, { useEffect, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { getHistory } from '../lib/api.js'
import { fmtClock, fmtSigned, fmtWhen } from '../lib/format.js'
import { WORLD } from '../lib/features.js'

// Desktop sidebar (DESIGN_V2.md §4.3): the loaded clip's details, a read-only
// readout of where the playhead is in the box, and the three latest clips.

// What /history can tell us about a stored clip. The API records browser
// recordings and file uploads under the same source_type ("upload"), so a clip
// reloaded from history can't say which it was; a clip made in this session can
// (see clipLabel).
const SOURCE_LABEL = {
  upload: 'Upload or recording',
  pi_mic: 'Pi microphone',
}
export function sourceLabel(sourceType) {
  return SOURCE_LABEL[sourceType] || 'Clip'
}

function clipLabel(info) {
  if (info.kind === 'recording') return 'Recorded in browser'
  if (info.kind === 'upload') return info.name ? `Uploaded · ${info.name}` : 'Uploaded'
  if (info.kind === 'pi_mic') return 'Pi microphone'
  return sourceLabel(info.sourceType)
}

function Eyebrow({ children }) {
  return (
    <div className="font-mono text-xs uppercase tracking-[0.12em] text-amber">{children}</div>
  )
}

function ClipCard({ sampleMeta, clipInfo, duration }) {
  if (sampleMeta) {
    return (
      <section aria-label="Loaded clip">
        <Eyebrow>Sample</Eyebrow>
        <h2 className="mt-2 font-display text-[28px] font-semibold leading-tight text-cream">
          {sampleMeta.species}
        </h2>
        {sampleMeta.sci_name && (
          <div className="mt-1 italic text-muted-foreground">{sampleMeta.sci_name}</div>
        )}
        <div className="mt-3 text-sm leading-relaxed text-muted-foreground">
          <div>{duration.toFixed(1)} s · rec. {sampleMeta.recordist}</div>
          <div>
            <a href={sampleMeta.license_url} target="_blank" rel="noopener noreferrer"
               className="underline decoration-dotted underline-offset-2 hover:text-cream">
              {sampleMeta.license}
            </a>
            {' · '}
            <a href={sampleMeta.source_url} target="_blank" rel="noopener noreferrer"
               className="inline-flex items-center gap-1 text-amber hover:underline">
              {sampleMeta.provider === 'freesound' ? 'Freesound' : 'Xeno-canto'}
              <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          </div>
        </div>
      </section>
    )
  }

  if (clipInfo) {
    return (
      <section aria-label="Loaded clip">
        <Eyebrow>Clip</Eyebrow>
        <h2 className="mt-2 break-words font-display text-2xl font-semibold leading-tight text-cream">
          {clipLabel(clipInfo)}
        </h2>
        <div className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {duration.toFixed(1)} s{clipInfo.createdAt ? ` · ${fmtWhen(clipInfo.createdAt)}` : ''}
        </div>
      </section>
    )
  }

  return (
    <section aria-label="Loaded clip">
      <Eyebrow>Example</Eyebrow>
      <h2 className="mt-2 font-display text-2xl font-semibold leading-tight text-cream">
        Example trail
      </h2>
      <div className="mt-3 text-sm leading-relaxed text-muted-foreground">
        Record, upload or pick a sample to see a sound of your own.
      </div>
    </section>
  )
}

// One read-only −WORLD…+WORLD track with a centre mark and an amber dot.
function AxisReadout({ label, value }) {
  const pct = Math.min(100, Math.max(0, ((value + WORLD) / (2 * WORLD)) * 100))
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[15px] text-cream">{label}</span>
        <span className="font-mono text-sm tabular-nums text-muted-foreground">{fmtSigned(value)}</span>
      </div>
      <div className="relative mt-2 h-1.5 rounded-full bg-night-line" aria-hidden>
        <span className="absolute left-1/2 top-1/2 h-3 w-px -translate-y-1/2 bg-muted-foreground/50" />
        <span
          className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber"
          style={{ left: `${pct}%` }}
        />
      </div>
    </div>
  )
}

function PlayheadReadout({ frame, playheadSec }) {
  return (
    <section aria-label="At the playhead" className="rounded-[20px] bg-night-3 p-[18px]">
      <div className="text-[13px] text-muted-foreground">
        Where the playhead is · <span className="font-mono tabular-nums">{fmtClock(playheadSec)}</span>
      </div>
      {frame ? (
        <div className="mt-3 space-y-4">
          <AxisReadout label="Pitch" value={frame.pitch} />
          <AxisReadout label="Timbre" value={frame.timbre} />
          <AxisReadout label="Motion" value={frame.motion} />
          <div className="flex items-baseline justify-between">
            <span className="text-[15px] text-cream">Loudness</span>
            <span className="font-mono text-sm tabular-nums text-muted-foreground">
              {Math.round(Math.min(1, Math.max(0, frame.amplitude)) * 100)}%
            </span>
          </div>
        </div>
      ) : (
        <div className="mt-3 text-sm text-muted-foreground">No clip loaded.</div>
      )}
    </section>
  )
}

function RecentClips({ refreshKey, currentId, onPick, onOpenHistory }) {
  const [items, setItems] = useState(null) // null = not loaded yet
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    getHistory()
      .then((rows) => { if (live) { setItems(rows); setFailed(false) } })
      .catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [refreshKey])

  const total = items ? items.length : 0
  const recent = items ? items.slice(0, 3) : []

  return (
    <section aria-label="Recent clips">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[15px] font-semibold text-cream">Recent clips</h2>
        <button
          type="button"
          onClick={onOpenHistory}
          className="rounded text-sm text-amber hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {total > 3 ? `All ${total}` : 'History'}
        </button>
      </div>

      <div className="mt-3 border-t border-night-line">
        {failed && (
          <div className="py-4 text-sm text-muted-foreground">Couldn’t load recent clips.</div>
        )}
        {!failed && items && recent.length === 0 && (
          <div className="py-4 text-sm text-muted-foreground">
            Nothing yet. Clips you record or upload appear here.
          </div>
        )}
        {recent.map((it) => (
          <button
            key={it.id}
            type="button"
            data-testid="recent-clip"
            onClick={() => onPick(it.id)}
            aria-current={it.id === currentId ? 'true' : undefined}
            className={'flex w-full items-center justify-between gap-3 border-b border-night-line py-3.5 text-left transition-colors ' +
              'hover:bg-night-3/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ' +
              (it.id === currentId ? 'bg-night-3/60' : '')}
          >
            <span className="min-w-0">
              <span className="block truncate text-[15px] text-cream">{sourceLabel(it.source_type)}</span>
              <span className="block text-[13px] text-muted-foreground">{fmtWhen(it.created_at)}</span>
            </span>
            <span className="shrink-0 font-mono text-[13px] tabular-nums text-muted-foreground">
              {fmtClock(it.duration_s)}
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}

export default function Sidebar({
  sampleMeta, clipInfo, duration, frame, playheadSec,
  historyKey, currentId, onPickClip, onOpenHistory,
}) {
  return (
    <aside
      aria-label="Clip details"
      className="w-[360px] shrink-0 space-y-7 overflow-y-auto scroll-thin border-l border-night-line bg-night-2 p-6"
    >
      <ClipCard sampleMeta={sampleMeta} clipInfo={clipInfo} duration={duration} />
      <PlayheadReadout frame={frame} playheadSec={playheadSec} />
      <RecentClips
        refreshKey={historyKey}
        currentId={currentId}
        onPick={onPickClip}
        onOpenHistory={onOpenHistory}
      />
    </aside>
  )
}
