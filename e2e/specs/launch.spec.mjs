import { test, expect } from '@playwright/test'
import { TONE_WAV, LONG_TONE_WAV } from '../fixtures-path.mjs'
import { trackConsoleErrors, uploadFileAndWait } from '../helpers.mjs'

// Public-launch behaviour (docs/LAUNCH.md §5), in a real browser.

/** Every Content-Security-Policy violation the page reports. */
async function trackCspViolations(page) {
  const violations = []
  await page.exposeFunction('__cspViolation', (v) => violations.push(v))
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) =>
      window.__cspViolation(`${e.violatedDirective} ${e.blockedURI}`))
  })
  return violations
}

async function newestClipId(context) {
  const rows = await (await context.request.get('/history')).json()
  return rows[0]?.id
}

// E2E-020 — two browsers can't see, open or play each other's clips.
test('each browser has its own private history', async ({ browser }) => {
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()
  const errors = trackConsoleErrors(pageA)

  await pageA.goto('/app')
  await uploadFileAndWait(pageA, TONE_WAV)
  const idA = await newestClipId(ctxA)
  expect(idA).toMatch(/^[0-9a-f]{32}$/)

  await pageB.goto('/app')
  await uploadFileAndWait(pageB, LONG_TONE_WAV)
  const idB = await newestClipId(ctxB)

  // Each context lists only its own clip…
  expect((await (await ctxA.request.get('/history')).json()).map((r) => r.id)).toEqual([idA])
  expect((await (await ctxB.request.get('/history')).json()).map((r) => r.id)).toEqual([idB])

  // …in the History sheet too.
  await pageB.getByTitle('Browse past clips').click()
  const sheetB = pageB.getByRole('dialog', { name: /History/ })
  await expect(sheetB.getByTestId('history-item')).toHaveCount(1)
  await expect(sheetB.getByText('Your clips live in this browser only.')).toBeVisible()

  // The owner can open and play it; the other browser gets a 404 for both,
  // and so does a request with no cookie at all.
  expect((await ctxA.request.get(`/history/${idA}`)).status()).toBe(200)
  expect((await ctxA.request.get(`/audio/${idA}.opus`)).status()).toBe(200)
  expect((await ctxB.request.get(`/history/${idA}`)).status()).toBe(404)
  expect((await ctxB.request.get(`/audio/${idA}.opus`)).status()).toBe(404)
  expect((await ctxB.request.delete(`/history/${idA}`)).status()).toBe(404)
  const ctxC = await browser.newContext()
  expect((await ctxC.request.get(`/history/${idA}`)).status()).toBe(404)
  expect((await ctxC.request.get(`/audio/${idA}.opus`)).status()).toBe(404)
  expect(await (await ctxC.request.get('/history')).json()).toEqual([])

  // The refused delete changed nothing.
  expect((await ctxA.request.get(`/history/${idA}`)).status()).toBe(200)
  expect(errors).toEqual([])
  await Promise.all([ctxA.close(), ctxB.close(), ctxC.close()])
})

// E2E-021 — delete a clip from the History sheet.
test('a clip can be deleted from History, and its audio goes with it', async ({ page, context }) => {
  const errors = trackConsoleErrors(page)
  await page.goto('/app')
  await uploadFileAndWait(page, TONE_WAV)
  const id = await newestClipId(context)

  await page.getByTitle('Browse past clips').click()
  const sheet = page.getByRole('dialog', { name: /History/ })
  const del = sheet.getByTestId('history-delete')
  await expect(del).toHaveCount(1)

  await del.click()                              // arms it
  await expect(del).toHaveText('Delete?')
  expect((await context.request.get(`/history/${id}`)).status()).toBe(200)
  await del.click()                              // deletes
  await expect(sheet.getByTestId('history-item')).toHaveCount(0)
  await expect(sheet.getByText(/No clips yet/)).toBeVisible()

  expect((await context.request.get(`/history/${id}`)).status()).toBe(404)
  expect((await context.request.get(`/audio/${id}.opus`)).status()).toBe(404)
  // The deleted clip was on screen: the stage goes back to the starting view.
  await expect(page.getByText(/clip [0-9a-f]+/)).toHaveCount(0)
  expect(errors).toEqual([])
})

