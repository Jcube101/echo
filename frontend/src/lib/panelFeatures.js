// Definitions for the v1.5 Spectral Analysis panel's six/seven lines.
//
// Each descriptor is stored by the backend in PHYSICAL units, already clamped to
// a fixed range (extraction.py). The `range` here MUST match that module's
// *_RANGE tunables — it's the fixed-scale, clamp-at-the-edge normalization that
// makes the lanes comparable across every clip (same philosophy as the 3D
// trail's world box). The hover readout shows the physical `value` + `unit`; the
// plotted line uses `norm()` (0..1 within the lane).
//
// Colours are the dataviz reference categorical palette (dark steps), validated
// colourblind-safe on this dark surface; the legend + hover readout name each
// line so identity is never colour-alone.

export const PANEL_FEATURES = [
  { key: 'spread',   label: 'Spectral Spread',   unit: 'Hz', range: [0, 4000],        color: '#3987e5', fmt: (v) => v.toFixed(0) },
  { key: 'crest',    label: 'Spectral Crest',    unit: '',   range: [1, 30],          color: '#008300', fmt: (v) => v.toFixed(1) },
  { key: 'contrast', label: 'Spectral Contrast', unit: 'dB', range: [10, 35],         color: '#d55181', fmt: (v) => v.toFixed(1) },
  { key: 'slope',    label: 'Spectral Slope',    unit: '',   range: [-0.001, 0.0002], color: '#c98500', fmt: (v) => v.toExponential(2) },
  { key: 'flatness', label: 'Spectral Flatness', unit: '',   range: [0, 0.25],        color: '#199e70', fmt: (v) => v.toFixed(4) },
  { key: 'hnr',      label: 'HNR',               unit: 'dB', range: [-30, 65],        color: '#d95926', fmt: (v) => v.toFixed(1) },
  { key: 'tonality', label: 'Tonality',          unit: '',   range: [0, 1],           color: '#9085e9', fmt: (v) => v.toFixed(2) },
]

// Map a raw physical value into its lane's 0..1 position, clamped to the edges
// (matches the backend's fixed-range-with-clamping — never stretches the scale).
export function normalize(feature, v) {
  const [lo, hi] = feature.range
  if (hi === lo) return 0
  const t = (v - lo) / (hi - lo)
  return t < 0 ? 0 : t > 1 ? 1 : t
}

// True when a feature array actually carries the extended descriptors (i.e. a
// v2+ payload). Older cached clips without them shouldn't render empty lines.
export function hasPanelData(features) {
  if (!features || !features.length) return false
  const f = features[0]
  return PANEL_FEATURES.every((pf) => typeof f[pf.key] === 'number')
}
