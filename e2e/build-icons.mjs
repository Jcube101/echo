// Draws Echo's icon and renders every size the app ships:
//
//   frontend/public/favicon.svg            browser tab (rounded square)
//   frontend/public/pwa-192.png            home-screen icon
//   frontend/public/pwa-512.png            home-screen icon / splash
//   frontend/public/pwa-maskable-512.png   Android adaptive icon (full bleed,
//                                          mark inside the central safe zone)
//   frontend/public/apple-touch-icon.png   iOS home screen (full bleed, 180px)
//
// The mark is the product in miniature: a trail that rises through the box,
// thin and green where the sound is quiet, wide and cream where it is loud
// (the same loudness ramp as the 3D trail), ending at the playhead ring.
//
// Run from the repo root:  node e2e/build-icons.mjs
// Uses Playwright's Chromium to rasterise (no image library on the Pi), and is
// deterministic, so re-running without a design change produces no diff.
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../frontend/public')

const NIGHT = '#121A15'
const GREEN = [79, 143, 99]    // #4F8F63  quiet
const AMBER = [232, 176, 75]   // #E8B04B  mid
const CREAM = [244, 239, 228]  // #F4EFE4  loud

const mix = (a, b, f) => a.map((v, i) => Math.round(v + (b[i] - v) * f))
const ramp = (p) => (p < 0.5 ? mix(GREEN, AMBER, p / 0.5) : mix(AMBER, CREAM, (p - 0.5) / 0.5))
const rgb = (c) => `rgb(${c.join(',')})`

// Cubic Bezier through the icon, bottom-left to top-right, in a 512 box.
const P = [[98, 402], [222, 386], [200, 212], [356, 166]]
function at(t) {
  const u = 1 - t
  const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t]
  return [0, 1].map((k) => P.reduce((sum, p, i) => sum + p[k] * w[i], 0))
}

// The mark, as overlapping circles that widen and brighten along the curve.
function mark() {
  const n = 72
  let out = ''
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    const [x, y] = at(t)
    const r = 12 + 13 * t * t
    out += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="${rgb(ramp(t))}"/>`
  }
  const [hx, hy] = at(1)
  out += `<circle cx="${hx}" cy="${hy}" r="34" fill="${rgb(CREAM)}"/>`
  out += `<circle cx="${hx}" cy="${hy}" r="58" fill="none" stroke="${rgb(CREAM)}" stroke-opacity="0.45" stroke-width="9"/>`
  return out
}

// scale < 1 shrinks the mark about the centre (maskable safe zone).
function svg({ radius, scale = 1 }) {
  const s = scale === 1 ? '' : ` transform="translate(256 256) scale(${scale}) translate(-256 -256)"`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">` +
    `<rect width="512" height="512" rx="${radius}" fill="${NIGHT}"/>` +
    `<g${s}>${mark()}</g></svg>\n`
}

const rounded = svg({ radius: 112 })
writeFileSync(path.join(OUT, 'favicon.svg'), rounded)

const jobs = [
  ['pwa-192.png', 192, rounded],
  ['pwa-512.png', 512, rounded],
  ['pwa-maskable-512.png', 512, svg({ radius: 0, scale: 0.74 })],
  ['apple-touch-icon.png', 180, svg({ radius: 0, scale: 0.9 })],
]

const browser = await chromium.launch()
for (const [name, size, markup] of jobs) {
  const page = await browser.newPage({ viewport: { width: size, height: size } })
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${markup}`)
  await page.screenshot({ path: path.join(OUT, name), omitBackground: true })
  await page.close()
  console.log(`wrote ${name} (${size}px)`)
}
await browser.close()
