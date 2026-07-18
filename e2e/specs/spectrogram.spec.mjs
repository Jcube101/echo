import { test, expect } from '@playwright/test'
import { TONE_WAV } from '../fixtures-path.mjs'
import { trackConsoleErrors, uploadFileAndWait, setRangeValue } from '../helpers.mjs'

// E2E-006 — spectrogram strip: second canvas renders, Hz labels from
// freq_ticks and mm:ss time labels visible, playhead line moves with the
// scrubber.
//
// SPEC.md: "2D spectrogram strip … log/mel frequency axis (Hz) and a time
// axis (aligned to the scrubber)."
test('spectrogram renders with frequency/time axes and a moving playhead', async ({ page }) => {
  const errors = trackConsoleErrors(page)
  await page.goto('/')
  await uploadFileAndWait(page, TONE_WAV)

  const canvases = page.locator('canvas')
  await expect(canvases).toHaveCount(2) // WebGL trail + 2D spectrogram

  // Hz axis labels (from backend freq_ticks) and a time axis label.
  await expect(page.getByText(/^(250|500|1k|2k|4k|8k)$/).first()).toBeVisible()
  await expect(page.getByText('0:00').first()).toBeVisible()

  const playhead = page.locator('.bg-white\\/90')
  const before = await playhead.evaluate((el) => el.style.left)

  const slider = page.getByRole('slider', { name: 'Seek' })
  const max = parseFloat(await slider.getAttribute('max'))
  await setRangeValue(slider, (max * 0.8).toFixed(2))
  await page.waitForTimeout(150)

  const after = await playhead.evaluate((el) => el.style.left)
  expect(after).not.toBe(before)
  expect(errors).toEqual([])
})
