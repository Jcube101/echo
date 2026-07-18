import { test, expect } from '@playwright/test'
import { TONE_WAV, LONG_TONE_WAV } from '../fixtures-path.mjs'
import { trackConsoleErrors, uploadFileAndWait } from '../helpers.mjs'

// E2E-004 — history gallery: open the drawer, cards listed with source
// icons, click one -> footer flips to that clip id, drawer closes.
// Formalizes verify_gallery.mjs.
//
// SPEC.md: "History gallery listing past clips, click to reload via
// GET /history/{id}."
test('gallery lists uploaded clips and reloads on click', async ({ page }) => {
  const errors = trackConsoleErrors(page)
  await page.goto('/')

  await uploadFileAndWait(page, TONE_WAV)
  const firstFooter = await page.getByText(/clip [0-9a-f]+/).textContent()

  await uploadFileAndWait(page, LONG_TONE_WAV)

  await page.getByTitle('Browse past clips').click()
  const cards = page.locator('aside', { hasText: 'History' }).getByRole('button')
  await expect(cards.first()).toBeVisible()
  expect(await cards.count()).toBeGreaterThanOrEqual(2)

  // Click the second (older) card — the one matching the FIRST upload.
  await cards.nth(1).click()

  await expect(page.getByText(/clip [0-9a-f]+/)).toBeVisible()
  const reloadedFooter = await page.getByText(/clip [0-9a-f]+/).textContent()
  expect(reloadedFooter).toBe(firstFooter)

  // drawer closes after picking
  await expect(page.locator('aside', { hasText: 'History' })).toHaveClass(/translate-x-full/)
  expect(errors).toEqual([])
})
