// Nearest feature index for a given playback time (features are t-ordered).
// Extracted from App.jsx so it's unit-testable without importing the whole
// component tree (Scene.jsx pulls in three.js/react-three-fiber).
export function indexForTime(features, t) {
  if (!features.length) return null
  let lo = 0
  let hi = features.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (features[mid].t < t) lo = mid + 1
    else hi = mid
  }
  if (lo > 0 && Math.abs(features[lo - 1].t - t) < Math.abs(features[lo].t - t)) return lo - 1
  return lo
}
