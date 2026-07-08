# Echo — Learnings

Running log of decisions, gotchas, and non-obvious findings from the build.
Newest at the bottom of each section.

---

## Decisions with rationale

### Session 5 — speed, boundary trim, spectrogram axes, sample library (2026-07-08)

**Part A — pyin speed (the real "Failed to fetch" fix).** `librosa.pyin` is ~99%
of extraction time and its cost scales with the pitch-bin count. `PYIN_RESOLUTION
= 0.25` (25 cents, vs librosa's default 0.1) cut a 60 s clip's pyin from **37 s
→ 6.5 s** (full extract 8.5 s) for only ~6 cents mean / 15 cents p95 pitch shift
— imperceptible, invisible in the viz. `0.5` was too coarse (octave errors).
Single-threaded tuning alone beat the 15 s target, so the multiprocessing/
chunking lever was NOT built. The earlier LEARNINGS note (~24 s for a 5 s clip)
was ~5× my isolated numbers — the Pi was clearly loaded then; budget for that
variance. **Timeout chain:** uvicorn has no request-processing timeout (only
idle keep-alive); cloudflared has none per-service; the real ceiling is
Cloudflare's edge ~100 s (HTTP 524) on the free plan — not configurable, so the
fix is to stay far under it, not to reconfigure.

**Part B — boundary-only silence trim, adaptive (`extraction.py`).** Reinstated
leading/trailing trim (interior HELD, never cut) with an ADAPTIVE threshold:
signal must exceed the clip's own noise floor (10th-pct RMS) by `TRIM_MARGIN_DB
= 8`, capped so it never rises within `TRIM_MIN_SNR_DB = 25` of the peak. The cap
is the whole point — the old `top_db=30` failure was a loud transient inflating
the peak so boundary signal >30 dB below it got eaten; a floor-relative threshold
with an SNR cap keeps real signal even then. Frame times get `trim_offset` added
back so the untrimmed opus still scrub-syncs (trail simply has no points during
the trimmed silence). Tunables: `TRIM_FLOOR_PCT/MARGIN_DB/MIN_SNR_DB/PAD_FRAMES`.
Regression clip `25bd6d1c` is genuinely 1.55 s digital silence + 1.24 s call →
correctly 141→64 frames (all real signal kept); its old 141 count WAS the origin
cluster. Self-check density now measured over the analyzed span, not file length.

**Part C — spectrogram axes + crisp scaling (`Spectrogram.jsx`).** Offscreen
native image → bilinear `drawImage` onto a ResizeObserver-sized canvas (× dpr≤2)
= fills any width, no pixelation (dropped `image-rendering: pixelated`). Hz axis
positions come from the backend: `compute_spectrogram` now returns `freq_ticks`
(`_mel_tick_positions`, Slaney mel) so the frontend needs no mel math. Time axis
reuses the linear scrubber scale. **Feature-JSON schema grew a `freq_ticks` key
in the spectrogram dict** — old clips without it still render (frontend defaults
to []); re-migrate to populate.

**Part D — sample library = static store, NOT a clips-table flag.** `samples/`
(audio/ + features/ + samples.json) is served by dedicated `/samples*` endpoints
and never enters the `clips` table, so retention can't evict it *by construction*
(cleaner than a "don't-evict" flag in the retention query). Seeded by
`verification/seed_samples.py`; attribution parsed from the fixtures MANIFEST.md.
Committed to git as product assets (gitignore negation `!/samples/audio/*.opus`).
Public serving of CC BY-NC-SA clips → attribution is shown in the UI (drawer
cards + an in-view credit line), not just the repo manifest.

### Fixed world scale, density fix, smoothing, visual overhaul (2026-07-08, post-launch)

**Part A — density bug root cause.** The `librosa.effects.trim` added the prior
session shrank the frame *timeline* for clips with quiet passages, so a clip
with silence emitted ~9 pts/sec of its real duration instead of ~50 (a 2.8 s
clip → 54 points). **Fix: removed trimming entirely.** Quiet frames are HELD
(not dropped), which already prevents the origin spikes, so density is now
~50 pts/sec of the full clip for all clips (verified 45–55 across lengths),
downsampling only past the 3000-point / 60 s ceiling.

**pyin range raised.** `FMAX` 2093 → **4000 Hz** (and `FMIN` 65 → 50) so high
birdsong (the reference clip is ~2.5 kHz) is actually detected instead of
collapsing to the unvoiced 220 Hz fallback. Aligned with the fixed pitch scale.

**Part B — fixed world scale (tunables in `extraction.py`).** Every axis now
means the same range for every clip (comparable across the gallery). Each raw
feature is transformed, clamped to fixed bounds, and mapped into a `[-WORLD,
WORLD]` cube with `WORLD = 3`:
- **pitch** = `log2(Hz)` over `PITCH_HZ_RANGE = (50, 4000)` Hz
- **timbre** = `log2(centroid/55)` over `TIMBRE_RAW_RANGE = (2, 8)` (from data:
  p50≈4.8, p95≈6.5)
- **motion** = `log1p(onset_strength)` over `MOTION_RAW_RANGE = (0, 3)` — onset
  is heavy-tailed (p50/p95/p99 ≈ 0.5/3.3/10.4), so log-compressed then clamped
  to the box edge; this puts the steady baseline near the floor with transient
  spikes reaching up (matches the reference).
Out-of-range values clamp to the box edge (never stretch the scale). The
frontend plots these stored coords directly — **no per-clip normalization**.
Axis layout: X = pitch, Y(up) = motion, Z = timbre.

**Part C — smoothing.** `SMOOTH_WINDOW = 5` (~100 ms) odd-window moving average
on pitch/timbre/motion; `AMP_SMOOTH_WINDOW = 3` light touch on amplitude (keep
transient peaks — it drives point size). Reduced frame-to-frame zigzag (mean
2nd-difference) by ~78 % on a test clip while preserving overall shape.

**Migration.** `verification/migrate_features.py` re-extracts every history
clip's stored features from the on-disk audio into the new space (overwrites
`data/features/<id>.json`, no schema change). Ran on all 21 clips.

**Part D — scene visuals (`Scene.jsx`).** Monochrome **teal** single hue,
brightness/size from amplitude (no rainbow). One `THREE.Points` + a custom
shader with a radial-gradient sprite and **additive blending** for cheap glow
(no post-processing bloom → mobile-safe), so 3000 points stay one draw call.
Faint teal connecting `Line` (opacity ~0.16). Fixed world box: wireframe edges
+ gridded floor/back/left walls + integer ticks (`-3..3`) + billboarded axis
names. Playhead restyled to a larger teal-white additive glow sprite (not a
hard white ball). **Framing** sets camera *distance* from the viewport aspect
so the box fills `FILL = 0.78` of the **shorter** dimension in any orientation
(direction + polar angle stay locked — the no-pole-flip guarantee holds).

### Mobile camera + trail-spike bug fixes (2026-07-08, post-launch)
Three mobile bugs from Job's phone testing. Tunables worth revisiting:
- **Locked polar angle = `POLAR_ANGLE` ≈ 1.130 rad (64.7°)** in `Scene.jsx`,
  derived at load from the initial camera position
  `[EXTENT*2.1, EXTENT*1.4, EXTENT*2.1]` via `acos(y/‖pos‖)`. `min` and `max`
  polar are both pinned to it, so vertical drag can't flip past the pole. If
  the default camera framing is ever changed, this recomputes automatically.
- **Zoom and pan are disabled** (`enableZoom={false}`, `enablePan={false}`,
  `target=[0,0,0]`) — a deliberate lock for now. Disabling zoom also removes
  the "camera dollies inside the geometry → white screen" path. Do not
  re-enable without revisiting a near-plane/`minDistance` clamp.
- **Axis labels are billboarded** (drei `<Billboard>`) so they stay upright and
  correctly-oriented (never mirrored) at any azimuth — the mirrored-label
  symptom had two causes (pole flip *and* orbiting to the back); the polar lock
  fixes the first, billboarding the second.
- **`dpr` capped at 2** and a `<Resizer>` (ResizeObserver on the canvas parent +
  a delayed re-apply on `orientationchange`) keeps the drawing buffer synced to
  the container across resizes/rotations. Canvas is wrapped in an
  `absolute inset-0` div so it has a real non-zero size before first render.
- **Silence trim `top_db = 30`** (`TRIM_TOP_DB`) — trims leading/trailing
  silence before extraction so the trail can't spike to the origin at the clip
  boundaries. Lower = more aggressive; raise if it ever eats soft signal.
- **Quiet-frame hold `SILENCE_RMS_FRAC = 0.06`** — a frame whose RMS is below
  6% of the clip's peak RMS holds the previous pitch/timbre/motion (all three,
  not just pitch) instead of collapsing an axis to 0. Amplitude still reflects
  the real low energy (small/dim point), so a pause reads as a held cluster,
  not a needle to the origin. Frame times keep the *original* timeline (trim
  offset added back) so the untrimmed playback copy still scrub-syncs.

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

### pyin is slow on the Pi (Phase 1 → FIXED session 5)
`librosa.pyin` dominates extraction time (~99%). It was the "Failed to fetch"
cause on longer clips. **Fixed in session 5 by `PYIN_RESOLUTION = 0.25`** (25
cents vs the default 0.1): a 60 s clip's extraction dropped from ~37 s to ~8.5 s
for only ~6 cents mean pitch shift. `/upload` and `/capture` are still
long-running requests (single-digit seconds), so the frontend keeps a clear
processing state — but they now clear well inside every timeout in the chain.
The old measurement (~24 s for a 5 s clip) was the Pi under heavy load; budget
for that variance. Further headroom if ever needed: chunk pitch detection across
the Pi's 4 cores (measured unnecessary at 0.25).

### Cloudflare Tunnel has a hard ~100 s edge timeout (constraint to remember)
Nothing in Echo's request chain (uvicorn, cloudflared) imposes a request-
processing timeout — uvicorn's `--timeout-keep-alive` is idle-only, and the
`echo` ingress has no per-service timeout. **But Cloudflare's edge enforces a
~100 s origin-response limit (HTTP 524) on the free plan, and it is not
configurable.** Any synchronous endpoint served through `*.job-joseph.com` must
respond within that window or the browser sees a dropped connection
("Failed to fetch"). This is *the* ceiling that bounds Echo's synchronous
`/upload` + `/capture`; keep extraction far under it (Part A does — worst case
tens of seconds). If a future feature genuinely needs longer, it must move to an
async job-status pattern, not a config tweak.

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
