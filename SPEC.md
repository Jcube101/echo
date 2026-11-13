# Echo — Specification

This is Echo's own working spec, adapted from the v1 build brief and kept
current through v1.7 (public launch). It is the contract the code is held to. Anything marked **locked** comes from
`CLAUDE.md` and is not up for change in a build session.

---

## What Echo is

A general-purpose acoustic visualizer. Audio in → per-frame feature stream →
interactive 3D trail (pitch / timbre / motion axes) + 2D spectrogram +
synced playback + history. It knows nothing about the *source* of a sound;
bird detection and any other semantics live in separate downstream projects
that call Echo's `/upload` as an ordinary client.

---

## Input sources (v1)

1. **File upload** — `mp3/wav/m4a/opus`, or a video whose audio is extracted
   with `ffmpeg` first. Limits (**20 MB / 60 s**) are enforced **server-side**,
   not just in the browser.
2. **In-browser recording** — the phone-at-the-park flow. `MediaRecorder`
   captures ≤60 s from the device mic and POSTs the blob to the **same
   `/upload` endpoint** — no separate pipeline. Android Chrome is the target
   (confirmed by Job, 2026-11-13); **iOS Safari is untested** (no device), a
   known gap noted in `LEARNINGS.md`.
3. **Pi USB mic capture — owner only.** `/capture` triggers the Pi's recording wrapper for
   the requested duration (≤60 s), then the same pipeline. The mic is acquired
   only for the recording window and released immediately — never held in the
   background. Only Job can use it, after signing in at `/me` (Cloudflare
   Access); one capture runs at a time, and it can be stopped early or
   cancelled.

Plus a built-in **sample library** (not user input): a small curated set of
example clips shipped with the app so someone with no sound to hand can still
see the visualization. Details under *Sample library* below.

---

## Feature-extraction spec

Given an audio file, produce a JSON array of per-frame feature points. The
three spatial features are stored as **fixed-scale world coordinates in
[-3, 3]** (not raw units), so every clip is directly comparable across the
gallery — a high bird sits high on the pitch axis in *every* clip, with no
per-clip normalization. The full transform/clamp design is in `LEARNINGS.md`.

```json
[
  { "t": 0.00, "pitch": -0.97, "timbre": 0.42, "motion": -1.80, "amplitude": 0.60 },
  { "t": 0.02, "pitch": -0.95, "timbre": 0.51, "motion": -0.10, "amplitude": 0.65 }
]
```

| Field       | Meaning | How |
|-------------|---------|-----|
| `t`         | Frame time (seconds) | frame index × hop, on the **original** timeline (boundary-trim offset added back so playback scrub-syncs) |
| `pitch`     | Fundamental frequency → world coord | `librosa.pyin` (fmin/fmax 50–4000 Hz, `resolution=0.25` semitone for speed), `log2(Hz)` mapped into [-3, 3]; unvoiced/quiet frames **carry forward** the last voiced value (keeps the trail continuous) rather than nulling |
| `timbre`    | Spectral centroid → world coord | `log2(centroid/55)` mapped into [-3, 3] (deterministic, no per-clip model fit — rationale in `LEARNINGS.md`) |
| `motion`    | Onset-strength → world coord | `log1p(onset_strength)` mapped into [-3, 3] (spectrally aware: steady tone = low, chirp = high) |
| `amplitude` | Loudness, normalized 0–1 | RMS energy per frame, per-clip normalized. Drives point size/color **only** — not a spatial axis |

- **Boundary silence trim:** leading/trailing silence is removed (interior
  untouched) with an adaptive, noise-floor-relative threshold, so the trail
  doesn't open/close with a cluster of near-origin points. Tunables in
  `extraction.py` (`TRIM_*`).
- **Frame hop:** ~20 ms (≈50 fps) → ~50 points/sec of the *analyzed* (post-trim)
  span. A 60 s clip ≈ 3000 points.
- **Point cap:** the API downsamples so the frontend never receives more than
  a few thousand points (cap: **3000**).
- **Speed:** `pyin` dominates extraction; at `resolution=0.25` a 60 s clip
  extracts in ~8.5 s on the Pi (was ~37 s at the default 0.1). See the
  Cloudflare edge-timeout constraint in `LEARNINGS.md`.
- Extraction is a **standalone, testable function first**, verified on a real
  sample clip before any API/frontend wiring.

Alongside the feature array, extraction also produces a compact mel-
**spectrogram** (`{bins, cols, data, freq_ticks}`) carried in the same clip
JSON; `freq_ticks` gives Hz-axis label positions for the frontend.

**Extraction quality gates (self-check):** pitch/timbre/motion within the
[-3, 3] world box, amplitude within 0–1, zero NaN/Inf anywhere, density ~50
pts/sec over the analyzed span (unless capped at 3000).

---

## API (locked: FastAPI + SQLite, port 8014)

