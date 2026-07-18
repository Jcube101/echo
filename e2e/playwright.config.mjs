import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { TONE_WAV } from './fixtures-path.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = process.env.ECHO_E2E_PORT || '8091'
const BASE_URL = `http://127.0.0.1:${PORT}`

// Every E2E-* spec here is sandboxed (localhost, temp data dir, synthetic
// audio) — none needs the real mic, sudo, or the public tunnel, so none is
// tagged @hardware/@tunnel. grepInvert is wired for any future spec that
// would need one of those, kept out of a default run the same way pytest's
// markers keep the hardware/sudo/tunnel suites opt-in. See TEST_PLAN.md
// section F and the "unattended-safety segregation" scheme.
export default defineConfig({
  testDir: './specs',
  outputDir: './test-results',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  grepInvert: /@hardware|@tunnel/,
  globalSetup: './global-setup.mjs',
  use: {
    baseURL: BASE_URL,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    // Fake media device + auto-accepted permission prompt, feeding our
    // synthetic tone as the "microphone" signal — lets E2E-010 drive the
    // real MediaRecorder code path with no real mic and no manual prompt.
    // Harmless for every other spec (only getUserMedia calls are affected).
    launchOptions: {
      // This container's @playwright/test resolved a version expecting a
      // browser revision newer than the pre-cached one — use the pinned
      // chromium binary directly instead of triggering a download.
      executablePath: '/opt/pw-browsers/chromium',
      args: [
        '--use-fake-device-for-media-capture',
        '--use-fake-ui-for-media-capture',
        `--use-file-for-fake-audio-capture=${TONE_WAV}`,
      ],
    },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'node e2e/start-server.mjs',
    cwd: path.resolve(__dirname, '..'),
    url: `${BASE_URL}/api/health`,
    timeout: 60_000,
    reuseExistingServer: false,
    env: { ECHO_E2E_PORT: PORT },
  },
})
