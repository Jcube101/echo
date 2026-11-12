import React, { useCallback, useEffect, useState } from 'react'
import { HardDrive, Loader2, Mic, Music, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { getHistory, getClip, friendlyError } from '../lib/api.js'

const SOURCE = {
  upload: { Icon: Upload, label: 'Upload' },
  recording: { Icon: Mic, label: 'Recording' },
  pi_mic: { Icon: HardDrive, label: 'Pi mic' },
}

function when(iso) {
  try {
    const d = new Date(iso)
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}

// Slide-in sheet listing past clips (shadcn Sheet — real focus trap, Escape to
// close, backdrop click to close). Click a card to reload its visualization
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
      const msg = friendlyError(e)
      onStatus?.('error', msg)
      toast.error("Couldn't load clip", { description: msg })
    } finally {
      setLoadingId(null)
    }
  }

  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <SheetContent
        side="right"
        className="w-80 max-w-[85vw] p-0 flex flex-col gap-0 bg-night-2 border-border text-cream"
      >
        <SheetHeader className="px-4 py-3 border-b border-border flex-row items-center space-y-0">
          <SheetTitle className="font-display text-lg font-semibold text-cream">
            History <span className="text-muted-foreground font-normal">({items.length})</span>
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto scroll-thin p-2 space-y-1.5">
          {err && <div className="text-xs text-destructive px-2 py-2">{err}</div>}
          {!err && items.length === 0 && (
            <div className="text-xs text-muted-foreground px-2 py-4 text-center">No clips yet — upload or record one.</div>
          )}
          {items.map((it) => {
            const s = SOURCE[it.source_type] || { Icon: Music, label: it.source_type }
            const active = it.id === currentId
            return (
              <button
                key={it.id}
                data-testid="history-item"
                onClick={() => pick(it.id)}
                disabled={loadingId === it.id}
                className={
                  'w-full text-left rounded-[10px] px-3 py-2.5 flex items-center gap-3 transition ' +
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-night-2 ' +
                  (active ? 'bg-night-3 ring-1 ring-amber/60' : 'bg-night-3/50 hover:bg-night-3')
                }
              >
                <s.Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-cream">{s.label} · {it.duration_s.toFixed(1)}s</span>
                  <span className="block text-[11px] text-muted-foreground truncate">{it.name ? `${it.name} · ${when(it.created_at)}` : `${when(it.created_at)} · ${it.id.slice(0, 8)}`}</span>
                </span>
                {loadingId === it.id && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              </button>
            )
          })}
        </div>
      </SheetContent>
    </Sheet>
  )
}
