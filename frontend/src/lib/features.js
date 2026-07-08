// Maps a raw feature array (from the API / sample.json) into normalized 3D
// geometry the scene can render directly.
//
// Axes (spatial): pitch -> X, timbre -> Y, motion -> Z.
// Amplitude is NOT a spatial axis — it drives point size + color intensity.
//
// Each axis is min–max normalized *per clip* so any clip fills the view.
// Pitch is log2-scaled first (perceptually even across octaves).

export const EXTENT = 6 // half-size of the cube the trail is fit into

function minMax(arr) {
  let lo = Infinity
  let hi = -Infinity
  for (const v of arr) {
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  return [lo, hi]
}

// Normalize a value into [-EXTENT, EXTENT] given the array's range.
function norm(v, lo, hi) {
  if (hi - lo < 1e-9) return 0
  return ((v - lo) / (hi - lo)) * 2 * EXTENT - EXTENT
}

// Amplitude -> RGB. Low = cool indigo, mid = teal/green, high = warm amber.
// Returns [r, g, b] in 0..1.
export function ampColor(a) {
  const stops = [
    [0.0, [0.20, 0.15, 0.55]], // indigo
    [0.4, [0.10, 0.55, 0.75]], // teal
    [0.7, [0.30, 0.80, 0.45]], // green
    [1.0, [1.00, 0.70, 0.20]], // amber
  ]
  a = Math.max(0, Math.min(1, a))
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i]
    const [t1, c1] = stops[i + 1]
    if (a >= t0 && a <= t1) {
      const f = (a - t0) / (t1 - t0)
      return [
        c0[0] + (c1[0] - c0[0]) * f,
        c0[1] + (c1[1] - c0[1]) * f,
        c0[2] + (c1[2] - c0[2]) * f,
      ]
    }
  }
  return stops[stops.length - 1][1]
}

// Build renderable geometry from feature points.
export function buildGeometry(features) {
  const n = features.length
  const positions = new Float32Array(n * 3)
  const colors = new Float32Array(n * 3)
  const sizes = new Float32Array(n)
  const times = new Float32Array(n)

  const pitchLog = features.map((f) => Math.log2(Math.max(f.pitch, 1)))
  const timbre = features.map((f) => f.timbre)
  const motion = features.map((f) => f.motion)

  const [plo, phi] = minMax(pitchLog)
  const [tlo, thi] = minMax(timbre)
  const [mlo, mhi] = minMax(motion)

  for (let i = 0; i < n; i++) {
    positions[i * 3 + 0] = norm(pitchLog[i], plo, phi)
    positions[i * 3 + 1] = norm(timbre[i], tlo, thi)
    positions[i * 3 + 2] = norm(motion[i], mlo, mhi)

    const a = Math.max(0, Math.min(1, features[i].amplitude))
    const [r, g, b] = ampColor(a)
    colors[i * 3 + 0] = r
    colors[i * 3 + 1] = g
    colors[i * 3 + 2] = b

    sizes[i] = 0.05 + a * 0.18 // amplitude drives point size
    times[i] = features[i].t
  }

  const duration = n > 0 ? features[n - 1].t : 0
  return { n, positions, colors, sizes, times, duration }
}
