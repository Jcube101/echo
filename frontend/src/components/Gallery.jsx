import React, { useCallback, useEffect, useRef, useState } from 'react'
import { HardDrive, Loader2, Mic, Music, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { deleteClip, deleteClips, getHistory, getClip, friendlyError } from '../lib/api.js'

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

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-night-2'
const LONG_PRESS_MS = 500

// Slide-in sheet listing past clips (shadcn Sheet — real focus trap, Escape to
// close, backdrop click to close). Click a card to reload its visualization
// via GET /history/{id}. Refreshes when opened and whenever refreshKey changes
// (i.e. a new clip was just created).
//
// The list is this browser's clips only (the server scopes /history to the
// browser's own cookie). Two ways to delete:
//   - one clip: the bin on its row. The first press arms it ("Delete?"), the
//     second deletes the clip and its audio for good.
//   - several: "Select" (or a long press on a row, for touch) turns the rows
//     into checkboxes, with "Select all" and "Delete N clips", which asks
//     once more before deleting. Escape or "Done" leaves selection first;
//     only then does Escape close the sheet.
export default function Gallery({ open, onClose, currentId, refreshKey, onLoaded, onStatus, onDeleted }) {
  const [items, setItems] = useState([])
  const [loadingId, setLoadingId] = useState(null)
  const [err, setErr] = useState(null)
  const [confirmId, setConfirmId] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState(() => new Set())
  const [confirmBulk, setConfirmBulk] = useState(false)
  const [bulkBusy, setBulkBusy] = useState(false)
  const selectAllRef = useRef(null)
  const press = useRef({ timer: null, fired: false })

  function exitSelection() {
    setSelecting(false)
    setSelected(new Set())
    setConfirmBulk(false)
  }

  useEffect(() => {
    if (!open) {
      setConfirmId(null)
      exitSelection()
    }
  }, [open])

  async function remove(id) {
    if (confirmId !== id) {
      setConfirmId(id)
      return
    }
    setDeletingId(id)
    try {
      await deleteClip(id)
      setItems((rows) => rows.filter((r) => r.id !== id))
      onDeleted?.(id)
      toast.success('Clip deleted')
    } catch (e) {
      toast.error("Couldn't delete clip", { description: friendlyError(e) })
    } finally {
      setDeletingId(null)
      setConfirmId(null)
    }
  }

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

  // Clips that vanished from the list (deleted elsewhere, aged out) can't stay selected.
  useEffect(() => {
    setSelected((cur) => {
      const ids = new Set(items.map((it) => it.id))
      const kept = [...cur].filter((id) => ids.has(id))
      return kept.length === cur.size ? cur : new Set(kept)
    })
  }, [items])

  const count = selected.size
  const allSelected = items.length > 0 && count === items.length
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = count > 0 && !allSelected
  }, [count, allSelected, selecting])

  function toggle(id) {
    setConfirmBulk(false)
    setSelected((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setConfirmBulk(false)
    setSelected(allSelected ? new Set() : new Set(items.map((it) => it.id)))
  }

  async function removeSelected() {
    if (!confirmBulk) {
      setConfirmBulk(true)
      return
    }
    const ids = [...selected]
    setBulkBusy(true)
    try {
      const deleted = await deleteClips(ids)
      ids.forEach((id) => onDeleted?.(id))
      exitSelection()
      await refresh()
      toast.success(deleted === 1 ? '1 clip deleted' : `${deleted} clips deleted`)
    } catch (e) {
      setConfirmBulk(false)
      toast.error("Couldn't delete the clips", { description: friendlyError(e) })
    } finally {
      setBulkBusy(false)
    }
  }

  // Long press on a row (touch): enter selection with that row ticked. The
  // click that follows the press is swallowed so it doesn't open the clip.
  function pressStart(id, e) {
    if (selecting || e.pointerType === 'mouse') return
    press.current.fired = false
    press.current.timer = setTimeout(() => {
      press.current.fired = true
      setConfirmId(null)
      setSelecting(true)
      setSelected(new Set([id]))
    }, LONG_PRESS_MS)
  }
  function pressEnd() {
    clearTimeout(press.current.timer)
  }

  async function pick(id) {
    if (press.current.fired) {
      press.current.fired = false
      return
    }
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

  const clipsWord = count === 1 ? '1 clip' : `${count} clips`

  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <SheetContent
        side="right"
        className="w-80 max-w-[85vw] p-0 flex flex-col gap-0 bg-night-2 border-border text-cream"
        onEscapeKeyDown={(e) => {
          if (selecting) {
            e.preventDefault()   // first Escape leaves selection; the sheet stays open
            exitSelection()
          }
        }}
      >
        <SheetHeader className="px-4 py-3 border-b border-border flex-row items-center space-y-0">
          <SheetTitle className="font-display text-lg font-semibold text-cream">
            History <span className="text-muted-foreground font-normal">({items.length})</span>
          </SheetTitle>
          {items.length > 0 && (
            <button
              type="button"
              onClick={() => { if (selecting) exitSelection(); else { setConfirmId(null); setSelecting(true) } }}
              aria-pressed={selecting}
              title={selecting ? 'Leave selection' : 'Select several clips to delete'}
              className={'ml-auto mr-8 inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-amber hover:underline ' + FOCUS_RING}
            >
              {selecting ? 'Done' : 'Select'}
            </button>
          )}
        </SheetHeader>

        <p className="border-b border-border px-4 py-2.5 text-xs leading-relaxed text-muted-foreground">
          Your clips live in this browser only.
        </p>

        {selecting && (
          <div className="border-b border-border px-2 py-2" role="group" aria-label="Selection">
            <div className="flex items-center justify-between gap-2">
              <label className={'flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 text-sm text-cream'}>
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  data-testid="history-select-all"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="h-5 w-5 shrink-0 accent-amber"
                />
                Select all
              </label>
              <span className="pr-2 text-xs text-muted-foreground" aria-live="polite">{count} selected</span>
            </div>
            <div className="mt-1 flex items-center gap-2 px-2">
              <button
                type="button"
                data-testid="history-delete-selected"
                onClick={removeSelected}
                disabled={count === 0 || bulkBusy}
                className={
                  'inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-[10px] px-3 text-sm font-semibold ' +
                  'disabled:opacity-50 ' + FOCUS_RING + ' ' +
                  (confirmBulk ? 'bg-destructive text-destructive-foreground' : 'border border-night-line bg-night-3 text-cream hover:bg-night-line')
                }
              >
                {bulkBusy
                  ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  : <Trash2 className="h-4 w-4" aria-hidden />}
                {confirmBulk ? `Delete ${clipsWord} for good?` : `Delete ${clipsWord}`}
              </button>
              {confirmBulk && (
                <button
                  type="button"
                  onClick={() => setConfirmBulk(false)}
                  className={'inline-flex min-h-11 items-center rounded-[10px] px-3 text-sm text-muted-foreground hover:text-cream ' + FOCUS_RING}
                >
                  Keep
                </button>
              )}
            </div>
            {confirmBulk && (
              <p className="px-2 pt-1.5 text-xs text-muted-foreground" role="status">
                This removes the clips and their audio. It can’t be undone.
              </p>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto scroll-thin p-2 space-y-1.5">
          {err && <div className="text-xs text-destructive px-2 py-2">{err}</div>}
          {!err && items.length === 0 && (
            <div className="text-xs text-muted-foreground px-2 py-4 text-center">No clips yet — upload or record one.</div>
          )}
          {items.map((it) => {
            const s = SOURCE[it.source_type] || { Icon: Music, label: it.source_type }
            const active = it.id === currentId
            const arming = confirmId === it.id
            const what = `${s.label} clip, ${it.duration_s.toFixed(1)} seconds, ${when(it.created_at)}`
            const details = (
              <>
                <s.Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-cream">{s.label} · {it.duration_s.toFixed(1)}s</span>
                  <span className="block text-[11px] text-muted-foreground truncate">{it.name ? `${it.name} · ${when(it.created_at)}` : `${when(it.created_at)} · ${it.id.slice(0, 8)}`}</span>
                </span>
              </>
            )
            const rowTone = active ? 'bg-night-3 ring-1 ring-amber/60' : 'bg-night-3/50 hover:bg-night-3'

            if (selecting) {
              const ticked = selected.has(it.id)
              return (
                <label
                  key={it.id}
                  data-testid="history-row"
                  className={'flex min-h-11 cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2.5 transition ' +
                    'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring ' +
                    (ticked ? 'bg-night-3 ring-1 ring-amber/60' : rowTone)}
                >
                  <input
                    type="checkbox"
                    data-testid="history-select"
                    checked={ticked}
                    onChange={() => toggle(it.id)}
                    aria-label={`Select ${what}`}
                    className="h-5 w-5 shrink-0 accent-amber focus-visible:outline-none"
                  />
                  {details}
                </label>
              )
            }

            return (
              <div
                key={it.id}
                data-testid="history-row"
                className={'flex items-stretch rounded-[10px] transition ' + rowTone}
              >
                <button
                  data-testid="history-item"
                  onClick={() => pick(it.id)}
                  onPointerDown={(e) => pressStart(it.id, e)}
                  onPointerUp={pressEnd}
                  onPointerLeave={pressEnd}
                  onPointerCancel={pressEnd}
                  onContextMenu={(e) => { if (press.current.fired) e.preventDefault() }}
                  disabled={loadingId === it.id}
                  className={'min-w-0 flex-1 text-left rounded-l-[10px] px-3 py-2.5 flex items-center gap-3 select-none ' + FOCUS_RING}
                >
                  {details}
                  {loadingId === it.id && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                </button>
                <button
                  type="button"
                  data-testid="history-delete"
                  onClick={() => remove(it.id)}
                  onBlur={() => { if (arming) setConfirmId(null) }}
                  disabled={deletingId === it.id}
                  aria-label={arming ? `Confirm: delete ${what}` : `Delete ${what}`}
                  title={arming ? 'Press again to delete for good' : 'Delete this clip'}
                  className={
                    'flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-r-[10px] px-2.5 text-xs font-medium ' +
                    FOCUS_RING + ' ' +
                    (arming ? 'bg-destructive text-destructive-foreground' : 'text-muted-foreground hover:text-cream')
                  }
                >
                  {deletingId === it.id
                    ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    : arming ? 'Delete?' : <Trash2 className="h-4 w-4" aria-hidden />}
                </button>
              </div>
            )
          })}
        </div>
      </SheetContent>
    </Sheet>
  )
}
