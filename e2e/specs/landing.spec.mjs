import { test, expect } from '@playwright/test'
import { trackConsoleErrors } from '../helpers.mjs'

// E2E-LAND-* — Design v2 session 4 (DESIGN_V2.md §4.1–4.2, §5): the landing
// page, its FAQ and its links into the app.

test('landing page is static: all sections render with no API calls and no app bundle', async ({ page }) => {
  const errors = trackConsoleErrors(page)
  const requests = []
  page.on('request', (r) => requests.push(new URL(r.url()).pathname))
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  for (const name of ['Turn it in 3D, or read it line by line', 'Good to know', 'Hear something? See its shape.']) {
    await expect(page.getByRole('heading', { name })).toBeVisible()
  }
  await expect(page.getByRole('heading', { name: /Start with one of \d+ sample sounds/ })).toBeVisible()
  await expect(page.getByRole('img', { name: /Five sample sounds/ })).toBeVisible()

  // No API, no feature files, and the three.js app chunk stays unloaded.
  expect(requests.filter((p) => /^\/(samples|history|upload|capture|audio)/.test(p))).toEqual([])
  expect(requests.filter((p) => /\/assets\/App-/.test(p))).toEqual([])
  expect(errors).toEqual([])
})

test('copy carries no bird / species / identification language outside sample names', async ({ page }) => {
  await page.goto('/')
  // Everything except the samples section, whose names and credits are exempt.
  const text = await page.evaluate(() => {
    const clone = document.body.cloneNode(true)
    clone.querySelector('#samples')?.remove()
    clone.querySelectorAll('[role="img"]').forEach((n) => n.remove()) // hero art labels are sample names
    return clone.textContent
  })
  expect(text).not.toMatch(/\bbirds?\b|\bspecies\b|\bidentif/i)
})

test('FAQ: seven questions, all closed by default, open on click', async ({ page }) => {
  await page.goto('/')
  const items = page.locator('#faq details')
  await expect(items).toHaveCount(7)
  expect(await page.locator('#faq details[open]').count()).toBe(0)

  const q = page.getByText('Is my audio kept?')
  await q.click()
  await expect(page.getByText(/Only a small copy for playback/)).toBeVisible()
  await q.click()
  await expect(page.getByText(/Only a small copy for playback/)).toBeHidden()
})

test('"See its shape" opens the app with that sample loaded', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'See the shape of Lion' }).click()
  await expect(page).toHaveURL(/\/app$/) // the ?sample= param is dropped once read
  const sidebar = page.getByRole('complementary', { name: 'Clip details' })
  await expect(sidebar.getByRole('heading', { name: 'Lion' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(/points · clip lion-roar/)).toBeVisible()
})

test('a sample chip and the library link both lead into the app', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Camel', exact: true }).click()
  await expect(page.getByRole('complementary', { name: 'Clip details' }).getByRole('heading', { name: 'Camel' })).toBeVisible({ timeout: 20_000 })

  await page.goto('/')
  await page.getByRole('link', { name: 'Open the sample library' }).click()
  await expect(page.getByRole('dialog', { name: /Sample sounds/ })).toBeVisible()
  await expect(page).toHaveURL(/\/app$/)
})

test('an unknown ?sample= id shows an error and leaves the app usable', async ({ page }) => {
  await page.goto('/app?sample=no-such-sample')
  await expect(page.getByText("Couldn't load sample")).toBeVisible()
  await expect(page.getByText(/points · sample/)).toBeVisible()
})

test('phone layout: stacked sections, sample rows link into the app', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Start with a sample' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  await page.getByRole('link', { name: 'See the shape of Wolf' }).click()
  await expect(page.getByRole('heading', { name: 'Wolf' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('button', { name: 'Back to home' })).toBeVisible()
})
