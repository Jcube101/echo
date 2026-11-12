import { test, expect } from '@playwright/test'
import { trackConsoleErrors } from '../helpers.mjs'

// E2E-001 — app boots: WebGL canvas present and non-zero-sized, footer
// shows the bundled sample, 0 console errors. Formalizes verify_ui.mjs.
test('app boots with a non-blank canvas and the bundled sample', async ({ page }) => {
  const errors = trackConsoleErrors(page)
  await page.goto('/app')

  const canvas = page.locator('canvas').first()
  await expect(canvas).toBeVisible()
  const box = await canvas.boundingBox()
  expect(box.width).toBeGreaterThan(0)
  expect(box.height).toBeGreaterThan(0)

  await expect(page.getByText(/points · sample/)).toBeVisible()
  expect(errors).toEqual([])
})

// The installed app has to work with no network beyond its own origin. The 3D
// axis labels used to pull a font from a CDN; they now use a font from our own
// build, so nothing on /app may be fetched from anywhere else.
test('the app loads everything from its own origin', async ({ page, baseURL }) => {
  const foreign = []
  const fonts = []
  page.on('request', (req) => {
    const url = req.url()
    if (/^https?:/.test(url) && !url.startsWith(baseURL)) foreign.push(url)
    if (/\.woff(\?|$)/.test(url)) fonts.push(url)
  })
  await page.goto('/app')
  await expect(page.getByText(/points · sample/)).toBeVisible()
  // The label font is requested once the scene has mounted.
  await expect.poll(() => fonts.length).toBeGreaterThan(0)
  await page.waitForTimeout(1500)
  expect(foreign).toEqual([])
})
