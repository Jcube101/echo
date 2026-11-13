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

// ---------------------------------------------------------------------------
// Multi-select delete and Pi mic cancel / stop.

async function openHistory(page) {
  await page.getByTitle('Browse past clips').click()
  const sheet = page.getByRole('dialog', { name: /History/ })
  await expect(sheet).toBeVisible()
  return sheet
}

// E2E-026 — bulk delete only ever touches the caller's clips.
test('multi-select delete removes this browser\'s clips and nobody else\'s', async ({ browser }) => {
  test.setTimeout(90_000)   // four real uploads; fine alone, tight inside the full run
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()
  const errors = trackConsoleErrors(pageA)

  await pageA.goto('/app')
  for (const f of [TONE_WAV, LONG_TONE_WAV, TONE_WAV]) {
    await pageA.locator('input[type="file"]').setInputFiles(f)
    await expect(pageA.locator('[data-sonner-toast]').filter({ hasText: 'Uploaded' }).last()).toBeVisible({ timeout: 20_000 })
    await pageA.waitForTimeout(300)
  }
  await pageB.goto('/app')
  await uploadFileAndWait(pageB, TONE_WAV)
  const idsA = (await (await ctxA.request.get('/history')).json()).map((r) => r.id)
  const idsB = (await (await ctxB.request.get('/history')).json()).map((r) => r.id)
  expect(idsA).toHaveLength(3)
  expect(idsB).toHaveLength(1)

  // B asks the server to delete A's clips: nothing happens, and it isn't told why.
  const sneaky = await ctxB.request.post('/history/delete', { data: { ids: idsA } })
  expect(sneaky.status()).toBe(200)
  expect(await sneaky.json()).toEqual({ deleted: 0 })
  expect((await (await ctxA.request.get('/history')).json()).map((r) => r.id)).toEqual(idsA)

  // A selects two of its three clips in the sheet and deletes them.
  const sheet = await openHistory(pageA)
  await sheet.getByRole('button', { name: 'Select' }).click()
  const boxes = sheet.getByTestId('history-select')
  await expect(boxes).toHaveCount(3)
  await expect(sheet.getByTestId('history-delete')).toHaveCount(0)     // single bins hidden while selecting
  await boxes.nth(0).check()
  await boxes.nth(2).check()
  await expect(sheet.getByText('2 selected')).toBeVisible()
  const del = sheet.getByTestId('history-delete-selected')
  await del.click()
  await expect(del).toHaveText('Delete 2 clips for good?')
  expect(await (await ctxA.request.get('/history')).json()).toHaveLength(3)   // nothing yet
  await del.click()
  await expect(pageA.locator('[data-sonner-toast]').filter({ hasText: '2 clips deleted' })).toBeVisible()
  await expect(sheet.getByTestId('history-item')).toHaveCount(1)
  await expect(sheet.getByTestId('history-delete')).toHaveCount(1)     // back to the normal list

  const leftA = (await (await ctxA.request.get('/history')).json()).map((r) => r.id)
  expect(leftA).toEqual([idsA[1]])
  for (const gone of [idsA[0], idsA[2]]) {
    expect((await ctxA.request.get(`/history/${gone}`)).status()).toBe(404)
    expect((await ctxA.request.get(`/audio/${gone}.opus`)).status()).toBe(404)
  }
  expect((await (await ctxB.request.get('/history')).json()).map((r) => r.id)).toEqual(idsB)
  expect((await ctxB.request.get(`/audio/${idsB[0]}.opus`)).status()).toBe(200)
  expect(errors).toEqual([])
  await Promise.all([ctxA.close(), ctxB.close()])
})

