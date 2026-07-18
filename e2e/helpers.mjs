import { expect } from '@playwright/test'

/** Collects console.error() and uncaught page errors — every phase in
 * VERIFICATION_LOG.md held these at 0; these specs hold the same bar.
 * Filters the browser's automatic /favicon.ico 404 (the app has no
 * favicon link in index.html) — not an app bug, just Chromium's default
 * request, and not something a test-only change should paper over by
 * adding a favicon to the app itself. */
export function trackConsoleErrors(page) {
  const errors = []
  const isFaviconNoise = (msg) => /favicon\.ico/i.test(msg.location()?.url || '') ||
    /favicon\.ico/i.test(msg.text())
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !isFaviconNoise(msg)) errors.push(msg.text())
  })
  page.on('pageerror', (err) => errors.push(String(err)))
  return errors
}

/** Sets a file on the upload <input> and waits for the footer to flip from
 * "sample" to "clip {id}" — robust to the processing overlay's timing
 * (it may flash and clear faster than we can assert on it). */
export async function uploadFileAndWait(page, filePath, timeout = 20_000) {
  await page.locator('input[type="file"]').setInputFiles(filePath)
  await expect(page.getByText(/clip [0-9a-f]+/)).toBeVisible({ timeout })
}
