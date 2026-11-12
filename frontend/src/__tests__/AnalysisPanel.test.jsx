import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import AnalysisPanel from '../components/AnalysisPanel.jsx'
import { PANEL_FEATURES } from '../lib/panelFeatures.js'

// FE-014 — Spectral panel (DESIGN_V2.md §4.4): seven stacked lanes, a label
// column whose names toggle their line, values at the playhead.
const frames = [0, 1, 2, 3, 4].map((t) => ({
  t, pitch: 0, timbre: 0, motion: 0, amplitude: 0.5,
  spread: 1000 + t * 500, crest: 5 + t, contrast: 20, slope: -0.0005, flatness: 0.02, hnr: 10, tonality: 0.5,
}))

describe('AnalysisPanel', () => {
  it('draws one lane per descriptor, each named by a pressed toggle', () => {
    const { container } = render(<AnalysisPanel features={frames} duration={4} playheadSec={0} onSeek={vi.fn()} />)
    expect(container.querySelectorAll('svg path')).toHaveLength(7)
    for (const pf of PANEL_FEATURES) {
      expect(screen.getByRole('button', { name: pf.label })).toHaveAttribute('aria-pressed', 'true')
    }
  })

  it('hides a line when its name is clicked and shows it again on a second click', () => {
    const { container } = render(<AnalysisPanel features={frames} duration={4} playheadSec={0} onSeek={vi.fn()} />)
    const crest = screen.getByRole('button', { name: 'Spectral Crest' })
    fireEvent.click(crest)
    expect(crest).toHaveAttribute('aria-pressed', 'false')
    expect(container.querySelectorAll('svg path')).toHaveLength(6)
    expect(container.querySelector('svg path[stroke="#2FA02F"]')).toBeNull()
    fireEvent.click(crest)
    expect(crest).toHaveAttribute('aria-pressed', 'true')
    expect(container.querySelectorAll('svg path')).toHaveLength(7)
  })

  it('shows each value at the playhead and moves the playhead with playheadSec', () => {
    const { rerender } = render(<AnalysisPanel features={frames} duration={4} playheadSec={0} onSeek={vi.fn()} />)
    expect(screen.getByText('1000 Hz')).toBeInTheDocument()
    expect(screen.getByText('5.0')).toBeInTheDocument()
    expect(screen.getByTestId('panel-playhead')).toHaveStyle({ left: '0%' })
    expect(screen.getByText('0:00.0 s')).toBeInTheDocument()

    rerender(<AnalysisPanel features={frames} duration={4} playheadSec={2} onSeek={vi.fn()} />)
    expect(screen.getByText('2000 Hz')).toBeInTheDocument()
    expect(screen.getByText('7.0')).toBeInTheDocument()
    expect(screen.getByTestId('panel-playhead')).toHaveStyle({ left: '50%' })
    expect(screen.getByText('0:02.0 s')).toBeInTheDocument()
  })

  it('shows a prompt instead of empty lanes when there is no clip', () => {
    render(<AnalysisPanel features={[]} duration={0} playheadSec={0} onSeek={vi.fn()} />)
    expect(screen.getByText(/load a clip to see its spectral descriptors/)).toBeInTheDocument()
  })

  it('uses the lane colour that reads on the night background for Spectral Crest', () => {
    expect(PANEL_FEATURES.find((p) => p.key === 'crest').color).toBe('#2FA02F')
  })
})
