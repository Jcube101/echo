// Generates the synthetic fixture audio every spec uploads/drops, via
// ffmpeg's `sine` source — no real recordings, nothing committed to git.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { FIXTURES_DIR, TONE_WAV, LONG_TONE_WAV, JUNK_BIN } from './fixtures-path.mjs'

export default async function globalSetup() {
  mkdirSync(FIXTURES_DIR, { recursive: true })

  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
    '-ar', '22050', '-ac', '1', TONE_WAV,
  ])

  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'sine=frequency=300:duration=6',
    '-ar', '22050', '-ac', '1', LONG_TONE_WAV,
  ])

  const junk = Buffer.from(Array.from({ length: 4096 }, () => Math.floor(Math.random() * 256)))
  writeFileSync(JUNK_BIN, junk)
}
