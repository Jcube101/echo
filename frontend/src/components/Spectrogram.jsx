import React, { useEffect, useMemo, useRef } from 'react'
import { fmtClock } from '../lib/format.js'

// Design v2 ramp (DESIGN_V2.md D5): night-green → deep green → amber → cream.
const STOPS = [
  [0.0, [0x16, 0x20, 0x1a]],
  [0.35, [0x2f, 0x4a, 0x3a]],
  [0.7, [0xe8, 0xb0, 0x4b]],
  [1.0, [0xf4, 0xef, 0xe4]],
]
function ramp(v) {
  const t = v / 255
  for (let i = 0; i < STOPS.length - 1; i++) {
    const [t0, c0] = STOPS[i]
    const [t1, c1] = STOPS[i + 1]
    if (t >= t0 && t <= t1) {
      const f = (t - t0) / (t1 - t0)
      return [
        c0[0] + (c1[0] - c0[0]) * f,
        c0[1] + (c1[1] - c0[1]) * f,
        c0[2] + (c1[2] - c0[2]) * f,
      ]
    }
  }
  return STOPS[STOPS.length - 1][1]
}

// ~5 evenly spaced time ticks across the clip (aligns with the linear scrubber).
function timeTicks(duration) {
  if (!duration || duration <= 0) return []
  const n = 4
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = (duration * i) / n
    return { t, pos: i / n }
  })
}

const STRIP_PX = 96      // strip height (Tailwind h-24)
const MIN_TICK_GAP = 14  // px — closer Hz ticks than this overlap as text

// Drop any Hz tick closer than MIN_TICK_GAP to its neighbour. Walks from the
// top down so the high, well-spaced ticks win and the crowded low end thins
// out (250 goes when it collides with 500).
export function visibleFreqTicks(ticks, heightPx = STRIP_PX) {
  const sorted = [...ticks].sort((a, b) => b.pos - a.pos)
  const kept = []
  for (const tk of sorted) {
    const last = kept[kept.length - 1]
    if (!last || (last.pos - tk.pos) * heightPx >= MIN_TICK_GAP) kept.push(tk)
  }
  return kept
}

// The mel-spectrogram painted to a crisp, container-filling strip with a
// logarithmic (mel) Hz axis on the left and a time axis below — both driven by
// data from the backend (freq_ticks) and the clip duration. The image is
// rendered from its native cols×bins into an offscreen canvas, then bilinearly
// upscaled to the container size (× devicePixelRatio) so it fills any width with
// no blocky pixelation, and re-fits on resize/orientation change.
export default function Spectrogram({ spectrogram, progress = 0, duration = 0 }) {
  const canvasRef = useRef(null)
  const wrapRef = useRef(null)
  const offRef = useRef(null)

  const hasData = spectrogram && spectrogram.cols > 0

  // Build the native-resolution offscreen image whenever the data changes.
  useEffect(() => {
    if (!hasData) { offRef.current = null; return }
    const { bins, cols, data } = spectrogram
    const off = document.createElement('canvas')
    off.width = cols
    off.height = bins
    const octx = off.getContext('2d')
    const img = octx.createImageData(cols, bins)
    for (let x = 0; x < cols; x++) {
      for (let b = 0; b < bins; b++) {
        const v = data[x * bins + b]
        const [r, g, bl] = ramp(v)
        const y = bins - 1 - b // flip so low frequencies sit at the bottom
        const idx = (y * cols + x) * 4
        img.data[idx] = r
        img.data[idx + 1] = g
        img.data[idx + 2] = bl
        img.data[idx + 3] = 255
      }
    }
    octx.putImageData(img, 0, 0)
    offRef.current = off
  }, [spectrogram, hasData])

  // Fit the visible canvas to its container and (bilinearly) upscale the image.
  useEffect(() => {
    if (!hasData) return
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return

    const draw = () => {
      const off = offRef.current
      if (!off) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = Math.max(1, wrap.clientWidth)
      const h = Math.max(1, wrap.clientHeight)
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      const ctx = canvas.getContext('2d')
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(off, 0, 0, off.width, off.height, 0, 0, canvas.width, canvas.height)
    }

    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(wrap)
    window.addEventListener('orientationchange', draw)
    return () => { ro.disconnect(); window.removeEventListener('orientationchange', draw) }
  }, [spectrogram, hasData])

  const fTicks = useMemo(
    () => (hasData ? visibleFreqTicks(spectrogram.freq_ticks || []) : []),
    [spectrogram, hasData],
  )
  const tTicks = useMemo(() => timeTicks(duration), [duration])

  if (!hasData) {
    return (
      <div className="h-24 grid place-items-center rounded-[10px] border border-night-line bg-night text-xs text-muted-foreground">
        spectrogram appears once a clip is loaded
      </div>
    )
  }

  const GUTTER = 36 // px, left frequency-label column

  return (
    <div>
      <div className="flex">
        {/* Frequency axis (Hz, log/mel-spaced) */}
        <div
          className="relative shrink-0 h-24 mr-2 font-mono text-[11px] leading-none text-muted-foreground"
          style={{ width: GUTTER }}
          title="Frequency (Hz)"
        >
          {fTicks.map((ft) => (
            <span
              key={ft.hz}
              className="absolute right-0 translate-y-1/2 tabular-nums"
              style={{ bottom: `${ft.pos * 100}%` }}
            >
              {ft.label}
            </span>
          ))}
        </div>

        {/* Spectrogram image + playhead + freq gridlines */}
        <div ref={wrapRef} className="relative flex-1 h-24 rounded-md overflow-hidden bg-[#16201A]">
          <canvas ref={canvasRef} className="block h-full w-full" />
          {fTicks.map((ft) => (
            <div
              key={ft.hz}
              className="absolute left-0 right-0 h-px bg-cream/[0.06] pointer-events-none"
              style={{ bottom: `${ft.pos * 100}%` }}
            />
          ))}
          <div
            data-testid="spectrogram-playhead"
            className="absolute top-0 bottom-0 w-0.5 -ml-px bg-amber pointer-events-none"
            style={{ left: `${Math.min(100, Math.max(0, progress * 100))}%` }}
          />
        </div>
      </div>

      {/* Time axis (m:ss) — aligned under the image, offset by the gutter */}
      <div
        className="relative h-4 mt-2 font-mono text-[11px] leading-none text-muted-foreground"
        style={{ marginLeft: GUTTER + 8 }}
      >
        {tTicks.map((tt, i) => (
          <span
            key={i}
            className="absolute top-0 tabular-nums"
            style={{
              left: `${tt.pos * 100}%`,
              transform: i === 0 ? 'none' : i === tTicks.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)',
            }}
          >
            {fmtClock(tt.t)}
          </span>
        ))}
      </div>
    </div>
  )
}
