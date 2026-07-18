import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import PlaybackBar from '../components/PlaybackBar.jsx'

// FE-010 — PlaybackBar. LEARNINGS.md: "Playback highlight … updated by BOTH
// the <audio> timeupdate event AND the seek <input>."
describe('PlaybackBar', () => {
  it('disables the transport when there is no audioUrl', () => {
    render(<PlaybackBar audioUrl={null} duration={0} spectrogram={null} playheadSec={0} onSeek={vi.fn()} />)
    expect(screen.getByTitle('Play')).toBeDisabled()
    expect(screen.getByRole('slider', { name: /Seek/i })).toBeDisabled()
  })

  it('enables the transport once an audioUrl is set', () => {
    render(<PlaybackBar audioUrl="/audio/x.opus" duration={5} spectrogram={null} playheadSec={0} onSeek={vi.fn()} />)
    expect(screen.getByTitle('Play')).not.toBeDisabled()
    expect(screen.getByRole('slider', { name: /Seek/i })).not.toBeDisabled()
  })

  it('scrubbing the seek input calls onSeek with the new time', () => {
    const onSeek = vi.fn()
    render(<PlaybackBar audioUrl="/audio/x.opus" duration={10} spectrogram={null} playheadSec={0} onSeek={onSeek} />)
    const slider = screen.getByRole('slider', { name: /Seek/i })
    fireEvent.change(slider, { target: { value: '4.5' } })
    expect(onSeek).toHaveBeenCalledWith(4.5)
  })

  it('propagates <audio> timeupdate events to onSeek', () => {
    const onSeek = vi.fn()
    const { container } = render(
      <PlaybackBar audioUrl="/audio/x.opus" duration={10} spectrogram={null} playheadSec={0} onSeek={onSeek} />,
    )
    const audioEl = container.querySelector('audio')
    Object.defineProperty(audioEl, 'currentTime', { value: 3.25, configurable: true })
    fireEvent.timeUpdate(audioEl)
    expect(onSeek).toHaveBeenCalledWith(3.25)
  })

  it('formats the playhead and duration labels as m:ss', () => {
    render(<PlaybackBar audioUrl="/audio/x.opus" duration={125} spectrogram={null} playheadSec={65} onSeek={vi.fn()} />)
    expect(screen.getByText('1:05')).toBeInTheDocument()
    expect(screen.getByText('2:05')).toBeInTheDocument()
  })

  it('resets to paused/zero when the audioUrl changes (new clip loaded)', () => {
    const { rerender, container } = render(
      <PlaybackBar audioUrl="/audio/a.opus" duration={10} spectrogram={null} playheadSec={7} onSeek={vi.fn()} />,
    )
    const audioEl = container.querySelector('audio')
    const pauseSpy = vi.spyOn(audioEl, 'pause').mockImplementation(() => {})

    rerender(<PlaybackBar audioUrl="/audio/b.opus" duration={8} spectrogram={null} playheadSec={7} onSeek={vi.fn()} />)

    expect(pauseSpy).toHaveBeenCalled()
    expect(audioEl.currentTime).toBe(0)
  })
})
