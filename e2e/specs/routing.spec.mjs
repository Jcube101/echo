import { test, expect } from '@playwright/test'
import { trackConsoleErrors } from '../helpers.mjs'

// E2E-ROUTE-* — Design v2 session 1: landing at /, app at /app
// (DESIGN_V2.md §2), ?record=1 auto-start, and the PWA manifest.

test('/ shows the landing page and links into the app', async ({ page }) => {
  const errors = trackConsoleErrors(page)
  await page.goto('/')

  await expect(page.getByRole('heading', { level: 1, name: 'Every sound has a shape.' })).toBeVisible()
  await expect(page.locator('canvas')).toHaveCount(0)

  await page.getByRole('link', { name: 'Open Echo' }).click()
  await expect(page).toHaveURL(/\/app$/)
  await expect(page.locator('canvas').first()).toBeVisible()
  await expect(page.getByText(/points · sample/)).toBeVisible()
  expect(errors).toEqual([])
})

test('/app/anything serves the app (reserved for later deep links)', async ({ page }) => {
  await page.goto('/app/anything')
  await expect(page.locator('canvas').first()).toBeVisible()
})

test('/app?record=1 asks for the mic straight away and drops the param', async ({ page }) => {
  // Asserts the recorder is STARTED (getUserMedia requested with no click),
  // not that a recording completes: headless Chromium on the Pi has no audio
  // session, so the fake-device capture itself fails here — the same known
  // environment limit as E2E-010 (TEST_PLAN.md).
  await page.addInitScript(() => {
    const md = navigator.mediaDevices
    const real = md.getUserMedia.bind(md)
    window.__gumCalls = 0
    md.getUserMedia = (c) => { window.__gumCalls += 1; return real(c) }
  })
  await page.goto('/app?record=1')
  await page.waitForFunction(() => window.__gumCalls === 1)
  await expect(page).toHaveURL(/\/app$/)
  // Either outcome proves the recorder path ran: recording, or its error toast.
  await expect(page.getByTitle('Stop recording').or(page.getByText('Recording failed'))).toBeVisible()
  expect(await page.evaluate(() => window.__gumCalls)).toBe(1)
})

test('/app without ?record=1 does not touch the mic', async ({ page }) => {
  await page.addInitScript(() => {
    const md = navigator.mediaDevices
    window.__gumCalls = 0
    md.getUserMedia = () => { window.__gumCalls += 1; return Promise.reject(new Error('unexpected')) }
  })
  await page.goto('/app')
  await expect(page.getByText(/points · sample/)).toBeVisible()
  await page.waitForTimeout(500)
  expect(await page.evaluate(() => window.__gumCalls)).toBe(0)
})

test('API paths still return JSON, with the service worker in control', async ({ page }) => {
  await page.goto('/app')
  // Wait for the service worker to take control, then NAVIGATE to /history:
  // the worker's navigation fallback must not answer it with index.html.
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  await page.waitForFunction(() => !!navigator.serviceWorker.controller)
  const res = await page.goto('/history')
  expect(res.headers()['content-type']).toContain('application/json')
  expect(Array.isArray(JSON.parse(await page.locator('body').innerText()))).toBe(true)
})

test('PWA manifest opens the installed app at /app', async ({ page, request }) => {
  await page.goto('/')
  const href = await page.locator('link[rel="manifest"]').getAttribute('href')
  const manifest = await (await request.get(href)).json()
  expect(manifest).toMatchObject({
    name: 'Echo', start_url: '/app', scope: '/', theme_color: '#121A15', display: 'standalone',
  })
  for (const icon of manifest.icons) {
    expect((await request.get(icon.src)).status()).toBe(200)
  }
})
