import React, { useMemo, useRef, useState } from 'react'
import { PANEL_FEATURES, normalize } from '../lib/panelFeatures.js'
import { indexForTime } from '../lib/nearestIndex.js'

// Spectral panel (v1.5; Design v2 layout, DESIGN_V2.md §4.4) — a 2D view that
// is genuinely separate from the 3D trail. Seven engineered spectral
// descriptors, each in its own lane, stacked on the SAME time axis as the
// spectrogram/scrubber. On the left, a label column names each lane (the name
// is a toggle that hides/shows its line) and shows its value at the playhead.
// The amber playhead runs through every lane and is driven by the shared
// `playheadSec`; hovering the chart shows every line's exact value at the
// cursor, and clicking seeks.
//
// Each lane is an SVG with a fixed viewBox stretched to its box
// (preserveAspectRatio="none"); `vector-effect: non-scaling-stroke` keeps line
// weight crisp regardless of the stretch. All text is HTML, so it never distorts.

const VB_W = 1000 // lane viewBox width (arbitrary; stretched to the lane)
const VB_H = 100  // lane viewBox height
const PAD = 12    // keeps a line off the lane's top/bottom edge

function fmtValue(pf, v) {
  if (typeof v !== 'number' || !isFinite(v)) return '—'
  return pf.fmt(v) + (pf.unit ? ` ${pf.unit}` : '')
}

export default function AnalysisPanel({ features, duration, playheadSec, onSeek }) {
  const wrapRef = useRef(null)
  const [hidden, setHidden] = useState(() => new Set()) // lanes toggled off
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
        const y = VB_H - PAD - normalize(pf, f[pf.key]) * (VB_H - 2 * PAD)
        d += (i === 0 ? 'M' : 'L') + x.toFixed(2) + ',' + y.toFixed(2) + ' '
      }
      out[pf.key] = d
    }
    return out
  }, [features, dur])

  const playheadFrac = dur > 0 ? Math.min(1, Math.max(0, playheadSec / dur)) : 0
  const playFrame = features.length ? features[indexForTime(features, playheadSec)] : null

  // Cursor (hover) frame for the readout.
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
      <div className="h-full grid place-items-center text-sm text-muted-foreground">
        load a clip to see its spectral descriptors
      </div>
    )
  }

  const m = Math.floor(playheadSec / 60)
  const timeTag = `${m}:${(playheadSec - m * 60).toFixed(1).padStart(4, '0')} s`

  return (
    <div className="h-full w-full flex flex-col px-4 sm:px-6 pt-5 pb-4 overflow-y-auto scroll-thin">
      <div className="flex flex-1 min-h-[392px] gap-3 sm:gap-6">
        {/* Label column — name toggles the line; value is at the playhead. */}
        <div className="flex w-[132px] sm:w-[206px] shrink-0 flex-col gap-1.5">
          {PANEL_FEATURES.map((pf) => {
            const off = hidden.has(pf.key)
            return (
              <div key={pf.key} className="flex min-h-[50px] flex-1 flex-col justify-center">
                <button
                  type="button"
                  onClick={() => toggle(pf.key)}
                  aria-pressed={!off}
                  title={off ? `Show ${pf.label}` : `Hide ${pf.label}`}
                  className={'flex items-center gap-2 self-start rounded text-left text-sm sm:text-[15px] font-semibold text-cream transition-opacity ' +
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-night ' +
                    (off ? 'opacity-45 hover:opacity-70' : 'hover:opacity-80')}
                >
                  <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ background: pf.color }} />
                  <span className={off ? 'line-through decoration-1' : ''}>{pf.label}</span>
                </button>
                <span className={'mt-1.5 pl-[18px] font-mono text-xs tabular-nums text-muted-foreground ' + (off ? 'opacity-45' : '')}>
                  {playFrame ? fmtValue(pf, playFrame[pf.key]) : '—'}
                </span>
              </div>
            )
          })}
        </div>

        {/* Lanes + playhead + hover readout */}
        <div
          ref={wrapRef}
          className="relative flex min-w-0 flex-1 cursor-crosshair flex-col gap-1.5"
          onPointerMove={onMove}
          onPointerLeave={() => setHoverX(null)}
          onPointerDown={onSeekEvent}
          onTouchStart={(e) => { onMove(e); onSeekEvent(e) }}
          onTouchMove={(e) => { onMove(e); onSeekEvent(e) }}
        >
          {PANEL_FEATURES.map((pf) => (
            <div key={pf.key} className="min-h-[50px] flex-1 overflow-hidden rounded-sm bg-night-2">
              <svg viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="none" className="block h-full w-full">
                {!hidden.has(pf.key) && (
                  <path d={paths[pf.key]} fill="none" stroke={pf.color}
                    strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
                    vectorEffect="non-scaling-stroke" />
                )}
              </svg>
            </div>
          ))}

          {/* hover cursor line */}
          {hoverX != null && (
            <div
              className="pointer-events-none absolute inset-y-0 w-px border-l border-dashed border-cream/50"
              style={{ left: `${hoverX * 100}%` }}
            />
          )}

          {/* shared playhead (driven by playheadSec) + time tag */}
          <div
            data-testid="panel-playhead"
            className="pointer-events-none absolute inset-y-0 w-0.5 -ml-px bg-amber"
            style={{ left: `${playheadFrac * 100}%` }}
          />
          <div
            className="pointer-events-none absolute top-1.5 whitespace-nowrap rounded-md border border-night-line bg-night px-2.5 py-1.5 font-mono text-xs tabular-nums text-cream"
            style={playheadFrac > 0.85
              ? { right: `calc(${(1 - playheadFrac) * 100}% + 8px)` }
              : { left: `calc(${playheadFrac * 100}% + 8px)` }}
          >
            {timeTag}
          </div>

          {/* Hover readout — every visible line's exact value at the cursor. */}
          {hoverFrame && (
            <div
              className="absolute top-10 z-10 pointer-events-none rounded-[10px] border border-border bg-popover/95 text-popover-foreground backdrop-blur px-3 py-2 text-xs shadow-lg animate-in fade-in-0 zoom-in-95 duration-100"
              style={{
                left: `calc(${hoverX * 100}% ${hoverX > 0.6 ? '- 228px' : '+ 10px'})`,
                width: 218,
              }}
            >
              <div className="mb-1.5 font-mono tabular-nums text-muted-foreground">t = {hoverFrame.t.toFixed(2)} s</div>
              {PANEL_FEATURES.map((pf) => (
                hidden.has(pf.key) ? null : (
                  <div key={pf.key} className="flex items-center justify-between gap-3 leading-relaxed">
                    <span className="flex items-center gap-1.5 text-cream">
                      <span className="inline-block h-2 w-2 rounded-sm" style={{ background: pf.color }} />
                      {pf.label}
                    </span>
                    <span className="font-mono tabular-nums text-muted-foreground">
                      {fmtValue(pf, hoverFrame[pf.key])}
                    </span>
                  </div>
                )
              ))}
            </div>
          )}
        </div>
      </div>

      <p className="mt-4 font-mono text-[13px] text-muted-foreground">
        Values at the playhead · click a name to hide its line · hover the chart for any moment
      </p>
    </div>
  )
}
