import { test, expect } from '@playwright/test'
import { trackConsoleErrors } from '../helpers.mjs'

// E2E-010 — in-browser recording via Chromium's fake media device
// (config-wide --use-fake-device-for-media-capture /
// --use-fake-ui-for-media-capture, feeding our synthetic tone as the
// "microphone" signal): tap Record -> countdown visible -> Stop -> blob
// POSTs to /upload -> renders. Exercises the real MediaRecorder code path
// with no real mic.
//
// Best-effort — this does NOT replace HW-007/HW-008 (real Android/iOS
// phones), which stay manual per LEARNINGS.md's follow-up note: fake
// devices don't reproduce real device codec/mime behavior.
test('recording via a fake mic device runs the real MediaRecorder path', async ({ page, context }) => {
  const errors = trackConsoleErrors(page)
  await page.goto('/')
  await context.grantPermissions(['microphone'], { origin: new URL(page.url()).origin })

  await page.getByTitle(/Record from your device mic/).click()
  await expect(page.getByTitle('Stop recording')).toBeVisible({ timeout: 5000 })

  // Let a moment of (fake) audio accumulate, then stop early rather than
  // waiting out the full 60s cap.
  await page.waitForTimeout(1500)
  await page.getByTitle('Stop recording').click()

  await expect(page.getByText(/clip [0-9a-f]+/)).toBeVisible({ timeout: 20_000 })
  expect(errors).toEqual([])
})
