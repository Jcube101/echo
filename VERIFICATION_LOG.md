# Echo — Verification Log

Phase-by-phase self-check evidence for the overnight v1 build. Every phase
appends a dated entry: what was checked, the actual output/evidence, and
PASS/FAIL. Screenshots and console logs live in the gitignored
`verification/` folder; this file is committed.

Build date: **2026-07-08**

---

## Phase 0 — Scaffolding — 2026-07-08 — PASS

**Checked:** docs populated with real content (not placeholders); app layout
decided and recorded.

**Evidence:**
- `README.md` — 100+ lines: what Echo is, 3 input sources, architecture tree,
  local run instructions (backend venv + uvicorn, frontend Vite), deployment
  summary. (Was a 7-byte stub before.)
- `SPEC.md` — created: full input-source / feature-extraction / API / schema /
  retention / frontend / deployment contract adapted into the repo's words.
- `LEARNINGS.md` — created with the three living sections (decisions, gotchas,
  manual follow-ups), filled as phases land.
- Layout decision: **backend Python at repo root** (`main.py`, `extraction.py`,
  `db.py`, `storage.py`) so systemd runs `uvicorn main:app` with
  `WorkingDirectory=~/projects/echo`; **frontend in `frontend/`** as its own
  Vite app whose `dist/` is served by StaticFiles in production. Recorded in
  README.
- Untouched per CLAUDE.md: `ROADMAP.md`, `CLAUDE.md`, root `package.json`,
  `.gitignore`.
- Toolchain confirmed present: Python 3.13.5, ffmpeg, node v22 / npm 10,
  Playwright chromium cached, `~/bin/rec` present (arecord S16_LE 44.1k mono).
  librosa + backend deps installing into `.venv` (see Phase 1).

**Result:** PASS — continuing immediately.

---

## Phase 1 — Feature extraction — 2026-07-08 — PASS

**Checked:** `extraction.py` run against the real sample `test.wav` (5.0 s,
44.1 kHz mono WAV), with automated quality gates.

**Actual output (`.venv/bin/python extraction.py test.wav`):**
```
duration: 5.000 s
point count: 251  (raw frames ~250, cap 3000)
  t         min=    0.0000  max=    5.0000  mean=    2.5000
  pitch     min=   65.0000  max=  231.6300  mean=  127.1304
  timbre    min=    3.3184  max=    5.2756  mean=    4.4372
  motion    min=    0.0000  max=    1.0000  mean=    0.1456
  amplitude min=    0.0000  max=    1.0000  mean=    0.2799
SELF-CHECK: PASS
```

**Gates:** pitch 65–232 Hz ∈ [20,4000] ✓ · amplitude 0–1 ✓ · zero NaN/Inf ✓ ·
251 points ≈ 250 expected at 20 ms hop over 5 s ✓ · ≤ 3000 cap ✓.

**Choices (documented in LEARNINGS.md):** timbre = log2 spectral centroid
(deterministic, no per-clip PCA fit); motion = onset-strength envelope
(spectrally aware); pitch carry-forward for unvoiced frames.

**Note:** `pyin` is slow (~24 s CPU for a 5 s clip) → `/upload`/`/capture` are
long-running; frontend must show a processing state. Logged in LEARNINGS.

**Result:** PASS — continuing immediately.

---

## Phase 2 — API + SQLite — 2026-07-08 — PASS

**Checked:** every endpoint with real curl against a live uvicorn on 127.0.0.1:8014.

**Actual output:**
- `GET /api/health` → `{"status":"ok"}`
- `GET /history` (empty) → `[]`
- `POST /upload -F file=@test.wav` → **HTTP 200**, `id=ebd8c00c2303`,
  `duration_s=5.0`, `audio_url=/audio/ebd8c00c2303.opus`, 251 features,
  first `{t:0.0, pitch:65.0, timbre:4.6052, motion:0.0, amplitude:0.3682}`.
  On-disk: `data/audio/ebd8c00c2303.opus` (28 KB) + `data/features/…json`
  (21 KB). Raw upload discarded (only the opus playback copy kept). ✓ locked
  storage rule.
- `GET /history` → one row `{id, created_at, source_type:"upload", duration_s:5.0}`.
- `GET /history/ebd8c00c2303` → keys `[audio_url, created_at, duration_s,
  features, id, source_type]`, 251 features. ✓ shape.
- `GET /history/doesnotexist` → **HTTP 404** `{"detail":"Clip not found."}`.
- `GET /audio/ebd8c00c2303.opus` → **HTTP 200**, `content-type: audio/ogg`,
  `content-length: 28973`.
- Oversize: 21 MB POST → **HTTP 413** `{"detail":"File exceeds the 20 MB limit."}`
  (size enforced by streaming to disk with a hard cap, not trusting
  Content-Length).
- Undecodable junk → **HTTP 422** `{"detail":"Could not read audio…"}`.

**Retention rule (cap temporarily lowered to 3):** inserted 5 dummy clips with
real placeholder files → `_enforce_retention` kept the 3 newest overall
(real upload + dummies 03/04), deleted rows **and** files for the 3 oldest
(00/01/02 `audio_exists=False feat_exists=False`). Dummies then cleaned up,
leaving the 1 real clip. ✓ 50-entry retention + file cleanup demonstrated.

**Result:** PASS — continuing immediately.

---

## Phase 3 — Frontend scaffold + static render — 2026-07-08 — PASS

**Checked:** Vite + React 18 + Tailwind + react-three-fiber app in `frontend/`
rendering the static Phase-1 sample (`src/data/sample.json`, 251 points).
Headless Chromium (swiftshader WebGL) via `verification/verify_ui.mjs`.

**Actual output (`node verification/verify_ui.mjs http://localhost:5174/ …`):**
```
canvas: { present: true, w: 1280, h: 747 }
consoleErrorCount: 0
pageErrorCount: 0
```

**Screenshot:** `verification/phase3_static_render.png` — a non-blank WebGL
scene: continuous trail on **pitch (X) / timbre (Y) / motion (Z)** labeled
axes, orbit-ready, amplitude driving point **size** (louder = bigger) and
**color** (indigo→teal→green→amber ramp).

**Fixes during the phase (2):** (1) drei `<Instance color>` conflicted with
`vertexColors` on the instance material → every sphere rendered black; removing
`vertexColors` let the per-instance `instanceColor` buffer drive color. (2)
Point sizes were too large (blobs) → reduced to `0.05 + amplitude*0.18`. Also
switched the verify harness `waitUntil` from `networkidle` (never fires under
Vite HMR websocket) to `load`.

**Note:** dev server bound to **5174** (5173 was already in use by another
process on the Pi); irrelevant to production, where FastAPI serves the build.

**Result:** PASS — continuing immediately.

---

## Phase 4 — Upload + browser recording wired — 2026-07-08 — PASS

**Checked:** a REAL file upload driven through the browser UI — the identical
`uploadAudio → POST /upload → render` code path a recorded blob uses — via
`verification/verify_upload.mjs` (Playwright sets the file input, waits out the
processing overlay, screenshots the rendered result).

**Actual output:**
```
rendered: true
footer: "251 points · clip 5961366e9019 · drag to orbit"
consoleErrorCount: 0
pageErrorCount: 0
```

**Screenshot:** `verification/phase4_upload_flow.png` — toolbar shows
**Upload file · Record · Pi mic + duration**; the uploaded clip
`5961366e9019` rendered as a full 3D trail (footer flipped from "sample" to the
real clip id). Processing overlay (spinner + "Analyzing audio…") displayed
during the ~24 s extraction, then cleared.

**MediaRecorder note (expected, not a stop condition):** the live phone-mic
path can't run headlessly (no real mic in headless Chromium). Wiring verified
through the shared upload path; the record button + 60s countdown + mime
negotiation are implemented (`src/lib/useRecorder.js`). **Manual follow-up for
Job:** test live phone recording (logged in LEARNINGS.md).

**Result:** PASS — continuing immediately.

---

## Phase 5 — Pi mic capture — 2026-07-08 — PASS

**Checked:** fully real — an actual recording from the Pi's USB mic via
`~/bin/rec`, both by direct curl and by clicking the UI's **Pi mic** button.

**Actual curl output (`POST /capture {"duration":3}`):**
```
HTTP 200
id: 39276b0e34a3   duration_s: 3.0   nfeat: 151   audio_url: /audio/39276b0e34a3.opus
```
`GET /history` then showed `pi_mic 39276b0e34a3 3.0` (correct source_type) —
so the mic path writes a distinct source and the mic was acquired only for the
recording window (rec is synchronous, released on exit; no background hold).

**UI drive (`verification/verify_capture.mjs`):** clicked **Pi mic** (5 s), a
new clip recorded + rendered:
```
rendered: true
footer: "251 points · clip d32aaaddeeda · drag to orbit"
consoleErrorCount: 0   pageErrorCount: 0
```

**Screenshot:** `verification/phase5_pi_capture.png` — a visibly different,
denser ambient-room trail (vs. the tonal `test.wav` clips), Pi-mic button
highlighted mid-capture.

**Result:** PASS — continuing immediately.

---

## Phase 6 — Playback sync + spectrogram — 2026-07-08 — PASS

