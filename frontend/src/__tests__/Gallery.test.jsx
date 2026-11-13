import { act, render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Gallery from '../components/Gallery.jsx'
import * as api from '../lib/api.js'

vi.mock('../lib/api.js')

// FE-006/FE-007 — history gallery reload + refresh-on-new-clip.
// SPEC.md: "History gallery listing past clips, click to reload via
// GET /history/{id}."
describe('Gallery', () => {
  afterEach(() => vi.resetAllMocks())

  const items = [
    { id: 'clip-1', created_at: '2026-07-18T10:00:00Z', source_type: 'upload', duration_s: 5.2 },
    { id: 'clip-2', created_at: '2026-07-18T09:00:00Z', source_type: 'pi_mic', duration_s: 3.0 },
  ]

  it('renders items from getHistory with source icon, duration, and id', async () => {
    api.getHistory.mockResolvedValue(items)
    render(<Gallery open currentId={null} refreshKey={0} onLoaded={vi.fn()} onStatus={vi.fn()} />)

    expect(await screen.findByText(/Upload · 5.2s/)).toBeInTheDocument()
    expect(await screen.findByText(/Pi mic · 3.0s/)).toBeInTheDocument()
    expect(screen.getByText(/clip-1/)).toBeInTheDocument()
  })

  it('says the clips are this browser\'s only', async () => {
    api.getHistory.mockResolvedValue(items)
    render(<Gallery open currentId={null} refreshKey={0} onLoaded={vi.fn()} onStatus={vi.fn()} />)
    expect(await screen.findByText('Your clips live in this browser only.')).toBeInTheDocument()
  })

  it('deletes a clip on the second press of its delete button, not the first', async () => {
    api.getHistory.mockResolvedValue(items)
    api.deleteClip.mockResolvedValue(undefined)
    const onDeleted = vi.fn()
    const onLoaded = vi.fn()
    render(<Gallery open currentId={null} refreshKey={0} onLoaded={onLoaded} onStatus={vi.fn()} onDeleted={onDeleted} />)
    await screen.findByText(/Upload · 5.2s/)

    const buttons = screen.getAllByTestId('history-delete')
    expect(buttons).toHaveLength(2)
    expect(buttons[0]).toHaveAccessibleName(/^Delete Upload clip, 5\.2 seconds/)
    fireEvent.click(buttons[0])
    expect(api.deleteClip).not.toHaveBeenCalled()
    expect(buttons[0]).toHaveTextContent('Delete?')
    expect(buttons[0]).toHaveAccessibleName(/^Confirm: delete Upload clip/)

    fireEvent.click(buttons[0])
    await waitFor(() => expect(api.deleteClip).toHaveBeenCalledWith('clip-1'))
    await waitFor(() => expect(screen.queryByText(/Upload · 5.2s/)).toBeNull())
    expect(screen.getByText(/Pi mic · 3.0s/)).toBeInTheDocument()
    expect(onDeleted).toHaveBeenCalledWith('clip-1')
    expect(api.getClip).not.toHaveBeenCalled()   // deleting never opens the clip
    expect(onLoaded).not.toHaveBeenCalled()
  })

  it('disarms the delete button when focus moves away, and keeps the clip if the delete fails', async () => {
    api.getHistory.mockResolvedValue(items)
    api.deleteClip.mockRejectedValue(new Error('Clip not found.'))
    render(<Gallery open currentId={null} refreshKey={0} onLoaded={vi.fn()} onStatus={vi.fn()} />)
    await screen.findByText(/Upload · 5.2s/)
    const btn = screen.getAllByTestId('history-delete')[0]

    fireEvent.click(btn)
    fireEvent.blur(btn)
    expect(btn).not.toHaveTextContent('Delete?')

    fireEvent.click(btn)
    fireEvent.click(btn)
    await waitFor(() => expect(api.deleteClip).toHaveBeenCalledTimes(1))
    expect(await screen.findByText(/Upload · 5.2s/)).toBeInTheDocument()
  })

  // --- multi-select ---------------------------------------------------------
  const three = [
    ...items,
    { id: 'clip-3', created_at: '2026-07-18T08:00:00Z', source_type: 'recording', duration_s: 7.0 },
  ]

  async function openSelecting(props = {}) {
    api.getHistory.mockResolvedValue(three)
    const onClose = vi.fn()
    const onDeleted = vi.fn()
    const onLoaded = vi.fn()
    render(<Gallery open currentId={null} refreshKey={0} onLoaded={onLoaded} onStatus={vi.fn()} onClose={onClose} onDeleted={onDeleted} {...props} />)
    await screen.findByText(/Upload · 5.2s/)
    fireEvent.click(screen.getByRole('button', { name: 'Select' }))
    return { onClose, onDeleted, onLoaded }
  }

  it('Select turns the rows into real, labelled checkboxes and hides the single-delete bins', async () => {
    await openSelecting()
    const boxes = screen.getAllByTestId('history-select')
    expect(boxes).toHaveLength(3)
    boxes.forEach((b) => { expect(b).toHaveAttribute('type', 'checkbox'); expect(b).not.toBeChecked() })
    expect(boxes[0]).toHaveAccessibleName(/^Select Upload clip, 5\.2 seconds/)
    expect(screen.queryAllByTestId('history-delete')).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Done' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('history-delete-selected')).toBeDisabled()
    expect(screen.getByText('0 selected')).toBeInTheDocument()
  })

  it('Select all ticks every clip, shows a mixed state for some, and clears again', async () => {
    await openSelecting()
    const all = screen.getByTestId('history-select-all')
    fireEvent.click(screen.getAllByTestId('history-select')[1])
    expect(all.indeterminate).toBe(true)
    expect(screen.getByText('1 selected')).toBeInTheDocument()
    expect(screen.getByTestId('history-delete-selected')).toHaveTextContent('Delete 1 clip')

    fireEvent.click(all)
    screen.getAllByTestId('history-select').forEach((b) => expect(b).toBeChecked())
    expect(all).toBeChecked()
    expect(all.indeterminate).toBe(false)
    expect(screen.getByTestId('history-delete-selected')).toHaveTextContent('Delete 3 clips')

    fireEvent.click(all)
    screen.getAllByTestId('history-select').forEach((b) => expect(b).not.toBeChecked())
  })

  it('deletes the ticked clips only after a confirm step, then leaves selection', async () => {
    api.deleteClips.mockResolvedValue(2)
    const { onDeleted, onLoaded } = await openSelecting()
    const boxes = screen.getAllByTestId('history-select')
    fireEvent.click(boxes[0])
    fireEvent.click(boxes[2])
    const del = screen.getByTestId('history-delete-selected')

    fireEvent.click(del)                                   // asks first
    expect(api.deleteClips).not.toHaveBeenCalled()
    expect(del).toHaveTextContent('Delete 2 clips for good?')
    expect(screen.getByRole('status')).toHaveTextContent(/can’t be undone/)

    fireEvent.click(screen.getByRole('button', { name: 'Keep' }))   // back out
    expect(del).toHaveTextContent(/^Delete 2 clips$/)
    expect(api.deleteClips).not.toHaveBeenCalled()

    api.getHistory.mockResolvedValue([three[1]])
    fireEvent.click(del)
    fireEvent.click(del)                                   // confirmed
    await waitFor(() => expect(api.deleteClips).toHaveBeenCalledWith(['clip-1', 'clip-3']))
    await waitFor(() => expect(screen.queryByTestId('history-select')).toBeNull())   // selection ended
    expect(onDeleted.mock.calls.map(([id]) => id)).toEqual(['clip-1', 'clip-3'])
    expect(await screen.findByText(/Pi mic · 3.0s/)).toBeInTheDocument()
    expect(screen.queryByText(/Upload · 5.2s/)).toBeNull()
    expect(screen.getAllByTestId('history-delete')).toHaveLength(1)    // single delete is back
    expect(onLoaded).not.toHaveBeenCalled()                // ticking never opens a clip
    expect(api.getClip).not.toHaveBeenCalled()
  })

  it('changing the selection withdraws a pending confirm', async () => {
    await openSelecting()
    fireEvent.click(screen.getAllByTestId('history-select')[0])
    fireEvent.click(screen.getByTestId('history-delete-selected'))
    expect(screen.getByTestId('history-delete-selected')).toHaveTextContent('for good?')
    fireEvent.click(screen.getAllByTestId('history-select')[1])
    expect(screen.getByTestId('history-delete-selected')).toHaveTextContent(/^Delete 2 clips$/)
  })

  it('Escape leaves selection first and only then closes the sheet; Done leaves it too', async () => {
    const { onClose } = await openSelecting()
    fireEvent.click(screen.getAllByTestId('history-select')[0])
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByTestId('history-select')).toBeNull()
    expect(screen.getByRole('button', { name: 'Select' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Select' }))
    expect(screen.getAllByTestId('history-select')[0]).not.toBeChecked()   // the old ticks are gone
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByTestId('history-select')).toBeNull()

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a long press on a row (touch) enters selection with that row ticked, without opening it', async () => {
    api.getHistory.mockResolvedValue(three)
    render(<Gallery open currentId={null} refreshKey={0} onLoaded={vi.fn()} onStatus={vi.fn()} />)
    await screen.findByText(/Upload · 5.2s/)
    vi.useFakeTimers()
    try {
      const row = screen.getAllByTestId('history-item')[1]
      fireEvent.pointerDown(row, { pointerType: 'touch' })
      act(() => { vi.advanceTimersByTime(300) })
      expect(screen.queryByTestId('history-select')).toBeNull()        // not yet
      act(() => { vi.advanceTimersByTime(250) })
      const boxes = screen.getAllByTestId('history-select')
      expect(boxes.map((b) => b.checked)).toEqual([false, true, false])
      expect(api.getClip).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a short tap never starts selection (a mouse press: launch.spec.mjs, jsdom has no pointer types)', async () => {
    api.getHistory.mockResolvedValue(three)
    api.getClip.mockResolvedValue({ id: 'clip-1', features: [] })
    render(<Gallery open currentId={null} refreshKey={0} onLoaded={vi.fn()} onStatus={vi.fn()} onClose={vi.fn()} />)
    await screen.findByText(/Upload · 5.2s/)
    vi.useFakeTimers()
    try {
      const row = screen.getAllByTestId('history-item')[0]
      fireEvent.pointerDown(row, { pointerType: 'touch' })
      act(() => { vi.advanceTimersByTime(200) })
      fireEvent.pointerUp(row, { pointerType: 'touch' })
      act(() => { vi.advanceTimersByTime(1000) })
      expect(screen.queryByTestId('history-select')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
    fireEvent.click(screen.getAllByTestId('history-item')[0])
    await waitFor(() => expect(api.getClip).toHaveBeenCalledWith('clip-1'))
  })

  it('offers no Select button when there is nothing to select', async () => {
    api.getHistory.mockResolvedValue([])
    render(<Gallery open currentId={null} refreshKey={0} onLoaded={vi.fn()} onStatus={vi.fn()} />)
    await screen.findByText(/No clips yet/)
    expect(screen.queryByRole('button', { name: 'Select' })).toBeNull()
  })

  it('shows an empty state when there are no clips', async () => {
    api.getHistory.mockResolvedValue([])
    render(<Gallery open currentId={null} refreshKey={0} onLoaded={vi.fn()} onStatus={vi.fn()} />)
    expect(await screen.findByText(/No clips yet/)).toBeInTheDocument()
  })

  it('shows an error state when getHistory rejects', async () => {
    api.getHistory.mockRejectedValue(new Error('network down'))
    render(<Gallery open currentId={null} refreshKey={0} onLoaded={vi.fn()} onStatus={vi.fn()} />)
    expect(await screen.findByText('network down')).toBeInTheDocument()
  })

  it('clicking a card calls getClip(id), then onLoaded and onClose', async () => {
    api.getHistory.mockResolvedValue(items)
    const fullClip = { id: 'clip-1', features: [{ t: 0, pitch: 0, timbre: 0, motion: 0, amplitude: 0 }] }
    api.getClip.mockResolvedValue(fullClip)
    const onLoaded = vi.fn()
    const onClose = vi.fn()
    const onStatus = vi.fn()

    render(<Gallery open currentId={null} refreshKey={0} onLoaded={onLoaded} onClose={onClose} onStatus={onStatus} />)
    const card = await screen.findByText(/Upload · 5.2s/)
    fireEvent.click(card.closest('button'))

    await waitFor(() => expect(api.getClip).toHaveBeenCalledWith('clip-1'))
    await waitFor(() => expect(onLoaded).toHaveBeenCalledWith(fullClip))
    expect(onClose).toHaveBeenCalled()
    expect(onStatus).toHaveBeenCalledWith('idle')
  })

  it('refetches when refreshKey changes (post-upload auto-refresh)', async () => {
    api.getHistory.mockResolvedValue(items)
    const { rerender } = render(
      <Gallery open={false} currentId={null} refreshKey={0} onLoaded={vi.fn()} onStatus={vi.fn()} />,
    )
    await waitFor(() => expect(api.getHistory).toHaveBeenCalledTimes(1))

    rerender(<Gallery open={false} currentId={null} refreshKey={1} onLoaded={vi.fn()} onStatus={vi.fn()} />)
    await waitFor(() => expect(api.getHistory).toHaveBeenCalledTimes(2))
  })
})
