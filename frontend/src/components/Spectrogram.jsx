import React, { useEffect, useRef } from 'react'

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

// Renders the compact mel-spectrogram (column-major, low->high freq) to a
// canvas at native cols×bins, then CSS-scales it to fill the strip.
export default function Spectrogram({ spectrogram, progress = 0 }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !spectrogram || !spectrogram.cols) return
    const { bins, cols, data } = spectrogram
    canvas.width = cols
    canvas.height = bins
    const ctx = canvas.getContext('2d')
    const img = ctx.createImageData(cols, bins)
    for (let x = 0; x < cols; x++) {
      for (let b = 0; b < bins; b++) {
        const v = data[x * bins + b]
        const [r, g, bl] = ramp(v)
        // flip y so low frequencies sit at the bottom
        const y = bins - 1 - b
        const idx = (y * cols + x) * 4
        img.data[idx] = r
        img.data[idx + 1] = g
        img.data[idx + 2] = bl
        img.data[idx + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
  }, [spectrogram])

  if (!spectrogram || !spectrogram.cols) {
    return (
      <div className="h-full grid place-items-center text-[11px] text-slate-600">
        spectrogram appears once a clip is loaded
      </div>
    )
  }

  return (
    <div className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        className="h-full w-full block"
        style={{ imageRendering: 'pixelated' }}
      />
      {/* Playhead line synced to playback progress (0..1). */}
      <div
        className="absolute top-0 bottom-0 w-px bg-white/90 pointer-events-none"
        style={{ left: `${Math.min(100, Math.max(0, progress * 100))}%` }}
      />
    </div>
  )
}
