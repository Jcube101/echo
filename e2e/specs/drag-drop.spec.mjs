import { readFileSync } from 'node:fs'
import { test, expect } from '@playwright/test'
import { TONE_WAV } from '../fixtures-path.mjs'
import { trackConsoleErrors } from '../helpers.mjs'

// E2E-008 — drag-and-drop: dragover shows the "Drop audio to visualize"
// overlay; dropping a fixture file runs the upload flow.
test('dragover shows the drop overlay, and dropping a file uploads it', async ({ page }) => {
  const errors = trackConsoleErrors(page)
  await page.goto('/')

  const bytes = Array.from(readFileSync(TONE_WAV))
  const dataTransfer = await page.evaluateHandle((data) => {
    const dt = new DataTransfer()
    const file = new File([new Uint8Array(data)], 'tone.wav', { type: 'audio/wav' })
    dt.items.add(file)
    return dt
  }, bytes)

  await page.dispatchEvent('main', 'dragover', { dataTransfer })
  await expect(page.getByText(/Drop audio to visualize/)).toBeVisible()

  await page.dispatchEvent('main', 'drop', { dataTransfer })
  await expect(page.getByText(/clip [0-9a-f]+/)).toBeVisible({ timeout: 20_000 })
  expect(errors).toEqual([])
})
