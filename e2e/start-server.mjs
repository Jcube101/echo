// Boots the real FastAPI app against a fresh temp data dir (never the real
// data/) on a dedicated port, serving the built frontend/dist same-origin —
// exactly like production, but fully disposable. Torn down by Playwright's
// webServer lifecycle (SIGTERM) after the suite finishes.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const PORT = process.env.ECHO_E2E_PORT || '8091'
const dataDir = mkdtempSync(path.join(tmpdir(), 'echo-e2e-data-'))

// ECHO_FRONTEND_DIST (the backend's own test seam) lets a run serve a build
// from somewhere other than frontend/dist, which is what production serves.
const distDir = process.env.ECHO_FRONTEND_DIST || path.join(ROOT, 'frontend', 'dist')
if (!existsSync(distDir)) {
  console.log('[e2e] building frontend (frontend/dist missing)...')
  const build = spawnSync('npm', ['run', 'build'], { cwd: path.join(ROOT, 'frontend'), stdio: 'inherit' })
  if (build.status !== 0) {
    console.error('[e2e] frontend build failed')
    process.exit(build.status ?? 1)
  }
}

console.log(`[e2e] starting uvicorn on 127.0.0.1:${PORT} with ECHO_DATA_DIR=${dataDir}`)
const uvicorn = spawn(
  path.join(ROOT, '.venv', 'bin', 'uvicorn'),
  ['main:app', '--host', '127.0.0.1', '--port', PORT],
  {
    cwd: ROOT,
    // The suite uploads far more than a person would from one address, so the
    // upload limits (10/hour, 30/day in production) are lifted here; the 429
    // itself is covered by pytest (PROT-003/004) and by a mocked response in
    // launch.spec.mjs.
    env: {
      ...process.env,
      ECHO_DATA_DIR: dataDir,
      ECHO_UPLOADS_PER_HOUR: '100000',
      ECHO_UPLOADS_PER_DAY: '100000',
    },
    stdio: 'inherit',
  },
)

const shutdown = () => {
  uvicorn.kill('SIGTERM')
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
uvicorn.on('exit', (code) => process.exit(code ?? 0))
