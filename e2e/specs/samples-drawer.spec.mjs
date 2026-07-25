import { test, expect } from '@playwright/test'
import { trackConsoleErrors } from '../helpers.mjs'

// E2E-005 — samples drawer: 14 cards (3 Xeno-canto birds + 11 Freesound
// animals), each with visible recordist/license/source link; clicking one
// loads the sample and the in-view credit line appears.
//
// SPEC.md sample-library section + ROADMAP.md M9 done-criteria: "the
// drawer lists the sample clips and each renders/plays end-to-end with
// attribution visible."
test('samples drawer lists attribution and loads a sample on click', async ({ page }) => {
  const errors = trackConsoleErrors(page)
  await page.goto('/')

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
