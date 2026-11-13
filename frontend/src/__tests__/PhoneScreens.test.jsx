import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PhoneHome, PhoneRecording, PhoneResultHeader, PiMicRecording, PlayheadChips, featuredSamples,
} from '../components/PhoneScreens.jsx'
import * as api from '../lib/api.js'

vi.mock('../lib/api.js')

// FE-013 — phone screens (DESIGN_V2.md §4.5–4.7).
const sample = (id, species, duration_s = 10) => ({ id, species, duration_s })
const library = [
  sample('asian-koel', 'Asian Koel', 20.56), sample('common-myna', 'Common Myna', 14.5),
  sample('rose-ringed-parakeet', 'Rose-ringed Parakeet'), sample('lion-roar', 'Lion', 13.2),
  sample('wolf-howl', 'Wolf', 23.2), sample('cow-moo', 'Cow'),
]

function makeActions(over = {}) {
  return {
    recorder: { supported: true, recording: false, elapsed: 0, maxSeconds: 60, levels: [], levelBars: 48, stop: vi.fn(), cancel: vi.fn() },
    startRecording: vi.fn(), pickFile: vi.fn(), runCapture: vi.fn(),
    captureSecs: '5', setCaptureSecs: vi.fn(), inFlight: null,
    ...over,
  }
}

describe('featuredSamples', () => {
  it('leads with the four chosen samples, in that order', () => {
    expect(featuredSamples(library).map((s) => s.id)).toEqual(['asian-koel', 'common-myna', 'wolf-howl', 'lion-roar'])
  })

  it('fills gaps from the front of the library when a chosen sample is missing', () => {
    const without = library.filter((s) => s.id !== 'wolf-howl')
    expect(featuredSamples(without).map((s) => s.id)).toEqual(['asian-koel', 'common-myna', 'lion-roar', 'rose-ringed-parakeet'])
    expect(featuredSamples([])).toEqual([])
  })
})

