import React, { useCallback, useEffect, useState } from 'react'
import { getHistory, getClip } from '../lib/api.js'

const SOURCE = {
  upload: { icon: '⤴', label: 'Upload' },
  recording: { icon: '●', label: 'Recording' },
  pi_mic: { icon: '🎙', label: 'Pi mic' },
}

function when(iso) {
  try {
    const d = new Date(iso)
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}

// Slide-in drawer listing past clips. Click a card to reload its visualization
// via GET /history/{id}. Refreshes when opened and whenever refreshKey changes
// (i.e. a new clip was just created).
export default function Gallery({ open, onClose, currentId, refreshKey, onLoaded, onStatus }) {
  const [items, setItems] = useState([])
  const [loadingId, setLoadingId] = useState(null)
  const [err, setErr] = useState(null)

  const refresh = useCallback(async () => {
    try {
      setItems(await getHistory())
      setErr(null)
    } catch (e) {
      setErr(e.message || 'Failed to load history')
    }
  }, [])

  useEffect(() => { if (open) refresh() }, [open, refresh])
  useEffect(() => { refresh() }, [refreshKey, refresh])

  async function pick(id) {
    setLoadingId(id)
    onStatus?.('processing', 'Loading clip…')
    try {
      const clip = await getClip(id)
      onLoaded(clip)
      onStatus?.('idle')
      onClose()
    } catch (e) {
      onStatus?.('error', e.message || 'Failed to load clip')
    } finally {
      setLoadingId(null)
    }
  }

  return (
    <>
      {open && <div className="fixed inset-0 bg-black/40 z-20" onClick={onClose} />}
      <aside
        className={
          'fixed top-0 right-0 h-full w-80 max-w-[85vw] bg-panel border-l border-white/10 z-30 ' +
          'transform transition-transform duration-200 flex flex-col ' +
          (open ? 'translate-x-0' : 'translate-x-full')
        }
      >
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
          <h2 className="text-sm font-semibold">History <span className="text-slate-500">({items.length})</span></h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-lg leading-none" title="Close">×</button>
        </div>

        <div className="flex-1 overflow-y-auto scroll-thin p-2 space-y-1.5">
          {err && <div className="text-xs text-rose-400 px-2 py-2">{err}</div>}
          {!err && items.length === 0 && (
            <div className="text-xs text-slate-500 px-2 py-4 text-center">No clips yet — upload or record one.</div>
          )}
          {items.map((it) => {
            const s = SOURCE[it.source_type] || { icon: '♪', label: it.source_type }
            const active = it.id === currentId
            return (
              <button
                key={it.id}
                onClick={() => pick(it.id)}
                disabled={loadingId === it.id}
                className={
                  'w-full text-left rounded-md px-3 py-2 flex items-center gap-3 transition ' +
                  (active ? 'bg-indigo-500/25 ring-1 ring-indigo-400/40' : 'bg-white/5 hover:bg-white/10')
                }
              >
                <span className="text-lg w-6 text-center">{s.icon}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-slate-100">{s.label} · {it.duration_s.toFixed(1)}s</span>
                  <span className="block text-[11px] text-slate-500 truncate">{when(it.created_at)} · {it.id.slice(0, 8)}</span>
                </span>
                {loadingId === it.id && <span className="h-3.5 w-3.5 rounded-full border-2 border-white/20 border-t-white animate-spin" />}
              </button>
            )
          })}
        </div>
      </aside>
    </>
  )
}
