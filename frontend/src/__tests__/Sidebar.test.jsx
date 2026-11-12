import { render, screen, fireEvent, within } from '@testing-library/react'
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Sidebar, { clipLabel, sourceLabel } from '../components/Sidebar.jsx'
import * as api from '../lib/api.js'

vi.mock('../lib/api.js')

// FE-012 — desktop sidebar (DESIGN_V2.md §4.3): clip card, playhead readout,
// recent clips.
const frame = { t: 4.6, pitch: 2.56, timbre: 0.35, motion: -0.97, amplitude: 0.014 }
const koel = {
  species: 'Asian Koel', sci_name: 'Eudynamys scolopaceus', recordist: 'Albert Noorlander',
  license: 'CC BY-NC-SA 4.0', license_url: 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
  source_url: 'https://xeno-canto.org/1136884', provider: 'xeno-canto',
}
const history = [
  { id: 'aaa111', created_at: '2026-11-12T10:00:00Z', source_type: 'upload', duration_s: 18.2 },
  { id: 'bbb222', created_at: '2026-11-11T10:00:00Z', source_type: 'pi_mic', duration_s: 10 },
  { id: 'ccc333', created_at: '2026-11-10T10:00:00Z', source_type: 'upload', duration_s: 42 },
  { id: 'ddd444', created_at: '2026-11-09T10:00:00Z', source_type: 'upload', duration_s: 3 },
]

function renderSidebar(props = {}) {
  return render(
    <Sidebar
      sampleMeta={null} clipInfo={null} duration={14.5} frame={frame} playheadSec={4.6}
      historyKey={0} currentId={null} onPickClip={vi.fn()} onOpenHistory={vi.fn()}
      {...props}
    />,
  )
}

describe('Sidebar', () => {
  afterEach(() => vi.resetAllMocks())

  it('shows a sample with its required attribution (recordist, licence link, source link)', async () => {
    api.getHistory.mockResolvedValue([])
    renderSidebar({ sampleMeta: koel })
    expect(screen.getByRole('heading', { name: 'Asian Koel' })).toBeInTheDocument()
    expect(screen.getByText('Eudynamys scolopaceus')).toBeInTheDocument()
    expect(screen.getByText(/14\.5 s · rec\. Albert Noorlander/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'CC BY-NC-SA 4.0' })).toHaveAttribute('href', koel.license_url)
    expect(screen.getByRole('link', { name: /Xeno-canto/ })).toHaveAttribute('href', koel.source_url)
    await screen.findByText(/Nothing yet/)
  })

  it('names the source link Freesound for a Freesound sample', async () => {
    api.getHistory.mockResolvedValue([])
    renderSidebar({ sampleMeta: { ...koel, provider: 'freesound', source_url: 'https://freesound.org/s/1/' } })
    expect(screen.getByRole('link', { name: /Freesound/ })).toBeInTheDocument()
    await screen.findByText(/Nothing yet/)
  })

  it('labels a clip by where it came from', () => {
    expect(clipLabel({ kind: 'recording' })).toBe('Recorded in browser')
    expect(clipLabel({ kind: 'upload', name: 'park.m4a' })).toBe('Uploaded · park.m4a')
    expect(clipLabel({ kind: 'upload' })).toBe('Uploaded')
    expect(clipLabel({ kind: 'pi_mic' })).toBe('Pi microphone')
    // Reloaded from history: the API's source_type and filename.
    expect(clipLabel({ kind: 'history', sourceType: 'upload', name: 'park.m4a' })).toBe('Uploaded · park.m4a')
    expect(clipLabel({ kind: 'history', sourceType: 'recording' })).toBe('Recorded in browser')
    // A clip saved before the API kept either could be an upload or a recording.
    expect(clipLabel({ kind: 'history', sourceType: 'upload' })).toBe('Upload or recording')
    expect(clipLabel({ kind: 'history', sourceType: 'pi_mic' })).toBe('Pi microphone')
    expect(sourceLabel('something-new')).toBe('Clip')
  })

  it('shows the example card when nothing is loaded', async () => {
    api.getHistory.mockResolvedValue([])
    renderSidebar()
    expect(screen.getByRole('heading', { name: 'Example trail' })).toBeInTheDocument()
    await screen.findByText(/Nothing yet/)
  })

  it('reads out pitch, timbre, motion and loudness at the playhead', async () => {
    api.getHistory.mockResolvedValue([])
    renderSidebar()
    const readout = screen.getByRole('region', { name: 'At the playhead' })
    expect(within(readout).getByText('0:04')).toBeInTheDocument()
    expect(within(readout).getByText('+2.56')).toBeInTheDocument()
    expect(within(readout).getByText('+0.35')).toBeInTheDocument()
    expect(within(readout).getByText('-0.97')).toBeInTheDocument()
    expect(within(readout).getByText('1%')).toBeInTheDocument()
    await screen.findByText(/Nothing yet/)
  })

  it('lists the three latest clips, links to all of them, and loads one on click', async () => {
    api.getHistory.mockResolvedValue(history)
    const onPickClip = vi.fn()
    const onOpenHistory = vi.fn()
    renderSidebar({ onPickClip, onOpenHistory, currentId: 'bbb222' })

    const rows = await screen.findAllByTestId('recent-clip')
    expect(rows).toHaveLength(3)
    expect(within(rows[0]).getByText('Upload or recording')).toBeInTheDocument()
    expect(within(rows[0]).getByText('0:18')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Pi microphone')).toBeInTheDocument()
    expect(rows[1]).toHaveAttribute('aria-current', 'true')

    fireEvent.click(rows[2])
    expect(onPickClip).toHaveBeenCalledWith('ccc333')

    fireEvent.click(screen.getByRole('button', { name: 'All 4' }))
    expect(onOpenHistory).toHaveBeenCalled()
  })

  it('says so when recent clips cannot be loaded', async () => {
    api.getHistory.mockRejectedValue(new Error('offline'))
    renderSidebar()
    expect(await screen.findByText(/Couldn’t load recent clips/)).toBeInTheDocument()
  })
})
