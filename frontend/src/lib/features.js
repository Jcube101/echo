// Turns a stored feature array into renderable geometry.
//
// Fixed world scale (Part B): pitch/timbre/motion are ALREADY world coordinates
// in [-WORLD, WORLD], computed server-side against fixed global bounds — so the
// box never resizes and clips are directly comparable. We plot them as-is (NO
// per-clip normalization here). Axis layout matches the reference:
//   X = pitch,  Y (up) = motion,  Z = timbre.
//
// Amplitude is NOT spatial: it drives point size + monochrome-teal brightness.

export const WORLD = 3.0 // must match extraction.py WORLD
const TEAL = [0.20, 1.0, 0.78]

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

    // Monochrome: single teal hue, brightness rises with amplitude (quiet = dim,
    // loud = glowing). Values >1 push the additive-blended sprite toward white.
    const a = clamp01(f.amplitude)
    const bright = 0.28 + a * 1.35
    colors[i * 3 + 0] = TEAL[0] * bright
    colors[i * 3 + 1] = TEAL[1] * bright
    colors[i * 3 + 2] = TEAL[2] * bright

    sizes[i] = 0.55 + a * 2.4 // amplitude drives point size (shader scales to px)
    times[i] = f.t
  }

  const duration = n > 0 ? features[n - 1].t : 0
  return { n, positions, colors, sizes, times, duration }
}
