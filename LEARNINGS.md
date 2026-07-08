# Echo — Learnings

Running log of decisions, gotchas, and non-obvious findings from the build.
Newest at the bottom of each section.

---

## Decisions with rationale

### Layout — backend at repo root (Phase 0)
Python backend (`main.py`, `extraction.py`, `db.py`, `storage.py`) lives at the
repo root rather than a `backend/` subfolder, so systemd can run
`uvicorn main:app` with `WorkingDirectory=~/projects/echo` and StaticFiles can
resolve `frontend/dist` with a simple relative path. Frontend is its own Vite
app in `frontend/`.

### timbre = log2 spectral centroid (Phase 1)
Chosen over MFCC(13)→PCA scalar. The centroid is deterministic, needs **no
per-clip model fit** (PCA would have to be fit per clip, making the axis mean a
different thing for every clip — bad for a spatial axis you compare across
history), is cheap, and maps cleanly to a spatial axis. Raw centroid in Hz has
a very wide range, so it's passed through `log2(centroid / 55Hz)` to get a
compact, perceptually-even scalar (typically ~3–5 for real audio).

### motion = onset-strength envelope (Phase 1)
Chosen over frame-to-frame RMS delta. Onset strength is **spectrally aware**: a
steady loud tone reads as *low* motion, a chirp/transient reads as *high*
motion — which matches the intuitive meaning of a "motion" axis. RMS-delta only
sees loudness change and would call a steady loud note high-motion. Normalized
0–1 per clip for a stable axis.

### pitch carry-forward (Phase 1)
`librosa.pyin` returns NaN on unvoiced frames. Those are replaced with the last
voiced value (leading gap back-filled with the first voiced value; a fully
unvoiced clip falls back to a neutral 220 Hz). This keeps the 3D trail a
continuous line instead of teleporting to 0 Hz on every silent/noisy frame.

---

## Gotchas & platform quirks

### pyin is slow on the Pi (Phase 1)
`librosa.pyin` dominates extraction time: ~24 s of CPU for a 5 s clip on the Pi.
A full 60 s clip could take several minutes. Acceptable for v1's on-demand,
one-clip-at-a-time usage, but it means `/upload` and `/capture` are
**long-running requests** — the frontend must show a clear processing state and
not time out. Possible future optimization: lower `pyin` resolution, or swap to
`librosa.yin` (faster, less robust) if latency ever pinches. Noted, not fixed.

---

### `systemctl status` is not in the sudo allowlist (Phase 8)
The scoped sudoers list has `start/stop/restart/enable/daemon-reload` but not
`status`. `sudo -n systemctl status echo` prompts for a password (would hang an
unattended run). `systemctl status echo` **without** sudo works fine for
read-only inspection — use that.

### Foreground `sleep` is blocked in this harness (Phase 6)
A bare `sleep N` in a Bash tool call gets killed (exit 144), which also killed a
server started in the same `&`-backgrounded line. Fix: start long-running
servers via the harness's `run_in_background`, and wait on readiness with a
poll loop (`until curl -s … ; do :; done`) instead of `sleep`.

### Don't use broad `pkill` patterns on this shared Pi (Phase 8 cleanup)
Cleaning up the echo dev server, `pkill -f "node.*vite"` **also killed a
stock-dashboard vite** running on :5173 (another project). The deployed `echo`
systemd service was unaffected (it's not a vite process), but this crossed the
"echo only" scope. Kill by exact pid or a project-specific path
(`pkill -f "projects/echo/frontend"`), never a generic runtime name.

### Three.js bundle size (Phase 8)
The production JS bundle is ~1.15 MB (332 KB gzipped) — almost entirely
three.js + drei. Fine for v1 over the tunnel; if it ever matters, code-split
the `Scene` behind a dynamic `import()`. Noted, not optimized.

### Spectrogram computed server-side, carried in the feature JSON (Phase 6)
Chosen over a client-side WebAudio FFT and over a separate PNG file/endpoint.
`extraction.compute_spectrogram` builds a 64-mel × ≤256-col spectrogram,
quantizes to uint8 (0–255), and returns a compact column-major flat list
(~16 KB for a 5 s clip). It rides inside the same `{features, spectrogram}`
JSON the clip already stores, so: no browser opus-decoding (which is flaky
headless), no extra endpoint, and it's cleaned up by the *same* 50-entry
retention rule (one file per clip). The React `<Spectrogram>` paints it to a
canvas via `putImageData`. Backward-compat: `/history/{id}` still reads the
older plain-array files (spectrogram = null).

### Scrub-driven highlight sync (Phase 6)
Playback highlight is driven by a single `playheadSec` state, updated by BOTH
the `<audio>` `timeupdate` event AND the seek `<input>`. Deriving the
highlighted 3D point from the scrubber (not only from live audio) means the
sync is verifiable headlessly — no autoplay permission needed — and scrubbing
feels responsive. Nearest point found by binary search over t-ordered frames.

### MediaRecorder mime negotiation (Phase 4)
The record button negotiates a mime type the browser supports, in order:
`audio/webm;codecs=opus` (Android Chrome), `audio/webm`, `audio/mp4` (iOS
Safari), `audio/ogg;codecs=opus`. Whatever the browser produces is POSTed to
the same `/upload`, and the backend transcodes it to WAV with ffmpeg before
extraction — so no format assumptions leak into the pipeline. iOS Safari's
`audio/mp4` path is untested on a real device (see follow-ups).

---

## Manual follow-ups for Job

- **Browser-recording from a real phone (Phase 4):** the `MediaRecorder` flow
  (tap Record → 60s countdown → auto-stop → POST → render) cannot be exercised
  in headless Chromium (no real mic). The *wiring* is verified by driving a
  real file upload through the identical `uploadAudio → /upload → render` code
  path. **Please test live from an Android phone at `echo.job-joseph.com`**,
  and note any iOS Safari quirks (mime is `audio/mp4` there) in this file.
