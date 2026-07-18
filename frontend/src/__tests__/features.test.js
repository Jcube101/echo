import { describe, expect, it } from 'vitest'
import { buildGeometry, WORLD } from '../lib/features.js'

// FE-004 — buildGeometry (features.js). LEARNINGS.md Part B: pitch/timbre/
// motion are ALREADY world coordinates — plotted as-is, no per-clip
// normalization. Axis layout: X = pitch, Y (up) = motion, Z = timbre.
describe('buildGeometry', () => {
  const sample = [
    { t: 0.0, pitch: -1.0, timbre: 0.5, motion: -2.0, amplitude: 0.2 },
    { t: 0.02, pitch: 1.5, timbre: -0.5, motion: 2.5, amplitude: 0.9 },
  ]

  it('maps axes X=pitch, Y=motion, Z=timbre with no per-clip normalization', () => {
    const geo = buildGeometry(sample)
    expect(geo.n).toBe(2)
    expect(geo.positions[0]).toBe(sample[0].pitch)   // X
    expect(geo.positions[1]).toBe(sample[0].motion)  // Y (up)
    expect(geo.positions[2]).toBe(sample[0].timbre)  // Z
    expect(geo.positions[3]).toBe(sample[1].pitch)
    expect(geo.positions[4]).toBe(sample[1].motion)
    expect(geo.positions[5]).toBe(sample[1].timbre)
  })

  it('drives point size and brightness from amplitude', () => {
    const geo = buildGeometry(sample)
    // louder (amplitude 0.9) point is larger than the quieter one
    expect(geo.sizes[1]).toBeGreaterThan(geo.sizes[0])
    // brightness (color magnitude) also rises with amplitude
    const brightness0 = geo.colors[0] + geo.colors[1] + geo.colors[2]
    const brightness1 = geo.colors[3] + geo.colors[4] + geo.colors[5]
    expect(brightness1).toBeGreaterThan(brightness0)
  })

  it('clamps amplitude to [0,1] even for out-of-range input', () => {
    const geo = buildGeometry([
      { t: 0, pitch: 0, timbre: 0, motion: 0, amplitude: -0.5 },
      { t: 0.02, pitch: 0, timbre: 0, motion: 0, amplitude: 5.0 },
    ])
    // sizes/colors must still be finite, ordered low->high
    expect(geo.sizes[1]).toBeGreaterThan(geo.sizes[0])
    expect(Number.isFinite(geo.sizes[0])).toBe(true)
    expect(Number.isFinite(geo.colors[3])).toBe(true)
  })

  it('reports duration as the last frame\'s t, and n=0 for an empty list', () => {
    const geo = buildGeometry(sample)
    expect(geo.duration).toBe(sample[1].t)

    const empty = buildGeometry([])
    expect(empty.n).toBe(0)
    expect(empty.duration).toBe(0)
  })

  it('exports WORLD matching the extraction.py half-extent (3.0)', () => {
    expect(WORLD).toBe(3.0)
  })
})
