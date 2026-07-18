import { test, expect } from '@playwright/test'
import { TONE_WAV } from '../fixtures-path.mjs'
import { trackConsoleErrors, uploadFileAndWait } from '../helpers.mjs'

// E2E-002 — upload flow: set the file input with a fixture clip, footer
// flips to "clip {id}", trail renders. Formalizes verify_upload.mjs. This
// shared upload path is also the stand-in wiring test for phone recording
// (LEARNINGS.md's follow-up note): both go through uploadAudio -> /upload
// -> render.
test('uploading a file renders a new clip', async ({ page }) => {
  const errors = trackConsoleErrors(page)
  await page.goto('/')

  await uploadFileAndWait(page, TONE_WAV)

  await expect(page.locator('canvas').first()).toBeVisible()
  expect(errors).toEqual([])
})
