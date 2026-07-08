# Echo — v1 Specification

This is Echo's own working spec, adapted from the build brief. It is the
contract the code is held to. Anything marked **locked** comes from
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
   `/upload` endpoint** — no separate pipeline. Android Chrome is the target;
   iOS Safari quirks are noted in `LEARNINGS.md` and do not block v1.
3. **Pi USB mic capture** — `/capture` triggers `~/bin/rec` for the requested
   duration (≤60 s), then the same pipeline. The mic is acquired only for the
   recording window and released immediately — never held in the background.

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
| POST   | `/upload`       | Accepts an audio file **or** a browser-recorded blob (same validation). Runs extraction, saves a history row + a transcoded playback copy, returns `{id, features}`. |
| POST   | `/capture`      | Body `{duration}` (≤60). Runs `~/bin/rec`, then the upload pipeline. Returns `{id, features}`. |
| GET    | `/history`      | List of `{id, created_at, source_type, duration_s}`, newest first. |
| GET    | `/history/{id}` | Full feature JSON + playback audio URL for one clip. |
| GET    | `/audio/{file}` | Serves the transcoded playback file. |
| GET    | `/samples`      | Curated sample library: list with attribution + metadata. |
| GET    | `/samples/{id}` | Full feature JSON + audio URL for one sample. |
| GET    | `/samples/audio/{file}` | Serves a sample's playback file. |

**Schema** — `clips(id, created_at, source_type, duration_s, feature_path, audio_path)`.
Metadata + file paths only. **Audio blobs are never stored in the DB**
(locked); audio lives on disk under `data/audio/`.

**Retention (locked):** keep the last **50** entries. On each save beyond 50,
the oldest entry's DB row **and** its files (audio + features) are deleted.

**Storage discipline (locked):** the raw uploaded/recorded audio is processed
and then **discarded** — only a small transcoded playback copy (opus/mp3) is
kept. This protects the SD card.

## Sample library

A permanent, curated store under `samples/` (served by the `/samples*`
endpoints), completely separate from the `clips` table: samples are **never**
DB rows, so the 50-entry retention cleanup can never evict them. One clip per
species (Asian Koel, Common Myna, Rose-ringed Parakeet), sourced from
`test-fixtures/xeno-canto/` and committed as product assets. Because the app
serves these CC BY-NC-SA recordings publicly, each sample's **attribution
(species, recordist, license + URL, Xeno-canto source link) is shown in the
UI**, not just the repo manifest. Seeded/regenerated by
`verification/seed_samples.py`.

---

## Frontend (locked: React 18 + Vite 6 + Tailwind + react-three-fiber)

- 3D scene: point/line trail on **pitch / timbre / motion** axes, orbit
  controls, amplitude driving point size + color intensity.
- Upload UI (drag/drop + picker) and a record button (`MediaRecorder`, 60 s
  max, visible countdown) posting to `/upload`.
- Pi capture button + duration selector calling `/capture`.
- Playback scrubber synced to the trail (the current point highlights as
  playback advances).
- 2D spectrogram strip below the 3D view, with a **log/mel frequency axis
  (Hz)** and a **time axis** (aligned to the scrubber), scaled crisply to fill
  its container at any viewport width.
- History gallery listing past clips, click to reload via `/history/{id}`.
- “🐦 Samples” drawer listing the curated sample library (distinct from the
  personal History gallery), each card showing its attribution.

Served in production by FastAPI `StaticFiles` from `frontend/dist`, mounted
**last**, same origin — no CORS, no `credentials: 'include'`.

---

## Deployment (locked)

- systemd service `echo.service`, `Type=simple`, uvicorn on **8014**, restart
  on failure.
- `echo.job-joseph.com` via one new ingress block in the `pi-home` Cloudflare
  Tunnel config, following `CLAUDE.md`'s editing rules exactly.
- **Done when** `curl https://echo.job-joseph.com/history` returns real data
  from the public URL.

---

## Non-goals (v1)

- No bird/species concepts anywhere in schema, code, or UI (that's the
  separate Avian Visitors project, a future *client* of this API).
- No background listening, no continuous capture, no long-running mic hold.
- No Docker/Kubernetes. No Vercel. No cross-origin setup.
