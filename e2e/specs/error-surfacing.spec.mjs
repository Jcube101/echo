import { test, expect } from '@playwright/test'
import { JUNK_BIN, TONE_WAV } from '../fixtures-path.mjs'
import { uploadFileAndWait } from '../helpers.mjs'

// E2E-007 — error surfacing: uploading a junk file shows the rose error
// toast with the backend's 422 detail; the app stays usable (previous
// trail intact).
test('an undecodable upload shows the error toast and keeps the app usable', async ({ page }) => {
  await page.goto('/')

  await page.locator('input[type="file"]').setInputFiles(JUNK_BIN)
  await expect(page.getByText(/Could not read audio/)).toBeVisible({ timeout: 20_000 })

  // still usable: the sample trail/footer is untouched, and a real upload
  // afterward still works.
  await expect(page.getByText(/points · sample/)).toBeVisible()
  await uploadFileAndWait(page, TONE_WAV)
})
