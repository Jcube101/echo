import { render, screen, waitFor, fireEvent } from '@testing-library/react'
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