**Checked:** scrub the playback bar through several positions, confirm the 3D
highlight tracks the playhead at a non-zero timestamp, and the spectrogram
strip renders — with zero console errors during scrubbing.
(`verification/verify_playback.mjs`.)

**Spectrogram payload (curl):** `POST /upload` now returns
`spectrogram {bins:64, cols:251, data_len:16064 (=64×251), range 0–255}` —
computed server-side (`librosa.melspectrogram` → dB → uint8) and carried inside
the clip's feature JSON (no extra file/endpoint; same retention).

**UI drive output:**
```
canvasCount: 2            (WebGL trail + 2D spectrogram)
playheadText: "0:02"      (scrubbed to a non-zero time)
consoleErrorCount: 0   pageErrorCount: 0   (across 5 scrub positions)
```

**Screenshot:** `verification/phase6_playback_sync.png` — white highlight
sphere sits on the trail at the ~2 s point; transport shows 0:02 / 0:05 with
the slider ~40%; magma spectrogram strip below shows harmonic content with a
white playhead line at the matching ~40% position.

**Result:** PASS — continuing immediately.

---

## Phase 7 — History gallery — 2026-07-08 — PASS

**Checked:** History drawer lists real clips from `GET /history`, and clicking
a card actually reloads that clip via `GET /history/{id}`.
(`verification/verify_gallery.mjs`.)

**Actual output:**
```
cardCount: 6
firstIdShort: "c8b02ded"
reloaded: true
footerAfter: "251 points · clip c8b02ded5adf · drag to orbit"
consoleErrorCount: 0   pageErrorCount: 0
```
The click-to-reload interaction was exercised for real: opened the drawer,
clicked the top card (`c8b02ded`), the footer flipped from "sample" to
`clip c8b02ded5adf` and the drawer closed.

**Screenshot:** `verification/phase7_gallery.png` — drawer with 6 entries, each
showing a source icon (⤴ Upload, 🎙 Pi mic), duration, timestamp, and short id;
the current clip is ring-highlighted; list auto-refreshes when a new clip is
created (`historyKey` bump).

**Result:** PASS — continuing immediately.

---

## Phase 8 — Deployment — 2026-07-08 — PASS

**Checked:** frontend built + served by StaticFiles; `echo` systemd service
active on 8014; `echo.job-joseph.com` ingress + DNS added; public URL returns
real data and the full app.

**Build:** `npm run build` → `frontend/dist` (index 0.55 KB, css 13 KB, js
1.15 MB / 332 KB gzip — three.js). StaticFiles (mounted last in `main.py`)
serves it: `GET http://127.0.0.1:8014/` → `<title>Echo — sound made
visible</title>`, JS asset → `HTTP 200 text/javascript`.

**systemd (`systemctl status echo`, no sudo — see LEARNINGS):**
```
● echo.service - Echo — 3D sound visualizer (FastAPI on :8014)
     Loaded: loaded (/etc/systemd/system/echo.service; enabled; preset: enabled)
     Active: active (running) since Wed 2026-07-08 03:26:34 IST
   Main PID: 28362 (uvicorn)  …  Application startup complete.
```
Installed via the scoped `sudo -n cp /tmp/echo.service … && daemon-reload &&
enable && start` (all succeeded; enable created the multi-user.target symlink).

**Cloudflare Tunnel:** added exactly one ingress block above the catch-all
`http_status:404` (before/after recorded below), synced with
`sudo -n cp … /etc/cloudflared/config.yml`, `sudo -n systemctl restart
cloudflared`, then `cloudflared tunnel route dns pi-home echo.job-joseph.com`
→ `INF Added CNAME echo.job-joseph.com … tunnelID=41ef69c7-…`.

**Public self-check:**
```
curl https://echo.job-joseph.com/history  → HTTP 200, 6 real entries
  upload c8b02ded 5.0 · upload bd914d82 5.0 · pi_mic d32aaadd 5.0 · pi_mic 39276b0e 3.0 …
curl https://echo.job-joseph.com/         → <title>Echo — sound made visible</title>
```
Headless load of the public URL (`verification/phase8_public_deploy.png`):
canvas present 1280×582, **0** console/page errors — the full app (toolbar,
3D trail, playback bar, spectrogram placeholder) renders through the tunnel.

**Tunnel config diff (one block added, nothing else touched):**
```
   - hostname: hunter.job-joseph.com
     service: http://localhost:8013

+  - hostname: echo.job-joseph.com
+    service: http://localhost:8014
+
   - service: http_status:404
```

**Result:** PASS — v1 complete.

---

## Build complete — all 8 phases PASS

No stop condition hit. Echo v1 is live at **https://echo.job-joseph.com** on
port **8014** (systemd `echo.service`, enabled). Full evidence above; all
screenshots in `verification/`. Manual follow-up for Job: live phone-mic
recording test (see LEARNINGS.md).

---

# Post-launch mobile bug fixes — 2026-07-08

Three bugs from Job's live Android (Chrome) testing. Scope: only `Scene.jsx`
(react-three-fiber) and `extraction.py`. No schema/deploy/API changes.

## Bug 1 — Gimbal flip / mirrored labels — PASS

**Fix:** locked `min/maxPolarAngle` to the camera's initial polar angle
(`POLAR_ANGLE ≈ 1.130 rad / 64.7°`, derived from the camera position), disabled
pan + zoom, pinned `target=[0,0,0]`, and billboarded the axis labels.

**Evidence (`verification/verify_mobile.mjs`, Pixel 5 emulation, touch):**
```
verticalDragDiff:   0.00000   verticalLocked: true    (large vertical drag → pixel-identical view; no pole flip)
horizontalDragDiff: 0.97971   horizontalRotated: true (horizontal drag still rotates)
console/page errors: 0 / 0
```
Screenshots: `mobile_bugfix_1_initial.png`, `_2_after_vertical_drag.png`
(identical to initial), `_3_after_horizontal_drag.png` (rotated, **labels
read upright/correct — not mirrored** after billboarding).

## Bug 2 — White screen / inside-geometry on mobile — PASS

**Fix:** `dpr` capped at 2; `<Resizer>` (ResizeObserver on canvas parent +
delayed `orientationchange` re-apply) syncs the drawing buffer to the
container; canvas wrapped in an `absolute inset-0` div for a real non-zero
size before first render; zoom disabled removes the dolly-inside path.

**Evidence (same run, portrait→landscape resize + orientationchange):**
```
portrait : canvas 393×429 fills parent 393×429 ✓   buffer 786×858 = client×2 (dpr cap) ✓
landscape: canvas 727×139 fills parent 727×139 ✓   buffer 1454×278 = client×2 (dpr cap) ✓
portraitFills/landscapeFills: true/true   dprOk: true/true
```
Screenshot `mobile_bugfix_4_landscape.png` — canvas fills its container, scene
centered, no white flash, no seam/cutoff.

## Bug 3 — Trail spikes to the origin — PASS

**Fix:** `librosa.effects.trim(top_db=30)` removes leading/trailing silence
(offset added back so frame times stay on the original timeline for playback
sync); quiet frames (RMS < 6% of peak) hold pitch **and** timbre **and** motion
(not just pitch); amplitude stays real.

**Evidence (`verification/verify_extraction.py`, OLD-vs-NEW in normalized render
space; "origin-dip" = an isolated inward needle toward the quiet corner —
the reported artifact — vs. legitimate outward onset "peaks"):**
```
silence_test.wav (leading+mid+trailing silence):
   OLD  origin-dips= 2  (peaks=7)
   NEW  origin-dips= 0  (peaks=2)   frames near-zero on all 3 axes: 0
d32aaaddeeda.opus (ambient, uniformly energetic):
   OLD  origin-dips= 0     NEW  origin-dips= 0   (never had the bug)
SUMMARY: OLD origin-dips total 2 → NEW 0   RESULT: PASS
```
Legitimate onset-strength peaks on the motion axis are preserved (that's what
"motion" means); only the silence-collapse dips were removed.

**Live production confirm:** `POST https://echo.job-joseph.com/upload` of the
silence clip → 206 pts, `first t=0.76 / last t=4.86` within a 5.6 s clip
(silence trimmed, timeline preserved), timbre min `3.012` (no longer collapsing
to ~0).

## Redeploy
`npm run build` → `sudo -n systemctl restart echo` (also loads the new
extraction code). `systemctl is-active echo` → `active`;
`https://echo.job-joseph.com/` and `/history` → HTTP 200.

**Deviation:** added label billboarding beyond the literal "lock polar angle"
instruction — the mirrored-label symptom persists under (intended) horizontal
rotation without it. Small, in-scope (Scene component only), directly serves
the reported symptom. Flagged for review.

---

# Fixed scale + density + smoothing + visual overhaul — 2026-07-08

Scope: `extraction.py` (+ pyin range) and `Scene.jsx`/`features.js`. Migration
of stored features. No schema/API/endpoint changes. Order A→B→C→(migrate)→D.

## Part A — Point-density bug — PASS

