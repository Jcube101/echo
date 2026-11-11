// Shared display formatting.

// Seconds → m:ss (clock style, used by the dock, sidebar and axes).
export function fmtClock(s) {
  if (!isFinite(s) || s < 0) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

// Signed, fixed-width world coordinate, e.g. +2.56 / -0.97 (true minus sign
// avoided on purpose: these sit in a monospace column).
export function fmtSigned(v, digits = 2) {
  if (!isFinite(v)) return '—'
  return (v >= 0 ? '+' : '-') + Math.abs(v).toFixed(digits)
}

// ISO timestamp → "12 Nov, 14:05" in the viewer's locale.
export function fmtWhen(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return iso
  }
}
