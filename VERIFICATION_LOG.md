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