| Method | Path            | Behavior |
|--------|-----------------|----------|
| POST   | `/upload`       | Accepts an audio file **or** a browser-recorded blob (same validation). The clip belongs to the uploading browser. Limits: 10 per hour and 30 per day, per browser and per IP (429 with a plain message); one analysis at a time (503 `Echo is busy — try again in a moment.` + `Retry-After: 15` after a 20 s wait). Runs extraction, saves a history row + a transcoded playback copy, returns `{id, features}`. Optional form field `source`: `recording` marks a browser recording; otherwise the clip is an `upload` and its filename is kept (bare name, ≤80 chars) for the history list. The field only labels the clip. |
| POST   | `/capture`      | **Owner only** (valid Cloudflare Access token, else 404). `duration` (≤60) in the query string (`/capture?duration=10`, no body: what the app sends) or a JSON body `{duration}`. Runs the recording wrapper, then the upload pipeline. Returns `{id, features}`. `rec` is killed at duration + 10 s (504, `X-Echo-Error: mic_timeout`). Other mic failures are 503 with an `X-Echo-Error` reason: `mic_busy`, `mic_not_found`, `mic_failed`. One capture at a time: a second request while one runs is a 503 `mic_busy`. Every request leaves a timeline in the log. |
| GET    | `/history`      | **This browser's clips only.** List of `{id, created_at, source_type, name, duration_s}`, newest first. `source_type` is `upload`, `recording` or `pi_mic`; `name` is an uploaded file's name, else `null`. |
| GET    | `/history/{id}` | Full feature JSON + playback audio URL for one clip. 404 unless this browser owns it. Opening a clip restarts its 30-day clock. |
| DELETE | `/history/{id}` | Owner only: deletes the row, the playback copy and the feature file. 204; 404 for anyone else. |
| POST   | `/history/delete` | Body `{"ids": [...]}` (≤100). Deletes those of this browser's clips; IDs that are another browser's, unknown or repeated are skipped silently. Returns `{"deleted": n}`. |
| DELETE | `/capture`      | **Owner only.** `?action=cancel` (default) kills the running recording: the capture answers `{"cancelled": true, "reason": "cancelled"}` and saves nothing; also works during the analysis (the clip is discarded). `?action=stop` ends the recording now and keeps what was recorded (under 1 s: `reason: "too_short"`, nothing saved). A no-op when nothing is running, when already asked, or (stop) once the recording has finished. Returns `{"active", "action"}`. |
| GET    | `/audio/{file}` | Serves the transcoded playback file. 404 unless this browser owns the clip. |
| GET    | `/me`           | **Owner only.** The sign-in step (Cloudflare Access covers this path); redirects to `/app?owner=1`. 404 without a valid token. |
| GET    | `/api/me`       | Public. `{"pi_mic": true}` only for a browser with a valid Access token, else `false`. |
| GET    | `/api/health`   | Public. Exactly `{"ok": true, "status": "ok"}`. |
| GET    | `/api/schema-audit` | **Owner only.** Current-vs-stale feature-schema report. |
| GET    | `/samples`      | Curated sample library: list with attribution + metadata. |
| GET    | `/samples/{id}` | Full feature JSON + audio URL for one sample. |
| GET    | `/samples/audio/{file}` | Serves a sample's playback file. |

**Schema** — `clips(id, created_at, source_type, source_name, duration_s, feature_path, audio_path, schema_version, owner_id, last_seen_at)`.
`id` is a full uuid4 hex (32 chars), and the playback file is named after it, so clip and audio URLs are unguessable. `owner_id` is the browser's visitor ID.
Metadata + file paths only. **Audio blobs are never stored in the DB**
(locked); audio lives on disk under `data/audio/`.

**Private history (v1.7):** no accounts. Each browser gets a random `echo_vid`
cookie (32 hex chars; HttpOnly, Secure, SameSite=Lax, one year, refreshed on
use) and sees only the clips it made. Another browser's clip is a 404, the same
answer as a clip that doesn't exist.

**Retention (locked, decision L6):** per browser, the newest **20** clips;
site-wide, **500** clips or **1 GB** of clip data (playback copies + feature
files + the DB), whichever comes first, oldest deleted first; and any clip not
opened for **30 days** is deleted. Each deletion removes the DB row **and** both
files. Runs on every save, at startup and once a day.

**Owner-only routes (v1.7):** the Pi mic is not public. Cloudflare Access signs
Job in at `/me`; Echo itself verifies the token (signature, audience, issuer,
expiry) on every gated request and answers 404 otherwise, including for direct
LAN requests to port 8014. With no Access settings configured, gated routes are
always 404.

**Hardening (v1.7):** API docs (`/docs`, `/redoc`, `/openapi.json`) are off
unless `ECHO_DEV=1`. Every response carries `X-Content-Type-Options: nosniff`,
`Referrer-Policy: same-origin`, `Permissions-Policy: microphone=(self)` and a
Content-Security-Policy (own files plus `blob:` for the 3D text worker, no
inline scripts, no eval; the only third-party origins are Cloudflare Web
Analytics' two, Job's call). Uploads
must contain an audio stream; every ffprobe/ffmpeg call has a 30 s timeout;
analysis runs in a separate worker process that is killed after 60 s.

