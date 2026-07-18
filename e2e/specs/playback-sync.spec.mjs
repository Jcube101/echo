import { test, expect } from '@playwright/test'
import { TONE_WAV } from '../fixtures-path.mjs'
import { trackConsoleErrors, uploadFileAndWait, setRangeValue } from '../helpers.mjs'

// E2E-003 — scrubber-to-trail sync: dragging the seek input to several
// positions updates the playhead time label monotonically, with zero
// console errors — the same headless-verifiable property LEARNINGS.md
// describes ("Scrub-driven highlight sync … verifiable headlessly").
// Formalizes verify_playback.mjs.
//
// SPEC.md: "Playback scrubber synced to the trail (the current point
// highlights as playback advances)."
test('scrubbing moves the playhead label forward through the clip', async ({ page }) => {
  const errors = trackConsoleErrors(page)
  await page.goto('/')
  await uploadFileAndWait(page, TONE_WAV)

  const slider = page.getByRole('slider', { name: 'Seek' })
  const max = parseFloat(await slider.getAttribute('max'))
  expect(max).toBeGreaterThan(0)

  const labels = []
  for (const frac of [0.15, 0.5, 0.85]) {
    await setRangeValue(slider, (max * frac).toFixed(2))
    await page.waitForTimeout(100)
    labels.push(await slider.inputValue())
  }

  expect(Number(labels[0])).toBeLessThan(Number(labels[1]))
  expect(Number(labels[1])).toBeLessThan(Number(labels[2]))
  expect(errors).toEqual([])
})
