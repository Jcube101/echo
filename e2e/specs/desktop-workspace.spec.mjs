import { test, expect } from '@playwright/test'
import path from 'node:path'
import { TONE_WAV } from '../fixtures-path.mjs'
import { trackConsoleErrors, uploadFileAndWait, setRangeValue } from '../helpers.mjs'

// E2E-DESK-* — Design v2 session 2 (DESIGN_V2.md §4.3–4.4): the desktop
// sidebar (clip card, playhead readout, recent clips) and the Spectral
// panel's label column. Runs at the default 1280px viewport, where the
// sidebar is shown.

test('sidebar shows the clip card, a live playhead readout and recent clips', async ({ page }) => {
  const errors = trackConsoleErrors(page)
  await page.goto('/app')
  const sidebar = page.getByRole('complementary', { name: 'Clip details' })
  await expect(sidebar.getByText('Example trail')).toBeVisible()

  await uploadFileAndWait(page, TONE_WAV)
  await expect(sidebar.getByRole('heading', { name: `Uploaded · ${path.basename(TONE_WAV)}` })).toBeVisible()

  // The readout follows the scrubber.
  const readout = sidebar.getByRole('region', { name: 'At the playhead' })
  await expect(readout.getByText('Pitch')).toBeVisible()
  await expect(readout.getByText('0:00')).toBeVisible()
  const slider = page.getByRole('slider', { name: 'Seek' })
  const max = parseFloat(await slider.getAttribute('max'))
  await setRangeValue(slider, (max * 0.9).toFixed(2))
  await expect(readout.getByText('0:00')).toHaveCount(0)

  // The new clip is listed under Recent clips and reloads on click.
  const recent = sidebar.getByTestId('recent-clip')
  await expect(recent).toHaveCount(1)
  // The stored clip keeps its filename, in the list and once reloaded.
  await expect(recent.first()).toContainText('Uploaded · tone.wav')
  await recent.first().click()
  await expect(sidebar.getByRole('heading', { name: 'Uploaded · tone.wav' })).toBeVisible()
  expect(errors).toEqual([])
})

test('spectral panel: lane names toggle their line and report aria-pressed', async ({ page }) => {
  await page.goto('/app')
  await uploadFileAndWait(page, TONE_WAV)
  await page.getByRole('tab', { name: 'Spectral panel' }).click()

  const crest = page.getByRole('button', { name: 'Spectral Crest' })
  await expect(crest).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('main svg path')).toHaveCount(7)
  await crest.click()
  await expect(crest).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('main svg path')).toHaveCount(6)
  await expect(page.getByTestId('panel-playhead')).toBeVisible()
})

test('below desktop width the sidebar gives way to the attribution chip', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 760 })
  await page.goto('/app')
  await expect(page.getByRole('complementary', { name: 'Clip details' })).toHaveCount(0)
  await page.getByTitle('Curated example sounds').click()
  await page.getByRole('dialog', { name: /Sample sounds/ }).getByTitle(/Visualize/).first().click()
  await expect(page.getByText(/rec\./)).toBeVisible({ timeout: 20_000 })
})
