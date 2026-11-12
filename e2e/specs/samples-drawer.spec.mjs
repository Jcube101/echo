import { test, expect } from '@playwright/test'
import { trackConsoleErrors } from '../helpers.mjs'

// E2E-005 — Samples sheet: one card per sample in the library (Xeno-canto
// and Freesound), each with visible recordist/license/source link; clicking
// one loads the sample and its credit appears in the sidebar clip card.
// (File name kept from when this was a drawer.)
//
// SPEC.md sample-library section + ROADMAP.md M9 done-criteria: "the
// drawer lists the sample clips and each renders/plays end-to-end with
// attribution visible."
test('samples sheet lists attribution and loads a sample on click', async ({ page }) => {
  const errors = trackConsoleErrors(page)
  await page.goto('/app')

  await page.getByTitle('Curated example sounds').click()
  const drawer = page.getByRole('dialog', { name: /Sample sounds/ })
  await expect(drawer).toBeVisible()

  const cards = drawer.getByTitle(/Visualize/)
  await expect(cards.first()).toBeVisible()
  expect(await cards.count()).toBe(14)

  await expect(drawer.getByText('Asian Koel')).toBeVisible()
  await expect(drawer.getByText('Lion')).toBeVisible()
  await expect(drawer.getByText(/CC BY-NC-SA/).first()).toBeVisible()
  await expect(drawer.getByText(/Xeno-canto XC/).first()).toBeVisible()
  await expect(drawer.getByText(/Freesound #/).first()).toBeVisible()

  await drawer.getByTitle(/Visualize/).first().click()

  await expect(page.getByText(/points · clip/)).toBeVisible({ timeout: 20_000 })
  // in-view attribution credit (bottom-right overlay in App.jsx)
  await expect(page.getByText(/rec\./)).toBeVisible()
  expect(errors).toEqual([])
})
