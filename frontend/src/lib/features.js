// Turns a stored feature array into renderable geometry.
//
// Fixed world scale (Part B): pitch/timbre/motion are ALREADY world coordinates
// in [-WORLD, WORLD], computed server-side against fixed global bounds — so the
// box never resizes and clips are directly comparable. We plot them as-is (NO
// per-clip normalization here). Axis layout matches the reference:
//   X = pitch,  Y (up) = motion,  Z = timbre.
//
// Amplitude is NOT spatial: it drives point size and colour. Design v2 (D4):
// quiet points are dim green, mid-loud amber, the loudest pale cream.

export const WORLD = 3.0 // must match extraction.py WORLD
const QUIET = [0.31, 0.56, 0.39] // green  #4F8F63
const MID = [0.91, 0.69, 0.29]   // amber  #E8B04B
const LOUD = [0.96, 0.94, 0.89]  // cream  #F4EFE4

// Loudness colour ramp, green → amber → cream. The square root spreads the
// ramp over typical clips, where most frames sit well below full scale.
export function loudnessColor(amplitude) {
  const p = Math.sqrt(clamp01(amplitude))
  const [from, to, f] = p < 0.5 ? [QUIET, MID, p / 0.5] : [MID, LOUD, (p - 0.5) / 0.5]
  return [
    from[0] + (to[0] - from[0]) * f,
    from[1] + (to[1] - from[1]) * f,
    from[2] + (to[2] - from[2]) * f,
  ]
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

export function buildGeometry(features) {
  const n = features.length
  const positions = new Float32Array(n * 3)
  const colors = new Float32Array(n * 3)
  const sizes = new Float32Array(n)
  const times = new Float32Array(n)

  for (let i = 0; i < n; i++) {
    const f = features[i]
    positions[i * 3 + 0] = f.pitch   // X
    positions[i * 3 + 1] = f.motion  // Y (up)
    positions[i * 3 + 2] = f.timbre  // Z

    // Colour follows the loudness ramp; brightness also rises a little with
    // amplitude so the quietest frames recede (quiet = dim, loud = full).
    const a = clamp01(f.amplitude)
    const c = loudnessColor(a)
    const bright = 0.6 + Math.sqrt(a) * 0.4
    colors[i * 3 + 0] = c[0] * bright
    colors[i * 3 + 1] = c[1] * bright
    colors[i * 3 + 2] = c[2] * bright

    sizes[i] = 0.55 + a * 2.4 // amplitude drives point size (shader scales to px)
    times[i] = f.t
  }

  const duration = n > 0 ? features[n - 1].t : 0
  return { n, positions, colors, sizes, times, duration }
}
