import React, { useCallback, useEffect, useState } from 'react'
import { Loader2, Play } from 'lucide-react'
import { toast } from 'sonner'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { getSamples, getSample, friendlyError } from '../lib/api.js'

// Left-side sheet of curated example clips (distinct from the right-side
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
      const msg = friendlyError(e)
      onStatus?.('error', msg)
      toast.error("Couldn't load sample", { description: msg })
    } finally {
      setLoadingId(null)
    }
  }

  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <SheetContent
        side="left"
        className="w-96 max-w-[90vw] p-0 flex flex-col gap-0 bg-panel border-border text-slate-100"
      >
        <SheetHeader className="px-4 py-3 border-b border-border space-y-1">
          <SheetTitle className="text-sm font-semibold flex items-center gap-2 text-slate-100">
            <span>🐦</span> Sample sounds
          </SheetTitle>
          <SheetDescription className="text-[11px] text-slate-500">
            Curated birdcalls — no upload needed. Tap one to visualize it.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto scroll-thin p-3 space-y-3">
          {err && <div className="text-xs text-rose-400 px-1 py-2">{err}</div>}
          {!err && items.length === 0 && (
            <div className="text-xs text-slate-500 px-1 py-4 text-center">No samples available.</div>
          )}
          {items.map((s) => {
            const active = s.id === currentId
            return (
              <Card
                key={s.id}
                className={
                  'rounded-lg p-3 shadow-none ' +
                  (active ? 'border-indigo-400/50 bg-indigo-500/15' : 'border-border bg-white/[0.03]')
                }
              >
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-slate-100">{s.species}</div>
                    <div className="text-[11px] italic text-slate-500">{s.sci_name}</div>
                  </div>
                  <Button
                    onClick={() => pick(s.id)}
                    disabled={loadingId === s.id}
                    title={`Visualize ${s.species}`}
                    size="sm"
                    className="shrink-0 h-9 px-3 bg-primary hover:bg-primary/90 text-primary-foreground"
                  >
                    {loadingId === s.id ? <Loader2 className="animate-spin" /> : <Play className="fill-current" />}
                    <span>{s.duration_s?.toFixed(0)}s</span>
                  </Button>
                </div>

                {/* Attribution — required, always visible */}
                <div className="mt-2 pt-2 border-t border-border text-[10.5px] leading-relaxed text-slate-500">
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
              </Card>
            )
          })}
        </div>

        <div className="px-4 py-2 border-t border-border text-[10px] text-slate-600">
          Recordings © their recordists, via xeno-canto.org. Reused under the
          Creative Commons licenses shown.
        </div>
      </SheetContent>
    </Sheet>
  )
}
