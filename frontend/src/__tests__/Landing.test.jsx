import { fireEvent, render, screen, within } from '@testing-library/react'
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import Landing from '../Landing.jsx'
import { SAMPLES, thumbFor } from '../lib/sampleArt.js'

// FE-015 — landing page (DESIGN_V2.md §4.1–4.2, §5).
describe('Landing', () => {
  it('has one h1 and the section headings', () => {
    render(<Landing />)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Every sound has a shape.')
    for (const name of ['How it works', 'Turn it in 3D, or read it line by line', 'Good to know', 'Hear something? See its shape.']) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument()
    }
  })

  it('takes the sample count from the generated library data', () => {
    render(<Landing />)
    expect(screen.getByText(`Start with one of ${SAMPLES.length} sample sounds`)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: `All ${SAMPLES.length} samples` })).toBeInTheDocument()
  })

  it('links every call to action into the app', () => {
    render(<Landing />)
    for (const link of screen.getAllByRole('link', { name: 'Record a sound' })) {
      expect(link).toHaveAttribute('href', '/app?record=1')
    }
    expect(screen.getByRole('link', { name: 'Upload a clip' })).toHaveAttribute('href', '/app')
    expect(screen.getByRole('link', { name: 'Open the sample library' })).toHaveAttribute('href', '/app?samples=1')
    expect(screen.getByRole('link', { name: 'Try a sample' })).toHaveAttribute('href', '/app?samples=1')
  })

  it('gives every sample in the library a deep link and a thumbnail', () => {
    const { container } = render(<Landing />)
    for (const s of SAMPLES) {
      expect(container.querySelector(`a[href="/app?sample=${s.id}"]`)).not.toBeNull()
      expect(thumbFor(s.id)).toBeTruthy()
    }
  })

  it('credits each featured sample: recordist, licence link and source link', () => {
    render(<Landing />)
    const list = screen.getAllByRole('list').find((ul) => within(ul).queryByText(/rec\. Albert Noorlander/))
    expect(within(list).getAllByRole('listitem')).toHaveLength(4)
    const koel = SAMPLES.find((s) => s.id === 'asian-koel')
    expect(within(list).getByRole('link', { name: koel.license })).toHaveAttribute('href', koel.license_url)
    expect(within(list).getByRole('link', { name: /Xeno-canto/ })).toHaveAttribute('href', koel.source_url)
  })

  it('has seven FAQ items, all closed by default, with the agreed limits in the copy', () => {
    const { container } = render(<Landing />)
    const items = container.querySelectorAll('#faq details')
    expect(items).toHaveLength(7)
    expect(container.querySelectorAll('#faq details[open]')).toHaveLength(0)
    const faq = container.querySelector('#faq').textContent
    // If a limit changes, the copy must change with it (DESIGN_V2.md §5).
    expect(faq).toMatch(/up to 60 seconds/i)
    expect(faq).toMatch(/up to 20 MB/)
    expect(faq).toMatch(/only this browser can see it/)
    expect(faq).toMatch(/haven’t opened in 30 days are deleted/)
    expect(faq).not.toMatch(/50 clips/)
  })

  it('has a Privacy dialog in the footer that repeats the FAQ answer word for word', () => {
    const showModal = vi.fn()
    HTMLDialogElement.prototype.showModal = showModal
    const { container } = render(<Landing />)
    const dialog = container.querySelector('footer dialog')
    const answer = [...container.querySelectorAll('#faq details')]
      .find((d) => /Is my audio kept\?/.test(d.textContent)).querySelector('summary ~ *').textContent.trim()
    expect(answer).toMatch(/^Only a small copy for playback, and only this browser can see it\./)
    expect(dialog.textContent).toContain(answer)
    expect(dialog.textContent).toMatch(/no accounts/i)
    expect(dialog.textContent).toMatch(/one cookie/i)
    expect(dialog.getAttribute('aria-labelledby')).toBe('privacy-title')

    fireEvent.click(within(container.querySelector('footer')).getByRole('button', { name: 'Privacy' }))
    expect(showModal).toHaveBeenCalledTimes(1)
  })

  it('uses no bird, species or identification language outside the samples', () => {
    const { container } = render(<Landing />)
    const clone = container.cloneNode(true)
    clone.querySelector('#samples').remove()
    clone.querySelectorAll('[role="img"]').forEach((n) => n.remove())
    expect(clone.textContent).not.toMatch(/\bbirds?\b|\bspecies\b|\bidentif/i)
  })

  it('labels the illustrations for screen readers', () => {
    render(<Landing />)
    expect(screen.getByRole('img', { name: /Five sample sounds/ })).toBeInTheDocument()
    expect(screen.getAllByRole('img').every((el) => el.getAttribute('aria-label') || el.hasAttribute('alt'))).toBe(true)
  })
})