// E2E-027 — selection mode: Select all, keyboard, Escape, long press.
test('selection mode: select all, Escape leaves it first, long press on touch only', async ({ page }) => {
  await page.goto('/app')
  await uploadFileAndWait(page, TONE_WAV)
  await page.locator('input[type="file"]').setInputFiles(LONG_TONE_WAV)
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Uploaded' }).last()).toBeVisible({ timeout: 20_000 })
  const sheet = await openHistory(page)
  await expect(sheet.getByTestId('history-item')).toHaveCount(2)

  // A held mouse button is not a long press.
  const first = sheet.getByTestId('history-item').first()
  const box = await first.boundingBox()
  await page.mouse.move(box.x + 20, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(800)
  await expect(sheet.getByTestId('history-select')).toHaveCount(0)
  await page.mouse.move(box.x + 400, box.y + 400)       // drag away so releasing doesn't open the clip
  await page.mouse.up()

  // A touch long press enters selection with that row ticked.
  await first.dispatchEvent('pointerdown', { pointerType: 'touch', bubbles: true })
  await expect(sheet.getByTestId('history-select')).toHaveCount(2, { timeout: 2000 })
  await expect(sheet.getByTestId('history-select').first()).toBeChecked()
  await expect(sheet.getByTestId('history-select').nth(1)).not.toBeChecked()

  // Select all from the keyboard (a real checkbox: Space toggles it).
  const all = sheet.getByTestId('history-select-all')
  await all.focus()
  await page.keyboard.press('Space')
  await expect(sheet.getByText('2 selected')).toBeVisible()
  await expect(sheet.getByTestId('history-delete-selected')).toHaveText('Delete 2 clips')

  // Escape leaves selection and keeps the sheet; a second Escape closes it.
  await page.keyboard.press('Escape')
  await expect(sheet).toBeVisible()
  await expect(sheet.getByTestId('history-select')).toHaveCount(0)
  await expect(sheet.getByTestId('history-item')).toHaveCount(2)       // nothing was deleted
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
})

// The Pi mic is owner-only, so these drive the app with the owner routes
// mocked: /api/me says "owner", and /capture answers the way the server does
// (the real behaviour is CAP-010… in pytest).
async function asOwner(page, { onEnd }) {
  const calls = []
  let release
  const ended = new Promise((resolve) => { release = resolve })
  await page.route('**/api/me', (route) => route.fulfill({ json: { pi_mic: true } }))
  await page.route('**/capture?*', async (route) => {
    const req = route.request()
    calls.push({ method: req.method(), url: new URL(req.url()).search, body: req.postData() })
    if (req.method() === 'DELETE') {
      const action = new URL(req.url()).searchParams.get('action')
      await route.fulfill({ json: { active: true, action } })
      release(action)
    } else {
      const action = await ended               // the capture answers once it is ended
      await route.fulfill({ json: await onEnd(action) })
    }
  })
  return calls
}

// E2E-028 — desktop: Pi mic shows it is listening; Cancel saves nothing.
test('Pi mic (owner): recording state with Stop and Cancel; Cancel ends it quietly', async ({ page }) => {
  const errors = trackConsoleErrors(page)
  const calls = await asOwner(page, { onEnd: async () => ({ cancelled: true, reason: 'cancelled' }) })
  await page.goto('/app')
  await page.getByTitle("Record from the Pi's USB mic").click()

  const live = page.getByRole('group', { name: 'Pi mic recording' })
  await expect(live.getByText('Pi mic is listening')).toBeVisible()
  await expect(live.getByRole('timer')).toHaveAccessibleName(/^Pi mic is listening, 0:0\d of 0:05$/)
  await expect(live.getByRole('button', { name: 'Stop' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Record', exact: true })).toHaveCount(0)   // one thing at a time
  await expect(page.getByTitle('Upload an audio or video file')).toHaveCount(0)

  await live.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Recording cancelled' })).toBeVisible()
  await expect(live).toBeHidden()
  await expect(page.getByTitle("Record from the Pi's USB mic")).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Record', exact: true })).toBeEnabled()
  await expect(page.getByText(/clip [0-9a-f]+/)).toHaveCount(0)

  // Parameters in the URL, no request bodies (the safe pattern behind Access).
  expect(calls).toEqual([
    { method: 'POST', url: '?duration=5', body: null },
    { method: 'DELETE', url: '?action=cancel', body: null },
  ])
  expect(errors).toEqual([])
})

// E2E-029 — phone: the same recording screen; Stop keeps the shorter clip.
test('Pi mic (owner, phone): listening screen; Stop keeps what was recorded', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 } })
  const page = await ctx.newPage()
  // A real clip to answer with, made by this same browser.
  await page.goto('/app')
  await page.locator('input[type="file"]').setInputFiles(TONE_WAV)
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Uploaded' })).toBeVisible({ timeout: 20_000 })
  const [row] = await (await ctx.request.get('/history')).json()
  const clip = await (await ctx.request.get(`/history/${row.id}`)).json()

  const calls = await asOwner(page, { onEnd: async () => clip })
  await page.goto('/app')
  await page.getByTitle("Record from the Pi's USB mic").click()

  await expect(page.getByRole('heading', { name: 'Pi mic is listening' })).toBeVisible()
  await expect(page.getByRole('timer')).toHaveAccessibleName(/^Pi mic is listening, 0:0\d of 0:05$/)
  await expect(page.getByText(/the Pi still finishes and the clip appears in History/)).toBeVisible()
  await expect(page.getByText('Tap to record')).toHaveCount(0)        // the home screen is replaced
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible()

  await page.getByRole('button', { name: /Stop and see its shape/ }).click()
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Captured' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Pi mic is listening' })).toHaveCount(0)
  await expect(page.locator('canvas').first()).toBeVisible()          // the result screen, with the trail
  expect(calls.map((c) => `${c.method} ${c.url} ${c.body}`)).toEqual(['POST ?duration=5 null', 'DELETE ?action=stop null'])
  await ctx.close()
})