**Root cause:** `librosa.effects.trim` (prev session) shrank the frame timeline
for clips with quiet passages → ~9 pts/sec of real duration instead of ~50.
Trace:
```
25bd6d1c: full 2.8s/141 frames → TRIMMED to 1.1s/54 frames  (the "55 points" bug)
39276b0e: full 3.0s/151 frames → trimmed 3.0s/151            (no silence, unaffected)
```
**Fix:** removed trimming; quiet frames are HELD, not dropped. Re-extracted
3 clips of different lengths:
```
test.wav     5.0s → 251 pts → 50.2 pts/sec
25bd6d1c    2.8s → 141 pts → 50.0 pts/sec   (was 54)
16b9be16    6.4s → 322 pts → 50.3 pts/sec
```
All within 45–55. GATE (density 44–56) added to `_self_check`. **PASS.**

## Part B — Fixed world scale — PASS

Fixed per-axis bounds mapped into `[-3,3]`, clamped to the edge (constants +
derivation in LEARNINGS). pyin `FMAX` raised 2093→4000 Hz so high birdsong is
detected (25bd6d1c went from a collapsed 220 Hz fallback to ~3.75 kHz → sits
high on pitch). Frontend plots stored coords directly (no per-clip normalize).
**Acceptance:** two clips render in the SAME box extents, occupying visibly
different regions — `visual_parity_desktop.png` (sample, mid cluster) vs
`visual_parity_loaded_clip.png` (clip 7139e141484e, lower vertical trail).
Live upload check: pitch/timbre/motion all within [-3,3], amplitude 0..1. **PASS.**

## Part C — Smoothing — PASS

`SMOOTH_WINDOW=5` on pitch/timbre/motion, `AMP_SMOOTH_WINDOW=3` on amplitude.
Before/after on clip 7139e141484e (mean |2nd difference| = zigzag):
```
unsmoothed jitter: 0.1527
smoothed  jitter:  0.0343   → 78% reduction (trail flows, shape kept)
```
**PASS.**

## Migration — PASS

`verification/migrate_features.py` re-extracted **all 21** history clips into
the new fixed-scale + smoothed space (overwrote `data/features/*.json`); every
clip reported ~50 pts/sec. Bundled `sample.json` regenerated from a migrated
clip.

## Part D — Scene visual overhaul — PASS

Monochrome teal glow (additive sprite, single `THREE.Points`), faint lines,
fixed world box with gridded walls + integer ticks + billboarded axis names,
aspect-aware framing (box fills ~78% of the shorter viewport dim), restyled
glow playhead. **Screenshots (console clean, 0 errors all runs):**
- `visual_parity_desktop.png` — box/grid/ticks/monochrome cluster, framed.
- `visual_parity_mobile_1_initial.png` (Pixel 5 portrait) — full box fits width.
- `visual_parity_mobile_4_landscape.png` — fills container, no white flash.
- `visual_parity_loaded_clip.png` — migrated clip + glow playhead + spectrogram.
- `visual_parity_public.png` — same scene through `echo.job-joseph.com`.
Camera lock (Bug 1) + canvas fill (Bug 2) re-confirmed by `verify_mobile.mjs`
(verticalLocked true, horizontalRotated true, portrait/landscape fills true).
Side-by-side vs the reference: box, gridded walls, numeric ticks, dense
monochrome teal cluster + faint trail — all present. **PASS.**

## Redeploy
`npm run build` → `sudo -n systemctl restart echo` (new extraction + new build).
`systemctl is-active echo` → active. `https://echo.job-joseph.com/` and
`/history` → HTTP 200; live upload → 50.2 pts/sec, world coords in [-3,3].

**Deviation:** raised pyin `FMAX` to 4000 Hz — not explicitly requested, but the
fixed pitch scale (50–4000) was useless without it (birds > 2093 Hz collapsed
to the fallback). In-scope (extraction module). Flagged for review.

---

# Session 5 — Slow-processing fix, boundary trim, spectrogram polish, sample library (2026-07-08)

## Part A — Slow processing / "Failed to fetch" — PASS

**Root cause confirmed by profiling, not assumed.** `librosa.pyin` is 99% of
extraction time; the bottleneck is its default pitch resolution (0.1 semitone).
Measured per-step on the Pi (isolated): 20 s clip → 12.4 s pyin; a synthesized
60 s clip → **37.0 s** pyin. Under real Pi load (the original LEARNINGS note
measured ~24 s for a 5 s clip, ~5× my isolated numbers) a longer clip could
approach Cloudflare's edge limit and drop the connection → browser
"Failed to fetch".

**Timeouts audited (logged):** uvicorn runs bare single-worker; its only timeout
is `--timeout-keep-alive` (idle keep-alive, not request processing) — no handler
timeout. cloudflared's echo ingress has no per-service timeout, but Cloudflare's
edge enforces a hard ~100 s origin-response limit (HTTP 524) on the free plan.
Nothing in the chain is shorter than processing needs *today*, so the fix is to
cut processing time for margin. **No timeout config change made.**

**Fix:** `PYIN_RESOLUTION = 0.25` (25 cents). 60 s clip pyin **37 s → 6.5 s**
(full `extract_features` 8.5 s, spectrogram 0.09 s) — well under the 15 s target,
single-threaded (multiprocessing/chunking NOT needed, so not built). Accuracy
cost vs 0.1: ~6 cents mean / 15 cents p95 — imperceptible, < ¼ semitone. 0.5 was
rejected (octave errors). fmin/fmax left at 50–4000 Hz.

**End-to-end (real uploads through the running app, 0 console/page errors):**
- Local `:8014`, 19 s clip (`asian-koel-XC1089796.mp3`) → rendered in **7.4 s**
  round-trip. `session5_partA_upload_19s.png`.
- **Public tunnel** `echo.job-joseph.com`, 19.8 s clip
  (`rose-ringed-parakeet-XC1142621.mp3`) → rendered, 976 pts, 0 errors — the
  original failing path. `session5_partA_public_upload.png`. **PASS.**

## Part B — Origin-collapse fix (boundary-only adaptive trim) — PASS

Reintroduced leading/trailing silence trimming, **interior untouched**, with an
adaptive threshold: signal must exceed the clip's own noise floor (10th-pct RMS)
by `TRIM_MARGIN_DB=8`, capped so the threshold can never rise within
`TRIM_MIN_SNR_DB=25` of the peak — the cap is what prevents the old `top_db=30`
failure where a loud transient made the trim eat quiet-but-real boundary signal.
Frame times get the trim offset added back → the untrimmed playback copy still
scrub-syncs.

**Regression check on `25bd6d1c6102` (explicit before/after):** its envelope is
**1.55 s of pure digital silence (flat −80 dB) then real birdsong 1.6–2.8 s**
(inspected frame-by-frame). Before: 141 frames over 2.8 s (≈77 leading frames
sat at the origin — the artifact). After: **64 frames, span 1.54–2.80 s, 50.8
pts/s over the analyzed span** — only the genuine silence removed, **100 % of
the real call kept**. This is the intended fix, NOT the old signal-eating
over-trim (which cut into the call itself). SELF-CHECK PASS.

**Origin cluster gone (data probe in-page):** first 5 frames of the migrated
`25bd6d1c` are all at distance **3.21** from the origin (out at the real signal),
**0 frames within 0.5 of the origin**. Parakeet/koel samples (leading silence
trimmed) render with the trail out in the box, no near-origin needle
(`session5_partD_sample_loaded.png`, `session5_partC_spectrogram_mobile.png`).

## Part C — Spectrogram polish — PASS

Rewrote `Spectrogram.jsx`: native cols×bins image drawn to an offscreen canvas,
then **bilinearly upscaled** onto a container-sized canvas (× dpr, capped 2) via
a `ResizeObserver` + `orientationchange` handler → fills any width crisply, no
`image-rendering: pixelated` blocks. Added a **frequency axis** (Hz, mel/log-
spaced: 250/500/1k/2k/4k/8k, positions computed server-side in
`compute_spectrogram.freq_ticks` so the frontend needs no mel formula) with faint
gridlines, and a **time axis** (mm:ss, aligned to the linear scrubber). Wrapped
in a rounded bordered panel matching the other dark-UI panels.
- `session5_partC_spectrogram_desktop.png` — labeled Hz + time axes, smooth.
- `session5_partC_spectrogram_mobile.png` / `_crop.png` (390×844, dpr 2) — canvas
  buffer 604 px for 302 px CSS width, fills cleanly, both axes legible. **PASS.**

## Part D — In-app sample library — PASS

New **permanent, non-rotating** store under `samples/` (audio/ opus + features/
JSON + `samples.json`), entirely separate from `data/` and `test-fixtures/`.
Samples are **never in the `clips` table**, so the 50-entry retention cleanup
cannot evict them — confirmed: 26 clips in DB, `/history` lists 26, **no sample
slug present in either**. Seeded by `verification/seed_samples.py` (attribution
parsed straight from `test-fixtures/xeno-canto/MANIFEST.md`). Endpoints
`GET /samples`, `/samples/{id}`, `/samples/audio/{file}` (declared before the
StaticFiles mount). Committed as product assets (gitignore negation for
`samples/audio/*.opus`).

3 species, one clip each: Asian Koel (Albert Noorlander), Common Myna (David
Darrell-Lambert), Rose-ringed Parakeet (Arjun Dutta) — all CC BY-NC-SA 4.0.
A left-side "🐦 Samples" drawer (distinct from the right-side History) shows each
card with **species, scientific name, recordist, license (→ license URL), and a
Xeno-canto XC# source link**; a compact attribution credit also shows in the main
view while a sample is loaded. Clicking a sample loads + renders in ~2.9 s.
- `session5_partD_samples_drawer.png` — 3 cards, full attribution visible.
- `session5_partD_sample_loaded.png` — koel trail + bottom-right credit.
- `session5_partD_samples_mobile.png` — attribution on phone width. **PASS.**

