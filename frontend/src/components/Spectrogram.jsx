import React, { useEffect, useMemo, useRef } from 'react'

// Magma-ish ramp: 0 -> near-black indigo, mid -> magenta/orange, high -> pale.
function ramp(v) {
  const t = v / 255
  const stops = [
    [0.0, [8, 4, 20]],
    [0.3, [60, 16, 90]],
    [0.55, [150, 40, 90]],
    [0.78, [230, 100, 50]],
    [1.0, [252, 235, 180]],
  ]
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i]
    const [t1, c1] = stops[i + 1]
    if (t >= t0 && t <= t1) {
      const f = (t - t0) / (t1 - t0)
      return [
        c0[0] + (c1[0] - c0[0]) * f,
        c0[1] + (c1[1] - c0[1]) * f,
        c0[2] + (c1[2] - c0[2]) * f,
      ]
    }
  }
  return stops[stops.length - 1][1]
}

function fmtTime(s) {
  if (!isFinite(s) || s < 0) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
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

  const fTicks = useMemo(() => (hasData ? spectrogram.freq_ticks || [] : []), [spectrogram, hasData])
  const tTicks = useMemo(() => timeTicks(duration), [duration])

  if (!hasData) {
    return (
      <div className="h-24 grid place-items-center text-[11px] text-slate-600 rounded-md bg-black/30 border border-white/10">
        spectrogram appears once a clip is loaded
      </div>
    )
  }

  const GUTTER = 34 // px, left frequency-label column

  return (
    <div className="rounded-md border border-white/10 bg-black/30 p-2">
      <div className="flex">
        {/* Frequency axis (Hz, log/mel-spaced) */}
        <div className="relative w-[34px] shrink-0 h-24 mr-1 text-[9px] leading-none text-slate-400">
          {fTicks.map((ft) => (
            <div
              key={ft.hz}
              className="absolute right-1 flex items-center gap-1 -translate-y-1/2"
              style={{ bottom: `${ft.pos * 100}%` }}
            >
              <span className="tabular-nums">{ft.label}</span>
            </div>
          ))}
          <div className="absolute -left-0.5 top-0 bottom-0 flex items-center">
            <span className="text-[8px] text-slate-500 -rotate-90 whitespace-nowrap origin-center">Hz</span>
          </div>
        </div>

        {/* Spectrogram image + playhead + freq gridlines */}
        <div ref={wrapRef} className="relative flex-1 h-24 rounded-sm overflow-hidden bg-black/40">
          <canvas ref={canvasRef} className="block h-full w-full" />
          {fTicks.map((ft) => (
            <div
              key={ft.hz}
              className="absolute left-0 right-0 h-px bg-white/10 pointer-events-none"
              style={{ bottom: `${ft.pos * 100}%` }}
            />
          ))}
          <div
            className="absolute top-0 bottom-0 w-px bg-white/90 pointer-events-none"
            style={{ left: `${Math.min(100, Math.max(0, progress * 100))}%` }}
          />
        </div>
      </div>

      {/* Time axis (mm:ss) — aligned under the image, offset by the gutter */}
      <div className="relative h-4 mt-1 text-[9px] leading-none text-slate-400" style={{ marginLeft: GUTTER + 4 }}>
        {tTicks.map((tt, i) => (
          <span
            key={i}
            className="absolute top-0 tabular-nums"
            style={{
              left: `${tt.pos * 100}%`,
              transform: i === 0 ? 'none' : i === tTicks.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)',
            }}
          >
            {fmtTime(tt.t)}
          </span>
        ))}
      </div>
    </div>
  )
}