// E2E-022 — the Pi mic is the owner's only; nothing owner-only is reachable.
test('without the owner sign-in there is no Pi mic and no owner route', async ({ page, request }) => {
  await page.goto('/app')
  await expect(page.getByRole('button', { name: 'Record' })).toBeVisible()
  await expect(page.getByText('Pi mic')).toHaveCount(0)
  await expect(page.getByTitle("Record from the Pi's USB mic")).toHaveCount(0)

  expect(await (await request.get('/api/me')).json()).toEqual({ pi_mic: false })
  expect((await request.post('/capture', { data: { duration: 2 } })).status()).toBe(404)
  expect((await request.get('/me', { maxRedirects: 0 })).status()).toBe(404)
  expect((await request.get('/api/schema-audit')).status()).toBe(404)
  for (const path of ['/docs', '/redoc', '/openapi.json']) {
    expect((await request.get(path)).status(), path).toBe(404)
  }
  expect(await (await request.get('/api/health')).json()).toEqual({ ok: true, status: 'ok' })
})

// E2E-023 — security headers, and a CSP the app actually works under.
test('security headers are set and the app runs clean under the CSP', async ({ page, request }) => {
  for (const path of ['/', '/app', '/api/health', '/history', '/samples', '/no-such-page']) {
    const h = (await request.get(path)).headers()
    expect(h['x-content-type-options'], path).toBe('nosniff')
    expect(h['referrer-policy'], path).toBe('same-origin')
    expect(h['permissions-policy'], path).toBe('microphone=(self)')
    expect(h['content-security-policy'], path).toContain("default-src 'self'")
    expect(h['content-security-policy'], path).not.toContain('unsafe-eval')
  }

  const errors = trackConsoleErrors(page)
  const violations = await trackCspViolations(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  // A sample: the 3D trail with its axis labels (their worker is the one
  // thing that needs blob: scripts), the spectrogram, playback, both views.
  await page.goto('/app?sample=lion-roar')
  await expect(page.getByText(/clip lion-roar/)).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('canvas').first()).toBeVisible()
  await page.waitForTimeout(4000)   // the label worker starts after the scene mounts
  await page.getByRole('tab', { name: /Spectral/ }).click()
  await page.waitForTimeout(500)
  await page.getByRole('tab', { name: /3D Trail/ }).click()

  // An upload and a browser recording (blob: audio) under the same policy.
  await uploadFileAndWait(page, TONE_WAV)
  expect(violations).toEqual([])
  expect(errors).toEqual([])
})

// E2E-024 — "try later" answers are plain notices, not errors.
for (const [status, detail, title] of [
  [503, 'Echo is busy — try again in a moment.', 'Echo is busy'],
  [429, "You've reached the upload limit (10 per hour). Try again in about 12 minutes.", 'Upload limit reached'],
]) {
  test(`a ${status} from /upload shows as a friendly notice`, async ({ page }) => {
    await page.route('**/upload', (route) => route.fulfill({
      status, contentType: 'application/json',
      headers: { 'Retry-After': '15' }, body: JSON.stringify({ detail }),
    }))
    await page.goto('/app')
    await page.locator('input[type="file"]').setInputFiles(TONE_WAV)
    const toast = page.locator('[data-sonner-toast]').filter({ hasText: title })
    await expect(toast).toBeVisible()
    await expect(toast).toContainText(detail)
    await expect(toast).not.toHaveAttribute('data-type', 'error')
    await expect(page.getByText('Upload failed')).toHaveCount(0)
    // Back to idle: the controls work again straight away.
    await expect(page.getByTitle('Upload an audio or video file')).toBeEnabled()
  })
}

// E2E-025 — the landing page's Privacy dialog.
test('the footer Privacy dialog opens, says what is kept, and closes', async ({ page }) => {
  const errors = trackConsoleErrors(page)
  await page.goto('/')
  await page.getByRole('contentinfo').getByRole('button', { name: 'Privacy' }).click()
  const dialog = page.getByRole('dialog', { name: 'Privacy' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('only this browser can see it')
  await expect(dialog).toContainText('haven’t opened in 30 days are deleted')
  await expect(dialog).toContainText('no accounts')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await page.getByRole('contentinfo').getByRole('button', { name: 'Privacy' }).click()
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.locator('#faq')).not.toContainText('50 clips')
  expect(errors).toEqual([])
})