## Migration + redeploy
`verification/migrate_features.py` re-ran over all 25 history clips (re-extracts
with the new resolution + boundary trim + freq_ticks; 24 s total). `npm run build`
→ `sudo -n systemctl restart echo` → `systemctl is-active echo` active.
`https://echo.job-joseph.com/` HTTP 200, `/samples` returns the 3 species,
public 19.8 s upload renders. New build + backend live.

**Deviations:** (1) The v2 Xeno-canto premise from Part-A's brief was moot — the
fix is purely `PYIN_RESOLUTION`. (2) Two real test-upload clips
(`ea191859bc7f`, `6fcabffa7248`) were added to production history by the
end-to-end upload checks — harmless real birdcalls, will age out via retention.
(3) `samples/` opus + feature JSON committed to git (small product assets) —
new precedent vs the global audio ignore; gitignore negation added.

---

# Session 6 (v1.5) — Extended Spectral Analysis Panel + feature-schema versioning (2026-07-19)

## Part 0 — feature-schema versioning system
Designed + built a permanent fix for feature-schema drift (three prior sessions
changed stored-JSON contents relying on *remembering* to migrate):
`extraction.FEATURE_SCHEMA_VERSION` (=2) + `FEATURE_FIELDS` are the source of
truth; every payload stores `schema_version` (JSON **and** `clips.schema_version`,
added in-place by `db._ensure_columns()` for the pre-existing DB); `schema_audit.py`
reports current-vs-stale (version **and** key-set), surfaced three ways
(`python schema_audit.py`, `GET /api/schema-audit`, `tests/test_schema.py`
SCHEMA-005); `migrate_schema.py` is the one supported migration path. Root-level
(not gitignored `verification/`). Rule added to CLAUDE.md.
- **Pre-migration audit (real check, real answer):** `python schema_audit.py`
  reported **38 stale** (35 history + 3 samples), all `v=None` missing the 7 new
  fields.
- **Post-migration audit:** `total=38  current=38  stale=0`. Public endpoint
  `GET https://echo.job-joseph.com/api/schema-audit` → `{current_version:2,
  total:38, current:38, stale:0}`. **PASS.**

## Parts A + B — descriptors compute + migration
`python extraction.py test.wav` → SELF-CHECK **PASS**: all 7 new fields present,
finite, within their documented fixed ranges (e.g. spread 1137–2476 Hz, crest
10.9–28.2, contrast 13.1–25.1 dB, slope −6.6e-4…−3.4e-4, flatness 5e-5–0.014,
hnr −12.5–26.5 dB, tonality 0.67–0.84). Migration (dogfooded through the Part-0
system) re-extracted + re-stamped all 35 history + 3 sample clips v1→v2. Backend
suite **95 passed** (incl. new SCHEMA-001..005 and the updated column-set assert).
60 s extract ≈10 s (was ≈8.5 s; +1.5 s from HPSS), ~10× under the ~100 s edge.

## Part C — the panel (Playwright, desktop + mobile)
`verification/verify_v1_5.mjs` against `http://localhost:8014` (loads the
asian-koel sample for rich data + audio, switches to the Spectral Panel tab):
- **Desktop 1280×800** and **Mobile 390×844**, identical results:
  - 7 legend labels present (Spectral Spread/Crest/Contrast/Slope/Flatness/HNR/
    Tonality); 7 stroked `<path>` lines.
  - **Playhead sync:** teal playhead x = 0 → after scrubbing the transport to 60%,
    x = 600.2 / 1000 (viewBox) — moves with the shared scrubber state.
  - **Hover readout:** `t = 10.28s` + every line's value+unit (Spread 3595 Hz,
    Crest 15.2, Contrast 19.9 dB, Slope −1.05e-4, Flatness 0.0072, HNR 8.0 dB,
    Tonality 0.74).
  - **Zero pageErrors, zero consoleErrors.**
- `v1_5_panel_desktop.png`, `v1_5_panel_mobile.png` — panel with readout + playhead.
- `v1_5_trail_intact.png` — 3D Trail view unchanged (1 canvas, tab selected, no
  errors) — additive-only guardrail confirmed.
- `v1_5_panel_public.png` — panel renders through the tunnel (7 paths, labels, no
  errors). **PASS.**

## Redeploy
`npm run build` (dist `index-DvZyzo4M.js`) → `sudo -n systemctl restart echo` →
`/api/health` ok. Tunnel serves the same asset hash
(`curl https://echo.job-joseph.com/` → `index-DvZyzo4M.js`). New build + backend
live and public.

**Deviations:** (1) The prompt says "six" new fields in prose but the legend +
Part A enumerate **seven** named descriptors (Spread, Crest, Contrast, Slope,
Flatness, HNR, Tonality) — implemented all seven so nothing named is missing.
(2) New descriptors stored in physical units (clamped) rather than remapped to
[−3,3], so the hover readout shows meaningful numbers; frontend normalizes per
lane against the same fixed ranges. (3) `frontend/src/data/sample.json` regenerated
(asian-koel, 380 pts) so the panel isn't empty on first boot. (4) `vitest` is not
installed in `frontend/node_modules`, so the JS unit layer wasn't run — the panel
is verified end-to-end via Playwright + a clean `vite build` instead. (5) The
second 3D scene (Spread/Centroid/Crest cube) was **deliberately deferred**, not
forgotten.

---

# Session 7 — shadcn/ui component polish (2026-07-19)

Frontend-only session (no backend/extraction/schema/API changes — confirmed via
`git status` showing zero touched files outside `frontend/` and the two e2e
specs updated to match the new Sheet markup). Goal: replace raw HTML
interactive elements with shadcn/ui primitives for real hover/focus/active/
loading states + toast feedback, without touching the 3D trail's rendering or
the app's layout/palette.

## Part A — shadcn/ui setup + palette mapping
`npx shadcn@latest` (v4.13.1) turned out to target Tailwind v4's CSS-first
`@theme`/`oklch()` engine by default — incompatible with this app's pinned
Tailwind v3.4 JS-config setup (would have needed a v4 migration, far outside
"component polish"). **Pinned to `shadcn@2.10.0`** instead (the last
Tailwind-v3-compatible major), with a hand-written `components.json` (the
newer CLI's interactive style/preset prompts don't accept non-interactive
flags for this) — `add` respects an existing `components.json` and skips the
wizard entirely.

Palette mapped to Echo's **actual existing colors** (computed exact HSL, not
approximated): `--background`=ink `#0a0a12`, `--card`/`--popover`=panel
`#12121c`, `--foreground`=base text `#e8e8f0`, `--muted-foreground`=slate-400
(existing secondary-text convention), `--primary`=indigo-500 `#6366f1`
(Echo's own pre-existing interactive accent — the Samples "Visualize" button,
seek-slider accent, and Gallery/Samples "selected" ring were ALREADY this hue;
confirmed via `grep` before mapping anything), `--destructive`=rose-500
(existing Stop-button/error red), `--ring`=indigo-400 (focus rings — same
accent family, doesn't compete with the trail's reserved teal `#3df0c0`).
`--border`/`--input`/`--muted`/`--accent` are plain white with a **fixed alpha
baked into `tailwind.config.js`** (`hsl(var(--x) / 0.1)` etc.) so `border-border`
etc. render as literally the same `bg-white/10`-style overlay Echo already uses
everywhere, not a new opaque theme color.

**Acceptance:** screenshot after Part A's CSS/config work (before touching any
component) vs. the pre-session baseline — **0 / 1,024,000 pixels differ**
(exact `PIL` diff). `shadcn_before_boot_desktop.png` vs
`shadcn_partA_setup_check.png`.

Missing-dependency gaps in the CLI's installer (silently skipped
`class-variance-authority`/`clsx`/`tailwind-merge`/`lucide-react` on this
version) were caught by trying a build and installed directly.
`tailwindcss-animate` added for the `animate-in`/`slide-in-from-*` utilities
shadcn's Sheet/Select/Tooltip/DropdownMenu use. `next-themes` (pulled in by the
generated `sonner.jsx` wrapper, meant for Next.js theme switching) removed and
replaced with a hardcoded `theme="dark"` — Echo has no light mode.

**Incidental fix (needed to verify Samples in dev):** `/samples` was missing
from `vite.config.js`'s dev proxy list (pre-existing gap, harmless in
production since StaticFiles is same-origin there) — added so the Samples
sheet could actually be tested against the dev server.

