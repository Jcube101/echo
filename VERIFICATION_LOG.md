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
