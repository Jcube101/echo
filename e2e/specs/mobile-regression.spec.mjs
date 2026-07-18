import { test, expect, devices } from '@playwright/test'
import { trackConsoleErrors } from '../helpers.mjs'

// E2E-009 — mobile regression pack (Pixel 5 emulation, touch): permanently
// encodes the three mobile bugs fixed post-launch. Formalizes
// verify_mobile.mjs. Pointer (mouse) drags stand in for touch drags here —
// OrbitControls binds Pointer Events, which Chromium dispatches for both
// input types, so this exercises the same code path the original manual
// touch verification did.
//
// LEARNINGS.md "Mobile camera + trail-spike bug fixes":
// - Bug 1: polar angle locked -> vertical drag must NOT change the view;
//   horizontal drag still rotates.
// - Bug 2: canvas fills its container in both portrait and landscape, with
//   no white flash / cutoff.
test.use({ ...devices['Pixel 5'], hasTouch: true })

test('vertical drag is locked (no pole flip); horizontal drag still rotates', async ({ page }) => {
  const errors = trackConsoleErrors(page)
  await page.goto('/')
  const canvas = page.locator('canvas').first()
  await expect(canvas).toBeVisible()
  await page.waitForTimeout(300) // let the initial frame settle before the baseline shot

  const box = await canvas.boundingBox()
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2

  const before = await canvas.screenshot()

  // Vertical drag: polar angle is locked (min === max), so the view must
  // not change at all.
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx, cy - 150, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(200)
  const afterVertical = await canvas.screenshot()
  expect(afterVertical.equals(before)).toBe(true)

  // Horizontal drag: azimuth is free, so the view SHOULD change.
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx + 150, cy, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(200)
  const afterHorizontal = await canvas.screenshot()
  expect(afterHorizontal.equals(afterVertical)).toBe(false)

  expect(errors).toEqual([])
})

test('canvas fills its container in portrait and after rotating to landscape', async ({ page }) => {
  await page.goto('/')
  const canvas = page.locator('canvas').first()
  await expect(canvas).toBeVisible()

  const portraitViewport = page.viewportSize()
  const portraitBox = await canvas.boundingBox()
  expect(Math.abs(portraitBox.width - portraitViewport.width)).toBeLessThan(2)

  await page.setViewportSize({ width: portraitViewport.height, height: portraitViewport.width })
  await page.waitForTimeout(400) // Resizer's ResizeObserver + orientationchange settle

  const landscapeBox = await canvas.boundingBox()
  const landscapeViewport = page.viewportSize()
  expect(Math.abs(landscapeBox.width - landscapeViewport.width)).toBeLessThan(2)
  expect(landscapeBox.width).toBeGreaterThan(landscapeBox.height) // genuinely landscape now
})
