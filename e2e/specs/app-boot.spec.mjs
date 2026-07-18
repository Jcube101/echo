import { test, expect } from '@playwright/test'
import { trackConsoleErrors } from '../helpers.mjs'

// E2E-001 — app boots: WebGL canvas present and non-zero-sized, footer
// shows the bundled sample, 0 console errors. Formalizes verify_ui.mjs.
test('app boots with a non-blank canvas and the bundled sample', async ({ page }) => {
  const errors = trackConsoleErrors(page)
  await page.goto('/')

  const canvas = page.locator('canvas').first()
  await expect(canvas).toBeVisible()
  const box = await canvas.boundingBox()
  expect(box.width).toBeGreaterThan(0)
  expect(box.height).toBeGreaterThan(0)

  await expect(page.getByText(/points · sample/)).toBeVisible()
  expect(errors).toEqual([])
})
