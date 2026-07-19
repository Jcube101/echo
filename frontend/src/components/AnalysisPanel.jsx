import React, { useMemo, useRef, useState } from 'react'
import { PANEL_FEATURES, normalize } from '../lib/panelFeatures.js'
import { indexForTime } from '../lib/nearestIndex.js'

// v1.5 Spectral Analysis panel — a 2D multi-line time-series view, a genuinely
// separate view from the 3D trail (App swaps between them via a header toggle).
// Six/seven engineered spectral descriptors plotted against the SAME time axis
// as the spectrogram/scrubber; the playhead marker is driven by the shared
// `playheadSec` state, so dragging the main scrubber moves it here too. A
// hover/tap readout shows every line's exact value at the cursor — a 7-line
// chart is unreadable without one.
//
// Rendered as an SVG with a fixed viewBox stretched to the container
// (preserveAspectRatio="none"); `vector-effect: non-scaling-stroke` keeps line
// weight crisp regardless of the horizontal stretch. Text (legend, readout,
// axes) is HTML positioned over the SVG so it never distorts.

const VB_W = 1000 // viewBox width (arbitrary; stretched to container)
const VB_H = 260  // viewBox height

function fmtTime(s) {
  if (!isFinite(s) || s < 0) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function timeTicks(duration) {
  if (!duration || duration <= 0) return []
  const n = 4
  return Array.from({ length: n + 1 }, (_, i) => ({ t: (duration * i) / n, pos: i / n }))
}

export default function AnalysisPanel({ features, duration, playheadSec, onSeek }) {
  const wrapRef = useRef(null)
  const [hidden, setHidden] = useState(() => new Set()) // legend toggles
  const [hoverX, setHoverX] = useState(null)            // 0..1 fraction, or null

  const dur = duration || (features.length ? features[features.length - 1].t : 0)

  // One SVG path per feature (built once per clip). x = t/dur, y = normalized.
  const paths = useMemo(() => {
    if (!features.length || dur <= 0) return {}
    const out = {}
    for (const pf of PANEL_FEATURES) {
      let d = ''
      for (let i = 0; i < features.length; i++) {
        const f = features[i]
        const x = (f.t / dur) * VB_W
        const y = VB_H - normalize(pf, f[pf.key]) * VB_H
        d += (i === 0 ? 'M' : 'L') + x.toFixed(2) + ',' + y.toFixed(2) + ' '
      }
      out[pf.key] = d
    }
    return out
  }, [features, dur])

  const gridY = [0, 0.25, 0.5, 0.75, 1]
  const tTicks = useMemo(() => timeTicks(dur), [dur])

  const playheadFrac = dur > 0 ? Math.min(1, Math.max(0, playheadSec / dur)) : 0

  // Cursor (hover) index + its px position for the readout.
  const hoverIdx = hoverX == null ? null : indexForTime(features, hoverX * dur)
  const hoverFrame = hoverIdx == null ? null : features[hoverIdx]

  function fracFromEvent(e) {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return null
    const cx = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left
    return Math.min(1, Math.max(0, cx / rect.width))
  }

  function onMove(e) {
    const frac = fracFromEvent(e)
    if (frac != null) setHoverX(frac)
  }

  function onLeave() {
    setHoverX(null)
  }

  // Click / drag seeks the shared playhead (same time state as the scrubber).
  function onSeekEvent(e) {
    const frac = fracFromEvent(e)
    if (frac != null && onSeek) onSeek(frac * dur)
  }

  function toggle(key) {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (!features.length) {
    return (
      <div className="h-full grid place-items-center text-sm text-slate-600">
        load a clip to see its spectral descriptors
      </div>
    )
  }

  return (
    <div className="h-full w-full flex flex-col p-3 sm:p-4 gap-3 overflow-y-auto scroll-thin">
      {/* Legend — click a chip to toggle its line. Names use the proper
          spectral terms (identity is never colour-alone). */}
      <div className="flex flex-wrap gap-x-3 gap-y-1.5">
        {PANEL_FEATURES.map((pf) => {
          const off = hidden.has(pf.key)
          return (
            <button
              key={pf.key}
              onClick={() => toggle(pf.key)}
              className={'flex items-center gap-1.5 text-[11px] sm:text-xs rounded px-1.5 py-0.5 transition ' +
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-ink ' +
                (off ? 'opacity-35 hover:opacity-60' : 'hover:bg-white/10')}
              title={off ? `Show ${pf.label}` : `Hide ${pf.label}`}
            >
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: pf.color }} />
              <span className="text-slate-200">{pf.label}</span>
            </button>
          )
        })}
      </div>

      {/* Chart area */}
      <div className="relative flex-1 min-h-[220px]">
        {/* y-axis hint labels (normalized lanes) */}
        <div className="absolute left-0 top-0 bottom-5 w-8 flex flex-col justify-between text-[9px] text-slate-600 tabular-nums pointer-events-none">
          <span>max</span>
          <span>min</span>
        </div>

        <div
          ref={wrapRef}
          className="absolute left-8 right-0 top-0 bottom-5 rounded-md border border-white/10 bg-black/30 overflow-hidden cursor-crosshair"
          onPointerMove={onMove}
          onPointerLeave={onLeave}
          onPointerDown={onSeekEvent}
          onTouchStart={(e) => { onMove(e); onSeekEvent(e) }}
          onTouchMove={(e) => { onMove(e); onSeekEvent(e) }}
        >
          <svg
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            preserveAspectRatio="none"
            className="block h-full w-full"
          >
            {/* horizontal gridlines */}
            {gridY.map((g) => (
              <line key={g} x1={0} x2={VB_W} y1={g * VB_H} y2={g * VB_H}
                stroke="rgba(255,255,255,0.07)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ))}
            {/* vertical time gridlines */}
            {tTicks.map((tt, i) => (
              <line key={i} x1={tt.pos * VB_W} x2={tt.pos * VB_W} y1={0} y2={VB_H}
                stroke="rgba(255,255,255,0.05)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ))}
            {/* feature lines */}
            {PANEL_FEATURES.map((pf) => (
              hidden.has(pf.key) ? null : (
                <path key={pf.key} d={paths[pf.key]} fill="none" stroke={pf.color}
                  strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
                  vectorEffect="non-scaling-stroke" opacity={0.95} />
              )
            ))}
            {/* hover cursor line */}
            {hoverX != null && (
              <line x1={hoverX * VB_W} x2={hoverX * VB_W} y1={0} y2={VB_H}
                stroke="rgba(255,255,255,0.45)" strokeWidth={1} strokeDasharray="4 3"
                vectorEffect="non-scaling-stroke" />
            )}
            {/* shared playhead (driven by playheadSec) */}
            <line x1={playheadFrac * VB_W} x2={playheadFrac * VB_W} y1={0} y2={VB_H}
              stroke="rgba(45,212,191,0.95)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          </svg>

          {/* Hover readout — every visible line's exact value at the cursor. */}
          {hoverFrame && (
            <div
              className="absolute top-1 z-10 pointer-events-none rounded-md border border-border bg-popover/95 text-popover-foreground backdrop-blur px-2 py-1.5 text-[10.5px] shadow-lg animate-in fade-in-0 zoom-in-95 duration-100"
              style={{
                left: `calc(${hoverX * 100}% ${hoverX > 0.6 ? '- 168px' : '+ 8px'})`,
                minWidth: 150,
              }}
            >
              <div className="text-slate-400 tabular-nums mb-1">t = {hoverFrame.t.toFixed(2)}s</div>
              {PANEL_FEATURES.map((pf) => (
                hidden.has(pf.key) ? null : (
                  <div key={pf.key} className="flex items-center justify-between gap-3 leading-tight">
                    <span className="flex items-center gap-1.5 text-slate-300">
                      <span className="inline-block h-2 w-2 rounded-sm" style={{ background: pf.color }} />
                      {pf.label}
                    </span>
                    <span className="tabular-nums text-slate-100">
                      {pf.fmt(hoverFrame[pf.key])}{pf.unit ? ` ${pf.unit}` : ''}
                    </span>
                  </div>
                )
              ))}
            </div>
          )}
        </div>

        {/* Time axis */}
        <div className="absolute left-8 right-0 bottom-0 h-4 text-[9px] text-slate-400">
          {tTicks.map((tt, i) => (
            <span key={i} className="absolute top-0 tabular-nums"
              style={{
                left: `${tt.pos * 100}%`,
                transform: i === 0 ? 'none' : i === tTicks.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)',
              }}>
              {fmtTime(tt.t)}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
