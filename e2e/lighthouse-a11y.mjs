// Lighthouse accessibility audit of the landing page (DESIGN_V2.md §7 item 4:
// "Lighthouse accessibility ≥ 95"), run with Playwright's Chromium so nothing
// else needs installing on the Pi.
//
//   npm run lighthouse                      # audits the live local service
//   ECHO_LH_URL=https://echo.job-joseph.com/ npm run lighthouse
//
// Exits non-zero if either form factor scores under the threshold.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const URL_ = process.env.ECHO_LH_URL || 'http://127.0.0.1:8014/'
const THRESHOLD = Number(process.env.ECHO_LH_MIN || 95)
const out = mkdtempSync(path.join(tmpdir(), 'echo-lh-'))

let ok = true
for (const form of ['mobile', 'desktop']) {
  const file = path.join(out, `${form}.json`)
  execFileSync(path.join(ROOT, 'node_modules', '.bin', 'lighthouse'), [
    URL_, '--only-categories=accessibility', '--output=json', `--output-path=${file}`,
    '--chrome-flags=--headless=new --no-sandbox', '--quiet',
    ...(form === 'desktop' ? ['--preset=desktop'] : []),
  ], { env: { ...process.env, CHROME_PATH: chromium.executablePath() }, stdio: ['ignore', 'ignore', 'inherit'] })

  const report = JSON.parse(readFileSync(file, 'utf8'))
  const score = Math.round(report.categories.accessibility.score * 100)
  const audits = Object.values(report.audits)
  const failed = audits.filter((a) => a.scoreDisplayMode === 'binary' && a.score === 0)
  const passed = audits.filter((a) => a.scoreDisplayMode === 'binary' && a.score === 1).length
  console.log(`${form}: accessibility ${score} (${passed} audits passed, ${failed.length} failed) — ${URL_}`)
  for (const a of failed) {
    console.log(`  FAIL ${a.id}: ${a.title}`)
    for (const item of (a.details?.items || []).slice(0, 5)) console.log(`       ${(item.node?.snippet || '').slice(0, 150)}`)
  }
  if (score < THRESHOLD) ok = false
}
process.exit(ok ? 0 : 1)
