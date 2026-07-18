import { render, screen } from '@testing-library/react'
import React from 'react'
import { describe, expect, it } from 'vitest'
import Spectrogram from '../components/Spectrogram.jsx'

// FE-011 — Spectrogram DOM (canvas 2D is stubbed in vitest.setup.js; pixel
// output is verified by E2E-006 in a real browser, not here).
describe('Spectrogram', () => {
  it('shows a placeholder when there is no spectrogram data', () => {
    render(<Spectrogram spectrogram={null} progress={0} duration={0} />)
    expect(screen.getByText(/spectrogram appears once a clip is loaded/)).toBeInTheDocument()
  })

  it('renders frequency tick labels from freq_ticks', () => {
    const spectrogram = {
      bins: 4, cols: 4, data: new Array(16).fill(0),
      freq_ticks: [
        { hz: 250, pos: 0.1, label: '250' },
        { hz: 1000, pos: 0.4, label: '1k' },
        { hz: 4000, pos: 0.8, label: '4k' },
      ],
    }
    render(<Spectrogram spectrogram={spectrogram} progress={0.3} duration={10} />)
    expect(screen.getByText('250')).toBeInTheDocument()
    expect(screen.getByText('1k')).toBeInTheDocument()
    expect(screen.getByText('4k')).toBeInTheDocument()
  })

  it('renders without crashing when freq_ticks is absent (older clips, back-compat)', () => {
    const spectrogram = { bins: 2, cols: 2, data: [0, 0, 0, 0] }
    render(<Spectrogram spectrogram={spectrogram} progress={0} duration={5} />)
    // no freq tick labels, but the panel itself still renders
    expect(screen.queryByText(/spectrogram appears once/)).not.toBeInTheDocument()
  })

  it('positions the playhead line at progress * 100%', () => {
    const spectrogram = { bins: 2, cols: 2, data: [0, 0, 0, 0], freq_ticks: [] }
    const { container } = render(<Spectrogram spectrogram={spectrogram} progress={0.42} duration={10} />)
    const playhead = container.querySelector('.bg-white\\/90')
    expect(playhead).toHaveStyle({ left: '42%' })
  })

  it('renders ~5 time ticks spanning the duration', () => {
    const spectrogram = { bins: 2, cols: 2, data: [0, 0, 0, 0], freq_ticks: [] }
    render(<Spectrogram spectrogram={spectrogram} progress={0} duration={120} />)
    expect(screen.getByText('0:00')).toBeInTheDocument()
    expect(screen.getByText('2:00')).toBeInTheDocument()
  })
})