describe('PiMicRecording', () => {
  const capture = (over = {}) => ({ seconds: 10, startedAt: Date.now() - 3000, phase: 'recording', ending: null, ...over })

  it('shows that the Pi mic is listening, with a countdown, Stop and Cancel', () => {
    const actions = makeActions({ piCapture: capture(), stopCapture: vi.fn(), cancelCapture: vi.fn() })
    render(<PiMicRecording actions={actions} onOpenHistory={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Pi mic is listening' })).toBeInTheDocument()
    expect(screen.getByRole('timer')).toHaveAccessibleName(/^Pi mic is listening, 0:0[34] of 0:10$/)
    expect(screen.getByText('of 0:10')).toBeInTheDocument()
    expect(screen.getByText(/the Pi still finishes and the clip appears in History/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Stop and see its shape/ }))
    expect(actions.stopCapture).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(actions.cancelCapture).toHaveBeenCalledTimes(1)
  })

  it('once the recording is done, offers Cancel only and says it is analysing', () => {
    const actions = makeActions({ piCapture: capture({ phase: 'finishing' }), stopCapture: vi.fn(), cancelCapture: vi.fn() })
    render(<PiMicRecording actions={actions} onOpenHistory={vi.fn()} />)
    expect(screen.getByRole('timer')).toHaveAccessibleName('Analysing the recording')
    expect(screen.queryByRole('button', { name: /Stop/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
  })

  it('disables both buttons once an ending was asked for', () => {
    const actions = makeActions({ piCapture: capture({ ending: 'cancel' }), stopCapture: vi.fn(), cancelCapture: vi.fn() })
    render(<PiMicRecording actions={actions} onOpenHistory={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Stop and see its shape/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancelling…' })).toBeDisabled()
  })
})

describe('PhoneHome', () => {
  afterEach(() => vi.resetAllMocks())

  it('hides the Pi mic from everyone but the signed-in owner', async () => {
    api.getSamples.mockResolvedValue(library)
    render(<PhoneHome actions={makeActions()} busy={false} onPickSample={vi.fn()} onOpenSamples={vi.fn()} onOpenHistory={vi.fn()} loadingSampleId={null} />)
    await screen.findAllByTestId('home-sample')
    expect(screen.getByTitle('Upload an audio or video file')).toBeInTheDocument()
    expect(screen.queryByTitle("Record from the Pi's USB mic")).toBeNull()
    expect(screen.queryByText('Pi mic')).toBeNull()
  })

  it('offers record, upload, Pi mic (owner) and four samples, each wired to its action', async () => {
    api.getSamples.mockResolvedValue(library)
    const actions = makeActions({ piMic: true })
    const onPickSample = vi.fn()
    const onOpenSamples = vi.fn()
    const onOpenHistory = vi.fn()
    render(<PhoneHome actions={actions} busy={false} onPickSample={onPickSample} onOpenSamples={onOpenSamples} onOpenHistory={onOpenHistory} loadingSampleId={null} />)

    expect(screen.getByText('Tap to record')).toBeInTheDocument()
    expect(screen.getByText('Up to 60 seconds')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    expect(actions.startRecording).toHaveBeenCalled()
    fireEvent.click(screen.getByTitle('Upload an audio or video file'))
    expect(actions.pickFile).toHaveBeenCalled()
    fireEvent.click(screen.getByTitle("Record from the Pi's USB mic"))
    expect(actions.runCapture).toHaveBeenCalled()

    const rows = await screen.findAllByTestId('home-sample')
    expect(rows).toHaveLength(4)
    expect(rows[0]).toHaveTextContent('Asian Koel')
    expect(rows[0]).toHaveTextContent('21 s')
    fireEvent.click(rows[1])
    expect(onPickSample).toHaveBeenCalledWith('common-myna')

    fireEvent.click(screen.getByRole('button', { name: 'All 6' }))
    expect(onOpenSamples).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'History' }))
    expect(onOpenHistory).toHaveBeenCalled()
  })

  it('disables the actions while a clip is being processed', async () => {
    api.getSamples.mockResolvedValue(library)
    render(<PhoneHome actions={makeActions()} busy onPickSample={vi.fn()} onOpenSamples={vi.fn()} onOpenHistory={vi.fn()} loadingSampleId={null} />)
    expect(screen.getByRole('button', { name: 'Record' })).toBeDisabled()
    expect(screen.getByTitle('Upload an audio or video file')).toBeDisabled()
    const rows = await screen.findAllByTestId('home-sample')
    expect(rows[0]).toBeDisabled()
  })

  it('points to upload when the browser cannot record', async () => {
    api.getSamples.mockResolvedValue([])
    const actions = makeActions()
    actions.recorder.supported = false
    render(<PhoneHome actions={actions} busy={false} onPickSample={vi.fn()} onOpenSamples={vi.fn()} onOpenHistory={vi.fn()} loadingSampleId={null} />)
    expect(screen.queryByRole('button', { name: 'Record' })).not.toBeInTheDocument()
    expect(screen.getByText('Upload a clip instead')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'All samples' })).toBeInTheDocument()
  })
})

describe('PhoneRecording', () => {
  it('shows the countdown and wires Stop and Cancel', () => {
    const recorder = { elapsed: 12.4, maxSeconds: 60, levels: [0.2, 0.8, 0.5], levelBars: 48, stop: vi.fn(), cancel: vi.fn() }
    render(<PhoneRecording recorder={recorder} onOpenHistory={vi.fn()} />)

    expect(screen.getByText('Point toward the sound')).toBeInTheDocument()
    expect(screen.getByRole('timer')).toHaveAccessibleName('Recording, 0:12 of 1:00')
    expect(screen.getByText('0:12')).toBeInTheDocument()
    expect(screen.getByText('of 1:00 max')).toBeInTheDocument()
    expect(screen.getByText(/The mic switches off as soon as you stop/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Stop and see its shape/ }))
    expect(recorder.stop).toHaveBeenCalledTimes(1)
    expect(recorder.cancel).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(recorder.cancel).toHaveBeenCalledTimes(1)
  })
})

describe('PhoneResultHeader + PlayheadChips', () => {
  it('shows the clip name and type, with Back and History', () => {
    const onBack = vi.fn()
    const onOpenHistory = vi.fn()
    render(<PhoneResultHeader title="Common Myna" subtitle="Sample · 14.5 s" onBack={onBack} onOpenHistory={onOpenHistory} />)
    expect(screen.getByRole('heading', { name: 'Common Myna' })).toBeInTheDocument()
    expect(screen.getByText('Sample · 14.5 s')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Back to home' }))
    expect(onBack).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'History' }))
    expect(onOpenHistory).toHaveBeenCalled()
  })

  it('shows signed values at the playhead, and dashes with no frame', () => {
    const { rerender } = render(<PlayheadChips frame={{ pitch: 2.56, timbre: 0.35, motion: -0.97 }} />)
    expect(screen.getByText('+2.56')).toBeInTheDocument()
    expect(screen.getByText('+0.35')).toBeInTheDocument()
    expect(screen.getByText('-0.97')).toBeInTheDocument()
    rerender(<PlayheadChips frame={null} />)
    expect(screen.getAllByText('—')).toHaveLength(3)
  })
})
