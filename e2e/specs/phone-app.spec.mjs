import { test, expect, devices } from '@playwright/test'
import { TONE_WAV } from '../fixtures-path.mjs'
import { trackConsoleErrors } from '../helpers.mjs'

// E2E-PHONE-* — Design v2 session 3 (DESIGN_V2.md §4.5–4.7): the phone app's
// home, recording and result screens, on Pixel 5 emulation.
test.use({ ...devices['Pixel 5'], hasTouch: true })

test('home → sample → result → back', async ({ page }) => {
  const errors = trackConsoleErrors(page)
  await page.goto('/app')

  // Home: record button, the two secondary actions, four featured samples.
  await expect(page.getByRole('button', { name: 'Record' })).toBeVisible()
  await expect(page.getByText('Tap to record')).toBeVisible()
  await expect(page.getByTitle('Upload an audio or video file')).toBeVisible()
  await expect(page.getByTitle("Record from the Pi's USB mic")).toBeVisible()
  await expect(page.getByTestId('home-sample')).toHaveCount(4)
  await expect(page.locator('canvas')).toHaveCount(0)

  // Result: name + type, trail, readout chips, spectrogram, attribution.
  await page.getByTestId('home-sample').filter({ hasText: 'Common Myna' }).click()
  await expect(page.getByRole('heading', { name: 'Common Myna' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(/^Sample · [\d.]+ s$/)).toBeVisible()
  await expect(page.locator('canvas')).toHaveCount(2) // WebGL trail + spectrogram
  const chips = page.getByRole('group', { name: 'At the playhead' })
  await expect(chips.getByText('Pitch')).toBeVisible()
  await expect(page.getByText(/rec\. David Darrell-Lambert/)).toBeVisible()
  await expect(page.getByRole('link', { name: 'Xeno-canto' })).toBeVisible()

  // Spectral tab keeps the seven lanes.
  await page.getByRole('tab', { name: 'Spectral' }).click()
  await expect(page.getByRole('button', { name: 'Spectral Crest' })).toBeVisible()
  await expect(page.locator('main svg path')).toHaveCount(7)

  // Back returns to the home screen.
  await page.getByRole('button', { name: 'Back to home' }).click()
  await expect(page.getByText('Tap to record')).toBeVisible()
  expect(errors).toEqual([])
})

test('upload from the phone home opens the result; History reloads it', async ({ page }) => {
  await page.goto('/app')
  await page.locator('input[type="file"]').setInputFiles(TONE_WAV)
  await expect(page.getByRole('heading', { name: /^Uploaded · / })).toBeVisible({ timeout: 20_000 })

  await page.getByRole('button', { name: 'Back to home' }).click()
  await page.getByRole('button', { name: 'History' }).click()
  await page.getByRole('dialog', { name: /History/ }).getByTestId('history-item').first().click()
  await expect(page.getByRole('heading', { name: 'Uploaded · tone.wav' })).toBeVisible()
})

test('recording screen: countdown, Stop uploads, Cancel discards', async ({ page }) => {
  // A stand-in mic: getUserMedia and MediaRecorder are replaced with minimal
  // fakes so Stop and Cancel behave the same on every run. This tests the
  // screen and its wiring; the real MediaRecorder path is E2E-010
  // (recording-fake-device.spec.mjs).
  await page.addInitScript(() => {
    window.__uploads = 0
    navigator.mediaDevices.getUserMedia = async () => new MediaStream()
    window.MediaRecorder = class {
      constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm' }
      static isTypeSupported() { return true }
      start() { this.state = 'recording' }
      stop() {
        this.state = 'inactive'
        this.ondataavailable?.({ data: new Blob(['not real audio'], { type: 'audio/webm' }) })
        this.onstop?.()
      }
    }
  })
  let uploads = 0
  await page.route('**/upload', (route) => { uploads += 1; route.fulfill({ status: 422, json: { detail: 'Could not read audio (test stub).' } }) })

  await page.goto('/app')
  await page.getByRole('button', { name: 'Record' }).click()
  await expect(page.getByText('Point toward the sound')).toBeVisible()
  await expect(page.getByRole('timer')).toBeVisible()
  await expect(page.getByText('of 1:00 max')).toBeVisible()

  // Cancel: back home, nothing uploaded.
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByText('Tap to record')).toBeVisible()
  await page.waitForTimeout(300)
  expect(uploads).toBe(0)

  // Stop: the recording is sent to /upload.
  await page.getByRole('button', { name: 'Record' }).click()
  await page.getByRole('button', { name: 'Stop and see its shape' }).click()
  await expect(page.getByText(/Could not read audio/)).toBeVisible()
  expect(uploads).toBe(1)
})
