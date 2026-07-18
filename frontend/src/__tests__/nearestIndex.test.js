import { describe, expect, it } from 'vitest'
import { indexForTime } from '../lib/nearestIndex.js'

// FE-001 — indexForTime (App.jsx's scrubber-to-trail sync core, extracted to
// lib/nearestIndex.js). LEARNINGS.md: "Nearest point found by binary search
// over t-ordered frames."
describe('indexForTime', () => {
  const features = [
    { t: 0.0 }, { t: 0.5 }, { t: 1.0 }, { t: 1.5 }, { t: 2.0 },
  ]

  it('returns null for an empty feature list', () => {
    expect(indexForTime([], 1.0)).toBeNull()
  })

  it('finds an exact hit', () => {
    expect(indexForTime(features, 1.0)).toBe(2)
  })

  it('resolves a midpoint tie to the truly nearer neighbor', () => {
    // 0.74 is nearer to 0.5 (0.24) than to 1.0 (0.26)
    expect(indexForTime(features, 0.74)).toBe(1)
    // 0.76 is nearer to 1.0 (0.24) than to 0.5 (0.26)
    expect(indexForTime(features, 0.76)).toBe(2)
  })

  it('clamps a time before the first frame to index 0', () => {
    expect(indexForTime(features, -5)).toBe(0)
  })

  it('clamps a time after the last frame to the last index', () => {
    expect(indexForTime(features, 100)).toBe(features.length - 1)
  })

  it('handles a single-frame list', () => {
    expect(indexForTime([{ t: 3.0 }], 0)).toBe(0)
    expect(indexForTime([{ t: 3.0 }], 100)).toBe(0)
  })
})
