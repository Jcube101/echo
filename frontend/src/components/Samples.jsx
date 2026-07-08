import React, { useCallback, useEffect, useState } from 'react'
import { getSamples, getSample } from '../lib/api.js'

// Left-side drawer of curated example clips (distinct from the right-side
// personal History). Each card carries visible attribution — species, recordist,
// license, and a link back to the Xeno-canto source — because these are
// CC BY-NC-SA recordings the app publishes publicly. Clicking loads the clip.
export default function Samples({ open, onClose, currentId, onLoaded, onStatus }) {
  const [items, setItems] = useState([])
  const [loadingId, setLoadingId] = useState(null)
  const [err, setErr] = useState(null)

  const refresh = useCallback(async () => {
    try {
      setItems(await getSamples())
      setErr(null)
    } catch (e) {
      setErr(e.message || 'Failed to load samples')
    }
  }, [])

  useEffect(() => { if (open) refresh() }, [open, refresh])

  async function pick(id) {
    setLoadingId(id)
    onStatus?.('processing', 'Loading sample…')
    try {
      const clip = await getSample(id)
      onLoaded({ ...clip, source_type: 'sample', sample: clip })
      onStatus?.('idle')
      onClose()
    } catch (e) {
      onStatus?.('error', e.message || 'Failed to load sample')
    } finally {
      setLoadingId(null)
    }
  }

  return (
    <>
      {open && <div className="fixed inset-0 bg-black/40 z-20" onClick={onClose} />}
      <aside
        className={
          'fixed top-0 left-0 h-full w-96 max-w-[90vw] bg-panel border-r border-white/10 z-30 ' +
          'transform transition-transform duration-200 flex flex-col ' +
          (open ? 'translate-x-0' : '-translate-x-full')
        }
      >
        <div className="px-4 py-3 border-b border-white/10">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <span>🐦</span> Sample sounds
          </h2>
          <p className="text-[11px] text-slate-500 mt-1">
            Curated birdcalls — no upload needed. Tap one to visualize it.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto scroll-thin p-3 space-y-3">
          {err && <div className="text-xs text-rose-400 px-1 py-2">{err}</div>}
          {!err && items.length === 0 && (
            <div className="text-xs text-slate-500 px-1 py-4 text-center">No samples available.</div>
          )}
          {items.map((s) => {
            const active = s.id === currentId
            return (
              <div
                key={s.id}
                className={
                  'rounded-lg border p-3 transition ' +
                  (active ? 'border-indigo-400/50 bg-indigo-500/15' : 'border-white/10 bg-white/[0.03]')
                }
              >
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-slate-100">{s.species}</div>
                    <div className="text-[11px] italic text-slate-500">{s.sci_name}</div>
                  </div>
                  <button
                    onClick={() => pick(s.id)}
                    disabled={loadingId === s.id}
                    className="shrink-0 h-9 px-3 rounded-md text-sm font-medium bg-indigo-500 hover:bg-indigo-400 text-white flex items-center gap-1.5"
                    title={`Visualize ${s.species}`}
                  >
                    {loadingId === s.id
                      ? <span className="h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                      : <span>▶</span>}
                    <span>{s.duration_s?.toFixed(0)}s</span>
                  </button>
                </div>

                {/* Attribution — required, always visible */}
                <div className="mt-2 pt-2 border-t border-white/10 text-[10.5px] leading-relaxed text-slate-500">
                  <div>Recordist: <span className="text-slate-400">{s.recordist}</span></div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                    <a href={s.license_url} target="_blank" rel="noopener noreferrer"
                       className="text-slate-400 underline decoration-dotted hover:text-slate-200">
                      {s.license}
                    </a>
                    <span className="text-slate-600">·</span>
                    <a href={s.source_url} target="_blank" rel="noopener noreferrer"
                       className="text-indigo-300 hover:text-indigo-200">
                      Xeno-canto XC{s.xc_id} ↗
                    </a>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <div className="px-4 py-2 border-t border-white/10 text-[10px] text-slate-600">
          Recordings © their recordists, via xeno-canto.org. Reused under the
          Creative Commons licenses shown.
        </div>
      </aside>
    </>
  )
}
