import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Samples from '../components/Samples.jsx'
import * as api from '../lib/api.js'

vi.mock('../lib/api.js')

// FE-008/FE-009 — samples-drawer attribution rendering + pick-to-load.
// SPEC.md: "each sample's attribution (species, recordist, license + URL,
// Xeno-canto source link) is shown in the UI" — a CC BY-NC-SA obligation,
// not cosmetic.
describe('Samples', () => {
  afterEach(() => vi.resetAllMocks())

  const koel = {
    id: 'asian-koel',
    species: 'Asian Koel',
    sci_name: 'Eudynamys scolopaceus',
    recordist: 'Albert Noorlander',
    license: 'CC BY-NC-SA 4.0',
    license_url: 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
    source_url: 'https://xeno-canto.org/1136884',
    xc_id: '1136884',
    duration_s: 20.56,
  }

  it('renders species, scientific name, recordist, license link, and XC source link', async () => {
    api.getSamples.mockResolvedValue([koel])
    render(<Samples open currentId={null} onLoaded={vi.fn()} onClose={vi.fn()} onStatus={vi.fn()} />)

    expect(await screen.findByText('Asian Koel')).toBeInTheDocument()
    expect(screen.getByText('Eudynamys scolopaceus')).toBeInTheDocument()
    expect(screen.getByText('Albert Noorlander')).toBeInTheDocument()

    const licenseLink = screen.getByRole('link', { name: 'CC BY-NC-SA 4.0' })
    expect(licenseLink).toHaveAttribute('href', koel.license_url)

    const sourceLink = screen.getByRole('link', { name: /Xeno-canto XC1136884/ })
    expect(sourceLink).toHaveAttribute('href', koel.source_url)
  })

  it('shows an empty state with no samples', async () => {
    api.getSamples.mockResolvedValue([])
    render(<Samples open currentId={null} onLoaded={vi.fn()} onStatus={vi.fn()} />)
    expect(await screen.findByText(/No samples available/)).toBeInTheDocument()
  })

  it('clicking a sample calls getSample and onLoaded with source_type "sample"', async () => {
    api.getSamples.mockResolvedValue([koel])
    api.getSample.mockResolvedValue({ id: 'asian-koel', features: [], audio_url: '/samples/audio/asian-koel.opus' })
    const onLoaded = vi.fn()
    const onClose = vi.fn()

    render(<Samples open currentId={null} onLoaded={onLoaded} onClose={onClose} onStatus={vi.fn()} />)
    await screen.findByText('Asian Koel')
    fireEvent.click(screen.getByTitle('Visualize Asian Koel'))

    await waitFor(() => expect(api.getSample).toHaveBeenCalledWith('asian-koel'))
    await waitFor(() => expect(onLoaded).toHaveBeenCalledWith(
      expect.objectContaining({ source_type: 'sample', id: 'asian-koel' }),
    ))
    expect(onClose).toHaveBeenCalled()
  })
})