## Part B — component replacement
| Element | Before | After |
|---|---|---|
| Upload/Record/Pi mic/Samples/History buttons | raw `<button>` | shadcn `Button` (kept the exact `bg-white/10 hover:bg-white/20` look via an explicit className override — Part A's pixel-identity goal — while gaining real focus-visible rings, disabled state, and a spinner slot) |
| Duration picker (3/5/10/15/30/60s) | native `<select>` | shadcn `Select` (Radix) |
| 3D Trail / Spectral Panel switch | hand-rolled `role="tablist"` buttons | shadcn `Tabs` (real Radix tabs; `role="tab"` names unchanged so existing `getByRole('tab', {name})` locators still work) |
| History drawer | hand-rolled `<aside>` with a CSS translate-x show/hide | shadcn `Sheet` (Radix Dialog: real focus trap, Escape-to-close, backdrop click, `aria-modal`) |
| Sample library drawer | same hand-rolled pattern | shadcn `Sheet` (left side) + shadcn `Card` for each entry |
| PlaybackBar play/pause | raw `<button>` with emoji glyphs | shadcn `Button` (icon size) + lucide `Play`/`Pause` — the Seek `<input type=range>` itself is untouched |
| Spectral-panel hover readout | custom floating div (crosshair-follow) | **kept the custom mechanism** (see below) — restyled onto the same `bg-popover`/`border-border` tokens as the rest of the app, plus a 100ms `animate-in fade-in-0 zoom-in-95` matching shadcn Tooltip's own entrance animation |
| Toasts | none (silent/ad hoc red banner) | `sonner` via shadcn's `Toaster` wrapper, mounted once in `App.jsx` |

**Deliberately did NOT adopt Radix Tooltip for the panel readout**: Radix
Tooltip anchors to one fixed trigger element; the panel's readout has to
follow the mouse continuously across a 1000-unit-wide chart (crosshair
style), which Tooltip's positioning model can't do. Visual language
unified via shared tokens instead — noted here rather than silently
diverging from the brief.

**Toast copy** (plain verbs, matching the button that triggered them):
`Uploaded` / `{filename}`, `Recorded`, `Captured` / `{n}s from the Pi mic`,
`Upload failed` / `Recording failed` / `Capture failed` each with the
specific backend or browser message — a raw `fetch` network failure
("Failed to fetch"/"NetworkError") is rewritten via a new `friendlyError()`
helper (`lib/api.js`) into "Couldn't reach the server — check your
connection and try again." A previously **completely silent** failure was
fixed along the way: `recorder.start()`'s getUserMedia rejection had no
catch at the call site at all (an unhandled promise rejection) — now caught
and surfaced as "Microphone access denied…" or the underlying error.

## Part C — motion, restraint, accessibility floor
- Sheet slide-in/out and Select/Tooltip fade+zoom: shadcn/Radix defaults via
  `tailwindcss-animate`, untouched.
- Tab switch: a restrained one-property fade (`animate-in fade-in-0
  duration-200`) on a wrapper div around the conditional Scene/AnalysisPanel
  render — Scene.jsx itself is not modified, so this cannot touch camera
  state or rendering.
- Recording feels alive: a small `animate-ping` red dot on the Stop button
  (Tailwind's built-in utility, no new dependency) + the existing progress
  bar now has an explicit `transition-[width] duration-200`.
- **Held back deliberately:** no animation on the toolbar buttons beyond
  color transitions (already had `transition-colors` via Button's base
  classes) and no animation added to the Samples/Gallery card list items —
  per the brief's own restraint warning ("if you find yourself adding
  animation in more than one or two places beyond what's listed, cut rather
  than add"), the trail is the one signature visual moment and everything
  else should stay quiet.
- `prefers-reduced-motion: reduce` — global CSS override in `index.css`
  collapsing all animation/transition durations to 0.01ms. **Verified**: with
  Playwright's `page.emulateMedia({reducedMotion:'reduce'})`, the open
  Sheet's computed `transition-duration` reads `1e-05s` (vs. its normal
  300–500ms) — confirms the rule actually applies to Radix's own animate-in
  classes, not just hand-written CSS.
- Focus rings — checked by literally tabbing through the toolbar
  (`shadcn_keyboard_check.mjs`): every focused element (Tabs, all 5 buttons,
  the Select trigger) shows a `box-shadow` ring in `rgb(129, 140, 248)`
  (indigo-400, the mapped `--ring`) — confirms the floor is met, not just
  assumed. Screenshot: `shadcn_keyboard_focus.png`.
- The AnalysisPanel legend-toggle buttons had **no focus state at all**
  before this session — added `focus-visible:ring-2 focus-visible:ring-ring`
  there too (an omission the polish pass exists to catch).

## Verification
- **Frontend unit tests:** 44/44 passed (`npx vitest run`) — one test
  (`Gallery.test.jsx` "shows an error state when getHistory rejects")
  initially broke because it does `vi.mock('../lib/api.js')` (auto-mocks
  every export including the new `friendlyError`, returning `undefined`);
  fixed by keeping Gallery/Samples' own inline `err` state on the original
  plain `e.message || 'Failed to load …'` (unchanged from before) and
  reserving `friendlyError()` for the new toast copy only — not a hack, a
  correctly-scoped division: the toast is the new surface, the inline banner
  is the old one and didn't need the new helper.
- **E2E (Playwright, 11 specs):** 10 passed. `history-gallery.spec.mjs` and
  `samples-drawer.spec.mjs` updated to target the new accessible structure
  (`getByRole('dialog', {name})` + `toBeHidden()` for the closed state,
  `getByTestId('history-item')`/`getByTitle(/Visualize/)` for card counts)
  instead of the old implementation-detail selectors (`aside` tag,
  `.translate-x-full` class, `.rounded-lg.border` class) — those were testing
  the OLD hand-rolled drawer's internals, not durable behavior, so updating
  them is a correctness fix that comes with adopting a real Sheet, not scope
  creep.
  - **1 pre-existing failure, confirmed NOT a regression:**
    `recording-fake-device.spec.mjs` fails deterministically (3/3 retries)
    with "Recording failed / Not supported" — verified by `git stash`-ing
    every change in this session, rebuilding, and re-running the exact same
    spec against untouched `main`: **same failure, same message**. This is
    an environment-specific MediaRecorder/fake-audio-device codec issue on
    this Chromium/Playwright install, unrelated to anything in this session.
    Left as-is (fixing it would be backend/tooling work, out of scope) but
    flagging concretely since my new error-surfacing made a previously
    *invisible* unhandled-promise-rejection into a *visible* toast — good
    to distinguish "now visible" from "newly broken."
- **Pixel-equivalence of the 3D trail specifically** (not just eyeballing):
  cropped the canvas region (y 95–620, full width) from the final build's
  boot screenshot and diffed against the pre-session baseline —
  **0 / 672,000 pixels differ**, even after every Part B/C header/toolbar
  change landed.
- Screenshots: `shadcn_before_*` (baseline), `shadcn_partA_setup_check.png`
  (Part A pixel-equivalence), `shadcn_after_*` (desktop+mobile: samples
  sheet, trail-loaded, history sheet, spectral panel), `shadcn_toast_*`
  (failure + success), `shadcn_keyboard_focus.png`, `shadcn_final_boot_*`,
  `shadcn_public_final.png` (through the tunnel). Zero console/page errors
  across every check.

## Redeploy
`npm run build` (dist `index-Y6sShxZz.js` / `index-_5XdbN4F.css`) →
`sudo -n systemctl restart echo` → `/api/health` ok. Tunnel serves the
identical asset hashes; live check through `https://echo.job-joseph.com`
confirms the Samples sheet, Spectral Panel (7 lines), and zero console
errors in production. `GET /api/schema-audit` unaffected (still 0 stale) —
confirms this session made no backend/schema changes, as scoped.

**Dependencies added** (`frontend/package.json`): `@radix-ui/react-dialog`,
`@radix-ui/react-select`, `@radix-ui/react-slot`, `@radix-ui/react-tabs`,
`@radix-ui/react-tooltip`, `class-variance-authority`, `clsx`, `lucide-react`,
`sonner`, `tailwind-merge`, `tailwindcss-animate`. New files:
`frontend/components.json`, `frontend/jsconfig.json`,
`frontend/src/components/ui/{button,select,sheet,card,tabs,tooltip,sonner}.jsx`,
`frontend/src/lib/utils.js` (shadcn's `cn()` helper).

**Deviations:** (1) Pinned shadcn CLI to v2.10.0 instead of `@latest` (Tailwind
v4 incompatibility, see Part A). (2) Radix Tooltip NOT used for the spectral
panel's hover readout — mechanism kept custom, tokens shared (see Part B).
(3) Two e2e specs updated to match the new Sheet's accessible structure.
(4) `vite.config.js` dev proxy gained a `/samples` entry (pre-existing gap,
needed to verify Samples in dev; harmless in production). (5) One
pre-existing e2e failure confirmed unrelated to this session via `git stash`
bisection, left unfixed (out of scope).

---

# Session 8 — sample library expansion: 3 birds → 10 clips across the box (2026-07-25)

Goal: the 3 existing samples were all birds clustering in the high-pitch
region, so the Sample library never demonstrated most of the 3D box's
range. Added 7 non-bird clips (Lion, Wolf, Cow, Dog, Cat, Frog, Cricket)
from the Freesound API, following the exact existing storage pattern
(`samples/` audio+features+manifest, never a `clips` DB row, never subject
to the 50-entry retention rule, schema-versioned via `migrate_schema.py`).

## Part A — sourcing (Freesound API)

Searched via `https://freesound.org/apiv2/search/text/`, one query per
species, judged on: clean/close single-animal recording over noisy field
ambience, and (where relevant) a real recording over the sound-design/
horror/human-vocal-imitation clips that dominate results for terms like
"wolf howl" (verified by reading full descriptions — e.g. two of the
top-rated "wolf howl" results turned out to be human vocal imitations
("Got tired of not being able to find any so I made my own" / "Pretending
sth like wolf howling"), explicitly rejected). All 7 chosen clips are real
single-animal recordings:

| Species | Sound | Recordist | License | Duration | Freesound ID |
|---|---|---|---|---|---|
| Lion | "S01-22_Lion snarls & roars 3.wav" | craigsmith | CC0 1.0 | 13.2s | 675442 |
| Wolf | "S28-04 Wolf howls with reverb.wav" | craigsmith | CC0 1.0 | 23.2s | 675445 |
| Cow | "Cow moo #5" | spurioustransients | CC0 1.0 | 13.9s | 513563 |
| Dog | "Dog - Bark 1" | Vrymaa | CC0 1.0 | 5.5s | 737885 |
| Cat | "Animal - Cat Meow" | Vrymaa | CC0 1.0 | 11.0s | 756236 |
| Frog | "R28-18-Single Frog Chirps.wav" | craigsmith | CC0 1.0 | 14.1s | 479833 |
| Cricket | "12ChirpBurst1x.wav" | zimbot | CC BY 4.0 | 5.0s | 89354 |

Source URLs: `https://freesound.org/people/<recordist>/sounds/<id>/` for
each (exact `url` field from the API response — never guessed). Lion/Wolf/
Cow/Frog all come from the same craigsmith collection (a digitized vintage
35mm-optical animal-sound archive, tagged `ANIMALS`/`WILD`) — the most
credible real-animal source available for those species on Freesound; the
"with reverb" in the wolf clip's own filename is disclosed as-is, not
hidden. Frog and Cricket got no `sci_name` (left `null`, not guessed) —
unlike Lion/Wolf/Cow/Dog/Cat (single unambiguous species), an unlabeled
frog/cricket recording can't be assigned one of the thousands of candidate
species without fabricating certainty.

**One swap after measuring output, not just success:** the first Cricket
pick (341855, "Cricketsample 1.wav") chirps once near the start of its 5.9s
duration then is silent for the rest — the extraction pipeline's boundary
silence-trim correctly discarded the true silence, but that left only 38
analyzed frames, too sparse to read as a trail. Compared frame counts
directly against alternatives from the same search and swapped to 89354
("12ChirpBurst1x.wav", same close/clean recording style, 12 chirps across
its full 5.0s) → 226 frames. Caught by actually inspecting output, exactly
the kind of check Part C below asks for.

## Part B — integration (exact existing pattern, extended for a 2nd source)

- New script `verification/fetch_freesound_samples.py`, sibling to the
  existing `verification/seed_samples.py` (which still owns the 3 Xeno-canto
  birds, untouched). Downloads each preview (`preview-hq-ogg`, no OAuth2
  needed for preview quality), transcodes to opus with the same `ffmpeg`
  settings as the existing seeder, and merges entries into
  `samples/samples.json` (existing 3 entries preserved, only gained a new
  `provider: "xeno-canto"` field for consistency).
- Manifest schema extended, additively: every entry now carries `provider`
  (`"xeno-canto"` / `"freesound"`) plus the provider-specific id
  (`xc_id` / `freesound_id`, `null` on the entries that don't apply).
  `samples.py._SUMMARY_KEYS` updated to expose both new fields via `/samples`.
- Feature extraction deliberately NOT done by the fetch script — it only
  writes audio + manifest metadata, then `python migrate_schema.py` (the one
  supported migration path per CLAUDE.md) extracted features and stamped
  `schema_version` for all 10 samples (+ all 38 history clips) in one run.
  `python schema_audit.py` confirms **0 stale / 48 current** (28 history +
  10 samples — history grew from 28 during the session from real traffic on
  the live public tunnel, unrelated to this work).
- Frontend (`Samples.jsx`, `App.jsx`) de-hardcoded from xeno-canto/bird-only:
  drawer header/description, the source-link label (`Xeno-canto XC{id}` vs
  `Freesound #{id}`, keyed off `provider`), the sci_name line (hidden when
  null), and the in-view attribution credit overlay. Emoji changed
  🐦→🔊 throughout (button, drawer header, credit overlay) since the library
  is no longer birds-only.
- Tests: added a Freesound-provider render case to `Samples.test.jsx`
  (source link label + no-sci_name-line assertions); updated
  `test_API_014_samples_list`/`test_STO_008_...retention` (hardcoded count 3
  → 10, key-set extended) and `e2e/specs/samples-drawer.spec.mjs` (card count
  3 → 10, button title text, added a Freesound-link assertion). All updated
  for the new reality, none loosened to hide a regression.

## Part C — measured spread (the actual acceptance check)

Extracted min/mean/max pitch/timbre/motion per sample from the stored
feature JSONs (fixed world-scale axes, `[-3, 3]` each, from `extraction.py`):

| id | frames | pitch (min/mean/max) | timbre (min/mean/max) | motion (min/mean/max) |
|---|---|---|---|---|
| asian-koel | 1028 | 1.22 / 2.43 / 2.97 | 0.15 / 0.69 / 1.23 | -3.00 / -1.69 / -0.52 |
| common-myna | 712 | 2.26 / 2.61 / 2.83 | -1.55 / 0.25 / 1.18 | -2.34 / -0.48 / 0.54 |
| rose-ringed-parakeet | 718 | 2.39 / 2.80 / 2.99 | 0.99 / 1.36 / 1.63 | -2.24 / -1.72 / -0.44 |
| lion-roar | 627 | -1.34 / -1.29 / -1.00 | -1.00 / -0.33 / 0.34 | -2.51 / -1.69 / 1.23 |
| wolf-howl | 1041 | -0.43 / -0.04 / 0.56 | -1.35 / -0.98 / -0.44 | -2.37 / -1.98 / -0.09 |
| cow-moo | 695 | -1.48 / -1.23 / -1.00 | -1.91 / -0.57 / 0.73 | -3.00 / -1.77 / -0.24 |
| dog-bark | 275 | -0.12 / -0.03 / 0.40 | -2.97 / -0.96 / 0.70 | -2.87 / -1.92 / 1.24 |
| cat-meow | 542 | 0.10 / 1.61 / 2.28 | -1.34 / 0.69 / 1.33 | -2.49 / -1.52 / 0.93 |
| frog-croak | 684 | 2.32 / 2.36 / 2.38 | -0.74 / 0.24 / 0.53 | -3.00 / -2.30 / 0.65 |
| cricket-chirp | 226 | 2.38 / 2.44 / 2.46 | 1.65 / 1.71 / 1.88 | -3.00 / -1.74 / -0.16 |

**Occupied span per axis, birds-only vs all 10** (of the box's max possible
6.0 per axis):

| axis | birds-only span | all-10 span |
|---|---|---|
| pitch | [1.22, 2.99] → 1.76 | [-1.48, 2.99] → **4.46** |
| timbre | [-1.55, 1.63] → 3.18 | [-2.97, 1.88] → **4.85** |
| motion | [-3.00, 0.54] → 3.54 | [-3.00, 1.24] → **4.24** |

**Honest read, per the prompt's instruction not to force the a-priori
low/mid/high grouping:** Lion and Cow land genuinely low-pitch (~-1.2 to
-1.3, mean), Wolf and Dog land mid (~0), Cat mid-high (1.6) — but Frog and
Cricket land in the *same* high-pitch band as the birds (2.3–2.5), because
real frog/cricket calls genuinely are high-frequency; no attempt was made to
force them lower to fit the expected grouping. The real gain from Frog/
Cricket is timbre, not pitch: Cricket's timbre (1.65–1.88) exceeds even the
highest bird (rose-ringed-parakeet, 1.63), extending that axis further than
the birds went. Motion's *mean* values cluster similarly low across all 10
samples (steady/sustained calls score low on the onset-strength axis by
design), but transient peaks in Lion/Dog reach further into positive motion
(+1.23/+1.24) than any bird's peak (+0.54) — visible as a bright upward
spike partway through those two trails. Net: genuinely different, non-
overlapping regions on pitch (new samples occupy the entire negative range
the birds never touched) and timbre (new min of -2.97 vs birds' -1.55); on
motion, spread comes from peak/transient extent more than centroid.

## Verification

- **Backend:** `pytest tests/` — 95 passed, 6 deselected (hardware/sudo/
  tunnel, unattended-safe). `python schema_audit.py` — 48/48 current, 0
  stale.
- **Frontend:** `npx vitest run` — 45 passed (8 files), including the new
  Freesound-provider Samples test.
- **E2E (Playwright, 11 specs):** 10 passed, including the updated
  `samples-drawer.spec.mjs` (10 cards, Xeno-canto + Freesound link
  assertions). **1 pre-existing failure** (`recording-fake-device.spec.mjs`)
  — same MediaRecorder/fake-audio-device codec issue on this Chromium
  install documented as unrelated in Session 7's `git stash` bisection;
  untouched by this session, confirmed still isolated (no other spec
  affected by the Samples/App changes).
- **Live app:** `npm run build` → `sudo -n systemctl restart echo` →
  `GET /samples` returns all 10 entries against the live systemd service on
  :8014 (confirmed samples themselves need no rebuild — pure data on disk,
  read fresh per request by `samples.py`; only the UI *code* changes needed
  the rebuild+restart).
- **Screenshots** (`verification/sample_expansion_*.png`): drawer showing
  all 10 cards top-to-bottom (`_drawer_all10.png`, `_drawer_all10_scrolled
  .png`) with correct per-provider attribution and no stray sci_name line on
  Frog/Cricket; 4 loaded trails side-by-side-comparable
  (`_trail_asian-koel.png`, `_trail_lion-roar.png`, `_trail_cow-moo.png`,
  `_trail_cricket-chirp.png`) visibly occupying different regions of the
  fixed box — koel top-right (high pitch), lion/cow center-left (low pitch,
  tight cluster), cricket right side but shifted deeper in timbre than the
  koel. Zero console/page errors across the whole check.

## Deviations

(1) Frog/Cricket `sci_name` left `null` rather than filled with a guessed
binomial (see Part A). (2) Swapped the Cricket source clip after measuring
frame-count output, not the first search result (see Part A). (3) Wolf
clip's source has "with reverb" in its own filename — used as-is (best real-
animal option found; the alternative was a purely synthetic/imitation
clip), disclosed rather than hidden. (4) Cricket ended up CC BY 4.0 (not
CC0 like the other 6) — attribution shown same as always, no functional
difference since the UI already always shows recordist+license+link.
(5) Touched `SPEC.md`/`ROADMAP.md` (species list, drawer emoji/copy,
`provider` field) in addition to the files the prompt named, since they'd
otherwise describe a stale 3-bird-only library.

---

# Session 9 — coverage-fill: measurement-driven sample selection (2026-07-25)

Different method from Session 8: instead of picking species names first and
measuring after, this session quantified the box's actual empty regions
*first*, then searched broadly, measured every real candidate, and kept
only the ones that provably closed a gap.

## Part 1 — quantifying the gap (not assuming it)

New `verification/coverage_gap.py`: bins every stored frame (all 10
existing samples, 6548 frames) into 0.25-wide bins per axis and reports
which bins have **zero** frames — a true empty range, not just "thin."

**Correction to the task's starting assumption:** the prompt (and this
session's own read of Session 8) assumed the empty region was "the true
middle" of the pitch axis. The actual histogram says otherwise — the
middle (roughly pitch ∈ [-0.5, 0.5]) is well covered by wolf-howl/dog-bark
(280–520 frames per bin there). The real, much bigger gap is the **low
end**:

| axis | true empty range(s) | as Hz / physical meaning |
|---|---|---|
| pitch | **[-3.00, -1.50)** ← the big one (1.5 units, 0 frames) | below ≈150 Hz — no sample has any pitch content that deep |
| pitch | (-0.75, -0.50), (0.75, 1.00) | two thin secondary notches (0.25 units each) |
| timbre | [2.00, 3.00) | very bright/harsh spectral centroid, unreached (cricket topped out at 1.88) |
| motion | [1.25, 3.00) | extreme transient/onset spikes beyond what lion/dog's peaks reached (1.23/1.24) |

Pitch's low-end gap (1.5 units fully empty) dwarfs every other gap by 5-6×,
so it was the primary target; timbre/motion gaps were tracked but treated
as secondary (see Part 4).

## Part 2 — broad candidate search (11 real clips measured)

Searched Freesound for species/sounds plausible for the low end — both the
task's suggested list (goat, sheep, pig, horse) and additional deep-
register candidates (deer, bull, camel, elephant, bullfrog) reasoned from
the ~150 Hz physical target. Same standard as Session 8: read the
description before trusting a title. Two outright rejects on genuineness
grounds alone, before even downloading:

- "elephant growls" (810176) — description states outright: *"This sound
  was generated using an AI model (elevenlabs). No real-world recording was
  used."* Rejected without downloading.
- "ElephantTrumpetCall.wav" (52249) — description: *"A hose pipe & a funnel
  makes a great elephant trumpet call!"* — a prop imitation, not a real
  elephant. Rejected.
- "awhoo.mp3" moose call (155150) — description: cast members of a stage
  play *"making the call"* for a theater production — humans imitating a
  moose, same category as Session 8's wolf-howl catch. Rejected.
- "tiger roar" as a query is dominated by monster-growl/vocoder/toilet-
  paper-tube sound design (checked ~8 top results, all explicitly
  synthesized or joke recordings) — no credible real tiger roar found; not
  forced, no tiger sample added.
- "bison bellow"/"buffalo bellow"/"gorilla grunt" — 0 Freesound results.

The 11 that passed the genuineness check were downloaded and run through
`extract_features` directly (not estimated):

| candidate | species | pitch (min/mean/max) | timbre (min/mean/max) | motion (min/mean/max) | verdict |
|---|---|---|---|---|---|
| pig-grunt (233173) | Pig | -3.00 / -2.92 / -2.80 | -0.90 / -0.32 / 0.46 | -2.40 / -1.27 / 0.46 | **kept** — deepest of all, right at the box edge |
| deer-roar-b (51060) | Red Deer | -2.13 / -2.02 / -1.85 | -0.03 / 0.37 / 0.62 | -2.76 / -1.78 / -0.11 | **kept** — tight, entirely inside the gap |
| bullfrog-b (799266) | American Bullfrog | -2.09 / -2.02 / -1.91 | -1.05 / -0.39 / 0.31 | -2.97 / -1.61 / 0.29 | **kept** — tight, entirely inside the gap |
| camel-grunt (437937) | Camel | -2.72 / -0.99 / 0.12 | -1.12 / -0.55 / 1.04 | -2.66 / -1.78 / 0.28 | **kept** — wide sweep, closes the residual notch between the other three and the already-covered zone |
| deer-roar-a (104580) | Red Deer | -2.09 / -1.75 / -1.42 | -0.42 / -0.10 / 0.29 | -2.49 / -1.44 / 0.10 | rejected — same species as deer-roar-b, and empirically redundant once deer-roar-b + camel are in (see combo test, Part 3) |
| bull-bellow (827111) | Cattle (bull) | -2.03 / -1.40 / -0.82 | -0.75 / 0.67 / 1.11 | -2.53 / -1.57 / 0.20 | rejected — mean sits above the gap edge, mostly overlaps cow-moo/lion-roar's already-covered territory |
| goat-bleat (683259) | Goat | 2.87 / 2.93 / 2.93 | -1.19 / 0.34 / 1.29 | -3.00 / -1.09 / 0.01 | rejected — lands squarely in the most crowded pitch bin in the whole set (2.25–2.50, already 1205 frames) |
| sheep-bleat (644830) | Sheep | -1.22 / -1.07 / -0.98 | -0.82 / -0.16 / 0.13 | -2.48 / -1.60 / 0.66 | rejected — entirely inside the already-covered -1.5..-1.0 band (lion/cow) |
| horse-neigh (437110) | Horse | -1.87 / -0.42 / 1.76 | -1.39 / -0.10 / 0.60 | -3.00 / -1.67 / **1.48** | rejected for pitch (mean in crowded mid-zone) — flagged separately: its motion peak (1.48) is the only candidate that exceeds the existing motion ceiling (1.24), a genuine secondary-axis fit not pursued this round (see Part 4) |
| elephant-call (819668) | Elephant | -1.72 / -1.10 / 0.88 | -1.38 / -0.53 / 0.63 | -3.00 / -1.72 / 0.26 | rejected — mean/max mostly redundant with wolf-howl/dog-bark's already-covered mid band |
| bullfrog-a (326648) | Bull Frog | 1.11 / 1.23 / 1.28 | -0.65 / -0.05 / 1.63 | -3.00 / -2.05 / 0.24 | rejected — lands in an already-populated pitch bin (1.00–1.50, 294 frames), doesn't touch either empty notch |

## Part 3 — empirical selection (combo-tested, not single-candidate reasoning)

Ran `coverage_gap.py`-equivalent occupancy checks on several combinations
before finalizing, rather than picking by eye:

| combo | resulting pitch empty range(s) |
|---|---|
| baseline (10 existing) | [-3.0,-1.5), (-0.75,-0.5), (0.75,1.0) |
| + pig, deer-b, bullfrog-b | [-2.75,-2.25), [-1.75,-1.5), (-0.75,-0.5), (0.75,1.0) |
| + pig, deer-b, bullfrog-b, **deer-a** | [-2.75,-2.25), (-0.75,-0.5), (0.75,1.0) — barely better |
| + pig, deer-b, bullfrog-b, **camel** | **[-2.5,-2.25)**, (0.75,1.0) — clearly better, closes both the -1.75..-1.5 AND -0.75..-0.5 notches |
| + all 11 candidates | [-2.5,-2.25) — same residual as the 4-pick combo, for 7 more redundant samples |

Camel strictly dominates deer-roar-a as the 4th pick (closes more, stays a
distinct species), and adding all 11 candidates gives no further benefit
over the 4-pick combo on the primary target — confirming "coverage, not
quantity." **Final selection: pig-grunt, deer-roar (b), bullfrog-croak (b),
camel-grunt** — 4 additions, re-verified on the actual post-opus-transcode
stored features (not just the raw preview measurement):

```
pitch true-empty:  [-3.0,-1.5), (-0.75,-0.5), (0.75,1.0)   ->   (-2.5,-2.25), (0.75,1.0)
```

The 1.5-unit fully-empty low-pitch band is reduced to a single residual
0.25-unit notch — an 83% reduction — plus the (-0.75,-0.5) secondary notch
also closed as a side effect. The remaining (-2.5,-2.25) and (0.75,1.0)
notches were not chased further: no candidate in the 11 measured reaches
them cleanly, and forcing a 5th/6th addition for two narrow notches after
already trying a reasonable set (11 candidates) would trade "coverage" for
"quantity" — exactly what the task said not to do.

## Selections — full attribution

| Species | Sound | Recordist | License | Duration | Source |
|---|---|---|---|---|---|
| Pig | Pig - Grunt 5 (deep) - 96kHz.wav | JarredGibb | CC0 1.0 | 2.5s | freesound.org/…/233173/ |
| Red Deer | Stag_Recording_Final_For_Freesound.wav | Joan Barnett | Sampling+ 1.0 | 9.6s | freesound.org/…/51060/ |
| Bullfrog | Frogs - American Bullfrog; Three Frogs Croaking in Pond | TheKingOfGeeks360 | CC0 1.0 | 18.0s | freesound.org/…/799266/ |
| Camel | G12-05-Camel Grunt.wav | craigsmith | CC0 1.0 | 23.4s | freesound.org/…/437937/ |

`sci_name`: Pig → *Sus scrofa domesticus*; Red Deer → *Cervus elaphus* (the
API description names "red deer stag" directly, not guessed); Bullfrog →
*Lithobates catesbeianus* (API title/description say "American Bullfrog"
explicitly); Camel → left `null` — the source doesn't specify Dromedary vs
Bactrian, so not guessed (same policy as Frog/Cricket in Session 8).

## Part 4 — before/after occupied range (all samples)

| axis | old-10 span | all-14 span |
|---|---|---|
| pitch | [-1.48, 2.99] → 4.46 | **[-3.00, 2.99] → 5.99** (99.8% of the full 6.0-wide box) |
| timbre | [-2.97, 1.88] → 4.85 | unchanged (none of the 4 additions targeted timbre) |
| motion | [-3.00, 1.24] → 4.24 | unchanged (none of the 4 additions targeted motion) |

Pitch coverage is now essentially edge-to-edge. Timbre's [2.0,3.0) gap and
motion's [1.25,3.0) gap remain **open** — flagged honestly rather than
forced. One candidate (horse-neigh, rejected above for pitch) did show a
real motion-axis fit (peak 1.48 vs the prior ceiling of 1.24), but pursuing
it would have meant adding a sample chosen for a different axis than this
round's stated target, and its pitch profile is otherwise redundant — left
as a flagged opportunity for a future timbre/motion-focused round rather
than added opportunistically here.

## Integration

Same pattern as Session 8, extended: `verification/fetch_freesound_samples.py`'s
`CHOSEN` dict got 4 new entries (round-2 comment block explaining the
gap-driven rationale); script re-run (idempotent, existing 10 untouched);
`python migrate_schema.py` extracted features + stamped all 14 samples (+ all
history clips); `python schema_audit.py` → **all current, 0 stale**. No
existing sample was touched, removed, or found to be a poor fit on
re-inspection.

**No frontend code change needed this round** — `Samples.jsx`/`App.jsx`
already render any number of samples generically (Session 8's
provider-agnostic rework). Confirmed live: `GET /samples` against the
already-running systemd service returned all 14 entries with no rebuild or
restart.

## Verification

- **Backend:** `pytest tests/` — 95 passed, 6 deselected (updated
  `test_API_014_samples_list`/`test_STO_008_...retention` hardcoded counts
  10→14, matching Session 8's precedent). `python schema_audit.py` — all
  current, 0 stale.
- **Frontend:** `npx vitest run` — 45 passed, unchanged (no frontend code
  touched this session).
- **E2E:** `samples-drawer.spec.mjs` card-count assertion updated 10→14;
  10/11 specs passed, same single pre-existing `recording-fake-device.spec.mjs`
  failure as every prior session (unrelated MediaRecorder/codec issue on
  this Chromium install).
- **Screenshots** (`verification/coverage_fill_*.png`): drawer top/mid/
  bottom scroll positions showing all 14 cards with correct attribution
  (including "Sampling+ 1.0" rendering correctly for deer-roar, and Camel's
  null `sci_name` correctly hiding its italic line); 4 loaded trails
  (`_trail_pig-grunt.png`, `_trail_deer-roar.png`, `_trail_bullfrog-croak
  .png`, `_trail_camel-grunt.png`) — pig-grunt sits hard against the pitch
  axis's far edge (visibly further left than lion/cow from Session 8),
  camel-grunt's trail visibly sprawls across a wide swath of the box
  bridging the new low cluster and the previously-covered mid region.
  Zero console/page errors.

## Deviations

(1) The task's framing assumed the empty region was "the true middle" —
measurement showed it's actually the **low end**; reported the correction
plainly rather than forcing candidates to fit the assumed narrative (see
Part 1). (2) Deer-roar's license is "Sampling+ 1.0" (not CC0/CC BY like
every other Freesound pick so far) — shown as-is, no functional difference
since the UI already always renders recordist+license+link. (3) Left
timbre/motion gaps open rather than adding a candidate chosen for a
different axis than this round's target (horse-neigh) — flagged as a
future opportunity instead. (4) Added `verification/coverage_gap.py` as a
new, reusable tool (not requested by name, but implied by "write a small
script that reports... which regions... are currently unoccupied").

---

# Session 10 — Design v2 S1: routing + PWA (2026-11-12)

Scope: DESIGN_V2.md §7 item 1 only. No visual reskin; nothing in
`extraction.py`, the feature schema, the DB or the upload limits was touched.

## What was built

- `main.py`: `/app` and `/app/{rest:path}` return `frontend/dist/index.html`,
  registered after every API route and above the StaticFiles mount, inside the
  `FRONTEND_DIST.exists()` guard. Plus `/sw.js` served with
  `Cache-Control: no-cache` (found during verification — see below).
- Frontend: `main.jsx` renders `Landing` (placeholder: wordmark, one line,
  "Open Echo" link) unless the path is `/app` or under `/app/`, where it renders
  today's `<App/>` unchanged. `/app?record=1` starts the browser recorder on
  mount and then drops the param from the URL.
- PWA: vite-plugin-pwa 2.0 — manifest name "Echo", `start_url: /app`,
  `scope: /`, theme/background `#121A15`, placeholder icons (192, 512,
  maskable 512, apple-touch) in `frontend/public/`.

## Automated suites

| Suite | Result |
|---|---|
| `pytest` (default run) | **99 passed**, 6 deselected (opt-in HW/sudo/tunnel). 4 new: DEPLOY-001..004 |
| Vitest | **48 passed** (9 files; new `route.test.js`) |
| Playwright | **16 passed, 1 failed** — the failure is E2E-010 (`recording-fake-device`), the known pre-existing environment gap (no audio session on the Pi; TEST_PLAN.md), unchanged by this session |
| `npm run build` | OK; service worker precaches 10 entries (1392 KiB) |

Changes to existing tests, routing-caused only: all ten e2e specs'
`page.goto('/')` → `page.goto('/app')`. New `e2e/specs/routing.spec.mjs`
(6 tests): `/` placeholder → "Open Echo" → `/app`; `/app/anything` serves the
app; `/app?record=1` calls `getUserMedia` once with no click and cleans the
URL; plain `/app` never touches the mic; a browser navigation to `/history`
returns JSON **with the service worker in control**; manifest fields + icons.

`?record=1` caveat: because of the same no-audio-session limit as E2E-010,
the spec proves the recorder is *started* (mic requested, recorder UI or its
error toast shown), not that a recording completes. A real-phone check is
listed for Job.

## Live checks (after `sudo -n systemctl restart echo`; `is-active` → active)

Same results on `http://127.0.0.1:8014` and `https://echo.job-joseph.com`:

| Path | Result |
|---|---|
| `/`, `/app`, `/app/anything`, `/app?record=1` | 200 `text/html` (index.html, 852 b) |
| `/history`, `/samples`, `/api/health` | 200 `application/json` |
| `/manifest.webmanifest` | 200 `application/manifest+json`, `start_url: /app`, `scope: /`, `theme_color: #121A15` |
| `/sw.js`, `/registerSW.js`, icons, `/favicon.svg` | 200 |

Headless Chromium against the public URL: `/` shows the placeholder (no
canvas); "Open Echo" lands on `/app` with the canvas and the bundled sample;
the service worker takes control; with it controlling, navigating to
`/history` still returns `application/json` and `/app/anything` renders the
app. Zero page errors.

Vite dev server (run on a spare port, 5199, stopped by exact PID): `/`,
`/app`, `/app/x`, `/app?record=1` all serve the dev index.html; `/` renders
the placeholder and `/app` the app; `/history` proxies to the backend.

## Found during verification

Cloudflare's edge was caching `/sw.js` (`cf-cache-status: HIT`,
`max-age=14400`). Added the `/sw.js` route with `Cache-Control: no-cache`;
after that the edge reports `EXPIRED` (revalidates with the origin) on every
request. See LEARNINGS.md.

## Verified by Job on his Android phone (2026-11-12)

- The PWA installs from Android Chrome and opens at `/app`.
- `/app?record=1` starts recording after the permission prompt.

With that, every "done when" item for S1 is met.
