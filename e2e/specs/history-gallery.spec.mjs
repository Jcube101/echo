import { test, expect } from '@playwright/test'
import { TONE_WAV, LONG_TONE_WAV } from '../fixtures-path.mjs'
import { trackConsoleErrors, uploadFileAndWait } from '../helpers.mjs'

// E2E-004 — history gallery: open the History sheet, clips listed with their
// source, click one -> the stage caption flips to that clip id, sheet closes.
// Formalizes verify_gallery.mjs.
//
// SPEC.md: "History gallery listing past clips, click to reload via
// GET /history/{id}."
test('gallery lists uploaded clips and reloads on click', async ({ page }) => {
  const errors = trackConsoleErrors(page)
  await page.goto('/app')

  await uploadFileAndWait(page, TONE_WAV)
  const firstFooter = await page.getByText(/clip [0-9a-f]+/).textContent()

  await uploadFileAndWait(page, LONG_TONE_WAV)

  await page.getByTitle('Browse past clips').click()
  const dialog = page.getByRole('dialog', { name: /History/ })
  const cards = dialog.getByTestId('history-item')
  // Wait for the count rather than reading it once: the sheet opens showing
  // the list it already had and refreshes a moment later.
  await expect(cards).toHaveCount(2)

  // Click the second (older) card — the one matching the FIRST upload.
  await cards.nth(1).click()

  await expect(page.getByText(/clip [0-9a-f]+/)).toBeVisible()
  const reloadedFooter = await page.getByText(/clip [0-9a-f]+/).textContent()
  expect(reloadedFooter).toBe(firstFooter)

  // sheet closes after picking (shadcn Sheet: unmounts once its exit
  // animation finishes, so "closed" means the dialog is gone, not merely
  // translated off-screen)
  await expect(dialog).toBeHidden()
  expect(errors).toEqual([])
})