**Storage discipline (locked):** the raw uploaded/recorded audio is processed
and then **discarded** — only a small transcoded playback copy (opus/mp3) is
kept. This protects the SD card.

## Sample library

A permanent, curated store under `samples/` (served by the `/samples*`
endpoints), completely separate from the `clips` table: samples are **never**
DB rows, so the retention cleanup can never evict them. 14 clips
spanning two independent sources: 3 birds (Asian Koel, Common Myna,
Rose-ringed Parakeet) sourced from `test-fixtures/xeno-canto/` and seeded by
`verification/seed_samples.py`, plus 11 non-bird animal sounds (Lion, Wolf,
Cow, Dog, Cat, Frog, Cricket, Pig, Red Deer, Bullfrog, Camel) fetched from
the Freesound API and seeded by `verification/fetch_freesound_samples.py` —
chosen (and, for the 4 latest, empirically selected by measuring candidates
against `verification/coverage_gap.py`) to spread across the pitch/timbre/
motion range the birds alone don't cover. Both sets are committed as
product assets. Because the app serves these Creative Commons recordings
publicly, each sample's **attribution (species, recordist, license + URL,
source link back to Xeno-canto or Freesound) is shown in the UI**, not just
the repo manifest. Each manifest entry carries a `provider` field
(`xeno-canto` / `freesound`) so the UI can render the right source link.

---

## Frontend (locked: React 18 + Vite 6 + Tailwind + react-three-fiber)

> **Design v2 (v1.6, November 2026):** the interface was redesigned without
> changing any of the behaviour below. `DESIGN_V2.md` is the source of truth
> for routes, layouts, tokens and copy; this list states what the UI must do.

- **Routes:** a static landing page at `/`; the app at `/app` (and `/app/*`,
  reserved). `/app?record=1`, `?sample=<id>` and `?samples=1` are accepted
  once on load. Installable as a PWA that starts at `/app`.
- **Layouts:** phone (< 640px: home, recording and result screens), a
  single-column layout, and a desktop workspace (≥ 1200px) with a clip
  sidebar showing the loaded clip, the values at the playhead and recent
  clips.
- 3D scene: point/line trail on **pitch / timbre / motion** axes, orbit
  controls, amplitude driving point size + colour (green → amber → cream).
- Upload UI (drag/drop + picker) and a record button (`MediaRecorder`, 60 s
  max, visible countdown) posting to `/upload`. On the phone, recording is a
  full screen with a countdown ring, live level bars, Stop, and a Cancel that
  discards the audio without uploading.
- Spectral panel: seven descriptors as stacked lanes on the scrubber's time
  axis, each toggled by its name, with values at the playhead and on hover.
- Pi capture button + duration selector calling `/capture`, shown **only to
  the signed-in owner** (`/api/me`). While it records, the app shows "Pi mic
  is listening" with a countdown, **Stop** (keep what was recorded) and
  **Cancel** (save nothing). If the answer is lost (phone locked), the app
  finds the new clip in History.
- Playback scrubber synced to the trail (the current point highlights as
  playback advances).
- 2D spectrogram strip below the 3D view, with a **log/mel frequency axis
  (Hz)** and a **time axis** (aligned to the scrubber), scaled crisply to fill
  its container at any viewport width.
- History sheet listing **this browser's** clips, click to reload via
  `/history/{id}`. It says "Your clips live in this browser only.", has a
  delete button per clip (two presses), and a selection mode (Select, or a
  long press on touch; Select all; "Delete N clips" with a confirm step).
- Samples sheet listing the curated sample library (distinct from the
  personal History), each card showing its attribution. A loaded sample's
  credit (recordist, licence, source link) is always visible: in the sidebar
  on desktop, on the stage or dock otherwise.
- No bird / species / identification language in the UI or landing copy;
  sample names and credits are the only exception.

Served in production by FastAPI `StaticFiles` from `frontend/dist`, mounted
**last**, same origin — no CORS, no `credentials: 'include'`.

---

## Deployment (locked)

- systemd service `echo.service`, `Type=simple`, uvicorn on **8014**, restart
  on failure. Since v1.7 it is sandboxed (read-only home, writes only under
  `data/`, `CPUQuota=200%`, `OOMScoreAdjust=500`) and runs with
  `--no-access-log --no-proxy-headers`.
- `echo.job-joseph.com` via one ingress block in the Cloudflare
  Tunnel config.
- **Done when** (v1) `curl https://echo.job-joseph.com/history` returns real
  data from the public URL. Since v1.7 that request returns `[]`: a client
  with no cookie is a new browser with no clips.

---

## Non-goals (v1)

- No bird/species concepts anywhere in schema, code, or UI (that's the
  job of any separate project that uses this API as a client).
- No background listening, no continuous capture, no long-running mic hold.
- No Docker/Kubernetes. No Vercel. No cross-origin setup.
